import { describe, expect, it } from 'vitest'

import { UNKNOWN_TRACKER, USAGE_EVENTS, usageDataPoint, type UsageEventName, type UsageReport } from './usageEvent'
import {
  acquisition,
  activation,
  activity,
  adoption,
  buildUsageReport,
  dataSafety,
  DURATION_SECONDS,
  engagement,
  formatUsageReport,
  latestSnapshots,
  newTrackers,
  outcomes,
  reliability,
  reportWeeks,
  retention,
  rowsFromSql,
  trackerAges,
  usageQuery,
  type UsageRow,
  type Window,
} from './usageReport'

/*
 * Every figure the report prints, each on rows built by hand so the expected number can be
 * read off the test. Days are counted from START, the Monday the window opens on.
 */
const DAY = 86_400_000
const START = new Date('2026-09-07T00:00:00Z')
const WEEK: Window = { from: START, to: new Date(START.getTime() + 7 * DAY) }
const day = (n: number) => new Date(START.getTime() + n * DAY)

const OPEN_DEFAULTS: Record<string, string> = {
  applications: '0',
  age: 'none',
  reached: 'none',
  storage: 'browser',
  backlog: 'none',
  notes: 'n',
  captures: 'n',
  messages: 'n',
  invites: 'n',
  ratings: 'n',
  compensation: 'n',
  posting: 'n',
  attachments: 'n',
  done: 'n',
  archived: 'n',
  referrer: 'direct',
}

function row(
  tracker: string,
  event: UsageEventName,
  atDay: number,
  props: Record<string, string> = {},
  options: { profile?: 'live' | 'demo'; weight?: number } = {},
): UsageRow {
  return {
    at: day(atDay),
    tracker: tracker.padEnd(16, '0'),
    profile: options.profile ?? 'live',
    event,
    props: event === 'open' ? { ...OPEN_DEFAULTS, ...props } : props,
    weight: options.weight ?? 1,
  }
}

const open = (tracker: string, atDay: number, props: Record<string, string> = {}, options = {}) =>
  row(tracker, 'open', atDay, props, options)

describe('usageQuery', () => {
  it('asks for every column a report can fill, for the period, oldest first', () => {
    const sql = usageQuery(56, 5000)
    expect(sql).toContain('FROM job_apps_tracker_usage')
    expect(sql).toContain('index1')
    expect(sql).toContain('blob1, ')
    expect(sql).toContain('blob20, _sample_interval')
    expect(sql).toContain("INTERVAL '56' DAY")
    expect(sql).toContain('ORDER BY timestamp')
    expect(sql).toContain('LIMIT 5000')
    expect(sql).toContain('FORMAT JSON')
  })

  it('cannot be handed anything but a whole number', () => {
    expect(usageQuery(7.9, 10.5)).toContain("INTERVAL '7' DAY")
    expect(usageQuery(-3, 0)).toContain('LIMIT 1')
  })
})

describe('rowsFromSql', () => {
  /** A stored row exactly as the Worker writes it and the SQL API returns it. */
  function stored(report: UsageReport, timestamp: string, sample = 1): Record<string, unknown> {
    const point = usageDataPoint(report)
    return {
      timestamp,
      index1: point.indexes[0],
      ...Object.fromEntries(point.blobs.map((blob, index) => [`blob${index + 1}`, blob])),
      _sample_interval: sample,
    }
  }

  it('reads back what the Worker stored, property by property', () => {
    const report: UsageReport = {
      v: 1,
      tracker: '0123456789abcdef',
      profile: 'live',
      event: 'open',
      props: { ...OPEN_DEFAULTS, applications: '3-10', referrer: 'search' },
    }
    const [read] = rowsFromSql([stored(report, '2026-09-08 10:30:00', 4)])
    expect(read).toEqual({
      at: new Date('2026-09-08T10:30:00Z'),
      tracker: report.tracker,
      profile: 'live',
      event: 'open',
      props: report.props,
      weight: 4,
    })
  })

  it('drops a row that is not a report the list allows, rather than guessing', () => {
    const good: UsageReport = { v: 1, tracker: '0123456789abcdef', profile: 'live', event: 'moved', props: { stage: 'offer', outcome: 'active' } }
    const rows = rowsFromSql([
      stored(good, '2026-09-08 10:30:00'),
      { ...stored(good, '2026-09-08 10:30:00'), blob3: 'Acme' },
      { ...stored(good, '2026-09-08 10:30:00'), blob1: 'deleted_event' },
      { ...stored(good, 'not a time') },
    ])
    expect(rows).toHaveLength(1)
  })

  it('counts a row without a usable sample interval once', () => {
    const report: UsageReport = { v: 1, tracker: '0123456789abcdef', profile: 'live', event: 'exported', props: {} }
    expect(rowsFromSql([{ ...stored(report, '2026-09-08 10:30:00'), _sample_interval: undefined }])[0].weight).toBe(1)
    expect(rowsFromSql([{ ...stored(report, '2026-09-08 10:30:00'), _sample_interval: 0 }])[0].weight).toBe(1)
  })

  it('reads every event the app can send', () => {
    for (const event of Object.keys(USAGE_EVENTS) as UsageEventName[]) {
      const props = Object.fromEntries(
        Object.entries(USAGE_EVENTS[event] as Record<string, readonly string[]>).map(([key, values]) => [key, values[0]]),
      )
      const report: UsageReport = { v: 1, tracker: '0123456789abcdef', profile: 'live', event, props }
      expect(rowsFromSql([stored(report, '2026-09-08 10:30:00')])).toHaveLength(1)
    }
  })
})

describe('latestSnapshots', () => {
  it('keeps each live tracker’s last open in the window, and nothing else', () => {
    const rows = [
      open('a', 1, { applications: '1-2' }),
      open('a', 3, { applications: '3-10' }),
      open('a', 9, { applications: '11-50' }),
      open('b', 2, {}, { profile: 'demo' }),
      row(UNKNOWN_TRACKER, 'open', 2),
      row('c', 'exported', 2),
    ]
    const latest = latestSnapshots(rows, WEEK)
    expect([...latest.keys()]).toEqual(['a'.padEnd(16, '0')])
    expect(latest.get('a'.padEnd(16, '0'))?.props.applications).toBe('3-10')
  })
})

describe('newTrackers', () => {
  it('counts a tracker first seen in the window and empty or a day old then', () => {
    const rows = [open('new', 2), open('day', 3, { age: '0d' })]
    expect(newTrackers(rows, WEEK).size).toBe(2)
  })

  it('does not count a tracker that was old when the data first saw it', () => {
    expect(newTrackers([open('old', 2, { age: '91d+' })], WEEK).size).toBe(0)
  })

  it('does not count a tracker first seen before the window', () => {
    expect(newTrackers([open('earlier', -3), open('earlier', 2)], WEEK).size).toBe(0)
  })

  it('dates a tracker from its first row of any kind', () => {
    const rows = [row('t', 'application_added', 1), open('t', 2)]
    expect(newTrackers(rows, WEEK).get('t'.padEnd(16, '0'))).toEqual(day(1))
  })
})

describe('acquisition', () => {
  it('counts loads by build, weighted for sampling, and visitors once each', () => {
    const rows = [
      open('a', 1, {}, { weight: 2 }),
      open('a', 2),
      open('b', 2, {}, { profile: 'demo' }),
      open('c', 10),
    ]
    const result = acquisition(rows, WEEK)
    expect(result.loads).toEqual({ live: 3, demo: 1 })
    expect(result.visitors).toEqual({ live: 1, demo: 1 })
  })

  it('says where live visits came from', () => {
    const rows = [
      open('a', 1, { referrer: 'search' }),
      open('b', 1, { referrer: 'demo' }),
      open('c', 1, { referrer: 'demo' }),
      open('d', 1, { referrer: 'social' }, { profile: 'demo' }),
    ]
    expect(acquisition(rows, WEEK).referrers).toEqual({
      direct: 0, internal: 0, demo: 2, search: 1, social: 0, github: 0, other: 0,
    })
  })

  it('counts new trackers', () => {
    expect(acquisition([open('a', 1), open('b', 1, { age: '8-30d' })], WEEK).newTrackers).toBe(1)
  })
})

describe('activity', () => {
  it('tells trackers that were opened from trackers that recorded something', () => {
    const rows = [
      open('a', 1),
      open('b', 1),
      row('b', 'application_added', 1),
      row('c', 'moved', 2, { stage: 'offer', outcome: 'active' }),
      row('d', 'view', 2, { place: 'table' }),
      row('e', 'application_added', 9),
    ]
    expect(activity(rows, WEEK)).toEqual({ active: 4, writing: 2 })
  })
})

describe('activation', () => {
  it('counts a new tracker that added an application within its first day', () => {
    const rows = [
      open('fast', 1),
      row('fast', 'application_added', 1.5),
      open('slow', 1),
      row('slow', 'application_added', 3),
      open('never', 1),
    ]
    expect(activation(rows, WEEK).addedFirstDay).toEqual({ count: 1, of: 3 })
  })

  it('counts a new tracker with three applications within a week, added or found in a snapshot', () => {
    const rows = [
      open('added', 0),
      row('added', 'application_added', 1),
      row('added', 'application_added', 2),
      row('added', 'application_added', 3),
      // Imported or added in a tab whose counts were off: the snapshot still shows the size.
      open('sized', 0),
      open('sized', 4, { applications: '3-10' }),
      open('late', 0),
      open('late', 9, { applications: '3-10' }),
      open('two', 0),
      row('two', 'application_added', 1, {}, { weight: 2 }),
    ]
    expect(activation(rows, WEEK).threeInFirstWeek).toEqual({ count: 2, of: 4 })
  })
})

describe('retention', () => {
  const now = day(60)

  it('counts a new tracker seen again in its second week, and in its fifth', () => {
    const rows = [
      open('both', 0),
      open('both', 8),
      open('both', 30),
      open('second', 1),
      open('second', 10),
      open('fifth', 2),
      open('fifth', 31),
      open('gone', 3),
      open('gone', 4),
    ]
    expect(retention(rows, WEEK, now)).toEqual({
      week1: { count: 2, of: 4 },
      week4: { count: 2, of: 4 },
    })
  })

  it('leaves out a tracker whose search had already ended in a job', () => {
    const rows = [open('hired', 0), open('hired', 5, { reached: 'accepted' }), open('stayed', 0), open('stayed', 9)]
    expect(retention(rows, WEEK, now).week1).toEqual({ count: 1, of: 1 })
  })

  it('still counts a tracker that took a job after the week in question', () => {
    const rows = [open('later', 0), open('later', 8), open('later', 20, { reached: 'accepted' })]
    expect(retention(rows, WEEK, now).week1).toEqual({ count: 1, of: 1 })
  })

  it('does not count a tracker too new to have reached the week', () => {
    const rows = [open('recent', 2)]
    expect(retention(rows, WEEK, day(10))).toEqual({ week1: { count: 0, of: 0 }, week4: { count: 0, of: 0 } })
  })
})

describe('trackerAges', () => {
  it('reads how old the trackers in use are from their latest snapshot', () => {
    const rows = [open('a', 1, { age: '0d' }), open('a', 2, { age: '1-7d' }), open('b', 1, { age: '91d+' }, { weight: 5 })]
    expect(trackerAges(rows, WEEK)).toEqual({ none: 0, '0d': 0, '1-7d': 1, '8-30d': 0, '31-90d': 0, '91d+': 1 })
  })
})

describe('engagement', () => {
  it('adds up applications, moves and endings, weighted for sampling', () => {
    const rows = [
      open('a', 1),
      row('a', 'application_added', 1, {}, { weight: 3 }),
      row('a', 'moved', 2, { stage: 'interview_1', outcome: 'active' }),
      row('b', 'moved', 2, { stage: 'interview_1', outcome: 'rejected' }),
      row('b', 'moved', 3, { stage: 'offer', outcome: 'withdrawn' }, { weight: 2 }),
      row('b', 'application_added', 9),
    ]
    expect(engagement(rows, WEEK)).toEqual({
      applicationsAdded: 3,
      moves: 4,
      endings: { rejected: 1, withdrawn: 2, closed: 0 },
      activeTrackers: 2,
    })
  })
})

describe('dataSafety', () => {
  it('reads where trackers save and how long changes have waited, from their latest snapshot', () => {
    const rows = [
      open('folder', 1, { storage: 'browser', backlog: '1-7d' }),
      open('folder', 2, { storage: 'folder' }),
      open('browser', 2, { backlog: '8d+' }),
      open('firefox', 2, { storage: 'unsupported', backlog: '<1d' }),
      row('browser', 'exported', 3),
      row('firefox', 'exported', 3, {}, { weight: 2 }),
      row('folder', 'folder_connected', 2),
    ]
    expect(dataSafety(rows, WEEK)).toEqual({
      folder: { count: 1, of: 3 },
      backlog: { none: 1, '<1d': 1, '1-7d': 0, '8d+': 1 },
      exports: 3,
      foldersConnected: 1,
    })
  })
})

describe('adoption', () => {
  it('reads the share of trackers using each feature from their latest snapshot', () => {
    const rows = [open('a', 1, { notes: 'y', ratings: 'y' }), open('b', 1, { notes: 'y' }), open('c', 1)]
    const { features } = adoption(rows, WEEK)
    expect(features.notes).toEqual({ count: 2, of: 3 })
    expect(features.ratings).toEqual({ count: 1, of: 3 })
    expect(features.posting).toEqual({ count: 0, of: 3 })
  })

  it('counts the views chosen', () => {
    const rows = [
      row('a', 'view', 1, { place: 'table' }),
      row('a', 'view', 1, { place: 'table' }),
      row('b', 'view', 1, { place: 'prep' }, { weight: 3 }),
    ]
    expect(adoption(rows, WEEK).switches).toEqual({ kanban: 0, table: 2, statistics: 0, compare: 0, prep: 3 })
  })

  it('estimates minutes on screen from the middle of each time bucket', () => {
    const rows = [
      row('a', 'view_time', 1, { place: 'kanban', duration: '1-5m' }),
      row('a', 'view_time', 1, { place: 'kanban', duration: '<10s' }, { weight: 6 }),
      row('a', 'view_time', 1, { place: 'prep', duration: '30m+' }),
    ]
    const { minutes } = adoption(rows, WEEK)
    expect(minutes.kanban).toBeCloseTo((DURATION_SECONDS['1-5m'] + 6 * DURATION_SECONDS['<10s']) / 60)
    expect(minutes.prep).toBe(45)
    expect(minutes.table).toBe(0)
  })
})

describe('outcomes', () => {
  it('counts how far searches got, each level including the ones past it', () => {
    const rows = [
      open('none', 1),
      open('interview', 1, { reached: 'interview' }),
      open('offer', 1, { reached: 'offer' }),
      open('hired', 1, { reached: 'accepted' }),
    ]
    expect(outcomes(rows, WEEK)).toEqual({
      interview: { count: 3, of: 4 },
      offer: { count: 2, of: 4 },
      accepted: { count: 1, of: 4 },
    })
  })
})

describe('reliability', () => {
  it('counts failures by kind, the unknown tracker’s included', () => {
    const rows = [
      row('a', 'error', 1, { kind: 'save' }),
      row('a', 'error', 1, { kind: 'save' }),
      row('b', 'error', 1, { kind: 'export' }),
      row(UNKNOWN_TRACKER, 'error', 1, { kind: 'load' }),
      row('d', 'error', 1, { kind: 'load' }, { profile: 'demo' }),
    ]
    expect(reliability(rows, WEEK).errors).toEqual({
      load: 1, save: 2, import: 0, export: 1, folder: 0, tracker: 0, copy: 0, reset: 0,
    })
  })

  it('says what share of loads failed', () => {
    const rows = [open('a', 1), open('b', 1), open('c', 1), row(UNKNOWN_TRACKER, 'error', 1, { kind: 'load' })]
    expect(reliability(rows, WEEK).failedLoads).toEqual({ count: 1, of: 4 })
  })

  it('says what share of imported files could not be read', () => {
    const rows = [row('a', 'imported', 1, { ok: 'y' }), row('a', 'imported', 1, { ok: 'n' }), row('b', 'imported', 1, { ok: 'y' })]
    expect(reliability(rows, WEEK).unreadableImports).toEqual({ count: 1, of: 3 })
  })

  it('counts older files brought up to date', () => {
    const rows = [row('a', 'migrated', 1, { from: '1' }), row('b', 'migrated', 1, { from: '2' }, { weight: 2 })]
    expect(reliability(rows, WEEK).migrations).toEqual({ '1': 1, '2': 2 })
  })
})

describe('reportWeeks', () => {
  it('runs Monday to Monday in UTC, oldest first, ending with the week holding now', () => {
    const weeks = reportWeeks(new Date('2026-09-16T18:00:00Z'), 3)
    expect(weeks.map((week) => week.from.toISOString().slice(0, 10))).toEqual(['2026-08-31', '2026-09-07', '2026-09-14'])
    expect(weeks[2].to.toISOString().slice(0, 10)).toBe('2026-09-21')
  })

  it('counts a Monday as the start of its own week, and a Sunday as the end of the last', () => {
    expect(reportWeeks(new Date('2026-09-14T00:00:00Z'), 1)[0].from.toISOString().slice(0, 10)).toBe('2026-09-14')
    expect(reportWeeks(new Date('2026-09-20T23:59:00Z'), 1)[0].from.toISOString().slice(0, 10)).toBe('2026-09-14')
  })
})

describe('buildUsageReport and formatUsageReport', () => {
  const rows = [
    open('a', 1, { notes: 'y', storage: 'folder', reached: 'offer', referrer: 'search' }),
    row('a', 'application_added', 1),
    row('a', 'view', 2, { place: 'table' }),
    row('a', 'view_time', 2, { place: 'table', duration: '5-30m' }),
    row('a', 'error', 3, { kind: 'save' }),
    open('b', 2, {}, { profile: 'demo' }),
  ]
  const report = buildUsageReport(rows, day(9), 2)

  it('reports week by week, and the period as a whole', () => {
    expect(report.weekly.map((week) => week.week)).toEqual(['2026-09-07', '2026-09-14'])
    expect(report.weekly[0]).toMatchObject({ active: 1, writing: 1, newTrackers: 1 })
    expect(report.weekly[1]).toMatchObject({ active: 0, writing: 0, newTrackers: 0 })
    expect(report.acquisition.loads).toEqual({ live: 1, demo: 1 })
  })

  it('prints every section, with small numbers as counts and empty shares as a dash', () => {
    const text = formatUsageReport(report)
    for (const heading of ['Acquisition', 'Data safety', 'Adoption', 'Outcomes', 'Reliability']) {
      expect(text).toContain(`\n${heading}\n`)
    }
    expect(text).toContain('Saving to a folder: 1 of 1')
    expect(text).toContain('search 1')
    expect(text).toContain('save 1')
    expect(text).toContain('Week of')
    // Nobody to measure in the second week, which is not 0%.
    expect(text).toMatch(/2026-09-14 +0 +0 +0 +—/)
  })

  it('says a share as a percentage once it is out of ten or more', () => {
    const many = Array.from({ length: 10 }, (_, index) => open(`t${index}`, 1, { storage: index < 3 ? 'folder' : 'browser' }))
    expect(formatUsageReport(buildUsageReport(many, day(2), 1))).toContain('Saving to a folder: 30% (3 of 10)')
  })
})
