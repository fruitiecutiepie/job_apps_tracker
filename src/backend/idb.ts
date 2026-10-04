import { trackerProfile, type TrackerProfile } from '../domain/trackerProfile'

/**
 * The little slice of IndexedDB this app needs, behind an interface so the backend can be
 * tested with an in-memory fake rather than a polyfill.
 */
export type StoreName = 'state' | 'attachments'

export interface KeyValueStore {
  /** Null, never undefined, when the key is absent. */
  get(store: StoreName, key: string): Promise<unknown>
  put(store: StoreName, key: string, value: unknown): Promise<void>
  delete(store: StoreName, key: string): Promise<void>
  keys(store: StoreName): Promise<string[]>
  clear(store: StoreName): Promise<void>
  /**
   * Reads `key` and writes whatever `decide` returns for it, as one step no other write can
   * land inside — another tab's included. `decide` runs synchronously and may return null
   * to write nothing. Resolves to whether anything was written.
   *
   * This is what makes a revision a real guard: read and written apart, two tabs can both
   * see the same revision and each store a document built on it, the later undoing the
   * earlier. Web Locks keep that from happening where they exist; this keeps it from
   * happening anywhere.
   */
  update(
    store: StoreName,
    key: string,
    decide: (current: unknown) => Array<[key: string, value: unknown]> | null,
  ): Promise<boolean>
}

export const IDB_VERSION = 1
const STORES: StoreName[] = ['state', 'attachments']

/*
 * The demo and the real tracker are served from one origin, so they share one IndexedDB
 * namespace unless told otherwise. A database per profile is what keeps nineteen
 * fictional applications from ever turning up in somebody's actual job search.
 */
export function idbName(profile: TrackerProfile): string {
  return profile === 'demo' ? 'job-applications-tracker-demo' : 'job-applications-tracker'
}

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result)
    source.onerror = () => reject(source.error ?? new Error('IndexedDB request failed'))
  })
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, IDB_VERSION)
    open.onupgradeneeded = () => {
      for (const store of STORES) {
        if (!open.result.objectStoreNames.contains(store)) open.result.createObjectStore(store)
      }
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error ?? new Error('Could not open browser storage'))
  })
}

export function indexedDbStore(profile: TrackerProfile = trackerProfile()): KeyValueStore {
  let opening: Promise<IDBDatabase> | null = null
  /*
   * Lets go when another context needs the database — an upgrade in a newer tab, or a
   * deletion — rather than holding it open and leaving that request waiting for good. The
   * next call opens it again.
   */
  const database = () => (opening ??= openDatabase(idbName(profile)).then((db) => {
    db.onversionchange = () => {
      db.close()
      opening = null
    }
    return db
  }))

  async function transact<T>(
    store: StoreName,
    mode: IDBTransactionMode,
    run: (objectStore: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await database()
    const transaction = db.transaction(store, mode)
    const result = await request(run(transaction.objectStore(store)))
    /*
     * Resolving on the request alone would report a write as landed while the transaction
     * is still open, so a reload racing the next save could miss it.
     */
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error ?? new Error('Browser storage write failed'))
    })
    return result
  }

  return {
    /*
     * IndexedDB answers a missing key with `undefined`, and every caller asks `=== null`,
     * which is what the in-memory store the unit tests use has always returned. Passing
     * `undefined` through made a first visit parse it as a document and refuse to load.
     */
    get: async (store, key) =>
      (await transact(store, 'readonly', (objectStore) => objectStore.get(key))) ?? null,
    put: async (store, key, value) => {
      await transact(store, 'readwrite', (objectStore) => objectStore.put(value, key))
    },
    delete: async (store, key) => {
      await transact(store, 'readwrite', (objectStore) => objectStore.delete(key))
    },
    keys: async (store) => {
      const keys = await transact(store, 'readonly', (objectStore) => objectStore.getAllKeys())
      return keys.map(String)
    },
    clear: async (store) => {
      await transact(store, 'readwrite', (objectStore) => objectStore.clear())
    },
    /*
     * One readwrite transaction for the read and the writes. IndexedDB runs readwrite
     * transactions over the same store one at a time, across every tab of the origin, so
     * nothing can be written between what `decide` saw and what it chose to write.
     */
    update: async (store, key, decide) => {
      const db = await database()
      const transaction = db.transaction(store, 'readwrite')
      const objectStore = transaction.objectStore(store)
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onabort = transaction.onerror = () =>
          reject(transaction.error ?? new Error('Browser storage write failed'))
      })
      // Written from the read's own callback: an `await` here would let the transaction
      // commit before the writes were queued on it.
      const read = objectStore.get(key)
      let wrote = false
      read.onsuccess = () => {
        const entries = decide(read.result ?? null)
        if (!entries) return
        wrote = true
        for (const [entryKey, value] of entries) objectStore.put(value, entryKey)
      }
      await done
      return wrote
    },
  }
}

/** In-memory stand-in, used by tests and when IndexedDB is unavailable (private mode). */
export function memoryStore(): KeyValueStore {
  const data: Record<StoreName, Map<string, unknown>> = {
    state: new Map(),
    attachments: new Map(),
  }
  return {
    get: async (store, key) => data[store].get(key) ?? null,
    put: async (store, key, value) => void data[store].set(key, value),
    delete: async (store, key) => void data[store].delete(key),
    keys: async (store) => [...data[store].keys()],
    clear: async (store) => data[store].clear(),
    // No await between the read and the writes, so nothing else can run between them.
    update: async (store, key, decide) => {
      const entries = decide(data[store].get(key) ?? null)
      if (!entries) return false
      for (const [entryKey, value] of entries) data[store].set(entryKey, value)
      return true
    },
  }
}
