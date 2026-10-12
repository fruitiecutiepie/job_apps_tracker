import { handleFeedbackRequest, type FeedbackStore } from '../src/feedback/server'
import { usageDocument } from '../src/usageDocument'
import { parseUsageReport, usageDataPoint } from '../src/usageEvent'
import { buildUsageReport, fetchUsageRows } from '../src/usageReport'

/*
 * The slices of the Workers runtime this file touches, declared here rather than pulled in
 * from `@cloudflare/workers-types`: a few methods on a bucket, one on the assets binding and
 * one on a dataset do not justify a dependency whose globals would fight the DOM types the
 * app builds with.
 */
interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>
  httpMetadata?: { contentType?: string }
}

interface R2Bucket {
  put(key: string, value: Uint8Array | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  get(key: string): Promise<R2ObjectBody | null>
  delete(key: string): Promise<void>
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: Array<{ key: string }>
    truncated: boolean
    cursor?: string
  }>
}

interface AnalyticsEngineDataset {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void
}

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  FEEDBACK?: R2Bucket
  /** Set from Bitwarden by `scripts/push-worker-secrets`. Unset, the inbox stays shut. */
  FEEDBACK_ADMIN_TOKEN?: string
  /** Usage counts (src/usageEvent.ts). */
  USAGE?: AnalyticsEngineDataset
  /** The account the usage dataset is in, and where the summary goes (wrangler.jsonc vars). */
  ANALYTICS_ACCOUNT_ID?: string
  USAGE_PUSH_URL?: string
  /** Secrets, from Bitwarden by `scripts/push-worker-secrets`: a token with Account Analytics:
      Read, and this project's usage token from fruitiecutiepie.com (its scripts/usage-token). */
  ANALYTICS_TOKEN?: string
  USAGE_PUSH_TOKEN?: string
}

function bucketStore(bucket: R2Bucket): FeedbackStore {
  return {
    put: async (key, body, contentType) => {
      await bucket.put(key, body, { httpMetadata: { contentType } })
    },
    get: async (key) => {
      const object = await bucket.get(key)
      if (!object) return null
      return {
        body: new Uint8Array(await object.arrayBuffer()),
        contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
      }
    },
    list: async (prefix) => {
      const keys: string[] = []
      let cursor: string | undefined
      do {
        const page = await bucket.list({ prefix, cursor })
        keys.push(...page.objects.map((object) => object.key))
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor)
      return keys
    },
    delete: (key) => bucket.delete(key),
  }
}

/** A usage report is a few hundred bytes; anything much larger is not one. */
const MAX_USAGE_BODY = 2048

/** Twelve weeks: what the progress page charts, inside the three months the data keeps. */
export const PUSH_WEEKS = 12
const PUSH_ROW_LIMIT = 50_000

/**
 * Takes a usage report in. It stores a report only if it is exactly one the app is allowed
 * to send, and stores nothing about the request itself — no address, no headers.
 */
export async function handleUsage(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  // Reports come from the app's own pages, and every browser that can send one says so. A
  // script can forge the header, so this keeps out the casual flood rather than a determined
  // one; the report query reads newest first, so even that cannot push this week out of it.
  if (request.headers.get('Sec-Fetch-Site') !== 'same-origin') return new Response(null, { status: 403 })
  const text = await request.text()
  if (text.length > MAX_USAGE_BODY) return new Response(null, { status: 413 })
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return new Response(null, { status: 400 })
  }
  const report = parseUsageReport(body)
  if (!report) return new Response(null, { status: 400 })
  env.USAGE?.writeDataPoint(usageDataPoint(report))
  return new Response(null, { status: 204 })
}

export type PushResult =
  | { outcome: 'pushed' }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'refused'; status: number; detail: string }

/**
 * Works the usage summary out from Analytics Engine and sends it to the progress page at
 * fruitiecutiepie.com, replacing what the page showed. The tracker decides what goes on that
 * page; the site decides how it looks (src/usageDocument.ts). Unconfigured, it sends nothing
 * and says so; refused, it says what the site answered, which for a document the site can't
 * read is every error at once.
 */
export async function pushUsage(env: Env, now: Date = new Date(), fetchImpl: typeof fetch = fetch): Promise<PushResult> {
  const { ANALYTICS_ACCOUNT_ID: account, ANALYTICS_TOKEN: token, USAGE_PUSH_URL: url, USAGE_PUSH_TOKEN: pushToken } = env
  if (!account || !token || !url || !pushToken) return { outcome: 'skipped', reason: 'not configured' }
  const { rows, truncated } = await fetchUsageRows({ account, token, weeks: PUSH_WEEKS, limit: PUSH_ROW_LIMIT, fetch: fetchImpl })
  if (truncated) console.warn(`usage push: hit the ${PUSH_ROW_LIMIT}-row limit, so the oldest weeks are short`)
  const response = await fetchImpl(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${pushToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(usageDocument(buildUsageReport(rows, now, PUSH_WEEKS))),
  })
  if (response.ok) return { outcome: 'pushed' }
  return { outcome: 'refused', status: response.status, detail: (await response.text()).slice(0, 2000) }
}

/*
 * Only `…/api/*` reaches `fetch` — `run_worker_first` in wrangler.jsonc says so — and
 * everything else is served straight from the built assets. Usage reports and feedback are
 * the two routes there; anything else under that prefix is handed back to the assets, which
 * answer 404. `scheduled` is the hourly usage push.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (/\/api\/usage\/?$/.test(new URL(request.url).pathname)) return handleUsage(request, env)
    if (env.FEEDBACK) {
      const response = await handleFeedbackRequest(request, {
        store: bucketStore(env.FEEDBACK),
        adminToken: env.FEEDBACK_ADMIN_TOKEN || null,
      })
      if (response) return response
    }
    return env.ASSETS.fetch(request)
  },

  async scheduled(_controller: unknown, env: Env, context: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    context.waitUntil(
      pushUsage(env).then((result) => {
        if (result.outcome === 'pushed') return
        console.error(JSON.stringify({ usagePush: result }))
        // A refusal is a failed run, so it shows as one in the Worker's logs.
        if (result.outcome === 'refused') throw new Error(`usage push refused: ${result.status}`)
      }),
    )
  },
}
