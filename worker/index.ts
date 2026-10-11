import { parseUsageReport, usageDataPoint } from '../src/usageEvent'
import { buildUsageReport, fetchUsageRows } from '../src/usageReport'

/**
 * The hosted tracker's one piece of server code. Everything else is static files, served by
 * the asset handler before this ever runs: `run_worker_first` in `wrangler.jsonc` sends only
 * the two paths below here.
 *
 * `__usage` takes reports in. It stores a report only if it is exactly one the app is
 * allowed to send, and stores nothing about the request itself — no address, no headers.
 *
 * `__progress` gives the summary out, to the portfolio's progress page, which fetches it
 * hourly and shows it to the owner and contributors only. It answers only with the report
 * key, so the figures are no more public than that page.
 */

interface AnalyticsEngineDataset {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void
}

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  USAGE?: AnalyticsEngineDataset
  /** Secrets, for `__progress`: the account and a token with Account Analytics: Read. */
  ANALYTICS_ACCOUNT_ID?: string
  ANALYTICS_TOKEN?: string
  /** Secret shared with the portfolio, which sends it as a bearer token. */
  USAGE_REPORT_KEY?: string
}

/** A report is a few hundred bytes; anything much larger is not one. */
const MAX_BODY = 2048

/** Twelve weeks: the progress page's charts run that far back, and the data keeps three months. */
export const PROGRESS_WEEKS = 12
const PROGRESS_ROW_LIMIT = 50_000

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

/** Equal strings, compared in a time that does not say how much of a guess was right. */
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let difference = a.length ^ b.length
  for (let index = 0; index < b.length; index += 1) difference |= (a[index] ?? 0) ^ b[index]
  return difference === 0
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  })

export async function handleProgress(
  request: Request,
  env: Env,
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
  const { ANALYTICS_ACCOUNT_ID: account, ANALYTICS_TOKEN: token, USAGE_REPORT_KEY: key } = env
  // Unconfigured is refused outright, never answered: an empty key would match an empty guess.
  if (!account || !token || !key) return json({ error: 'not configured' }, 503)
  const given = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
  if (!sameSecret(given, key)) return json({ error: 'unauthorized' }, 401)
  try {
    const { rows, truncated } = await fetchUsageRows({
      account,
      token,
      weeks: PROGRESS_WEEKS,
      limit: PROGRESS_ROW_LIMIT,
      fetch: fetchImpl,
    })
    return json({ ...buildUsageReport(rows, now, PROGRESS_WEEKS), truncated })
  } catch (error) {
    // Says that it failed, not why: the reason can carry the API's own message.
    console.error(error)
    return json({ error: 'analytics unavailable' }, 502)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname.endsWith('/__usage')) return handleUsage(request, env)
    if (pathname.endsWith('/__progress')) return handleProgress(request, env)
    return env.ASSETS.fetch(request)
  },
}
