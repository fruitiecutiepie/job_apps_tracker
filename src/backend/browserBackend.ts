import { isSafeAttachmentId, MAX_ATTACHMENT_BYTES } from '../domain/attachmentPaths'
import { createEmptyDocument, ensureFreshIndexes, refreshTrackerDatabase } from '../domain/database'
import { createDemoDocument } from '../domain/demo'
import { createUuidV7 } from '../domain/id'
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
import { locationAddress, NEW_TRACKER, type TrackerAddress } from './trackerAddress'
import type {
  ConnectableStorage,
  ConnectResult,
  StorageConnection,
  StorageState,
  TrackerBackend,
  TrackerSummary,
} from './types'

/** Mirrors the layout the dev server writes, so the same folder opens in either build. */
export const TRACKER_FILENAME = 'tracker.json'
export const ATTACHMENTS_DIRNAME = 'attachments'

/*
 * Every tracker this browser holds lives under keys carrying its id, so two tabs holding
 * two trackers never read or write each other's. The keys below are the layout from
 * before there could be more than one; `migrateSingleTracker` moves them under an id.
 */
const LEGACY_DOCUMENT_KEY = 'document'
const LEGACY_DIRECTORY_KEY = 'directoryHandle'
const LEGACY_BACKLOG_KEY = 'unbackedSince'

const META_PREFIX = 'meta:'
const documentKey = (id: string) => `document:${id}`
const directoryKey = (id: string) => `directory:${id}`
const backlogKey = (id: string) => `backlog:${id}`
const metaKey = (id: string) => `${META_PREFIX}${id}`

export const UNTITLED_TRACKER = 'Untitled tracker'

export interface BrowserBackendOptions {
  store?: KeyValueStore
  supportsFolders?: boolean
  /** Opens the picker. Injected so tests can hand over a fake folder. */
  pick?: () => Promise<DirectoryHandleLike | null>
  /** Asks the browser not to evict this origin's storage. Injected so tests can see it. */
  persist?: () => Promise<boolean>
  now?: () => Date
  /** Which tracker this tab holds. The page's URL unless a test says otherwise. */
  address?: TrackerAddress
}

function serialize(document: TrackerDatabase): string {
  return `${JSON.stringify(assertTrackerDocument(document), null, 2)}\n`
}

/** `job-search.json` names a tracker `job-search`; an export's zip the same way. */
export function trackerNameFromFile(filename: string): string {
  const base = filename.replace(/\.(json|zip)$/i, '').trim()
  return base || UNTITLED_TRACKER
}

/*
 * A tracker started from nothing has no file to be named after, and two of them both
 * called "Untitled tracker" could not be told apart in the switcher or the tab strip —
 * which is the one thing a name here is for. So each new one takes the next number.
 */
export function untitledName(taken: string[]): string {
  if (!taken.includes(UNTITLED_TRACKER)) return UNTITLED_TRACKER
  let n = 2
  while (taken.includes(`${UNTITLED_TRACKER} ${n}`)) n += 1
  return `${UNTITLED_TRACKER} ${n}`
}

function countApplications(text: string): number {
  try {
    const parsed = JSON.parse(text) as { applications?: unknown }
    return Array.isArray(parsed.applications) ? parsed.applications.length : 0
  } catch {
    return 0
  }
}

/**
 * Storage for the static build. Every change lands in IndexedDB, and additionally in a
 * folder the viewer picked once the File System Access API is available and connected.
 *
 * The two are not alternatives. The folder is the copy that outlives the browser profile;
 * the IndexedDB copy is what stops a revoked folder permission — which the browser can do
 * without asking, and which cannot be renewed outside a user gesture — from also taking
 * the data with it.
 *
 * A browser can hold several trackers, each with its own document, folder, backlog and
 * attachments; a backend instance serves the one its tab's URL names.
 */
export function browserBackend(options: BrowserBackendOptions = {}): TrackerBackend {
  const store = options.store ?? defaultStore()
  const canConnect = options.supportsFolders ?? supportsDirectoryPicker()
  const pick = options.pick ?? pickDirectory
  const persist = options.persist ?? requestPersistence
  const now = options.now ?? (() => new Date())
  const address = options.address ?? locationAddress()

  let directory: DirectoryHandleLike | null = null
  let connection: StorageConnection = canConnect ? { kind: 'disconnected' } : { kind: 'unsupported' }
  let unbackedSince: string | null = null
  let restored: Promise<void> | null = null
  const listeners = new Set<(state: StorageState) => void>()

  /*
   * Which tracker this is. `meta` is null until it has been written, which for a new
   * tracker is its first save: opening an empty tracker writes nothing, so a tab opened
   * and closed without typing leaves nothing behind to list.
   */
  let trackerId: string | null = null
  let trackerName = UNTITLED_TRACKER
  let meta: TrackerSummary | null = null
  /* No tracker existed anywhere when this one was opened: the demo seeds only then. */
  let firstEver = false

  function state(): StorageState {
    return {
      connection,
      unbackedSince,
      tracker: trackerId === null ? null : { id: trackerId, name: trackerName },
    }
  }

  function announce(next: StorageConnection = connection): StorageConnection {
    connection = next
    const current = state()
    for (const listener of listeners) listener(current)
    return next
  }

  function id(): string {
    if (trackerId === null) throw new Error('No tracker is open yet')
    return trackerId
  }

  async function listMetas(): Promise<TrackerSummary[]> {
    const metas: TrackerSummary[] = []
    for (const key of await store.keys('state')) {
      if (!key.startsWith(META_PREFIX)) continue
      const value = (await store.get('state', key)) as TrackerSummary | null
      if (value) metas.push(value)
    }
    return metas.sort((left, right) => right.openedAt.localeCompare(left.openedAt))
  }

  async function writeMeta(applications: number): Promise<void> {
    meta = {
      id: id(),
      name: trackerName,
      applications,
      openedAt: meta?.openedAt ?? now().toISOString(),
    }
    await store.put('state', metaKey(meta.id), meta)
  }

  /*
   * The layout from before a browser could hold more than one tracker: one document, one
   * folder handle, one backlog, and attachments keyed without a tracker. Moved under an id
   * of its own so an existing visitor's data becomes their first tracker rather than
   * vanishing behind keys nothing reads any more.
   */
  async function migrateSingleTracker(): Promise<void> {
    const document = (await store.get('state', LEGACY_DOCUMENT_KEY)) as string | null
    const handle = (await store.get('state', LEGACY_DIRECTORY_KEY)) as DirectoryHandleLike | null
    const backlog = (await store.get('state', LEGACY_BACKLOG_KEY)) as string | null
    if (document === null && handle === null) return

    const migrated = createUuidV7(now())
    if (document !== null) await store.put('state', documentKey(migrated), document)
    if (handle !== null) await store.put('state', directoryKey(migrated), handle)
    if (backlog !== null) await store.put('state', backlogKey(migrated), backlog)
    for (const key of await store.keys('attachments')) {
      if (key.split('/').length !== 2) continue
      await store.put('attachments', `${migrated}/${key}`, await store.get('attachments', key))
      await store.delete('attachments', key)
    }
    const summary: TrackerSummary = {
      id: migrated,
      name: handle?.name ?? UNTITLED_TRACKER,
      applications: document === null ? 0 : countApplications(document),
      openedAt: now().toISOString(),
    }
    await store.put('state', metaKey(migrated), summary)
    await store.delete('state', LEGACY_DOCUMENT_KEY)
    await store.delete('state', LEGACY_DIRECTORY_KEY)
    await store.delete('state', LEGACY_BACKLOG_KEY)
  }

  /*
   * The tracker the URL names, if this browser holds it; else, when the URL names none,
   * the one opened most recently; else a new one. An id nobody holds — a tracker removed
   * in another tab, a link from another browser — opens a new tracker rather than an
   * error, because there is nothing to show for it and an empty tracker is harmless.
   */
  async function resolveTracker(): Promise<void> {
    await migrateSingleTracker()
    const metas = await listMetas()
    const requested = address.requested()
    const found = requested === null
      ? metas[0]
      : requested === NEW_TRACKER ? undefined : metas.find((candidate) => candidate.id === requested)
    firstEver = metas.length === 0 && requested !== NEW_TRACKER
    if (found) {
      trackerId = found.id
      trackerName = found.name
      meta = { ...found, openedAt: now().toISOString() }
      await store.put('state', metaKey(found.id), meta)
    } else {
      trackerId = createUuidV7(now())
      trackerName = isDemoTrackerProfile() && firstEver
        ? 'Demo'
        : untitledName(metas.map((candidate) => candidate.name))
      meta = null
    }
    address.show(trackerId)
  }

  /*
   * The first write that reaches no file starts the backlog; later ones leave its date
   * alone, since "only in this browser since Tuesday" is the fact worth knowing. The
   * demo is exempt: nagging someone to back up nineteen fictional applications would
   * teach them to ignore the reminder on the site where it matters.
   */
  async function noteUnbacked(): Promise<void> {
    if (unbackedSince !== null || isDemoTrackerProfile()) return
    unbackedSince = now().toISOString()
    await store.put('state', backlogKey(id()), unbackedSince)
    announce()
    /*
     * This is the moment the browser copy became the only copy, so it is the moment to
     * ask the browser not to evict it under storage pressure. Whatever it answers, the
     * reminder stands: persistence makes eviction less likely, not a file you hold.
     */
    void persist().catch(() => false)
  }

  /** Leaves announcing to the caller, which usually has a connection change to announce too. */
  async function clearBacklog(): Promise<void> {
    if (unbackedSince === null) return
    unbackedSince = null
    await store.delete('state', backlogKey(id()))
  }

  /*
   * A handle survives a reload in IndexedDB, but its permission may not. `ask: false`
   * here because restoring happens on load, outside any gesture — `needs-permission` is
   * the honest answer, and the UI turns it into a button the viewer can press.
   */
  async function restore(): Promise<void> {
    await resolveTracker()
    const backlog = (await store.get('state', backlogKey(id()))) as string | null
    if (backlog !== null && !isDemoTrackerProfile()) unbackedSince = backlog
    announce()
    if (!canConnect) return
    const stored = (await store.get('state', directoryKey(id()))) as DirectoryHandleLike | null
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
    await store.delete('state', directoryKey(id()))
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

  const attachmentPrefix = () => `${id()}/`
  const attachmentKey = (applicationId: string, attachmentId: string) =>
    `${attachmentPrefix()}${applicationId}/${attachmentId}`

  async function deleteAttachmentsWithPrefix(prefix: string): Promise<void> {
    for (const key of await store.keys('attachments')) {
      if (key.startsWith(prefix)) await store.delete('attachments', key)
    }
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

  /*
   * Pushes everything held in browser storage into the folder.
   *
   * This runs on reconnect, and the direction matters: while the permission was lapsed the
   * browser copy kept taking writes and the folder's stopped, so the browser copy is the
   * newer of the two. Reading the folder instead would replace however long someone spent
   * typing with the file as it stood when the permission went, and report it as a success.
   *
   * Attachments are rewritten wholesale rather than tracked as dirty. Reconnecting is rare,
   * the alternative is a second set of bookkeeping that can itself go stale, and an
   * attachment that never reached the folder is indistinguishable from one that did
   * without reading both back.
   */
  async function flushToFolder(): Promise<void> {
    if (!directory) return
    const cached = (await store.get('state', documentKey(id()))) as string | null
    if (cached !== null) await writeFileIn(directory, TRACKER_FILENAME, cached)

    const prefix = attachmentPrefix()
    for (const key of await store.keys('attachments')) {
      if (!key.startsWith(prefix)) continue
      const [applicationId, attachmentId] = key.slice(prefix.length).split('/')
      if (!applicationId || !attachmentId) continue
      const bytes = (await store.get('attachments', key)) as ArrayBuffer | null
      if (!bytes) continue
      const application = await applicationDirectory(applicationId, true)
      if (application) await writeFileIn(application, attachmentId, bytes)
    }
  }

  /** Browser storage only, with the tracker's entry in the list kept in step. */
  async function cacheDocument(text: string, applications: number): Promise<void> {
    await store.put('state', documentKey(id()), text)
    await writeMeta(applications)
  }

  async function writeDocument(document: TrackerDatabase): Promise<void> {
    const text = serialize(document)
    await cacheDocument(text, document.applications.length)
    if (directory) await writeFileIn(directory, TRACKER_FILENAME, text)
    else await noteUnbacked()
  }

  /* Another tracker in this browser already writing to the folder just picked, if any. */
  async function trackerHolding(picked: DirectoryHandleLike): Promise<TrackerSummary | null> {
    if (!picked.isSameEntry) return null
    for (const other of await listMetas()) {
      if (other.id === trackerId) continue
      const handle = (await store.get('state', directoryKey(other.id))) as DirectoryHandleLike | null
      if (handle && (await picked.isSameEntry(handle))) return other
    }
    return null
  }

  const storage: ConnectableStorage = {
    connection: () => connection,
    state,

    async connect(): Promise<ConnectResult> {
      await ready()
      const picked = await pick()
      if (!picked) return { outcome: 'dismissed' }
      const holder = await trackerHolding(picked)
      if (holder) return { outcome: 'already-open', tracker: holder }

      directory = picked
      trackerName = picked.name
      await store.put('state', directoryKey(id()), picked)
      /*
       * Connecting a folder adopts whatever is already in it. Someone pointing the site
       * at the folder they exported last week means to open that data, not to overwrite
       * it with the empty document the page started on.
       */
      const existing = await readFileIn(picked, TRACKER_FILENAME)
      if (existing) {
        const parsed = ensureFreshIndexes(parseTrackerDocument(await existing.text()))
        await cacheDocument(serialize(parsed), parsed.applications.length)
      } else {
        const cached = (await store.get('state', documentKey(id()))) as string | null
        const text = cached ?? serialize(createEmptyDocument())
        await writeFileIn(picked, TRACKER_FILENAME, text)
        await cacheDocument(text, countApplications(text))
      }
      await clearBacklog()
      return {
        outcome: 'connected',
        connection: announce({ kind: 'connected', name: picked.name }),
      }
    },

    async reconnect(): Promise<StorageConnection> {
      await ready()
      const stored = (await store.get('state', directoryKey(id()))) as DirectoryHandleLike | null
      if (!stored) return announce({ kind: 'disconnected' })
      const permission = await permissionFor(stored, true)
      if (permission !== 'granted') {
        return announce({ kind: 'needs-permission', name: stored.name })
      }
      directory = stored
      await flushToFolder()
      await clearBacklog()
      return announce({ kind: 'connected', name: stored.name })
    },

    async disconnect(): Promise<StorageConnection> {
      await ready()
      directory = null
      await store.delete('state', directoryKey(id()))
      return announce(canConnect ? { kind: 'disconnected' } : { kind: 'unsupported' })
    },

    /*
     * Waits on `ready` as every save does, so it joins the queue behind a save made just
     * before it rather than overtaking one still waiting to start — and so the stored
     * backlog has been read before there is anything to clear.
     */
    async markBackedUp(): Promise<void> {
      await ready()
      return serialized(async () => {
        if (unbackedSince === null) return
        await clearBacklog()
        announce()
      })
    },

    async nameAfterFile(filename: string): Promise<void> {
      await ready()
      return serialized(async () => {
        if (directory) return
        trackerName = trackerNameFromFile(filename)
        if (meta) await writeMeta(meta.applications)
        announce()
      })
    },

    async listTrackers(): Promise<TrackerSummary[]> {
      await ready()
      return listMetas()
    },

    async removeTracker(): Promise<TrackerSummary | null> {
      await ready()
      return serialized(async () => {
        const removing = id()
        await deleteAttachmentsWithPrefix(`${removing}/`)
        await store.delete('state', documentKey(removing))
        await store.delete('state', directoryKey(removing))
        await store.delete('state', backlogKey(removing))
        await store.delete('state', metaKey(removing))
        directory = null
        meta = null
        unbackedSince = null
        return (await listMetas())[0] ?? null
      })
    },

    subscribe(listener): () => void {
      listeners.add(listener)
      listener(state())
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
            await cacheDocument(serialize(parsed), parsed.applications.length)
            return parsed
          }
        }

        const cached = (await store.get('state', documentKey(id()))) as string | null
        if (cached === null) {
          /*
           * Nothing stored yet. The demo profile seeds its nineteen examples and writes
           * them, so a visitor has something to look at; the real tracker opens empty and
           * writes nothing, so "nothing stored" stays true until they type something.
           *
           * The seed is written rather than only returned, which is what makes it a first
           * visit rather than every visit: someone who deletes every demo row gets an
           * empty demo back on reload, not the nineteen they just cleared. It is the first
           * visit to the demo, not to each tracker in it: a new tracker there is empty,
           * because that is what New tracker asked for.
           */
          if (!isDemoTrackerProfile() || !firstEver) return createEmptyDocument()
          const demo = refreshTrackerDatabase(createDemoDocument())
          await writeDocument(demo)
          return demo
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
        await deleteAttachmentsWithPrefix(attachmentPrefix())
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
        await deleteAttachmentsWithPrefix(`${attachmentPrefix()}${applicationId}/`)
        const attachments = await attachmentsDirectory(false)
        if (attachments) await removeEntryIn(attachments, applicationId, true)
      })
    },

    async wipeAttachments(): Promise<void> {
      await ready()
      await serialized(async () => {
        // This tracker's only: the others in this browser keep theirs.
        await deleteAttachmentsWithPrefix(attachmentPrefix())
        if (directory) await removeEntryIn(directory, ATTACHMENTS_DIRNAME, true)
      })
    },
  }
}

function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return Promise.resolve(false)
  return navigator.storage.persist()
}

function defaultStore(): KeyValueStore {
  // Private browsing and locked-down profiles can refuse IndexedDB outright.
  if (typeof indexedDB === 'undefined') return memoryStore()
  return indexedDbStore()
}
