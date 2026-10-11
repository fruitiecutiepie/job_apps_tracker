import { parseUsageReport, usageDataPoint } from '../src/usageEvent'

/**
 * The hosted tracker's one piece of server code. Everything else is static files, served by
 * the asset handler before this ever runs: `run_worker_first` in `wrangler.jsonc` sends only
 * the usage path here.
 *
 * It stores a report only if it is exactly one the app is allowed to send, and stores
 * nothing about the request itself — no address, no headers, no time finer than Analytics
 * Engine's own.
 */

interface AnalyticsEngineDataset {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void
}

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  USAGE?: AnalyticsEngineDataset
}

/** A report is a few hundred bytes; anything much larger is not one. */
const MAX_BODY = 2048

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.endsWith('/__usage')) return handleUsage(request, env)
    return env.ASSETS.fetch(request)
  },
}
