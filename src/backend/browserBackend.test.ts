import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApplication } from '../domain/mutations'
import { prepareTrackerDatabase } from '../domain/database'
import { MAX_ATTACHMENT_BYTES } from '../domain/attachmentPaths'
import type { TrackerDatabase } from '../domain/types'
import { browserBackend, TRACKER_FILENAME } from './browserBackend'
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
    expect(await store.get('state', 'document')).toBeNull()
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
    expect(await backend.storage!.connect()).toEqual({ kind: 'connected', name: 'job-applications' })

    await backend.saveDocument(withApplication())

    const onDisk = folder.readText(TRACKER_FILENAME)
    expect(onDisk).toContain('Northwind')
    expect(await store.get('state', 'document')).toBe(onDisk)
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

  it('adopts the data already in the folder instead of overwriting it', async () => {
    const backend = connected(store, folder)
    await backend.saveDocument(withApplication('Typed before connecting'))

    // The folder already holds a different tracker — the one the viewer means to open.
    const seeded = connected(memoryStore(), folder)
    await seeded.storage!.connect()
    await seeded.saveDocument(withApplication('Already in the folder'))

    await backend.storage!.connect()
    const loaded = await backend.loadDocument()
    expect(loaded.applications.map((application) => application.company)).toEqual([
      'Already in the folder',
    ])
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
    backend.storage!.subscribe((connection) => seen.push(connection.kind))

    // Subscribing reports the current state first, so a late subscriber is never blank.
    expect(seen).toEqual(['disconnected'])

    await backend.storage!.connect()
    await backend.storage!.disconnect()
    expect(seen).toEqual(['disconnected', 'connected', 'disconnected'])
  })

  it('treats a dismissed picker as no change', async () => {
    const backend = browserBackend({ store, supportsFolders: true, pick: async () => null })
    expect(await backend.storage!.connect()).toEqual({ kind: 'disconnected' })
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

  it('keeps accepting saves while disconnected, then flushes on reconnect', async () => {
    folder.permission = 'prompt'
    const backend = connected(store, folder)
    await backend.loadDocument()
    await backend.saveDocument(withApplication('Saved while locked out'))

    expect(folder.readText(TRACKER_FILENAME)).toContain('Saved while connected')

    expect(await backend.storage!.reconnect()).toEqual({
      kind: 'connected',
      name: 'job-applications',
    })
    await backend.saveDocument(withApplication('Saved after reconnecting'))
    expect(folder.readText(TRACKER_FILENAME)).toContain('Saved after reconnecting')
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
    expect(await store.get('state', 'directoryHandle')).toBeNull()
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
