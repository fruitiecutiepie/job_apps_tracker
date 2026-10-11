/**
 * `pnpm usage:report` — fetches the hosted tracker's usage counts from Workers Analytics
 * Engine and prints the numbers worth watching.
 *
 * Needs an account id and an API token with Account → Account Analytics → Read, in
 * CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (the names Wrangler reads), or CF_ACCOUNT_ID
 * and CF_API_TOKEN. Options: --weeks N (default 8), --limit N rows (default 10000), --json.
 *
 * Everything that fetches and computes is in `src/usageReport.ts`, which is tested; this file
 * only reads options and prints. It loads that module through Vite, since the app's sources
 * import without file extensions and plain Node will not resolve them.
 */
import { runnerImport } from 'vite'

import type * as Report from '../src/usageReport'

function option(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  const value = index === -1 ? NaN : Number(process.argv[index + 1])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID
const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN
if (!account || !token) {
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Account Analytics: Read).')
  process.exit(1)
}

const weeks = option('weeks', 8)
const limit = option('limit', 10_000)
const { module: report } = await runnerImport<typeof Report>(new URL('../src/usageReport.ts', import.meta.url).pathname, {
  configFile: false,
  logLevel: 'error',
})

try {
  const { rows, truncated } = await report.fetchUsageRows({ account, token, weeks, limit })
  if (truncated) {
    console.error(`Warning: the query hit its limit of ${limit} rows, so the oldest weeks are incomplete. Raise --limit.`)
  }
  const summary = report.buildUsageReport(rows, new Date(), weeks)
  console.log(process.argv.includes('--json') ? JSON.stringify(summary, null, 2) : report.formatUsageReport(summary))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
