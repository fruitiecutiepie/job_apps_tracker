import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { addApplication, createApplication, renameTracker } from '../domain/mutations'
import { prepareTrackerDatabase } from '../domain/database'
import { MAX_ATTACHMENT_BYTES } from '../domain/attachmentPaths'
import type { TrackerDatabase } from '../domain/types'
import type { ExternalChange, TrackerBackend } from './types'
import { browserBackend, TRACKER_FILENAME, trackerNameFromFile, type BrowserBackendOptions } from './browserBackend'
import { exportFilename } from '../domain/export'
import { NEW_TRACKER } from './trackerAddress'
import type { TabChannel, TabLock, TabMessage } from './tabSync'
import { FakeDirectory } from './fakeDirectory'
import { idbName, memoryStore, type KeyValueStore } from './idb'
import type { DirectoryHandleLike } from './fileSystem'

const APPLICATION_ID = '11111111-1111-7111-8111-111111111111'
const ATTACHMENT_ID = '22222222-2222-7222-8222-222222222222'

function withApplication(company = 'Northwind'): TrackerDatabase {
  return prepareTrackerDatabase([
    createApplication({
      company,
      role: 'Engineer',
      url: '',
      source: 'referral',
      state: 'applied',
      next_action: '',
      next_action_at: null,
      deadline_at: null,
      notes: '',
    }),
  ])
}

/** What a subscriber saw, with repeats of one value collapsed: announcements may repeat. */
function changes<T>(seen: T[]): T[] {
  return seen.filter((value, index) => index === 0 || value !== seen[index - 1])
}

async function cachedDocument(store: KeyValueStore, backend: TrackerBackend): Promise<unknown> {
  return store.get('state', `document:${backend.storage!.state().tracker!.id}`)
}

function connected(store: KeyValueStore, folder: DirectoryHandleLike) {
  return browserBackend({ store, supportsFolders: true, pick: async () => folder })
}

/*
 * The demo and the tracker are served from one origin, so nothing but the database name
 * separates their storage. If these ever matched, nineteen fictional applications would
 * turn up in somebody's real job search.
 */
describe('storage namespacing', () => {
  it('gives the demo its own database', () => {
    expect(idbName('demo')).not.toBe(idbName('live'))
  })
})

/*
 * The suite runs under the demo profile, so the tracker's behaviour has to be asked for
 * explicitly — otherwise these would all be measuring the demo.
 */
beforeEach(() => {
  vi.stubEnv('VITE_TRACKER_PROFILE', 'live')
  // Which tracker a backend opens comes from the URL, so each test starts on a bare one.
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('browser backend, with no folder connected', () => {
  let store: KeyValueStore

  beforeEach(() => {
    store = memoryStore()
  })

  it('starts on an empty tracker rather than the demo data', async () => {
    const backend = browserBackend({ store, supportsFolders: false })
    const loaded = await backend.loadDocument()
    expect(loaded.applications).toEqual([])
    expect(backend.storage?.connection()).toEqual({ kind: 'unsupported' })
  })

  it('writes nothing until there is something to write', async () => {
    await browserBackend({ store, supportsFolders: false }).loadDocument()
    expect(await store.keys('state')).toEqual([])
  })

  it('seeds the demo profile instead, and only once', async () => {
    vi.stubEnv('VITE_TRACKER_PROFILE', 'demo')
    const seeded = await browserBackend({ store, supportsFolders: false }).loadDocument()
    expect(seeded.applications).toHaveLength(19)

    // Emptying it sticks: the seed is a first visit, not a reset on every load.
    await browserBackend({ store, supportsFolders: false }).saveDocument({
      ...seeded,
      applications: [],
    })
    const reloaded = await browserBackend({ store, supportsFolders: false }).loadDocument()
    expect(reloaded.applications).toEqual([])
  })

  it('auto-saves every change and reads it back after a reload', async () => {
    const backend = browserBackend({ store, supportsFolders: false })
    await backend.saveDocument(withApplication())

    // A second backend over the same store is what a page reload looks like.
    const reloaded = await browserBackend({ store, supportsFolders: false }).loadDocument()
    expect(reloaded.applications.map((application) => application.company)).toEqual(['Northwind'])
  })

  it('keeps attachment bytes and hands them back', async () => {
    const backend = browserBackend({ store, supportsFolders: false })
    await backend.writeAttachment(APPLICATION_ID, ATTACHMENT_ID, new Blob(['resume']), 'text/plain')

    const bytes = await backend.readAttachment(APPLICATION_ID, ATTACHMENT_ID)
    expect(new TextDecoder().decode(bytes!)).toBe('resume')

    await backend.deleteAttachment(APPLICATION_ID, ATTACHMENT_ID)
    expect(await backend.readAttachment(APPLICATION_ID, ATTACHMENT_ID)).toBeNull()
  })

  it('reports a missing attachment as absent rather than throwing', async () => {
    const backend = browserBackend({ store, supportsFolders: false })
    expect(await backend.readAttachment(APPLICATION_ID, ATTACHMENT_ID)).toBeNull()
  })

  it('refuses ids that are not attachment-shaped and files over the cap', async () => {
    const backend = browserBackend({ store, supportsFolders: false })
    await expect(
      backend.writeAttachment('../etc', ATTACHMENT_ID, new Blob(['x']), null),
    ).rejects.toThrow(/invalid/i)
    await expect(
      backend.writeAttachment(APPLICATION_ID, ATTACHMENT_ID, oversized(), null),
    ).rejects.toThrow(/limit/)
  })

  it('offers no external editor', () => {
    const backend = browserBackend({ store, supportsFolders: false })
    expect(backend.capabilities.externalEditor).toBe(false)
    expect(backend.openNoteInEditor).toBeUndefined()
  })

  /*
   * Two saves in flight at once is not hypothetical: the notes panel autosaves on a pause
   * in typing while a captured line writes immediately. If the slower of the two lands
   * last, it silently undoes the newer one — a lost note with nothing failing anywhere.
   */
  it('lands concurrent saves in the order they were made, even when the first is slower', async () => {
    const backend = browserBackend({ store: slowFirstWrite(store), supportsFolders: false })
    const first = backend.saveDocument(withApplication('First'))
    const second = backend.saveDocument(withApplication('Second'))
    await Promise.all([first, second])

    const loaded = await backend.loadDocument()
    expect(loaded.applications.map((application) => application.company)).toEqual(['Second'])
  })
})

describe('browser backend, with a folder connected', () => {
  let store: KeyValueStore
  let folder: FakeDirectory

  beforeEach(() => {
    store = memoryStore()
    folder = new FakeDirectory('job-applications')
  })

  it('writes tracker.json into the folder and keeps a copy in browser storage', async () => {
    const backend = connected(store, folder)
    expect(await backend.storage!.connect()).toEqual({
      outcome: 'connected',
      connection: { kind: 'connected', name: 'job-applications' },
    })

    await backend.saveDocument(withApplication())

    const onDisk = folder.readText(TRACKER_FILENAME)
    expect(onDisk).toContain('Northwind')
    expect(await cachedDocument(store, backend)).toBe(onDisk)
  })

  it('mirrors attachments into attachments/<application>/<attachment>', async () => {
    const backend = connected(store, folder)
    await backend.storage!.connect()
    await backend.writeAttachment(APPLICATION_ID, ATTACHMENT_ID, new Blob(['resume']), null)

    expect(folder.readText(`attachments/${APPLICATION_ID}/${ATTACHMENT_ID}`)).toBe('resume')

    await backend.deleteApplicationAttachments(APPLICATION_ID)
    expect(folder.read(`attachments/${APPLICATION_ID}/${ATTACHMENT_ID}`)).toBeNull()
  })

  it('wipes the whole attachments folder, not just the browser copy', async () => {
    const backend = connected(store, folder)
    await backend.storage!.connect()
    await backend.writeAttachment(APPLICATION_ID, ATTACHMENT_ID, new Blob(['resume']), null)

    await backend.wipeAttachments()
    expect(folder.directories.has('attachments')).toBe(false)
    expect(await store.keys('attachments')).toEqual([])
  })

  /*
   * Neither copy is overwritten. The folder's tracker is not replaced by what the page
   * had, and — since the page had applications of its own — the page's are not replaced
   * by the folder's either: the folder opens as a tracker of its own.
   */
  it('overwrites neither the folder\'s tracker nor the one already in the page', async () => {
    const backend = connected(store, folder)
    await backend.saveDocument(withApplication('Typed before connecting'))

    // The folder already holds a different tracker — the one the viewer means to open.
    const seeded = connected(memoryStore(), folder)
    await seeded.storage!.connect()
    await seeded.saveDocument(withApplication('Already in the folder'))

    expect(await backend.storage!.connect()).toMatchObject({ outcome: 'opened' })
    expect((await backend.loadDocument()).applications[0].company).toBe('Typed before connecting')
    expect(folder.readText(TRACKER_FILENAME)).toContain('Already in the folder')
  })

  it('seeds an empty folder with what the page already had', async () => {
    const backend = connected(store, folder)
    await backend.saveDocument(withApplication('Typed before connecting'))
    await backend.storage!.connect()

    expect(folder.readText(TRACKER_FILENAME)).toContain('Typed before connecting')
  })

  it('tells subscribers when the connection changes', async () => {
    const backend = connected(store, folder)
    const seen: string[] = []
    backend.storage!.subscribe((state) => seen.push(state.connection.kind))

    // Subscribing reports the current state first, so a late subscriber is never blank.
    expect(seen).toEqual(['disconnected'])

    await backend.storage!.connect()
    await backend.storage!.disconnect()
    expect(changes(seen)).toEqual(['disconnected', 'connected', 'disconnected'])
  })

  it('treats a dismissed picker as no change, and says it was dismissed', async () => {
    const backend = browserBackend({ store, supportsFolders: true, pick: async () => null })
    expect(await backend.storage!.connect()).toEqual({ outcome: 'dismissed' })
    expect(backend.storage!.connection()).toEqual({ kind: 'disconnected' })
  })
})

describe('browser backend, when the folder permission lapses', () => {
  let store: KeyValueStore
  let folder: FakeDirectory

  beforeEach(async () => {
    store = memoryStore()
    folder = new FakeDirectory('job-applications')
    const first = connected(store, folder)
    await first.storage!.connect()
    await first.saveDocument(withApplication('Saved while connected'))
  })

  it('keeps serving the browser copy rather than failing', async () => {
    folder.permission = 'prompt'

    const backend = connected(store, folder)
    const loaded = await backend.loadDocument()
    expect(loaded.applications.map((application) => application.company)).toEqual([
      'Saved while connected',
    ])
    expect(backend.storage!.connection()).toEqual({
      kind: 'needs-permission',
      name: 'job-applications',
    })
  })

  /*
   * The edits made while locked out are the newest thing anywhere: the folder's copy
   * stopped at the moment the permission lapsed. Reconnecting has to push them, because
   * pulling would replace an hour of typing with the stale file and report success.
   */
  it('carries the edits made while locked out into the folder on reconnect', async () => {
    folder.permission = 'prompt'
    const backend = connected(store, folder)
    await backend.loadDocument()
    await backend.saveDocument(withApplication('Saved while locked out'))

    expect(folder.readText(TRACKER_FILENAME)).toContain('Saved while connected')

    expect(await backend.storage!.reconnect()).toEqual({
      kind: 'connected',
      name: 'job-applications',
    })
    expect(folder.readText(TRACKER_FILENAME)).toContain('Saved while locked out')
    const loaded = await backend.loadDocument()
    expect(loaded.applications.map((application) => application.company)).toEqual([
      'Saved while locked out',
    ])

    await backend.saveDocument(withApplication('Saved after reconnecting'))
    expect(folder.readText(TRACKER_FILENAME)).toContain('Saved after reconnecting')
  })

  it('carries attachments added while locked out as well', async () => {
    folder.permission = 'prompt'
    const backend = connected(store, folder)
    await backend.loadDocument()
    await backend.writeAttachment(APPLICATION_ID, ATTACHMENT_ID, new Blob(['resume']), null)

    expect(folder.read(`attachments/${APPLICATION_ID}/${ATTACHMENT_ID}`)).toBeNull()

    await backend.storage!.reconnect()
    expect(folder.readText(`attachments/${APPLICATION_ID}/${ATTACHMENT_ID}`)).toBe('resume')
  })

  it('stays disconnected when the viewer refuses the permission', async () => {
    folder.permission = 'prompt'
    folder.grantOnRequest = false

    const backend = connected(store, folder)
    await backend.loadDocument()
    expect(await backend.storage!.reconnect()).toEqual({
      kind: 'needs-permission',
      name: 'job-applications',
    })
  })

  it('forgets a folder the browser has revoked outright', async () => {
    folder.permission = 'denied'

    const backend = connected(store, folder)
    await backend.loadDocument()
    expect(backend.storage!.connection()).toEqual({ kind: 'disconnected' })
    expect((await store.keys('state')).some((key) => key.startsWith('directory:'))).toBe(false)
  })
})

/*
 * Without a folder the browser copy is the only copy, and the risk is not an unsaved edit
 * but an export nobody remembered to make. The backlog is what the topbar reads to say so.
 */
describe('the backup reminder', () => {
  let store: KeyValueStore
  let clock: Date

  beforeEach(() => {
    store = memoryStore()
    clock = new Date('2026-09-01T09:00:00.000Z')
  })

  function unsupported(persist: () => Promise<boolean> = async () => true) {
    return browserBackend({ store, supportsFolders: false, persist, now: () => clock })
  }

  it('has nothing to back up before anything is written', async () => {
    const backend = unsupported()
    await backend.loadDocument()
    expect(backend.storage!.state().unbackedSince).toBeNull()
  })

  it('dates the backlog from the first change that reached no file, not the latest', async () => {
    const backend = unsupported()
    await backend.saveDocument(withApplication('First'))
    clock = new Date('2026-09-05T09:00:00.000Z')
    await backend.saveDocument(withApplication('Second'))
    expect(backend.storage!.state().unbackedSince).toBe('2026-09-01T09:00:00.000Z')
  })

  it('is still there after a reload, which is when it gets forgotten', async () => {
    await unsupported().saveDocument(withApplication())
    const reloaded = unsupported()
    await reloaded.loadDocument()
    expect(reloaded.storage!.state().unbackedSince).toBe('2026-09-01T09:00:00.000Z')
  })

  it('clears on a backup, and the next change starts a new one', async () => {
    const backend = unsupported()
    const seen: (string | null)[] = []
    backend.storage!.subscribe((state) => seen.push(state.unbackedSince))
    await backend.saveDocument(withApplication())
    await backend.storage!.markBackedUp()
    expect(backend.storage!.state().unbackedSince).toBeNull()
    expect((await store.keys('state')).some((key) => key.startsWith('backlog:'))).toBe(false)

    clock = new Date('2026-09-09T09:00:00.000Z')
    await backend.saveDocument(withApplication('After the export'))
    expect(backend.storage!.state().unbackedSince).toBe('2026-09-09T09:00:00.000Z')
    expect(changes(seen)).toEqual([null, '2026-09-01T09:00:00.000Z', null, '2026-09-09T09:00:00.000Z'])
  })

  /*
   * An import saves the imported document and then marks it backed up. If the mark ran
   * first, the import's own save would start a backlog straight after it was cleared.
   */
  it('marks a backup only after the writes already queued ahead of it', async () => {
    const backend = browserBackend({
      store: slowFirstWrite(store),
      supportsFolders: false,
      persist: async () => true,
      now: () => clock,
    })
    const saving = backend.saveDocument(withApplication('Imported'))
    const marking = backend.storage!.markBackedUp()
    await Promise.all([saving, marking])
    expect(backend.storage!.state().unbackedSince).toBeNull()
  })

  it('asks the browser to keep its storage once, when the browser copy becomes the only one', async () => {
    const persist = vi.fn(async () => true)
    const backend = unsupported(persist)
    await backend.saveDocument(withApplication('First'))
    await backend.saveDocument(withApplication('Second'))
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('never builds up while a folder is taking every write', async () => {
    const backend = connected(store, new FakeDirectory('job-applications'))
    await backend.storage!.connect()
    await backend.saveDocument(withApplication())
    expect(backend.storage!.state().unbackedSince).toBeNull()
  })

  it('clears when a folder is connected, since the folder now has everything', async () => {
    const backend = browserBackend({
      store,
      supportsFolders: true,
      pick: async () => new FakeDirectory('job-applications'),
      persist: async () => true,
    })
    await backend.saveDocument(withApplication())
    expect(backend.storage!.state().unbackedSince).not.toBeNull()

    await backend.storage!.connect()
    expect(backend.storage!.state()).toMatchObject({
      connection: { kind: 'connected', name: 'job-applications' },
      unbackedSince: null,
    })
  })

  it('builds up while the folder permission is lapsed, and clears on reconnecting', async () => {
    const folder = new FakeDirectory('job-applications')
    await connected(store, folder).storage!.connect()
    folder.permission = 'prompt'

    const backend = connected(store, folder)
    await backend.loadDocument()
    await backend.saveDocument(withApplication('Saved while locked out'))
    expect(backend.storage!.state().unbackedSince).not.toBeNull()

    await backend.storage!.reconnect()
    expect(backend.storage!.state().unbackedSince).toBeNull()
  })

  it('stays quiet on the demo, whose data is fictional', async () => {
    vi.stubEnv('VITE_TRACKER_PROFILE', 'demo')
    const backend = unsupported()
    await backend.loadDocument()
    await backend.saveDocument(withApplication())
    expect(backend.storage!.state().unbackedSince).toBeNull()
  })
})

/*
 * A browser holds several trackers, and a tab holds one of them — the one its URL names.
 * Two tabs with two trackers open must never read or write each other's data.
 */
describe('several trackers in one browser', () => {
  let store: KeyValueStore
  let clock: Date

  beforeEach(() => {
    store = memoryStore()
    clock = new Date('2026-09-01T09:00:00.000Z')
  })

  function tab(requested: string | null, extra: Partial<BrowserBackendOptions> = {}) {
    const shown: string[] = []
    const backend = browserBackend({
      store,
      supportsFolders: false,
      persist: async () => true,
      now: () => clock,
      address: { requested: () => requested, show: (id) => shown.push(id) },
      ...extra,
    })
    return { backend, shown }
  }

  async function trackerIn(backend: TrackerBackend): Promise<string> {
    await backend.loadDocument()
    return backend.storage!.state().tracker!.id
  }

  it('keeps two trackers apart, documents and attachments both', async () => {
    const first = tab(NEW_TRACKER).backend
    await first.saveDocument(withApplication('First'))
    await first.writeAttachment(APPLICATION_ID, ATTACHMENT_ID, new Blob(['first']), null)
    const second = tab(NEW_TRACKER).backend
    await second.saveDocument(withApplication('Second'))

    const firstId = await trackerIn(first)
    const secondId = await trackerIn(second)
    expect(firstId).not.toBe(secondId)
    expect((await tab(firstId).backend.loadDocument()).applications[0].company).toBe('First')
    expect((await tab(secondId).backend.loadDocument()).applications[0].company).toBe('Second')
    expect(await second.readAttachment(APPLICATION_ID, ATTACHMENT_ID)).toBeNull()

    await second.wipeAttachments()
    expect(await first.readAttachment(APPLICATION_ID, ATTACHMENT_ID)).not.toBeNull()
  })

  it('puts the tracker it opened in the URL, so a reload comes back to it', async () => {
    const { backend, shown } = tab(null)
    const id = await trackerIn(backend)
    expect(shown).toEqual([id])
  })

  it('opens the most recently opened tracker when the URL names none', async () => {
    const older = tab(NEW_TRACKER).backend
    await older.saveDocument(withApplication('Older'))
    clock = new Date('2026-09-02T09:00:00.000Z')
    const newer = tab(NEW_TRACKER).backend
    await newer.saveDocument(withApplication('Newer'))

    expect((await tab(null).backend.loadDocument()).applications[0].company).toBe('Newer')
  })

  it('opens a new tracker for an id this browser does not hold', async () => {
    const known = tab(NEW_TRACKER).backend
    await known.saveDocument(withApplication('Known'))

    const { backend, shown } = tab('0190a0a0-0000-7000-8000-000000000000')
    expect((await backend.loadDocument()).applications).toEqual([])
    expect(shown[0]).not.toBe('0190a0a0-0000-7000-8000-000000000000')
  })

  it('lists what it holds, and does not list a tracker nothing was ever written to', async () => {
    const named = tab(NEW_TRACKER).backend
    await named.saveDocument(withApplication())
    await named.storage!.nameAfterFile('job-search-2026.json')
    await tab(NEW_TRACKER).backend.loadDocument()

    const listed = await named.storage!.listTrackers()
    expect(listed.map(({ name, applications }) => ({ name, applications }))).toEqual([
      { name: 'job-search-2026', applications: 1 },
    ])
  })

  it('numbers trackers started from nothing, so two can be told apart', async () => {
    const first = tab(NEW_TRACKER).backend
    await first.saveDocument(withApplication())
    const second = tab(NEW_TRACKER).backend
    await second.saveDocument(withApplication())
    await second.storage!.nameAfterFile('imported.json')
    const third = tab(NEW_TRACKER).backend
    await third.loadDocument()

    expect(first.storage!.state().tracker!.name).toBe('Untitled tracker')
    expect(third.storage!.state().tracker!.name).toBe('Untitled tracker 2')
  })

  async function rename(backend: TrackerBackend, name: string): Promise<void> {
    await backend.updateDocument!(await backend.loadDocument(), (document) => renameTracker(document, name))
  }

  /*
   * A chosen name lives in the document, so it outranks the folder's and the file's —
   * which are only guesses — and connecting a folder or importing afterwards keeps it.
   */
  it('keeps a name the reader chose, over a folder and an import alike', async () => {
    const folder = new FakeDirectory('job-apps')
    const { backend } = tab(NEW_TRACKER, { supportsFolders: true, pick: async () => folder })
    await rename(backend, '  Autumn search  ')
    await backend.storage!.connect()
    await backend.storage!.nameAfterFile('someone-elses.json')
    expect(backend.storage!.state().tracker!.name).toBe('Autumn search')

    const id = backend.storage!.state().tracker!.id
    const reopened = tab(id).backend
    await reopened.loadDocument()
    expect(reopened.storage!.state().tracker!.name).toBe('Autumn search')
  })

  /*
   * The point of keeping the name in the document: browser storage can be cleared, and
   * the folder is what outlives it. Pointing a fresh browser at the folder brings the
   * name back with the applications.
   */
  it('gets its name back from the folder after browser storage is cleared', async () => {
    const folder = new FakeDirectory('job-apps')
    const first = tab(NEW_TRACKER, { supportsFolders: true, pick: async () => folder }).backend
    await first.loadDocument()
    await first.storage!.connect()
    await rename(first, 'Autumn search')
    expect(JSON.parse(folder.readText(TRACKER_FILENAME)!).name).toBe('Autumn search')

    store = memoryStore()
    const fresh = tab(NEW_TRACKER, { supportsFolders: true, pick: async () => folder }).backend
    await fresh.loadDocument()
    await fresh.storage!.connect()
    expect(fresh.storage!.state().tracker!.name).toBe('Autumn search')
    expect((await fresh.storage!.listTrackers())[0].name).toBe('Autumn search')
  })

  it('keeps a tracker that was named before anything was saved in it', async () => {
    const { backend } = tab(NEW_TRACKER)
    await rename(backend, 'Next year')
    expect((await backend.storage!.listTrackers()).map((tracker) => tracker.name)).toEqual(['Next year'])
  })

  it('goes back to what it was called before once the name is cleared', async () => {
    const { backend } = tab(NEW_TRACKER)
    await backend.saveDocument(withApplication())
    await backend.storage!.nameAfterFile('imported.json')
    await rename(backend, 'Autumn search')
    await rename(backend, '   ')
    expect(backend.storage!.state().tracker!.name).toBe('imported')
  })

  it('names a tracker imported from an export after the tracker, not the export\'s date', () => {
    expect(trackerNameFromFile('Autumn search 2026-10-01.zip')).toBe('Autumn search')
    expect(trackerNameFromFile('Autumn search 2026-10-01 (1).zip')).toBe('Autumn search')
    expect(trackerNameFromFile('job-applications-2026-09-30T09-15-00-000Z.zip')).toBe('job-applications')
    expect(trackerNameFromFile('notes.json')).toBe('notes')
    expect(trackerNameFromFile(exportFilename(new Date(2026, 9, 1), 'zip', 'Autumn search'))).toBe('Autumn search')
  })

  it('is named after the folder it saves to, and keeps that name over an import', async () => {
    const folder = new FakeDirectory('job-apps')
    const { backend } = tab(NEW_TRACKER, { supportsFolders: true, pick: async () => folder })
    await backend.loadDocument()
    await backend.storage!.connect()
    await backend.storage!.nameAfterFile('someone-elses.json')
    expect(backend.storage!.state().tracker!.name).toBe('job-apps')
  })

  /*
   * Choosing a folder both opens and saves. Opened into a tracker that already holds
   * applications, the folder's file would replace them — and "Save to a folder" is pressed
   * exactly when they exist nowhere else — so that folder opens as a tracker of its own.
   */
  it('opens a folder holding a tracker as its own tracker, leaving this one alone', async () => {
    const folder = new FakeDirectory('last-year')
    await folder.getFileHandle(TRACKER_FILENAME, { create: true }).then(async (handle) => {
      const writable = await handle.createWritable()
      await writable.write(`${JSON.stringify(withApplication('From the folder'))}\n`)
      await writable.close()
    })
    const { backend } = tab(NEW_TRACKER, { supportsFolders: true, pick: async () => folder })
    await backend.saveDocument(withApplication('Only in this browser'))
    const before = backend.storage!.state().tracker!.id

    const result = await backend.storage!.connect()
    expect(result).toMatchObject({ outcome: 'opened', tracker: { name: 'last-year', applications: 1 } })
    expect((await backend.loadDocument()).applications[0].company).toBe('Only in this browser')
    expect(backend.storage!.connection()).toEqual({ kind: 'disconnected' })

    const opened = tab(result.outcome === 'opened' ? result.tracker.id : '', { supportsFolders: true }).backend
    expect((await opened.loadDocument()).applications[0].company).toBe('From the folder')
    expect(opened.storage!.connection()).toEqual({ kind: 'connected', name: 'last-year' })
    expect(opened.storage!.state().tracker!.id).not.toBe(before)
  })

  it('opens a folder holding a tracker into this one while this one is empty', async () => {
    const folder = new FakeDirectory('last-year')
    const writable = await (await folder.getFileHandle(TRACKER_FILENAME, { create: true })).createWritable()
    await writable.write(`${JSON.stringify(withApplication('From the folder'))}\n`)
    await writable.close()
    const { backend } = tab(NEW_TRACKER, { supportsFolders: true, pick: async () => folder })
    await backend.loadDocument()

    expect(await backend.storage!.connect()).toMatchObject({ outcome: 'connected' })
    expect((await backend.loadDocument()).applications[0].company).toBe('From the folder')
  })

  /*
   * Two trackers writing whole documents into one folder would each undo the other, so a
   * folder already connected elsewhere is handed back as that tracker instead.
   */
  it('will not connect a folder another tracker already saves to', async () => {
    const folder = new FakeDirectory('job-apps')
    const holder = tab(NEW_TRACKER, { supportsFolders: true, pick: async () => folder }).backend
    await holder.loadDocument()
    await holder.storage!.connect()
    const holderId = holder.storage!.state().tracker!.id

    const other = tab(NEW_TRACKER, { supportsFolders: true, pick: async () => folder }).backend
    await other.loadDocument()
    const result = await other.storage!.connect()
    expect(result).toMatchObject({ outcome: 'already-open', tracker: { id: holderId, name: 'job-apps' } })
    expect(other.storage!.connection()).toEqual({ kind: 'disconnected' })
  })

  it('removes only its own tracker, leaves a folder its files, and names the next', async () => {
    const kept = tab(NEW_TRACKER).backend
    await kept.saveDocument(withApplication('Kept'))
    const keptId = await trackerIn(kept)

    const folder = new FakeDirectory('job-apps')
    const removed = tab(NEW_TRACKER, { supportsFolders: true, pick: async () => folder }).backend
    await removed.loadDocument()
    await removed.storage!.connect()
    await removed.saveDocument(withApplication('Removed'))
    await removed.writeAttachment(APPLICATION_ID, ATTACHMENT_ID, new Blob(['resume']), null)
    const removedId = removed.storage!.state().tracker!.id

    expect(await removed.storage!.removeTracker()).toMatchObject({ id: keptId })
    expect((await store.keys('state')).filter((key) => key.includes(removedId))).toEqual([])
    expect((await store.keys('attachments')).filter((key) => key.startsWith(removedId))).toEqual([])
    expect(folder.readText(TRACKER_FILENAME)).toContain('Removed')
    expect(folder.readText(`attachments/${APPLICATION_ID}/${ATTACHMENT_ID}`)).toBe('resume')
    expect((await tab(keptId).backend.loadDocument()).applications[0].company).toBe('Kept')
  })

  /*
   * Before a browser could hold more than one tracker, it held one under fixed keys. That
   * visitor's data must come back as their first tracker, not vanish behind keys nothing
   * reads any more.
   */
  it('moves a single-tracker browser into the first of several', async () => {
    const document = `${JSON.stringify(withApplication('From before'))}\n`
    await store.put('state', 'document', document)
    await store.put('state', 'unbackedSince', '2026-08-01T09:00:00.000Z')
    await store.put('attachments', `${APPLICATION_ID}/${ATTACHMENT_ID}`, new TextEncoder().encode('resume').buffer)

    const { backend } = tab(null)
    const loaded = await backend.loadDocument()
    expect(loaded.applications[0].company).toBe('From before')
    expect(backend.storage!.state().unbackedSince).toBe('2026-08-01T09:00:00.000Z')
    expect(new TextDecoder().decode(await backend.readAttachment(APPLICATION_ID, ATTACHMENT_ID) ?? undefined)).toBe('resume')
    expect(await store.get('state', 'document')).toBeNull()
    expect(await backend.storage!.listTrackers()).toHaveLength(1)
  })

  it('seeds the demo once, not every new tracker in it', async () => {
    vi.stubEnv('VITE_TRACKER_PROFILE', 'demo')
    expect((await tab(null).backend.loadDocument()).applications).toHaveLength(19)
    expect((await tab(NEW_TRACKER).backend.loadDocument()).applications).toEqual([])
  })
})

/*
 * Two tabs holding one tracker. A tab cannot be opened in a test, so these are two
 * backends sharing one store, one lock and one channel hub — what two tabs share.
 */
function fakeTabs() {
  const held = new Map<string, Promise<unknown>>()
  const locks: TabLock = {
    run(name, task) {
      const previous = held.get(name) ?? Promise.resolve()
      const result = previous.then(task)
      held.set(name, result.catch(() => undefined))
      return result
    },
  }
  const hub = new Map<string, Set<(message: TabMessage) => void>>()
  let delivering = true
  const channel = (name: string): TabChannel => {
    const mine = new Set<(message: TabMessage) => void>()
    const everyone = hub.get(name) ?? new Set()
    hub.set(name, everyone)
    return {
      post(message) {
        if (!delivering) return
        for (const listener of everyone) {
          // Delivered later, like a real channel, and never back to the tab that posted.
          if (!mine.has(listener)) setTimeout(() => listener(message), 0)
        }
      },
      listen(listener) {
        mine.add(listener)
        everyone.add(listener)
        return () => {
          mine.delete(listener)
          everyone.delete(listener)
        }
      },
    }
  }
  return { locks, channel, mute: () => void (delivering = false) }
}

function adding(company: string) {
  return (document: TrackerDatabase) =>
    addApplication(document, {
      company,
      role: '',
      url: '',
      source: '',
      state: 'applied',
      next_action: '',
      next_action_at: null,
      deadline_at: null,
      notes: '',
    })
}

describe('one tracker open in two tabs', () => {
  let store: KeyValueStore
  let tabs: ReturnType<typeof fakeTabs>

  beforeEach(() => {
    store = memoryStore()
    tabs = fakeTabs()
  })

  function tab(requested: string | null, extra: Partial<BrowserBackendOptions> = {}) {
    return browserBackend({
      store,
      supportsFolders: false,
      persist: async () => true,
      address: { requested: () => requested, show: () => {} },
      locks: tabs.locks,
      channel: tabs.channel,
      ...extra,
    })
  }

  async function twoTabs(extra: Partial<BrowserBackendOptions> = {}) {
    const first = tab(NEW_TRACKER, extra)
    await first.saveDocument(withApplication('Northwind'))
    const id = first.storage!.state().tracker!.id
    const second = tab(id, extra)
    return { first, second, firstDocument: await first.loadDocument(), secondDocument: await second.loadDocument() }
  }

  it('shows the other tab what one tab wrote, without a reload', async () => {
    const { first, second, firstDocument } = await twoTabs()
    const heard: ExternalChange[] = []
    second.subscribeChanges!((change) => heard.push(change))

    await first.updateDocument!(firstDocument, adding('Halcyon'))

    await vi.waitFor(() => expect(heard).toHaveLength(1))
    const change = heard[0]
    expect(change.kind === 'document' && change.document.applications.map((item) => item.company))
      .toEqual(expect.arrayContaining(['Northwind', 'Halcyon']))
  })

  /*
   * The case the whole arrangement exists for: both tabs edit from the same snapshot at
   * the same moment. Saving documents, the slower would undo the faster.
   */
  it('keeps both tabs\' edits when they write at the same moment', async () => {
    const { first, second, firstDocument, secondDocument } = await twoTabs()

    await Promise.all([
      first.updateDocument!(firstDocument, adding('From the first tab')),
      second.updateDocument!(secondDocument, adding('From the second tab')),
    ])

    const stored = await tab(first.storage!.state().tracker!.id).loadDocument()
    expect(stored.applications.map((item) => item.company).sort()).toEqual([
      'From the first tab',
      'From the second tab',
      'Northwind',
    ])
  })

  /*
   * A message can be late, or never arrive. The revision checked inside the lock is what
   * catches a tab that has not heard: it reads what the other stored before it writes.
   */
  it('catches up from storage even when the other tab\'s message never arrives', async () => {
    const { first, second, firstDocument, secondDocument } = await twoTabs()
    tabs.mute()

    await first.updateDocument!(firstDocument, adding('Halcyon'))
    const { document } = await second.updateDocument!(secondDocument, adding('Paper Kite'))

    expect(document.applications.map((item) => item.company).sort()).toEqual([
      'Halcyon',
      'Northwind',
      'Paper Kite',
    ])
  })

  it('hands back the newer document without writing when the mutation has nothing to do', async () => {
    const { first, second, firstDocument, secondDocument } = await twoTabs()
    tabs.mute()
    await first.updateDocument!(firstDocument, adding('Halcyon'))

    const result = await second.updateDocument!(secondDocument, (document) => document)
    expect(result.wrote).toBe(false)
    expect(result.document.applications.map((item) => item.company)).toContain('Halcyon')
  })

  it('shows a name chosen in the other tab', async () => {
    const { first, second, firstDocument } = await twoTabs()
    await first.updateDocument!(firstDocument, (document) => renameTracker(document, 'Autumn search'))
    await vi.waitFor(() => expect(second.storage!.state().tracker!.name).toBe('Autumn search'))
  })

  it('follows a folder the other tab connected', async () => {
    const folder = new FakeDirectory('job-apps')
    const { first, second } = await twoTabs({ supportsFolders: true, pick: async () => folder })

    await first.storage!.connect()
    await vi.waitFor(() =>
      expect(second.storage!.connection()).toEqual({ kind: 'connected', name: 'job-apps' }),
    )
    expect(second.storage!.state().tracker!.name).toBe('job-apps')
  })

  it('is told where to go when the other tab removes the tracker', async () => {
    const kept = tab(NEW_TRACKER)
    await kept.saveDocument(withApplication('Kept'))
    const keptId = kept.storage!.state().tracker!.id
    const { first, second } = await twoTabs()
    const heard: ExternalChange[] = []
    second.subscribeChanges!((change) => heard.push(change))

    await first.storage!.removeTracker()
    await vi.waitFor(() => expect(heard).toEqual([{ kind: 'removed', next: expect.objectContaining({ id: keptId }) }]))
  })
})

/** Makes the first write the slow one, so an unordered backend finishes them backwards. */
function slowFirstWrite(store: KeyValueStore): KeyValueStore {
  let writes = 0
  return {
    ...store,
    async put(name, key, value) {
      const delay = writes === 0 ? 25 : 0
      writes += 1
      await new Promise((resolve) => setTimeout(resolve, delay))
      await store.put(name, key, value)
    },
  }
}

function oversized(): Blob {
  // Big enough to trip the cap without allocating 25 MiB of test data.
  return { size: MAX_ATTACHMENT_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) } as Blob
}
