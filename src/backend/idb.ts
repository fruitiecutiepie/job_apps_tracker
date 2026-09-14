import { trackerProfile, type TrackerProfile } from '../domain/trackerProfile'

/**
 * The little slice of IndexedDB this app needs, behind an interface so the backend can be
 * tested with an in-memory fake rather than a polyfill.
 */
export type StoreName = 'state' | 'attachments'

export interface KeyValueStore {
  get(store: StoreName, key: string): Promise<unknown>
  put(store: StoreName, key: string, value: unknown): Promise<void>
  delete(store: StoreName, key: string): Promise<void>
  keys(store: StoreName): Promise<string[]>
  clear(store: StoreName): Promise<void>
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
  const database = () => (opening ??= openDatabase(idbName(profile)))

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
    get: (store, key) => transact(store, 'readonly', (objectStore) => objectStore.get(key)),
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
  }
}
