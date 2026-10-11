import { afterEach, describe, expect, it } from 'vitest'

import { addApplication } from '../domain/mutations'
import type { TrackerDatabase } from '../domain/types'
import { browserBackend } from './browserBackend'
import { idbName, indexedDbStore } from './idb'
import { NEW_TRACKER } from './trackerAddress'

function adding(company: string) {
  return (document: TrackerDatabase) =>
    addApplication(document, {
      company,
      role: '',
      url: '',
      source: '',
      stage: 'applied',
      next_action: '',
      next_action_at: null,
      deadline_at: null,
      notes: '',
    })
}

/*
 * Every unit test of the backend runs on `memoryStore`, because jsdom has no IndexedDB.
 * So the only place the real store's answers can be checked is a real browser — and a
 * first visit failing to load was exactly a difference between the two.
 */
describe('the IndexedDB store', () => {
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(idbName('live'))
      request.onsuccess = request.onerror = request.onblocked = () => resolve()
    })
  })

  it('reports a missing key as null, the way the in-memory store does', async () => {
    expect(await indexedDbStore('live').get('state', 'document')).toBeNull()
  })

  it('opens a first visit on an empty tracker rather than failing to load', async () => {
    const backend = browserBackend({
      store: indexedDbStore('live'),
      supportsFolders: false,
      // The runner's own page is not a tracker tab, so its URL is left alone.
      address: { requested: () => null, show: () => {} },
    })
    const loaded = await backend.loadDocument()
    expect(loaded.applications).toEqual([])
    expect(backend.storage!.state().unbackedSince).toBeNull()
  })

  /*
   * The one-step update is what keeps two tabs' writes from crossing where Web Locks do
   * not exist. Its read and its writes share one readwrite transaction, which IndexedDB
   * runs one at a time across connections — so of two that saw the same revision, only one
   * can act on it. The in-memory store gets this for free; only the real one can show it.
   */
  it('writes what the update decides, and nothing when it decides nothing', async () => {
    const store = indexedDbStore('live')
    expect(await store.update('state', 'revision:x', (current) => {
      expect(current).toBeNull()
      return [['document:x', 'one'], ['revision:x', 1]]
    })).toBe(true)
    expect(await store.update('state', 'revision:x', () => null)).toBe(false)
    expect(await store.get('state', 'document:x')).toBe('one')
    expect(await store.get('state', 'revision:x')).toBe(1)
  })

  it('lets only one of two connections act on a revision both expected', async () => {
    const tabs = [indexedDbStore('live'), indexedDbStore('live')]
    const results = await Promise.all(tabs.map((store, index) =>
      store.update('state', 'revision:x', (current) =>
        ((current as number | null) ?? 0) === 0
          ? [['document:x', `from tab ${index}`], ['revision:x', 1]]
          : null),
    ))
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await tabs[0].get('state', 'revision:x')).toBe(1)
  })

  it('keeps both tabs\' edits without Web Locks, when they write at the same moment', async () => {
    const noLocks = { run: <T,>(_name: string, task: () => Promise<T>) => task() }
    const tab = (requested: string) => browserBackend({
      store: indexedDbStore('live'),
      supportsFolders: false,
      persist: async () => true,
      locks: noLocks,
      channel: () => null,
      address: { requested: () => requested, show: () => {} },
    })
    const first = tab(NEW_TRACKER)
    const start = await first.updateDocument!(await first.loadDocument(), adding('Northwind'))
    const second = tab(first.storage!.state().tracker!.id)
    const seen = await second.loadDocument()

    await Promise.all([
      first.updateDocument!(start.document, adding('From the first tab')),
      second.updateDocument!(seen, adding('From the second tab')),
    ])

    const stored = await tab(first.storage!.state().tracker!.id).loadDocument()
    expect(stored.applications.map((item) => item.company).sort()).toEqual([
      'From the first tab',
      'From the second tab',
      'Northwind',
    ])
  })
})
