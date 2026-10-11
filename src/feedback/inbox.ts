import type { FeedbackSubmission } from './report'

/**
 * What this browser has sent, kept so the sender can see it went and retry one that did
 * not. A report that fails to send is kept rather than lost: it was written mid-problem,
 * and asking someone to describe it twice is how the second description never happens.
 *
 * It lives in an IndexedDB database of its own, apart from either tracker's. Feedback is
 * about the app rather than about anybody's job search, so it belongs to neither tracker,
 * travels in no export, and is untouched by removing one.
 */
export interface SentReport {
  /** This browser's id for the report, which is not the inbox's. */
  id: string
  /** The inbox's id, once it has one. */
  remote_id: string | null
  submission: FeedbackSubmission
  screenshots: Blob[]
  sent_at: string | null
  /** Why the last attempt failed, while it has not gone. */
  error: string | null
}

export interface FeedbackInbox {
  list(): Promise<SentReport[]>
  put(report: SentReport): Promise<void>
  delete(id: string): Promise<void>
}

const DATABASE = 'job-applications-tracker-feedback'
const STORE = 'reports'

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result)
    source.onerror = () => reject(source.error ?? new Error('Browser storage failed'))
  })
}

function indexedDbInbox(): FeedbackInbox {
  let opening: Promise<IDBDatabase> | null = null
  const database = () => (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 1)
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    open.onsuccess = () => {
      open.result.onversionchange = () => {
        open.result.close()
        opening = null
      }
      resolve(open.result)
    }
    open.onerror = () => reject(open.error ?? new Error('Could not open browser storage'))
  }))

  async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const transaction = (await database()).transaction(STORE, mode)
    const result = await request(act(transaction.objectStore(STORE)))
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Browser storage failed'))
    })
    return result
  }

  return {
    list: async () => sortNewestFirst(await run('readonly', (store) => store.getAll() as IDBRequest<SentReport[]>)),
    put: async (report) => void (await run('readwrite', (store) => store.put(report))),
    delete: async (id) => void (await run('readwrite', (store) => store.delete(id))),
  }
}

function sortNewestFirst(reports: SentReport[]): SentReport[] {
  return [...reports].sort((a, b) => b.submission.created_at.localeCompare(a.submission.created_at))
}

/** In-memory stand-in for tests, and for a browser that will not open IndexedDB. */
export function memoryInbox(): FeedbackInbox {
  const reports = new Map<string, SentReport>()
  return {
    list: async () => sortNewestFirst([...reports.values()]),
    put: async (report) => void reports.set(report.id, report),
    delete: async (id) => void reports.delete(id),
  }
}

let shared: FeedbackInbox | null = null

export function feedbackInbox(): FeedbackInbox {
  if (!shared) {
    shared = typeof indexedDB === 'undefined' ? memoryInbox() : withFallback(indexedDbInbox())
  }
  return shared
}

/*
 * A private window can refuse IndexedDB outright. The panel still works then — it simply
 * forgets what was sent when the tab closes, which is all a private window promises anyway.
 */
function withFallback(primary: FeedbackInbox): FeedbackInbox {
  const fallback = memoryInbox()
  let failed = false
  const attempt = async <T>(call: (inbox: FeedbackInbox) => Promise<T>): Promise<T> => {
    if (failed) return call(fallback)
    try {
      return await call(primary)
    } catch {
      failed = true
      return call(fallback)
    }
  }
  return {
    list: () => attempt((inbox) => inbox.list()),
    put: (report) => attempt((inbox) => inbox.put(report)),
    delete: (id) => attempt((inbox) => inbox.delete(id)),
  }
}
