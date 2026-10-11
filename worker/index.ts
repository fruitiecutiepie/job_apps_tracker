import { usageDocument } from '../src/usageDocument'
import { parseUsageReport, usageDataPoint } from '../src/usageEvent'
import { buildUsageReport, fetchUsageRows } from '../src/usageReport'

/**
 * The hosted tracker's one piece of server code. Everything else is static files, served by
 * the asset handler before this ever runs: `run_worker_first` in `wrangler.jsonc` sends only
 * the usage path here.
 *
 * `fetch` takes usage reports in. It stores a report only if it is exactly one the app is
 * allowed to send, and stores nothing about the request itself — no address, no headers.
 *
 * `scheduled` sends the summary out, hourly, to the progress page at fruitiecutiepie.com,
 * which only the owner and contributors can open. The tracker decides what goes on that page;
 * the site decides how it looks (src/usageDocument.ts).
 */

interface AnalyticsEngineDataset {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void
}

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  USAGE?: AnalyticsEngineDataset
  /** Where the summary goes: the site's usage API for this project (wrangler.jsonc vars). */
  USAGE_PUSH_URL?: string
  /** Secrets: the account the dataset is in, a token with Account Analytics: Read, and this
      project's usage token from the site (its scripts/usage-token). */
  ANALYTICS_ACCOUNT_ID?: string
  ANALYTICS_TOKEN?: string
  USAGE_PUSH_TOKEN?: string
}

/** A report is a few hundred bytes; anything much larger is not one. */
const MAX_BODY = 2048

/** Twelve weeks: what the progress page charts, inside the three months the data keeps. */
export const PUSH_WEEKS = 12
const PUSH_ROW_LIMIT = 50_000

export async function handleUsage(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  // Reports come from the app's own pages. Browsers too old to send the header are let in.
  const site = request.headers.get('Sec-Fetch-Site')
  if (site !== null && site !== 'same-origin') return new Response(null, { status: 403 })
  const text = await request.text()
  if (text.length > MAX_BODY) return new Response(null, { status: 413 })
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
 * Works the report out from Analytics Engine and sends it to the site, replacing what the
 * page showed. Unconfigured, it sends nothing and says so; refused, it says what the site
 * answered, which for a document the site can't read is every error at once.
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.endsWith('/__usage')) return handleUsage(request, env)
    return env.ASSETS.fetch(request)
  },

  async scheduled(_controller: unknown, env: Env, context: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    context.waitUntil(
      pushUsage(env).then(
        (result) => {
          if (result.outcome === 'pushed') return
          console.error(JSON.stringify({ usagePush: result }))
          // A refusal is a failed run, so it shows as one in the Worker's logs.
          if (result.outcome === 'refused') throw new Error(`usage push refused: ${result.status}`)
        },
      ),
    )
  },
}
