import {
  parseUsageReport,
  UNKNOWN_TRACKER,
  USAGE_DURATIONS,
  USAGE_EVENTS,
  USAGE_FAILURES,
  USAGE_FEATURES,
  USAGE_PLACES,
  USAGE_REFERRERS,
  type UsageEventName,
  type UsageFeature,
  type UsagePlace,
} from './usageEvent'

/**
 * Turns stored usage rows into the numbers worth watching. Pure, so every figure is tested
 * on rows built by hand; `scripts/usage-report.ts` is only the fetching and the printing.
 *
 * Only the live tracker is measured, apart from loads, which count the demo too: the demo
 * is fictional data, and its trackers say nothing about anyone's search.
 */

export const USAGE_DATASET = 'job_apps_tracker_usage'

/**
 * The shape of `buildUsageReport`'s output, for whoever reads it from elsewhere — the
 * portfolio's progress page stores it as JSON. Bumped when a field changes meaning or goes,
 * so a reader built for one shape refuses another rather than misreading it.
 */
export const USAGE_REPORT_VERSION = 1

export interface UsageRow {
  at: Date
  tracker: string
  profile: 'live' | 'demo'
  event: UsageEventName
  props: Record<string, string>
  /** How many reports this row stands for: Analytics Engine samples at high volume. */
  weight: number
}

const DAY = 86_400_000
const BLOBS = 20

/** Every column a report can occupy, for the last `days` days, oldest first. */
export function usageQuery(days: number, limit: number): string {
  const blobs = Array.from({ length: BLOBS }, (_, index) => `blob${index + 1}`).join(', ')
  return [
    `SELECT timestamp, index1, ${blobs}, _sample_interval`,
    `FROM ${USAGE_DATASET}`,
    `WHERE timestamp > NOW() - INTERVAL '${Math.max(1, Math.floor(days))}' DAY`,
    'ORDER BY timestamp',
    `LIMIT ${Math.max(1, Math.floor(limit))}`,
    'FORMAT JSON',
  ].join('\n')
}

/**
 * Rows as the SQL API returns them, read back into reports through the same check the
 * Worker stored them with. A row that no longer passes — written by an older version of
 * the list — is dropped rather than guessed at.
 */
export function rowsFromSql(data: ReadonlyArray<Record<string, unknown>>): UsageRow[] {
  const rows: UsageRow[] = []
  for (const record of data) {
    const event = record.blob1
    if (typeof event !== 'string' || !Object.hasOwn(USAGE_EVENTS, event)) continue
    const keys = Object.keys(USAGE_EVENTS[event as UsageEventName])
    const props = Object.fromEntries(keys.map((key, index) => [key, record[`blob${index + 3}`]]))
    const report = parseUsageReport({ v: 1, tracker: record.index1, profile: record.blob2, event, props })
    // The API writes `2026-10-11 03:20:00`, in UTC.
    const at = new Date(`${String(record.timestamp).replace(' ', 'T')}Z`)
    if (!report || Number.isNaN(at.getTime())) continue
    const weight = Number(record._sample_interval ?? 1)
    rows.push({
      at,
      tracker: report.tracker,
      profile: report.profile,
      event: report.event,
      props: report.props,
      weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    })
  }
  return rows
}

/**
 * The rows for the last `weeks` weeks, from Analytics Engine's SQL API. `truncated` says the
 * row limit was reached, so the oldest weeks are short. Takes `fetch` so a test can answer.
 */
export async function fetchUsageRows(options: {
  account: string
  token: string
  weeks: number
  limit: number
  fetch?: typeof fetch
}): Promise<{ rows: UsageRow[]; truncated: boolean }> {
  const request = options.fetch ?? fetch
  const response = await request(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.account)}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.token}` },
      body: usageQuery(options.weeks * 7, options.limit),
    },
  )
  if (!response.ok) throw new Error(`Analytics Engine answered ${response.status}: ${await response.text()}`)
  const { data } = (await response.json()) as { data?: Array<Record<string, unknown>> }
  const records = Array.isArray(data) ? data : []
  return { rows: rowsFromSql(records), truncated: records.length >= options.limit }
}

export interface Window {
  from: Date
  to: Date
}

const within = (row: UsageRow, window: Window) => row.at >= window.from && row.at < window.to
const live = (rows: readonly UsageRow[]) => rows.filter((row) => row.profile === 'live' && row.tracker !== UNKNOWN_TRACKER)
const weighted = (rows: readonly UsageRow[]) => rows.reduce((sum, row) => sum + row.weight, 0)
const distinct = (rows: readonly UsageRow[]) => new Set(rows.map((row) => row.tracker)).size

function tally<K extends string>(keys: readonly K[], rows: readonly UsageRow[], key: (row: UsageRow) => string): Record<K, number> {
  const counts = Object.fromEntries(keys.map((name) => [name, 0])) as Record<K, number>
  for (const row of rows) {
    const value = key(row) as K
    if (value in counts) counts[value] += row.weight
  }
  return counts
}

/** A share as a whole and a part, kept apart so small numbers can be said as counts. */
export interface Share {
  count: number
  of: number
}

const share = (count: number, of: number): Share => ({ count, of })

/** Each tracker's last `open` in the window: what it looked like most recently. */
export function latestSnapshots(rows: readonly UsageRow[], window: Window): Map<string, UsageRow> {
  const latest = new Map<string, UsageRow>()
  for (const row of live(rows)) {
    if (row.event !== 'open' || !within(row, window)) continue
    const held = latest.get(row.tracker)
    if (!held || row.at > held.at) latest.set(row.tracker, row)
  }
  return latest
}

/** Where visits come from, and how many trackers are new. */
export function acquisition(rows: readonly UsageRow[], window: Window) {
  const opens = rows.filter((row) => row.event === 'open' && within(row, window))
  const liveOpens = live(opens)
  return {
    loads: {
      live: weighted(opens.filter((row) => row.profile === 'live')),
      demo: weighted(opens.filter((row) => row.profile === 'demo')),
    },
    visitors: {
      live: distinct(liveOpens),
      demo: distinct(opens.filter((row) => row.profile === 'demo')),
    },
    newTrackers: newTrackers(rows, window).size,
    referrers: tally(USAGE_REFERRERS, liveOpens, (row) => row.props.referrer),
  }
}

/**
 * Trackers that began in the window: first seen there, and empty or a day old when they
 * were. Both, because a tracker older than the data's three months is first seen whenever
 * the data starts, and is not new for it.
 */
export function newTrackers(rows: readonly UsageRow[], window: Window): Map<string, Date> {
  const first = new Map<string, UsageRow>()
  for (const row of live(rows)) {
    const held = first.get(row.tracker)
    if (!held || row.at < held.at) first.set(row.tracker, row)
  }
  const firstOpen = new Map<string, UsageRow>()
  for (const row of live(rows)) {
    if (row.event !== 'open') continue
    const held = firstOpen.get(row.tracker)
    if (!held || row.at < held.at) firstOpen.set(row.tracker, row)
  }
  const result = new Map<string, Date>()
  for (const [tracker, row] of first) {
    const open = firstOpen.get(tracker)
    const young = open !== undefined && (open.props.age === 'none' || open.props.age === '0d')
    if (young && within(row, window)) result.set(tracker, row.at)
  }
  return result
}

/** The north star and its context: trackers seen, and trackers that recorded something. */
export function activity(rows: readonly UsageRow[], window: Window) {
  const seen = live(rows).filter((row) => within(row, window))
  return {
    active: distinct(seen),
    writing: distinct(seen.filter((row) => row.event === 'application_added' || row.event === 'moved')),
  }
}

/** Of the trackers begun in the window, how many got going. */
export function activation(rows: readonly UsageRow[], window: Window) {
  const cohort = newTrackers(rows, window)
  let firstDay = 0
  let threeInAWeek = 0
  for (const [tracker, start] of cohort) {
    const own = live(rows).filter((row) => row.tracker === tracker)
    const added = (days: number) =>
      own.filter((row) => row.event === 'application_added' && row.at.getTime() - start.getTime() < days * DAY)
    if (weighted(added(1)) > 0) firstDay += 1
    const sizedUp = own.some(
      (row) =>
        row.event === 'open'
        && row.at.getTime() - start.getTime() < 7 * DAY
        && !['0', '1-2'].includes(row.props.applications),
    )
    if (weighted(added(7)) >= 3 || sizedUp) threeInAWeek += 1
  }
  return {
    addedFirstDay: share(firstDay, cohort.size),
    threeInFirstWeek: share(threeInAWeek, cohort.size),
  }
}

/**
 * Of the trackers begun in the window, how many came back in their second week and in
 * their fifth. A tracker whose search had already ended in a job before that week is left
 * out of it: not coming back then is the search succeeding, not the app failing. A cohort
 * too recent to have reached the week is not counted at all.
 */
export function retention(rows: readonly UsageRow[], window: Window, now: Date) {
  const cohort = newTrackers(rows, window)
  const returnedIn = (fromDay: number, toDay: number): Share => {
    let eligible = 0
    let returned = 0
    for (const [tracker, start] of cohort) {
      const opens = start.getTime() + fromDay * DAY
      if (now.getTime() < start.getTime() + toDay * DAY) continue
      const own = live(rows).filter((row) => row.tracker === tracker)
      const hired = own.some((row) => row.event === 'open' && row.props.reached === 'accepted' && row.at.getTime() < opens)
      if (hired) continue
      eligible += 1
      const back = own.some((row) => {
        const day = (row.at.getTime() - start.getTime()) / DAY
        return day >= fromDay && day < toDay
      })
      if (back) returned += 1
    }
    return share(returned, eligible)
  }
  return { week1: returnedIn(7, 14), week4: returnedIn(28, 35) }
}

/** How long the trackers in use have been in use: the long view past the data's three months. */
export function trackerAges(rows: readonly UsageRow[], window: Window) {
  const snapshots = [...latestSnapshots(rows, window).values()]
  return tally(USAGE_EVENTS.open.age, snapshots.map((row) => ({ ...row, weight: 1 })), (row) => row.props.age)
}

/** How much is being recorded. */
export function engagement(rows: readonly UsageRow[], window: Window) {
  const seen = live(rows).filter((row) => within(row, window))
  const moves = seen.filter((row) => row.event === 'moved')
  return {
    applicationsAdded: weighted(seen.filter((row) => row.event === 'application_added')),
    moves: weighted(moves),
    endings: tally(['rejected', 'withdrawn', 'closed'] as const, moves, (row) => row.props.outcome),
    activeTrackers: distinct(seen),
  }
}

/** Whether what people have typed would survive their browser being cleared. */
export function dataSafety(rows: readonly UsageRow[], window: Window) {
  const snapshots = [...latestSnapshots(rows, window).values()]
  const seen = live(rows).filter((row) => within(row, window))
  return {
    folder: share(snapshots.filter((row) => row.props.storage === 'folder').length, snapshots.length),
    backlog: tally(USAGE_EVENTS.open.backlog, snapshots.map((row) => ({ ...row, weight: 1 })), (row) => row.props.backlog),
    exports: weighted(seen.filter((row) => row.event === 'exported')),
    foldersConnected: weighted(seen.filter((row) => row.event === 'folder_connected')),
  }
}

/** The midpoint of each time bucket, in seconds, for adding the buckets up. */
export const DURATION_SECONDS: Record<(typeof USAGE_DURATIONS)[number], number> = {
  '<10s': 5,
  '10s-1m': 35,
  '1-5m': 180,
  '5-30m': 1050,
  '30m+': 2700,
}

/** Which features are in use, and where time goes. */
export function adoption(rows: readonly UsageRow[], window: Window) {
  const snapshots = [...latestSnapshots(rows, window).values()]
  const seen = live(rows).filter((row) => within(row, window))
  const features = Object.fromEntries(
    USAGE_FEATURES.map((feature) => [
      feature,
      share(snapshots.filter((row) => row.props[feature] === 'y').length, snapshots.length),
    ]),
  ) as Record<UsageFeature, Share>
  const minutes = Object.fromEntries(USAGE_PLACES.map((place) => [place, 0])) as Record<UsagePlace, number>
  for (const row of seen) {
    if (row.event !== 'view_time') continue
    const place = row.props.place as UsagePlace
    minutes[place] += (DURATION_SECONDS[row.props.duration as keyof typeof DURATION_SECONDS] * row.weight) / 60
  }
  return {
    features,
    switches: tally(USAGE_PLACES, seen.filter((row) => row.event === 'view'), (row) => row.props.place),
    minutes,
  }
}

/** How far searches get. */
export function outcomes(rows: readonly UsageRow[], window: Window) {
  const snapshots = [...latestSnapshots(rows, window).values()]
  const reached = (levels: string[]) => share(snapshots.filter((row) => levels.includes(row.props.reached)).length, snapshots.length)
  return {
    interview: reached(['interview', 'offer', 'accepted']),
    offer: reached(['offer', 'accepted']),
    accepted: reached(['accepted']),
  }
}

/**
 * What went wrong. Unlike everything above, this counts the unknown tracker too: a load
 * that failed before the page learnt its tracker is still a load that failed.
 */
export function reliability(rows: readonly UsageRow[], window: Window) {
  const seen = rows.filter((row) => row.profile === 'live' && within(row, window))
  const imports = seen.filter((row) => row.event === 'imported')
  const loads = weighted(seen.filter((row) => row.event === 'open'))
  const errors = tally(USAGE_FAILURES, seen.filter((row) => row.event === 'error'), (row) => row.props.kind)
  return {
    errors,
    failedLoads: share(errors.load, loads + errors.load),
    unreadableImports: share(weighted(imports.filter((row) => row.props.ok === 'n')), weighted(imports)),
    migrations: tally(['1', '2'] as const, seen.filter((row) => row.event === 'migrated'), (row) => row.props.from),
  }
}

/** The weeks the report covers, Monday to Monday in UTC, oldest first, ending with this one. */
export function reportWeeks(now: Date, count: number): Window[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY
  return Array.from({ length: count }, (_, index) => {
    const from = monday - (count - 1 - index) * 7 * DAY
    return { from: new Date(from), to: new Date(from + 7 * DAY) }
  })
}

export function buildUsageReport(rows: readonly UsageRow[], now: Date, weeks: number) {
  const windows = reportWeeks(now, weeks)
  const whole: Window = { from: windows[0].from, to: windows[windows.length - 1].to }
  return {
    version: USAGE_REPORT_VERSION,
    generatedAt: now.toISOString(),
    period: { from: whole.from.toISOString(), to: whole.to.toISOString() },
    weekly: windows.map((window) => ({
      week: window.from.toISOString().slice(0, 10),
      ...activity(rows, window),
      newTrackers: newTrackers(rows, window).size,
      activation: activation(rows, window),
      retention: retention(rows, window, now),
      engagement: engagement(rows, window),
    })),
    acquisition: acquisition(rows, whole),
    ages: trackerAges(rows, whole),
    dataSafety: dataSafety(rows, whole),
    adoption: adoption(rows, whole),
    outcomes: outcomes(rows, whole),
    reliability: reliability(rows, whole),
  }
}

export type UsageReportSummary = ReturnType<typeof buildUsageReport>

function percent({ count, of }: Share): string {
  if (of === 0) return '—'
  // Small numbers are said as counts: "2 of 3" is a fact, "67%" is a claim.
  return of < 10 ? `${count} of ${of}` : `${Math.round((count / of) * 100)}% (${count} of ${of})`
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function table(headers: string[], body: string[][]): string {
  const widths = headers.map((header, column) => Math.max(header.length, ...body.map((row) => row[column].length)))
  const line = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd()
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...body.map(line)].join('\n')
}

function pairs(record: Record<string, number | Share>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key} ${typeof value === 'number' ? round(value) : percent(value)}`)
    .join(' · ')
}

/** The report as text for a terminal: weekly trend first, then the period as a whole. */
export function formatUsageReport(report: UsageReportSummary): string {
  const weekly = table(
    ['Week of', 'Active', 'Writing', 'New', 'Added 1st day', '3+ in week 1', 'Back wk 2', 'Back wk 5', 'Apps added', 'Moves'],
    report.weekly.map((week) => [
      week.week,
      String(week.active),
      String(week.writing),
      String(week.newTrackers),
      percent(week.activation.addedFirstDay),
      percent(week.activation.threeInFirstWeek),
      percent(week.retention.week1),
      percent(week.retention.week4),
      round(week.engagement.applicationsAdded),
      round(week.engagement.moves),
    ]),
  )
  const { acquisition: a, dataSafety: d, adoption: f, outcomes: o, reliability: r } = report
  return [
    `Usage, ${report.period.from.slice(0, 10)} to ${report.period.to.slice(0, 10)} (live tracker unless said)`,
    '',
    weekly,
    '',
    'Acquisition',
    `  Page loads: live ${round(a.loads.live)}, demo ${round(a.loads.demo)} · visitors: live ${a.visitors.live}, demo ${a.visitors.demo} · new trackers ${a.newTrackers}`,
    `  Came from: ${pairs(a.referrers)}`,
    `  Tracker age: ${pairs(report.ages)}`,
    '',
    'Data safety',
    `  Saving to a folder: ${percent(d.folder)} · exports ${round(d.exports)} · folders connected ${round(d.foldersConnected)}`,
    `  Changes only in the browser for: ${pairs(d.backlog)}`,
    '',
    'Adoption',
    `  In use: ${pairs(f.features)}`,
    `  Views chosen: ${pairs(f.switches)}`,
    `  Minutes on screen (estimated): ${pairs(f.minutes)}`,
    '',
    'Outcomes',
    `  Reached interview ${percent(o.interview)} · offer ${percent(o.offer)} · accepted ${percent(o.accepted)}`,
    '',
    'Reliability',
    `  Failed loads: ${percent(r.failedLoads)} · unreadable imports: ${percent(r.unreadableImports)}`,
    `  Errors: ${pairs(r.errors)}`,
    `  Older files brought up to date: from v1 ${round(r.migrations['1'])}, from v2 ${round(r.migrations['2'])}`,
  ].join('\n')
}
