import { createUuidV7 } from '../domain/id'
import { INBOX_PAGE } from './inboxPage'
import {
  isFeedbackStatus,
  MAX_REQUEST_BYTES,
  MAX_SCREENSHOTS,
  parseFeedbackSubmission,
  screenshotProblem,
  type FeedbackRecord,
} from './report'

/**
 * Where reports go, behind the four calls the handler needs. The Worker answers it with an
 * R2 bucket and the dev server with a folder, so the route itself is written once and
 * tested once, against the in-memory store below.
 */
export interface FeedbackStore {
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>
  /** Every key starting with `prefix`. */
  list(prefix: string): Promise<string[]>
  delete(key: string): Promise<void>
}

export interface FeedbackHandlerOptions {
  store: FeedbackStore
  /**
   * The secret that reads, triages and deletes reports. Null leaves the inbox shut: anyone
   * may send, nobody may read. Sending never needs it.
   */
  adminToken: string | null
  now?: () => Date
}

/** The segment every feedback route sits under, wherever the app itself is served from. */
export const FEEDBACK_ROUTE = '/api/feedback'
/** How many reports the inbox lists, newest first. */
export const INBOX_LIMIT = 200

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const reportKey = (id: string) => `reports/${id}.json`
const screenshotPrefix = (id: string) => `screenshots/${id}/`
const screenshotKey = (id: string, index: number) => `${screenshotPrefix(id)}${index}`

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function problem(status: number, error: string): Response {
  return json(status, { error })
}

/** Compares without returning early, so the time taken says nothing about the token. */
function sameSecret(given: string, expected: string): boolean {
  let difference = given.length ^ expected.length
  for (let index = 0; index < given.length; index += 1) {
    difference |= given.charCodeAt(index) ^ expected.charCodeAt(index % Math.max(expected.length, 1))
  }
  return difference === 0
}

function authorised(request: Request, adminToken: string | null): Response | null {
  if (!adminToken) return problem(503, 'The feedback inbox has no admin token configured.')
  const header = request.headers.get('Authorization') ?? ''
  const given = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  return given && sameSecret(given, adminToken) ? null : problem(401, 'Wrong or missing token.')
}

async function readRecord(store: FeedbackStore, id: string): Promise<FeedbackRecord | null> {
  const stored = await store.get(reportKey(id))
  if (!stored) return null
  try {
    return JSON.parse(new TextDecoder().decode(stored.body)) as FeedbackRecord
  } catch {
    return null
  }
}

async function receive(request: Request, options: FeedbackHandlerOptions): Promise<Response> {
  /*
   * A report is sent by the page it describes, never by another site. Browsers that send
   * `Sec-Fetch-Site` say so outright; a request without it (a script, an old browser) is
   * let through, since refusing it would stop nothing anyone determined could not forge.
   */
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return problem(403, 'Reports are accepted from the app only.')
  }
  const declared = Number(request.headers.get('Content-Length') ?? 0)
  if (declared > MAX_REQUEST_BYTES) return problem(413, 'The report is too large.')

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return problem(400, 'The report could not be read.')
  }

  let raw: unknown
  try {
    raw = JSON.parse(String(form.get('report') ?? ''))
  } catch {
    return problem(400, 'The report could not be read.')
  }
  const parsed = parseFeedbackSubmission(raw)
  if (!parsed.ok) return problem(400, parsed.error)

  const files = form.getAll('screenshot').filter((entry): entry is File => typeof entry !== 'string')
  if (files.length > MAX_SCREENSHOTS) return problem(400, `Send at most ${MAX_SCREENSHOTS} screenshots.`)
  for (const file of files) {
    const reason = screenshotProblem(file)
    if (reason) return problem(400, reason)
  }

  const now = options.now?.() ?? new Date()
  const id = createUuidV7(now)
  // Screenshots first: a report listed in the inbox should never point at an image that
  // has not landed yet.
  for (const [index, file] of files.entries()) {
    await options.store.put(screenshotKey(id, index), new Uint8Array(await file.arrayBuffer()), file.type)
  }
  const record: FeedbackRecord = {
    ...parsed.submission,
    id,
    received_at: now.toISOString(),
    status: 'new',
    screenshots: files.map((file, index) => ({ index, type: file.type, size: file.size })),
  }
  await options.store.put(reportKey(id), JSON.stringify(record), 'application/json')
  return json(201, { id })
}

async function list(options: FeedbackHandlerOptions): Promise<Response> {
  const ids = (await options.store.list('reports/'))
    .map((key) => key.slice('reports/'.length, -'.json'.length))
    .filter((id) => ID.test(id))
    // UUIDv7 sorts by when it was minted, so this is newest first.
    .sort()
    .reverse()
    .slice(0, INBOX_LIMIT)
  const records = await Promise.all(ids.map((id) => readRecord(options.store, id)))
  return json(200, { reports: records.filter(Boolean) })
}

/**
 * Answers a request under `/api/feedback`, or returns null when the request is for
 * something else and should go on to the app's own files.
 */
export async function handleFeedbackRequest(
  request: Request,
  options: FeedbackHandlerOptions,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const at = pathname.indexOf(FEEDBACK_ROUTE)
  if (at === -1) return null
  const rest = pathname.slice(at + FEEDBACK_ROUTE.length).replace(/\/$/, '')
  if (rest && !rest.startsWith('/')) return null
  const parts = rest.split('/').filter(Boolean)
  const method = request.method.toUpperCase()

  if (parts.length === 0 && method === 'POST') return receive(request, options)

  if (parts.length === 1 && parts[0] === 'inbox' && method === 'GET') {
    return new Response(INBOX_PAGE, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // The page holds a token; nothing else may frame it or be loaded into it.
        'Content-Security-Policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
      },
    })
  }

  const denied = authorised(request, options.adminToken)

  if (parts.length === 0 && method === 'GET') return denied ?? list(options)

  const [id, sub, index] = parts
  if (!id || !ID.test(id)) return problem(404, 'No such report.')

  if (parts.length === 3 && sub === 'screenshots' && method === 'GET') {
    if (denied) return denied
    if (!/^\d+$/.test(index ?? '')) return problem(404, 'No such screenshot.')
    const stored = await options.store.get(screenshotKey(id, Number(index)))
    if (!stored) return problem(404, 'No such screenshot.')
    return new Response(new Uint8Array(stored.body), {
      headers: { 'Content-Type': stored.contentType, 'Cache-Control': 'no-store' },
    })
  }

  if (parts.length !== 1) return problem(404, 'Not found.')

  if (method === 'PATCH') {
    if (denied) return denied
    const record = await readRecord(options.store, id)
    if (!record) return problem(404, 'No such report.')
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return problem(400, 'Send a JSON body.')
    }
    const status = (body as { status?: unknown } | null)?.status
    if (!isFeedbackStatus(status)) return problem(400, 'Unknown status.')
    const next = { ...record, status }
    await options.store.put(reportKey(id), JSON.stringify(next), 'application/json')
    return json(200, next)
  }

  if (method === 'DELETE') {
    if (denied) return denied
    for (const key of await options.store.list(screenshotPrefix(id))) await options.store.delete(key)
    await options.store.delete(reportKey(id))
    return new Response(null, { status: 204 })
  }

  return problem(405, 'Method not allowed.')
}

/** A store that forgets everything, for tests. */
export function memoryFeedbackStore(): FeedbackStore & { keys(): string[] } {
  const data = new Map<string, { body: Uint8Array; contentType: string }>()
  return {
    put: async (key, body, contentType) => {
      data.set(key, { body: typeof body === 'string' ? new TextEncoder().encode(body) : body, contentType })
    },
    get: async (key) => data.get(key) ?? null,
    list: async (prefix) => [...data.keys()].filter((key) => key.startsWith(prefix)),
    delete: async (key) => void data.delete(key),
    keys: () => [...data.keys()],
  }
}
