import { describe, expect, it, vi } from 'vitest'

import worker, { pushUsage, PUSH_WEEKS } from '../worker'
import { USAGE_DOCUMENT_SCHEMA, usageDocument, type UsageDocument } from './usageDocument'
import { buildUsageReport, type UsageReportSummary, type UsageRow } from './usageReport'

/*
 * The document the progress page at fruitiecutiepie.com draws. Each metric is checked for
 * the number it carries, and the whole document against the site's rules
 * (docs/usage-api.md there), which the site enforces by refusing the push outright.
 */

const DAY = 86_400_000
const NOW = new Date('2026-10-14T12:00:00Z')
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY)
const OPEN = {
  applications: '0', age: 'none', reached: 'none', storage: 'browser', backlog: 'none',
  notes: 'n', captures: 'n', messages: 'n', invites: 'n', ratings: 'n', compensation: 'n',
  posting: 'n', attachments: 'n', done: 'n', archived: 'n', referrer: 'direct',
}
function row(tracker: string, event: UsageRow['event'], daysAgo: number, props: Record<string, string> = {}): UsageRow {
  return { at: at(daysAgo), tracker: tracker.padEnd(16, '0'), profile: 'live', event, props: event === 'open' ? { ...OPEN, ...props } : props, weight: 1 }
}

/** Three trackers over five weeks, one of them back after a month, a little of everything. */
const ROWS: UsageRow[] = [
  row('a', 'open', 35, { referrer: 'search' }),
  row('a', 'application_added', 35),
  row('a', 'open', 27, { applications: '3-10', age: '8-30d', notes: 'y', storage: 'folder', reached: 'offer' }),
  row('a', 'open', 2, { applications: '3-10', age: '31-90d', notes: 'y', storage: 'folder', reached: 'offer', referrer: 'site' }),
  row('a', 'moved', 2, { stage: 'offer', outcome: 'active' }),
  row('a', 'view_time', 2, { place: 'kanban', duration: '5-30m' }),
  row('a', 'exported', 2),
  row('b', 'open', 3, { referrer: 'demo' }),
  row('b', 'application_added', 3),
  row('b', 'application_added', 3),
  row('b', 'error', 3, { kind: 'save' }),
  row('c', 'open', 1, { age: '0d', ratings: 'y' }),
  row('c', 'view_time', 1, { place: 'table', duration: '1-5m' }),
]
const report: UsageReportSummary = buildUsageReport(ROWS, NOW, PUSH_WEEKS)
const document = usageDocument(report)
const find = (id: string) => {
  const metric = document.metrics.find((m) => m.id === id)
  if (!metric) throw new Error(`no metric ${id}`)
  return metric
}

describe('usageDocument, metric by metric', () => {
  it('heads the page with trackers this week, and how many of them recorded something or are new', () => {
    expect(find('trackers')).toEqual({
      id: 'trackers',
      label: 'Trackers this week',
      kind: 'count',
      value: 2,
      headline: true,
      context: [
        // This week is a (moved a stage) and c (only opened); b's visit was last week.
        { label: 'recorded something', kind: 'count', value: 1 },
        { label: 'new', kind: 'count', value: 1 },
      ],
    })
  })

  it('pools day-one starts over the period', () => {
    // a and b began in the period and added on day one; c began but has added nothing.
    expect(find('started')).toMatchObject({ kind: 'share', count: 2, of: 3, headline: true })
  })

  it('pools coming back, and leaves the fifth week out until someone has reached it', () => {
    expect(find('came-back')).toMatchObject({ kind: 'share', count: 1, of: 1, headline: true })
    expect(find('came-back')).toMatchObject({ context: [{ label: 'in their fifth week', kind: 'share', count: 1, of: 1 }] })
    const young = usageDocument(buildUsageReport([row('z', 'open', 1)], NOW, PUSH_WEEKS))
    expect(young.metrics.find((m) => m.id === 'came-back')).not.toHaveProperty('context')
  })

  it('says how many save to a folder, with the exports beside it', () => {
    expect(find('folder')).toMatchObject({ kind: 'share', count: 1, of: 3, context: [{ label: 'exports', kind: 'count', value: 1 }] })
  })

  it('says how many got an offer, and how many took a job', () => {
    expect(find('offer')).toMatchObject({ kind: 'share', count: 1, of: 3, context: [{ label: 'took a job', kind: 'share', count: 0, of: 3 }] })
  })

  it('charts trackers per week, split into those that recorded something and those only opened', () => {
    const series = find('trackers-per-week')
    expect(series).toMatchObject({ kind: 'series', interval: 'week', parts: ['Recorded something', 'Only opened'] })
    if (series.kind !== 'series') return
    expect(series.points).toHaveLength(PUSH_WEEKS)
    expect(series.points.at(-1)).toEqual({ start: '2026-10-12', values: [1, 1] })
    expect(series.points.at(-2)).toEqual({ start: '2026-10-05', values: [1, 0] })
  })

  it('charts what was recorded per week', () => {
    const series = find('recorded-per-week')
    if (series.kind !== 'series') throw new Error('not a series')
    expect(series.parts).toEqual(['Applications added', 'Stage moves'])
    expect(series.points.at(-1)?.values).toEqual([0, 1])
    expect(series.points.at(-2)?.values).toEqual([2, 0])
  })

  it('lists every feature as a share of trackers, named in words', () => {
    const features = find('features')
    if (features.kind !== 'breakdown') throw new Error('not a breakdown')
    expect(features.items).toHaveLength(10)
    expect(features.items).toContainEqual({ label: 'Prep notes', kind: 'share', count: 1, of: 3 })
    expect(features.items).toContainEqual({ label: 'Ratings', kind: 'share', count: 1, of: 3 })
    expect(features.items).toContainEqual({ label: 'Job postings', kind: 'share', count: 0, of: 3 })
  })

  it('lists where visits came from, leaving out the kinds nobody came by', () => {
    expect(find('referrers')).toMatchObject({
      items: [
        // a's visit 27 days ago and c's: no referrer.
        { label: 'Direct', kind: 'count', value: 2 },
        { label: 'The demo', kind: 'count', value: 1 },
        { label: 'fruitiecutiepie.com', kind: 'count', value: 1 },
        { label: 'Search', kind: 'count', value: 1 },
      ],
    })
  })

  it('sends time on each view as seconds, for the site to format', () => {
    expect(find('time')).toMatchObject({
      items: [
        { label: 'Kanban', kind: 'duration', seconds: 1050 },
        { label: 'Table', kind: 'duration', seconds: 180 },
      ],
    })
  })

  it('lists how long trackers have been in use, in age order', () => {
    const ages = find('ages')
    expect(ages).toMatchObject({ kind: 'breakdown', ordered: true })
    if (ages.kind !== 'breakdown') return
    expect(ages.items.map((item) => item.label)).toEqual([
      'Started today', 'Up to a week', 'Up to a month', 'Up to three months', 'Over three months',
    ])
    expect(ages.items.map((item) => (item.kind === 'count' ? item.value : null))).toEqual([1, 0, 0, 1, 0])
  })

  it('lists what failed, and leaves the list out when nothing did', () => {
    expect(find('failures')).toMatchObject({ items: [{ label: 'Saving', kind: 'count', value: 1 }] })
    const quiet = usageDocument(buildUsageReport([row('z', 'open', 1)], NOW, PUSH_WEEKS))
    expect(quiet.metrics.map((m) => m.id)).not.toContain('failures')
  })

  it('gives the other numbers as they are', () => {
    const numbers = Object.fromEntries(
      document.metrics
        .filter((m) => !('headline' in m) && (m.kind === 'count' || m.kind === 'share'))
        .map((m) => [m.id, m.kind === 'count' ? m.value : m.kind === 'share' ? `${m.count}/${m.of}` : null]),
    )
    expect(numbers).toEqual({
      loads: 5,
      visitors: 3,
      'demo-loads': 0,
      errors: 1,
      'failed-loads': '0/5',
      'unreadable-imports': '0/0',
      migrations: 0,
    })
  })
})

describe('usageDocument, against the site’s rules', () => {
  const ID = /^[a-z0-9][a-z0-9-]{0,39}$/

  function check(doc: UsageDocument): string[] {
    const problems: string[] = []
    if (doc.schema !== USAGE_DOCUMENT_SCHEMA) problems.push('schema')
    if (doc.metrics.length < 1 || doc.metrics.length > 30) problems.push('metric count')
    if (new Set(doc.metrics.map((m) => m.id)).size !== doc.metrics.length) problems.push('duplicate ids')
    if (doc.metrics.filter((m) => 'headline' in m && m.headline).length > 5) problems.push('headlines')
    const scalar = (s: { kind: string; value?: number; count?: number; of?: number; seconds?: number }, where: string) => {
      if (s.kind === 'count' && !(Number.isFinite(s.value) && s.value! >= 0)) problems.push(`${where} count`)
      if (s.kind === 'share' && !(Number.isInteger(s.count) && Number.isInteger(s.of) && s.count! >= 0 && s.count! <= s.of!)) problems.push(`${where} share`)
      if (s.kind === 'duration' && !(Number.isFinite(s.seconds) && s.seconds! >= 0)) problems.push(`${where} duration`)
    }
    for (const m of doc.metrics) {
      if (!ID.test(m.id)) problems.push(`${m.id} id`)
      if (!m.label.trim() || m.label.length > 80) problems.push(`${m.id} label`)
      if ((m.description?.length ?? 0) > 280) problems.push(`${m.id} description`)
      if (m.kind === 'series') {
        if (m.parts.length < 1 || m.parts.length > 4) problems.push(`${m.id} parts`)
        if (m.points.length < 1 || m.points.length > 104) problems.push(`${m.id} points`)
        m.points.forEach((p, i) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(p.start)) problems.push(`${m.id} start`)
          if (i && p.start <= m.points[i - 1].start) problems.push(`${m.id} order`)
          if (p.values.length !== m.parts.length || !p.values.every((v) => Number.isFinite(v) && v >= 0)) problems.push(`${m.id} values`)
        })
      } else if (m.kind === 'breakdown') {
        if (m.items.length > 30) problems.push(`${m.id} items`)
        if (new Set(m.items.map((i) => i.kind)).size > 1) problems.push(`${m.id} mixed`)
        m.items.forEach((item) => {
          if (!item.label.trim() || item.label.length > 80) problems.push(`${m.id} item label`)
          scalar(item, m.id)
        })
      } else {
        scalar(m, m.id)
        if ((m.context?.length ?? 0) > 3) problems.push(`${m.id} context`)
        m.context?.forEach((c) => scalar(c, `${m.id} context`))
      }
    }
    return problems
  }

  it('keeps every rule, with data', () => {
    expect(check(document)).toEqual([])
  })

  it('keeps every rule with no data at all, the first push after deploying', () => {
    expect(check(usageDocument(buildUsageReport([], NOW, PUSH_WEEKS)))).toEqual([])
  })

  it('carries no formatted numbers: every label is words, every value a number', () => {
    const labels = JSON.stringify(document.metrics.map((m) => [m.label, 'items' in m ? m.items.map((i) => i.label) : []]))
    expect(labels).not.toMatch(/%|\d/)
  })
})

describe('pushUsage', () => {
  const env = {
    ASSETS: { fetch: vi.fn() },
    ANALYTICS_ACCOUNT_ID: 'acct',
    ANALYTICS_TOKEN: 'read-token',
    USAGE_PUSH_URL: 'https://api.example.test/projects/job-apps-tracker/usage',
    USAGE_PUSH_TOKEN: 'fcpu_push',
  }
  const stored = { timestamp: '2026-10-13 10:00:00', index1: '0123456789abcdef', blob1: 'application_added', blob2: 'live' }

  /** Analytics Engine answers the query; the site answers the push with `site`. */
  function network(site: Response = new Response(null, { status: 204 })) {
    return vi.fn(async (url: string | URL | Request) =>
      String(url).includes('analytics_engine')
        ? new Response(JSON.stringify({ data: [stored] }))
        : site.clone(),
    )
  }

  it('queries Analytics Engine with the read token, and puts the document with the push token', async () => {
    const calls = network()
    expect(await pushUsage(env, NOW, calls)).toEqual({ outcome: 'pushed' })
    const [query, push] = calls.mock.calls as unknown as [string, RequestInit][]
    expect(query[0]).toBe('https://api.cloudflare.com/client/v4/accounts/acct/analytics_engine/sql')
    expect(query[1].headers).toEqual({ Authorization: 'Bearer read-token' })
    expect(push[0]).toBe(env.USAGE_PUSH_URL)
    expect(push[1].method).toBe('PUT')
    expect(push[1].headers).toEqual({ Authorization: 'Bearer fcpu_push', 'Content-Type': 'application/json' })
    const sent = JSON.parse(String(push[1].body)) as UsageDocument
    expect(sent.schema).toBe(USAGE_DOCUMENT_SCHEMA)
    expect(sent.metrics.find((m) => m.id === 'recorded-per-week')).toBeDefined()
  })

  it('sends nothing while unconfigured', async () => {
    const calls = network()
    expect(await pushUsage({ ...env, USAGE_PUSH_TOKEN: undefined }, NOW, calls)).toEqual({ outcome: 'skipped', reason: 'not configured' })
    expect(calls).not.toHaveBeenCalled()
  })

  it('reports what the site said when it refuses the document', async () => {
    const refusal = new Response(JSON.stringify({ errors: [{ path: 'metrics[0].label', message: 'must be non-blank text' }] }), { status: 400 })
    expect(await pushUsage(env, NOW, network(refusal))).toEqual({
      outcome: 'refused',
      status: 400,
      detail: '{"errors":[{"path":"metrics[0].label","message":"must be non-blank text"}]}',
    })
  })

  it('fails the scheduled run when the site refuses, so the logs show it', async () => {
    const refusal = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('analytics_engine') ? new Response(JSON.stringify({ data: [] })) : new Response('nope', { status: 401 }),
    )
    const realFetch = globalThis.fetch
    globalThis.fetch = refusal as unknown as typeof fetch
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      let waited: Promise<unknown> = Promise.resolve()
      await worker.scheduled({}, env, { waitUntil: (promise) => (waited = promise) })
      await expect(waited).rejects.toThrow('usage push refused: 401')
      expect(logged).toHaveBeenCalled()
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
