import { afterEach, describe, expect, it } from 'vitest'

import { browserBackend } from './browserBackend'
import { idbName, indexedDbStore } from './idb'

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
    const backend = browserBackend({ store: indexedDbStore('live'), supportsFolders: false })
    const loaded = await backend.loadDocument()
    expect(loaded.applications).toEqual([])
    expect(backend.storage!.state().unbackedSince).toBeNull()
  })
})
