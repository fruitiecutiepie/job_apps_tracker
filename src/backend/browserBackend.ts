import { isSafeAttachmentId, MAX_ATTACHMENT_BYTES } from '../domain/attachmentPaths'
import { createEmptyDocument, ensureFreshIndexes, refreshTrackerDatabase } from '../domain/database'
import { createDemoDocument } from '../domain/demo'
import { isDemoTrackerProfile } from '../domain/trackerProfile'
import type { TrackerDatabase } from '../domain/types'
import { assertTrackerDocument, parseTrackerDocument } from '../domain/validation'
import {
  permissionFor,
  pickDirectory,
  readFileIn,
  removeEntryIn,
  subdirectory,
  supportsDirectoryPicker,
  writeFileIn,
  type DirectoryHandleLike,
} from './fileSystem'
import { indexedDbStore, memoryStore, type KeyValueStore } from './idb'
import type { ConnectableStorage, StorageConnection, TrackerBackend } from './types'

/** Mirrors the layout the dev server writes, so the same folder opens in either build. */
export const TRACKER_FILENAME = 'tracker.json'
export const ATTACHMENTS_DIRNAME = 'attachments'

const DOCUMENT_KEY = 'document'
const DIRECTORY_KEY = 'directoryHandle'

export interface BrowserBackendOptions {
  store?: KeyValueStore
  supportsFolders?: boolean
  /** Opens the picker. Injected so tests can hand over a fake folder. */
  pick?: () => Promise<DirectoryHandleLike | null>
}

function attachmentKey(applicationId: string, attachmentId: string): string {
  return `${applicationId}/${attachmentId}`
}

function serialize(document: TrackerDatabase): string {
  return `${JSON.stringify(assertTrackerDocument(document), null, 2)}\n`
}

/**
 * Storage for the static build. Every change lands in IndexedDB, and additionally in a
 * folder the viewer picked once the File System Access API is available and connected.
 *
 * The two are not alternatives. The folder is the copy that outlives the browser profile;
 * the IndexedDB copy is what stops a revoked folder permission — which the browser can do
 * without asking, and which cannot be renewed outside a user gesture — from also taking
 * the data with it.
 */
export function browserBackend(options: BrowserBackendOptions = {}): TrackerBackend {
  const store = options.store ?? defaultStore()
  const canConnect = options.supportsFolders ?? supportsDirectoryPicker()
  const pick = options.pick ?? pickDirectory

  let directory: DirectoryHandleLike | null = null
  let connection: StorageConnection = canConnect ? { kind: 'disconnected' } : { kind: 'unsupported' }
  let restored: Promise<void> | null = null
  const listeners = new Set<(connection: StorageConnection) => void>()

  function announce(next: StorageConnection): StorageConnection {
    connection = next
    for (const listener of listeners) listener(next)
    return next
  }

  /*
   * A handle survives a reload in IndexedDB, but its permission may not. `ask: false`
   * here because restoring happens on load, outside any gesture — `needs-permission` is
   * the honest answer, and the UI turns it into a button the viewer can press.
   */
  async function restore(): Promise<void> {
    if (!canConnect) return
    const stored = (await store.get('state', DIRECTORY_KEY)) as DirectoryHandleLike | null
    if (!stored) return
    const permission = await permissionFor(stored, false)
    if (permission === 'granted') {
      directory = stored
      announce({ kind: 'connected', name: stored.name })
      return
    }
    if (permission === 'prompt') {
      announce({ kind: 'needs-permission', name: stored.name })
      return
    }
    await store.delete('state', DIRECTORY_KEY)
  }

  function ready(): Promise<void> {
    return (restored ??= restore().catch(() => undefined))
  }

  /*
   * Writes run one at a time. `App.tsx` already queues its mutations, but a backend that
   * only behaves when its caller does is a backend that will misbehave when a second
   * caller arrives.
   */
  let queue: Promise<unknown> = Promise.resolve()
  function serialized<T>(run: () => Promise<T>): Promise<T> {
    const done = queue.then(run)
    queue = done.catch(() => undefined)
    return done
  }

  async function attachmentsDirectory(create: boolean): Promise<DirectoryHandleLike | null> {
    if (!directory) return null
    return subdirectory(directory, ATTACHMENTS_DIRNAME, create)
  }

  async function applicationDirectory(
    applicationId: string,
    create: boolean,
  ): Promise<DirectoryHandleLike | null> {
    const attachments = await attachmentsDirectory(create)
    if (!attachments) return null
    return subdirectory(attachments, applicationId, create)
  }

  async function writeDocument(document: TrackerDatabase): Promise<void> {
    const text = serialize(document)
    await store.put('state', DOCUMENT_KEY, text)
    if (directory) await writeFileIn(directory, TRACKER_FILENAME, text)
  }

  const storage: ConnectableStorage = {
    connection: () => connection,

    async connect(): Promise<StorageConnection> {
      const picked = await pick()
      if (!picked) return connection
      directory = picked
      await store.put('state', DIRECTORY_KEY, picked)
      /*
       * Connecting a folder adopts whatever is already in it. Someone pointing the site
       * at the folder they exported last week means to open that data, not to overwrite
       * it with the empty document the page started on.
       */
      const existing = await readFileIn(picked, TRACKER_FILENAME)
      if (existing) {
        const parsed = ensureFreshIndexes(parseTrackerDocument(await existing.text()))
        await store.put('state', DOCUMENT_KEY, serialize(parsed))
      } else {
        const cached = (await store.get('state', DOCUMENT_KEY)) as string | null
        await writeFileIn(picked, TRACKER_FILENAME, cached ?? serialize(createEmptyDocument()))
      }
      return announce({ kind: 'connected', name: picked.name })
    },

    async reconnect(): Promise<StorageConnection> {
      const stored = (await store.get('state', DIRECTORY_KEY)) as DirectoryHandleLike | null
      if (!stored) return announce({ kind: 'disconnected' })
      const permission = await permissionFor(stored, true)
      if (permission !== 'granted') {
        return announce({ kind: 'needs-permission', name: stored.name })
      }
      directory = stored
      return announce({ kind: 'connected', name: stored.name })
    },

    async disconnect(): Promise<StorageConnection> {
      directory = null
      await store.delete('state', DIRECTORY_KEY)
      return announce(canConnect ? { kind: 'disconnected' } : { kind: 'unsupported' })
    },

    subscribe(listener): () => void {
      listeners.add(listener)
      listener(connection)
      return () => void listeners.delete(listener)
    },
  }

  return {
    capabilities: { externalEditor: false, connectableStorage: true },
    storage,

    async loadDocument(): Promise<TrackerDatabase> {
      await ready()
      return serialized(async () => {
        if (directory) {
          const file = await readFileIn(directory, TRACKER_FILENAME)
          if (file) {
            const parsed = ensureFreshIndexes(parseTrackerDocument(await file.text()))
            await store.put('state', DOCUMENT_KEY, serialize(parsed))
            return parsed
          }
        }

        const cached = (await store.get('state', DOCUMENT_KEY)) as string | null
        if (cached === null) {
          // First visit: an empty tracker, not the demo data, and nothing written yet.
          return createEmptyDocument()
        }
        const parsed = ensureFreshIndexes(parseTrackerDocument(cached))
        if (directory) await writeFileIn(directory, TRACKER_FILENAME, serialize(parsed))
        return parsed
      })
    },

    async saveDocument(document: TrackerDatabase): Promise<TrackerDatabase> {
      await ready()
      const refreshed = refreshTrackerDatabase(document)
      return serialized(async () => {
        await writeDocument(refreshed)
        return refreshed
      })
    },

    async resetDocument(): Promise<TrackerDatabase> {
      if (!isDemoTrackerProfile()) {
        throw new Error('Resetting is only available in the demo profile')
      }
      await ready()
      return serialized(async () => {
        await store.clear('attachments')
        const attachments = await attachmentsDirectory(false)
        if (attachments && directory) await removeEntryIn(directory, ATTACHMENTS_DIRNAME, true)
        const demo = refreshTrackerDatabase(createDemoDocument())
        await writeDocument(demo)
        return demo
      })
    },

    async readAttachment(applicationId: string, attachmentId: string): Promise<Uint8Array | null> {
      await ready()
      const application = await applicationDirectory(applicationId, false)
      if (application) {
        const file = await readFileIn(application, attachmentId)
        if (file && file.size > 0) return new Uint8Array(await file.arrayBuffer())
      }
      const cached = (await store.get('attachments', attachmentKey(applicationId, attachmentId))) as
        | ArrayBuffer
        | null
      if (!cached || cached.byteLength === 0) return null
      return new Uint8Array(cached)
    },

    async writeAttachment(
      applicationId: string,
      attachmentId: string,
      file: Blob,
    ): Promise<void> {
      if (!isSafeAttachmentId(applicationId) || !isSafeAttachmentId(attachmentId)) {
        throw new TypeError('Attachment ids are invalid')
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        throw new TypeError(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte limit`)
      }
      await ready()
      const bytes = await file.arrayBuffer()
      await serialized(async () => {
        await store.put('attachments', attachmentKey(applicationId, attachmentId), bytes)
        const application = await applicationDirectory(applicationId, true)
        if (application) await writeFileIn(application, attachmentId, bytes)
      })
    },

    async deleteAttachment(applicationId: string, attachmentId: string): Promise<void> {
      await ready()
      await serialized(async () => {
        await store.delete('attachments', attachmentKey(applicationId, attachmentId))
        const application = await applicationDirectory(applicationId, false)
        if (application) await removeEntryIn(application, attachmentId)
      })
    },

    async deleteApplicationAttachments(applicationId: string): Promise<void> {
      await ready()
      await serialized(async () => {
        const prefix = `${applicationId}/`
        for (const key of await store.keys('attachments')) {
          if (key.startsWith(prefix)) await store.delete('attachments', key)
        }
        const attachments = await attachmentsDirectory(false)
        if (attachments) await removeEntryIn(attachments, applicationId, true)
      })
    },

    async wipeAttachments(): Promise<void> {
      await ready()
      await serialized(async () => {
        await store.clear('attachments')
        if (directory) await removeEntryIn(directory, ATTACHMENTS_DIRNAME, true)
      })
    },
  }
}

function defaultStore(): KeyValueStore {
  // Private browsing and locked-down profiles can refuse IndexedDB outright.
  if (typeof indexedDB === 'undefined') return memoryStore()
  return indexedDbStore()
}
