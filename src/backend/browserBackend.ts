import { isSafeAttachmentId, MAX_ATTACHMENT_BYTES } from '../domain/attachmentPaths'
import { createEmptyDocument, ensureFreshIndexes, refreshTrackerDatabase } from '../domain/database'
import { createDemoDocument } from '../domain/demo'
import { createUuidV7 } from '../domain/id'
import { renameTracker } from '../domain/mutations'
import { isDemoTrackerProfile, trackerProfile } from '../domain/trackerProfile'
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
  type FileHandleLike,
} from './fileSystem'
import { idbName, indexedDbStore, memoryStore, type KeyValueStore } from './idb'
import { broadcastChannel, webLocks, type TabChannel, type TabLock, type TabMessage } from './tabSync'
import { locationAddress, NEW_TRACKER, type TrackerAddress } from './trackerAddress'
import type {
  ConnectableStorage,
  ConnectResult,
  ExternalChange,
  OpenResult,
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
const revisionKey = (id: string) => `revision:${id}`
const metaKey = (id: string) => `${META_PREFIX}${id}`
/* The handle of the file a tracker came from, kept so a later drop of it can be matched. */
const sourceKey = (id: string) => `source:${id}`

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
  /** Makes two tabs' writes to one tracker take turns. The Web Locks API by default. */
  locks?: TabLock
  /** Tells the other tabs on a tracker that it changed. `BroadcastChannel` by default. */
  channel?: (name: string) => TabChannel | null
}

function serialize(document: TrackerDatabase): string {
  return `${JSON.stringify(assertTrackerDocument(document), null, 2)}\n`
}

/**
 * `job-search.json` names a tracker `job-search`; an export's zip the same way. The date an
 * export stamps on its name — and the ` (1)` a browser adds to a second download that day —
 * is dropped, so a tracker exported and imported again comes back under its own name.
 */
export function trackerNameFromFile(filename: string): string {
  const base = filename
    .replace(/\.(json|zip)$/i, '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[ -]\d{4}-\d{2}-\d{2}(T[\d-]+Z)?$/, '')
    .trim()
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
  const locks = options.locks ?? webLocks()
  const openChannel = options.channel ?? broadcastChannel

  let directory: DirectoryHandleLike | null = null
  let connection: StorageConnection = canConnect ? { kind: 'disconnected' } : { kind: 'unsupported' }
  let unbackedSince: string | null = null
  let writing = 0
  let restored: Promise<void> | null = null
  const listeners = new Set<(state: StorageState) => void>()

  /*
   * Which tracker this is. `meta` is null until it has been written, which for a new
   * tracker is its first save: opening an empty tracker writes nothing, so a tab opened
   * and closed without typing leaves nothing behind to list.
   */
  let trackerId: string | null = null
  /*
   * The name shown is the document's own when the reader gave it one — stored in the file,
   * so it travels with the folder and every export — and `fallbackName` otherwise.
   */
  let trackerName = UNTITLED_TRACKER
  let fallbackName = UNTITLED_TRACKER
  let sourceFile: string | null = null
  let meta: TrackerSummary | null = null
  /* No tracker existed anywhere when this one was opened: the demo seeds only then. */
  let firstEver = false

  /*
   * Another tab can hold this same tracker, and every write stores the whole document, so
   * two writes built on one snapshot do not merge: the second silently undoes the first.
   * Three things stop that. Each stored document carries a revision; a write runs under a
   * lock every tab on the tracker shares, and inside it checks the revision against the
   * one this tab last saw, reading the newer document before applying its mutation when
   * another tab has written since; and each write tells the other tabs, which read it at
   * once so what they show never falls behind what is stored.
   */
  let knownRevision = 0
  let knownDocument: TrackerDatabase | null = null
  let channel: TabChannel | null = null
  const changeListeners = new Set<(change: ExternalChange) => void>()

  function state(): StorageState {
    return {
      connection,
      unbackedSince,
      saving: writing > 0,
      tracker: trackerId === null ? null : { id: trackerId, name: trackerName, sourceFile },
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
      fallbackName,
      applications,
      openedAt: meta?.openedAt ?? now().toISOString(),
      ...(sourceFile ? { sourceFile } : {}),
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
      fallbackName = found.fallbackName ?? found.name
      sourceFile = found.sourceFile ?? null
      meta = { ...found, openedAt: now().toISOString() }
      await store.put('state', metaKey(found.id), meta)
    } else {
      trackerId = createUuidV7(now())
      fallbackName = isDemoTrackerProfile() && firstEver
        ? 'Demo'
        : untitledName(metas.map((candidate) => candidate.name))
      trackerName = fallbackName
      meta = null
    }
    address.show(trackerId)
    knownRevision = ((await store.get('state', revisionKey(trackerId))) as number | null) ?? 0
    channel = openChannel(`${idbName(trackerProfile())}:${trackerId}`)
    channel?.listen((message) => void hear(message))
  }

  function post(message: TabMessage): void {
    channel?.post(message)
  }

  /* Tells the tabs holding some tracker, this tab's or another. */
  function postTo(tracker: string, message: TabMessage): void {
    if (tracker === trackerId) {
      post(message)
      return
    }
    const other = openChannel(`${idbName(trackerProfile())}:${tracker}`)
    other?.post(message)
    other?.close?.()
  }

  /*
   * A critical section on any tracker: this tab's own goes through `exclusive`; another's
   * takes that tracker's lock, so it never lands between the halves of a write made by a
   * tab holding it.
   */
  function onTracker<T>(tracker: string, run: () => Promise<T>): Promise<T> {
    if (tracker === trackerId) return exclusive(run)
    return serialized(() => locks.run(`${idbName(trackerProfile())}:${tracker}`, run))
  }

  /** A write's critical section: in this tab's queue, then under the tracker's lock. */
  function exclusive<T>(run: () => Promise<T>): Promise<T> {
    return serialized(() => locks.run(`${idbName(trackerProfile())}:${id()}`, run))
  }

  /*
   * The newest stored document, read when another tab has written since this one last
   * looked. Null when nothing newer is there to read.
   */
  async function catchUp(): Promise<TrackerDatabase | null> {
    const stored = ((await store.get('state', revisionKey(id()))) as number | null) ?? 0
    if (stored === knownRevision) return null
    knownRevision = stored
    const text = (await store.get('state', documentKey(id()))) as string | null
    if (text === null) return null
    knownDocument = ensureFreshIndexes(parseTrackerDocument(text))
    syncName()
    return knownDocument
  }

  /** The document's own name when it has one; the fallback otherwise. */
  function syncName(): void {
    const next = knownDocument?.name ?? fallbackName
    if (next === trackerName) return
    trackerName = next
    announce()
  }

  /*
   * What another tab on this tracker said. Run in this tab's queue, so it never reads
   * between the halves of one of this tab's own writes.
   */
  async function hear(message: TabMessage): Promise<void> {
    await serialized(async () => {
      if (message.type === 'removed') {
        const next = message.next === null
          ? null
          : (await listMetas()).find((candidate) => candidate.id === message.next) ?? null
        for (const listener of changeListeners) listener({ kind: 'removed', next })
        return
      }
      await refreshStorage()
      if (message.type !== 'document') return
      const document = await catchUp()
      if (!document) return
      for (const listener of changeListeners) listener({ kind: 'document', document })
    }).catch(() => undefined)
  }

  /*
   * The folder, backlog and name another tab may have changed. A handle connected there
   * is usable here too only if this tab already has its permission, which the browser
   * grants per origin, and asking would need a gesture this tab has not had.
   */
  async function refreshStorage(): Promise<void> {
    const stored = (await store.get('state', metaKey(id()))) as TrackerSummary | null
    if (stored) {
      meta = { ...stored, openedAt: meta?.openedAt ?? stored.openedAt }
      trackerName = stored.name
      fallbackName = stored.fallbackName ?? fallbackName
      sourceFile = stored.sourceFile ?? null
    }
    const backlog = (await store.get('state', backlogKey(id()))) as string | null
    unbackedSince = isDemoTrackerProfile() ? null : backlog
    if (canConnect) {
      const handle = (await store.get('state', directoryKey(id()))) as DirectoryHandleLike | null
      if (!handle) {
        directory = null
        connection = { kind: 'disconnected' }
      } else if (handle !== directory) {
        const permission = await permissionFor(handle, false)
        directory = permission === 'granted' ? handle : null
        connection = permission === 'granted'
          ? { kind: 'connected', name: handle.name }
          : { kind: 'needs-permission', name: handle.name }
      }
    }
    announce()
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

  /*
   * Browser storage only, with the tracker's entry in the list kept in step and the
   * revision moved on, so another tab on this tracker knows to read it. Always called
   * from inside `exclusive`, which is what keeps the revision one tab's to move at a time.
   */
  async function cacheDocument(document: TrackerDatabase): Promise<string> {
    const text = serialize(document)
    await store.put('state', documentKey(id()), text)
    knownDocument = document
    // Before the listing entry is written, so it lists the name the document now gives.
    syncName()
    await writeMeta(document.applications.length)
    knownRevision = (((await store.get('state', revisionKey(id()))) as number | null) ?? 0) + 1
    await store.put('state', revisionKey(id()), knownRevision)
    post({ type: 'document' })
    return text
  }

  async function writeDocument(document: TrackerDatabase): Promise<void> {
    writing += 1
    announce()
    try {
      const text = await cacheDocument(document)
      if (directory) await writeFileIn(directory, TRACKER_FILENAME, text)
      else await noteUnbacked()
    } finally {
      writing -= 1
      announce()
    }
  }

  /*
   * A folder opened as a tracker of its own rather than into this one: written under a new
   * id with the folder already connected, so the tab that navigates to it finds it whole.
   */
  async function storeAsNewTracker(
    folder: DirectoryHandleLike | null,
    document: TrackerDatabase,
    fallback: string,
    files: Array<{ applicationId: string; attachmentId: string; data: Uint8Array }> = [],
    source: { name: string; handle: FileHandleLike | null } | null = null,
  ): Promise<TrackerSummary> {
    const created = createUuidV7(now())
    await store.put('state', documentKey(created), serialize(document))
    if (folder) await store.put('state', directoryKey(created), folder)
    if (source?.handle) await store.put('state', sourceKey(created), source.handle)
    await store.put('state', revisionKey(created), 1)
    for (const file of files) {
      if (!isSafeAttachmentId(file.applicationId) || !isSafeAttachmentId(file.attachmentId)) continue
      const bytes = file.data.slice().buffer
      await store.put('attachments', `${created}/${file.applicationId}/${file.attachmentId}`, bytes)
    }
    const summary: TrackerSummary = {
      id: created,
      name: document.name ?? fallback,
      fallbackName: fallback,
      applications: document.applications.length,
      openedAt: now().toISOString(),
      ...(source ? { sourceFile: source.name } : {}),
    }
    await store.put('state', metaKey(created), summary)
    return summary
  }

  /* Whether a dropped or picked file is one some tracker reads from or came from. */
  async function belongsTo(
    summary: TrackerSummary,
    file: FileHandleLike,
  ): Promise<{ folder: string } | { source: true } | null> {
    if (!file.isSameEntry) return null
    const folder = summary.id === trackerId
      ? directory
      : (await store.get('state', directoryKey(summary.id))) as DirectoryHandleLike | null
    /*
     * A folder this tab has no permission for cannot be looked inside without asking, and
     * there is no gesture to ask in. It is passed over rather than prompted for.
     */
    if (folder && (await permissionFor(folder, false)) === 'granted') {
      try {
        const own = await folder.getFileHandle(TRACKER_FILENAME)
        if (await file.isSameEntry(own)) return { folder: folder.name }
      } catch {
        // No tracker.json there yet, or the folder went away: not this one.
      }
    }
    const source = (await store.get('state', sourceKey(summary.id))) as FileHandleLike | null
    return source && (await file.isSameEntry(source)) ? { source: true } : null
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

      return exclusive(async () => {
        /*
         * One action both opens and saves, and what the folder holds says which was meant.
         * A folder with a tracker in it is opened; an empty one starts saving this tracker
         * there. Opening into this tracker is only safe while it is empty — the first
         * visit — because adopting the folder's file replaces whatever this one holds, and
         * the moment someone presses "Save to a folder" is exactly when it holds changes
         * that are nowhere else. So a tracker with anything in it is left alone, and the
         * folder opens as a tracker of its own.
         */
        const existing = await readFileIn(picked, TRACKER_FILENAME)
        const parsedExisting = existing
          ? ensureFreshIndexes(parseTrackerDocument(await existing.text()))
          : null
        const cachedText = (await store.get('state', documentKey(id()))) as string | null
        if (parsedExisting && cachedText !== null && countApplications(cachedText) > 0) {
          return {
            outcome: 'opened' as const,
            tracker: await storeAsNewTracker(picked, parsedExisting, picked.name),
          }
        }

        directory = picked
        fallbackName = picked.name
        await store.put('state', directoryKey(id()), picked)
        if (parsedExisting) {
          await cacheDocument(parsedExisting)
        } else {
          const document = cachedText === null
            ? createEmptyDocument()
            : ensureFreshIndexes(parseTrackerDocument(cachedText))
          const text = await cacheDocument(document)
          await writeFileIn(picked, TRACKER_FILENAME, text)
        }
        await clearBacklog()
        post({ type: 'storage' })
        return {
          outcome: 'connected' as const,
          connection: announce({ kind: 'connected', name: picked.name }),
        }
      })
    },

    /*
     * A folder opened as a new tracker from the switcher, whatever this tab holds: one
     * with a tracker in it opens that, an empty one becomes a new tracker that saves there,
     * and one some tracker already saves to — this tab's included — opens that tracker.
     */
    async openFolder(): Promise<OpenResult> {
      await ready()
      const picked = await pick()
      if (!picked) return { outcome: 'dismissed' }
      if (directory && (await picked.isSameEntry?.(directory))) {
        const current = (await listMetas()).find((item) => item.id === id())
        return {
          outcome: 'opened',
          tracker: current ?? { id: id(), name: trackerName, applications: 0, openedAt: '' },
        }
      }
      const holder = await trackerHolding(picked)
      if (holder) return { outcome: 'opened', tracker: holder }
      return serialized(async () => {
        const existing = await readFileIn(picked, TRACKER_FILENAME)
        if (existing) {
          const parsed = ensureFreshIndexes(parseTrackerDocument(await existing.text()))
          return { outcome: 'opened' as const, tracker: await storeAsNewTracker(picked, parsed, picked.name) }
        }
        const empty = createEmptyDocument()
        await writeFileIn(picked, TRACKER_FILENAME, serialize(empty))
        return { outcome: 'opened' as const, tracker: await storeAsNewTracker(picked, empty, picked.name) }
      })
    },

    /*
     * An imported file as a new tracker, beside this one rather than over it, so there is
     * nothing to replace and nothing to ask. The viewer holds the file it came from, so it
     * starts with nothing waiting on a backup.
     */
    async createTracker(document, files, filename, source = null): Promise<TrackerSummary> {
      await ready()
      return serialized(() =>
        storeAsNewTracker(
          null,
          refreshTrackerDatabase(document),
          trackerNameFromFile(filename),
          files,
          { name: filename, handle: source },
        ),
      )
    },

    async findTrackerForFile(file: FileHandleLike): Promise<TrackerSummary | null> {
      await ready()
      const metas = await listMetas()
      // This tab's tracker first, so a file it holds is never offered as another's.
      const ordered = [...metas.filter((item) => item.id === trackerId), ...metas.filter((item) => item.id !== trackerId)]
      for (const summary of ordered) {
        const how = await belongsTo(summary, file)
        // `folder` set when the file is that folder's tracker.json; null when it is the source.
        if (how !== null) return { ...summary, folder: 'folder' in how ? how.folder : null }
      }
      return null
    },

    async reconnect(): Promise<StorageConnection> {
      await ready()
      const stored = (await store.get('state', directoryKey(id()))) as DirectoryHandleLike | null
      if (!stored) return announce({ kind: 'disconnected' })
      const permission = await permissionFor(stored, true)
      if (permission !== 'granted') {
        return announce({ kind: 'needs-permission', name: stored.name })
      }
      return exclusive(async () => {
        directory = stored
        await flushToFolder()
        await clearBacklog()
        post({ type: 'storage' })
        return announce({ kind: 'connected', name: stored.name })
      })
    },

    async disconnect(): Promise<StorageConnection> {
      await ready()
      return exclusive(async () => {
        directory = null
        await store.delete('state', directoryKey(id()))
        post({ type: 'storage' })
        return announce(canConnect ? { kind: 'disconnected' } : { kind: 'unsupported' })
      })
    },

    /*
     * Waits on `ready` as every save does, so it joins the queue behind a save made just
     * before it rather than overtaking one still waiting to start — and so the stored
     * backlog has been read before there is anything to clear.
     */
    async markBackedUp(): Promise<void> {
      await ready()
      return exclusive(async () => {
        if (unbackedSince === null) return
        await clearBacklog()
        post({ type: 'storage' })
        announce()
      })
    },

    async keepCopyInFolder(filename: string, data: Uint8Array): Promise<void> {
      await ready()
      return exclusive(async () => {
        if (!directory) throw new Error('No folder is connected to keep a copy in')
        if (filename === TRACKER_FILENAME || filename.includes('/')) {
          throw new Error('A copy must not take the place of the tracker itself')
        }
        await writeFileIn(directory, filename, data.slice().buffer)
      })
    },

    async markOtherBackedUp(other: string): Promise<void> {
      await ready()
      if (other === id()) return storage.markBackedUp()
      return onTracker(other, async () => {
        await store.delete('state', backlogKey(other))
        postTo(other, { type: 'storage' })
      })
    },

    async nameAfterFile(filename: string, source: FileHandleLike | null = null): Promise<void> {
      await ready()
      return exclusive(async () => {
        if (directory) return
        fallbackName = trackerNameFromFile(filename)
        sourceFile = filename
        if (source) await store.put('state', sourceKey(id()), source)
        else await store.delete('state', sourceKey(id()))
        syncName()
        if (meta) await writeMeta(meta.applications)
        post({ type: 'storage' })
        announce()
      })
    },

    async listTrackers(): Promise<TrackerSummary[]> {
      await ready()
      const metas = await listMetas()
      return Promise.all(metas.map(async (summary) => {
        const handle = (await store.get('state', directoryKey(summary.id))) as DirectoryHandleLike | null
        const backlog = (await store.get('state', backlogKey(summary.id))) as string | null
        return { ...summary, folder: handle?.name ?? null, unbackedSince: backlog }
      }))
    },

    async removeTracker(removing: string): Promise<TrackerSummary | null> {
      await ready()
      const holding = removing === id()
      return onTracker(removing, async () => {
        await deleteAttachmentsWithPrefix(`${removing}/`)
        await store.delete('state', documentKey(removing))
        await store.delete('state', directoryKey(removing))
        await store.delete('state', backlogKey(removing))
        await store.delete('state', revisionKey(removing))
        await store.delete('state', sourceKey(removing))
        await store.delete('state', metaKey(removing))
        if (holding) {
          directory = null
          meta = null
          unbackedSince = null
        }
        const next = (await listMetas())[0] ?? null
        // Every tab on it goes where this one would, rather than writing it back.
        postTo(removing, { type: 'removed', next: next?.id ?? null })
        return next
      })
    },

    async renameOtherTracker(renaming: string, name: string): Promise<void> {
      await ready()
      if (renaming === id()) throw new Error('The open tracker is renamed through its document')
      return onTracker(renaming, async () => {
        const stored = (await store.get('state', metaKey(renaming))) as TrackerSummary | null
        if (!stored) return
        const text = (await store.get('state', documentKey(renaming))) as string | null
        const document = text === null ? createEmptyDocument() : ensureFreshIndexes(parseTrackerDocument(text))
        const renamed = renameTracker(document, name)
        if (renamed === document) return
        const written = serialize(renamed)
        /*
         * The folder's file is the copy that tracker reads first when it opens, so a name
         * written only to browser storage would be undone the next time it did. Rewritten
         * before anything is stored, so a refused permission leaves both copies agreeing.
         */
        const handle = (await store.get('state', directoryKey(renaming))) as DirectoryHandleLike | null
        if (handle) {
          if ((await permissionFor(handle, true)) !== 'granted') {
            throw new Error(`${stored.name} keeps its name in the ${handle.name} folder, which this page was not allowed to write to`)
          }
          await writeFileIn(handle, TRACKER_FILENAME, written)
        }
        await store.put('state', documentKey(renaming), written)
        await store.put('state', metaKey(renaming), {
          ...stored,
          name: renamed.name ?? stored.fallbackName ?? stored.name,
        })
        const revision = (((await store.get('state', revisionKey(renaming))) as number | null) ?? 0) + 1
        await store.put('state', revisionKey(renaming), revision)
        postTo(renaming, { type: 'document' })
      })
    },

    async readTracker(reading: string) {
      await ready()
      const text = (await store.get('state', documentKey(reading))) as string | null
      const document = text === null ? createEmptyDocument() : ensureFreshIndexes(parseTrackerDocument(text))
      const prefix = `${reading}/`
      const files: Array<{ applicationId: string; attachmentId: string; data: Uint8Array }> = []
      for (const key of await store.keys('attachments')) {
        if (!key.startsWith(prefix)) continue
        const [applicationId, attachmentId] = key.slice(prefix.length).split('/')
        const bytes = (await store.get('attachments', key)) as ArrayBuffer | null
        if (applicationId && attachmentId && bytes) {
          files.push({ applicationId, attachmentId, data: new Uint8Array(bytes) })
        }
      }
      return { document, files }
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
      return exclusive(async () => {
        if (directory) {
          const file = await readFileIn(directory, TRACKER_FILENAME)
          if (file) {
            const parsed = ensureFreshIndexes(parseTrackerDocument(await file.text()))
            await cacheDocument(parsed)
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
        knownDocument = parsed
        syncName()
        knownRevision = ((await store.get('state', revisionKey(id()))) as number | null) ?? 0
        if (directory) await writeFileIn(directory, TRACKER_FILENAME, serialize(parsed))
        return parsed
      })
    },

    async saveDocument(document: TrackerDatabase): Promise<TrackerDatabase> {
      await ready()
      const refreshed = refreshTrackerDatabase(document)
      return exclusive(async () => {
        await writeDocument(refreshed)
        return refreshed
      })
    },

    /*
     * The mutation runs on the newest document this tab knows of — another tab's, read
     * inside the lock, when one has written since — rather than on `current`, which is
     * only what this tab last rendered. So two tabs editing the same tracker at once
     * each keep the other's edit instead of the slower writing over it.
     */
    async updateDocument(current, mutate) {
      await ready()
      return exclusive(async () => {
        await catchUp()
        const base = knownDocument ?? current
        const next = mutate(base)
        if (next === base) return { document: base, wrote: false }
        const refreshed = refreshTrackerDatabase(next)
        await writeDocument(refreshed)
        return { document: refreshed, wrote: true }
      })
    },

    subscribeChanges(listener) {
      changeListeners.add(listener)
      return () => void changeListeners.delete(listener)
    },

    async resetDocument(): Promise<TrackerDatabase> {
      if (!isDemoTrackerProfile()) {
        throw new Error('Resetting is only available in the demo profile')
      }
      await ready()
      return exclusive(async () => {
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
