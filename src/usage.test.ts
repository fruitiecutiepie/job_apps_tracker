import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleProgress, handleUsage, PROGRESS_WEEKS } from '../worker'
import { USAGE_REPORT_VERSION } from './usageReport'
import { addApplication, createDemoDocument, createEmptyDocument, migrateDocument, moveApplication, OUTCOME_CONFIG, STATE_CONFIG } from './domain'
import { DEFAULT_DEMO_REFERENCE } from './domain/demo'
import type { Application, TrackerDocument } from './domain'
import type { StorageState } from './backend'
import {
  readUsagePreference,
  recordUsage,
  resetUsageForTests,
  setUsageTracker,
  USAGE_STORAGE_KEY,
  usageAvailable,
  usageTag,
  useViewTime,
  writeUsagePreference,
} from './usage'
import {
  parseUsageReport,
  UNKNOWN_TRACKER,
  USAGE_EVENTS,
  USAGE_FEATURES,
  USAGE_OUTCOMES,
  USAGE_STAGES,
  usageDataPoint,
  type UsageFeature,
} from './usageEvent'
import { durationBucket, referrerKind, usageChanges, usageSnapshot } from './usageSnapshot'

const reference = new Date(DEFAULT_DEMO_REFERENCE)
const TRACKER_ID = '0199a1b2-c3d4-7e5f-8a6b-1234567890ab'

const browserStorage = (overrides: Partial<StorageState> = {}): StorageState => ({
  connection: { kind: 'disconnected' },
  unbackedSince: null,
  saving: false,
  tracker: { id: TRACKER_ID, name: 'Untitled tracker', sourceFile: null },
  ...overrides,
})

const validOpen = () => ({
  v: 1,
  tracker: '0123456789abcdef',
  profile: 'live',
  event: 'open',
  props: usageSnapshot(createDemoDocument(reference), browserStorage(), reference),
})

describe('usage reports', () => {
  it('accepts exactly the reports the app may send', () => {
    expect(parseUsageReport(validOpen())).not.toBeNull()
    expect(parseUsageReport({ v: 1, tracker: '0123456789abcdef', profile: 'demo', event: 'moved', props: { stage: 'offer', outcome: 'rejected' } })).not.toBeNull()
    expect(parseUsageReport({ v: 1, tracker: '0123456789abcdef', profile: 'live', event: 'application_added', props: {} })).not.toBeNull()
  })

  it('refuses anything that could carry what someone wrote', () => {
    const base = validOpen()
    // A value off its list: free text is exactly what must never get through.
    expect(parseUsageReport({ ...base, props: { ...base.props, applications: 'Acme Corp' } })).toBeNull()
    // A property nobody declared.
    expect(parseUsageReport({ ...base, props: { ...base.props, company: 'n' } })).toBeNull()
    // A property missing.
    const { notes: _notes, ...missing } = base.props
    void _notes
    expect(parseUsageReport({ ...base, props: missing })).toBeNull()
    // An event nobody declared, or one inherited from Object.prototype.
    expect(parseUsageReport({ ...base, event: 'note_text', props: {} })).toBeNull()
    expect(parseUsageReport({ ...base, event: 'toString', props: {} })).toBeNull()
    // A raw tracker id instead of its tag.
    expect(parseUsageReport({ ...base, tracker: TRACKER_ID })).toBeNull()
    expect(parseUsageReport({ ...base, v: 2 })).toBeNull()
    expect(parseUsageReport({ ...base, profile: 'other' })).toBeNull()
    expect(parseUsageReport(null)).toBeNull()
  })

  it('stores the properties in their declared order, within Analytics Engine’s twenty blobs', () => {
    const report = parseUsageReport(validOpen())!
    const point = usageDataPoint(report)
    expect(point.indexes).toEqual(['0123456789abcdef'])
    expect(point.blobs.slice(0, 2)).toEqual(['open', 'live'])
    expect(point.blobs.slice(2)).toEqual(Object.keys(USAGE_EVENTS.open).map((key) => report.props[key]))
    for (const props of Object.values(USAGE_EVENTS)) {
      expect(Object.keys(props).length + 2).toBeLessThanOrEqual(20)
    }
  })
})

describe('the stage and outcome lists', () => {
  it('match the domain’s, which the event module cannot import', () => {
    expect([...USAGE_STAGES]).toEqual(STATE_CONFIG.map((state) => state.id))
    expect([...USAGE_OUTCOMES]).toEqual(OUTCOME_CONFIG.map((outcome) => outcome.id))
  })
})

/** A document of `count` bare applications, each created `daysAgo` before the reference. */
function documentOf(count: number, daysAgo = 0): TrackerDocument {
  let document = createEmptyDocument()
  for (let index = 0; index < count; index += 1) {
    document = addApplication(document, { company: `Company ${index}` }, new Date(reference.getTime() - daysAgo * 86_400_000))
  }
  return document
}

/** One application, edited by hand to hold exactly one thing. */
function withOne(change: (application: Application) => Partial<Application>): TrackerDocument {
  const document = documentOf(1)
  const [application] = document.applications
  return { ...document, applications: [{ ...application, ...change(application) }] }
}

const at = reference.toISOString()
const FEATURE_FIXTURES: Record<UsageFeature, (application: Application) => Partial<Application>> = {
  notes: () => ({ stage_notes: [{ state: 'applied', body: 'Ask about the team', heard: [], created_at: at, updated_at: at }] }),
  captures: () => ({ stage_notes: [{ state: 'applied', body: '', heard: [{ id: 'h1', body: 'Two rounds', at }], created_at: at, updated_at: at }] }),
  messages: () => ({ correspondence: [{} as Application['correspondence'][number]] }),
  invites: () => ({ state_events: [{} as Application['state_events'][number]] }),
  ratings: () => ({ ratings: [{} as Application['ratings'][number]] }),
  compensation: (application) => ({ compensation: { ...application.compensation, currency: 'AUD', advertised: { min: 100_000, max: 120_000 } } }),
  posting: () => ({ posting: { body: 'We are hiring', captured_at: at, source_url: null } }),
  attachments: () => ({ attachments: [{} as Application['attachments'][number]] }),
  done: () => ({ completed_actions: [{} as Application['completed_actions'][number]] }),
  archived: () => ({ archived_at: at }),
}

describe('usageSnapshot, field by field', () => {
  const snapshot = (document: TrackerDocument, storage = browserStorage()) => usageSnapshot(document, storage, reference)

  it.each([
    [0, '0'],
    [1, '1-2'],
    [2, '1-2'],
    [3, '3-10'],
    [10, '3-10'],
    [11, '11-50'],
    [50, '11-50'],
    [51, '51+'],
  ])('counts %i applications as %s', (count, bucket) => {
    expect(snapshot(documentOf(count)).applications).toBe(bucket)
  })

  it.each([
    [0, '0d'],
    [1, '1-7d'],
    [7, '1-7d'],
    [8, '8-30d'],
    [30, '8-30d'],
    [31, '31-90d'],
    [90, '31-90d'],
    [91, '91d+'],
  ])('ages a tracker whose oldest application is %i days old as %s', (days, bucket) => {
    expect(snapshot(documentOf(1, days)).age).toBe(bucket)
  })

  it.each([
    ['applied', 'none'],
    ['recruiter_messaged', 'none'],
    ['recruiter_interview', 'interview'],
    ['interview_2', 'interview'],
    ['offer', 'offer'],
    ['accepted', 'accepted'],
  ] as const)('reads an application at %s as having reached %s', (state, reached) => {
    const document = documentOf(1)
    const moved = moveApplication(document, document.applications[0].id, { state }, reference)
    expect(snapshot(moved).reached).toBe(reached)
  })

  it('keeps how far an application got after it ended, and after it was moved back', () => {
    const document = documentOf(1)
    const id = document.applications[0].id
    const offered = moveApplication(document, id, { state: 'offer' }, reference)
    const back = moveApplication(offered, id, { state: 'applied', outcome: 'rejected' }, reference)
    expect(snapshot(back).reached).toBe('offer')
  })

  it.each([
    [{ kind: 'connected', name: 'Job search' }, 'folder'],
    [{ kind: 'needs-permission', name: 'Job search' }, 'browser'],
    [{ kind: 'disconnected' }, 'browser'],
    [{ kind: 'unsupported' }, 'unsupported'],
  ] as const)('reports a %o connection as %s', (connection, storage) => {
    expect(snapshot(documentOf(0), browserStorage({ connection })).storage).toBe(storage)
  })

  it.each(USAGE_FEATURES)('reports %s in use only once something uses it', (feature) => {
    expect(snapshot(documentOf(1))[feature]).toBe('n')
    const used = snapshot(withOne(FEATURE_FIXTURES[feature]))
    expect(used[feature]).toBe('y')
    // Exactly that one: the fixture holds nothing else.
    const others = USAGE_FEATURES.filter((other) => other !== feature && !(feature === 'captures' && other === 'notes'))
    for (const other of others) expect(used[other]).toBe('n')
  })

  it('does not count a stage note with nothing written as notes in use', () => {
    expect(snapshot(withOne(FEATURE_FIXTURES.captures)).notes).toBe('n')
  })

  it('carries the referrer it is given, and says direct when given none', () => {
    expect(snapshot(documentOf(0)).referrer).toBe('direct')
    expect(usageSnapshot(documentOf(0), browserStorage(), reference, 'search').referrer).toBe('search')
  })
})

describe('referrerKind', () => {
  const origin = 'https://fruitiecutiepie.com'
  it.each([
    ['', 'direct'],
    ['https://fruitiecutiepie.com/projects/job_apps_tracker/app/?tracker=x', 'internal'],
    ['https://fruitiecutiepie.com/projects/job_apps_tracker/app/demo/', 'demo'],
    ['https://www.google.com.au/', 'search'],
    ['https://duckduckgo.com/', 'search'],
    ['https://www.bing.com/search?q=job+tracker', 'search'],
    ['https://www.linkedin.com/feed/', 'social'],
    ['https://uk.linkedin.com/in/someone', 'social'],
    ['https://t.co/abc', 'social'],
    ['https://news.ycombinator.com/item?id=1', 'social'],
    ['https://github.com/fruitiecutiepie/job_apps_tracker', 'github'],
    ['https://fruitiecutiepie.github.io/', 'github'],
    ['https://example.com/blog', 'other'],
    ['https://notgoogle.com/', 'other'],
    ['not a url', 'other'],
    ['https://fruitiecutiepie.com/projects/job-apps-tracker', 'site'],
    ['https://fruitiecutiepie.com/', 'site'],
  ])('reads %s as %s', (referrer, kind) => {
    expect(referrerKind(referrer, origin, '/projects/job_apps_tracker/app/demo/', '/projects/job_apps_tracker/app/')).toBe(kind)
  })

  it('reads the whole origin as internal when it is not told where the tracker ends', () => {
    expect(referrerKind('https://fruitiecutiepie.com/projects/job-apps-tracker', origin)).toBe('internal')
  })

  it('reads the demo as internal on the demo itself, which passes no demo path', () => {
    expect(referrerKind('https://fruitiecutiepie.com/projects/job_apps_tracker/app/demo/', origin)).toBe('internal')
  })
})

describe('durationBucket', () => {
  it.each([
    [0, '<10s'],
    [9_999, '<10s'],
    [10_000, '10s-1m'],
    [59_999, '10s-1m'],
    [60_000, '1-5m'],
    [299_999, '1-5m'],
    [300_000, '5-30m'],
    [1_799_999, '5-30m'],
    [1_800_000, '30m+'],
  ])('puts %i ms in %s', (ms, bucket) => {
    expect(durationBucket(ms)).toBe(bucket)
  })
})

describe('usageSnapshot', () => {
  it('describes an empty tracker as empty', () => {
    const snapshot = usageSnapshot(createEmptyDocument(), browserStorage(), reference)
    expect(snapshot).toMatchObject({ applications: '0', age: 'none', reached: 'none', storage: 'browser', backlog: 'none' })
    expect(Object.values(snapshot).filter((value) => value === 'y')).toEqual([])
  })

  it('describes the demo coarsely', () => {
    const snapshot = usageSnapshot(
      createDemoDocument(reference),
      browserStorage({ connection: { kind: 'connected', name: 'Job search' } }),
      reference,
    )
    expect(snapshot).toMatchObject({
      applications: '11-50',
      reached: 'accepted',
      storage: 'folder',
      notes: 'y',
      messages: 'y',
      invites: 'y',
      ratings: 'y',
      compensation: 'y',
      archived: 'y',
    })
  })

  it('buckets the backlog by its age', () => {
    const day = 86_400_000
    const since = (days: number) => new Date(reference.getTime() - days * day).toISOString()
    const backlog = (days: number) =>
      usageSnapshot(createEmptyDocument(), browserStorage({ unbackedSince: since(days) }), reference).backlog
    expect(backlog(0.5)).toBe('<1d')
    expect(backlog(3)).toBe('1-7d')
    expect(backlog(30)).toBe('8d+')
  })
})

describe('usageChanges', () => {
  it('counts an application added and a move, and nothing for an unchanged document', () => {
    const empty = createEmptyDocument()
    const added = addApplication(empty, { company: 'Acme' }, reference)
    expect(usageChanges(empty, added)).toEqual({ added: 1, moved: [] })
    expect(usageChanges(added, added)).toEqual({ added: 0, moved: [] })

    const id = added.applications[0].id
    const moved = moveApplication(added, id, { state: 'interview_1', outcome: 'rejected' }, reference)
    expect(usageChanges(added, moved)).toEqual({ added: 0, moved: [{ state: 'interview_1', outcome: 'rejected' }] })
  })
})

describe('sending', () => {
  let beacon: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetUsageForTests()
    beacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetUsageForTests()
  })

  const sentBodies = async () => {
    await vi.waitFor(() => expect(beacon).toHaveBeenCalled())
    return beacon.mock.calls.map(([, body]) => String(body))
  }

  it('sends nothing from a build without an endpoint', async () => {
    vi.stubEnv('VITE_USAGE_URL', '')
    expect(usageAvailable()).toBe(false)
    setUsageTracker(TRACKER_ID)
    recordUsage('exported', {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(beacon).not.toHaveBeenCalled()
  })

  it('sends the tracker’s tag and nothing anyone wrote', async () => {
    vi.stubEnv('VITE_USAGE_URL', '/app/__usage')
    const document = createDemoDocument(reference)
    setUsageTracker(TRACKER_ID)
    recordUsage('open', usageSnapshot(document, browserStorage(), reference))

    const [body] = await sentBodies()
    expect(beacon.mock.calls[0][0]).toBe('/app/__usage')
    const report = JSON.parse(body)
    expect(report.tracker).toBe(await usageTag(TRACKER_ID))
    expect(body).not.toContain(TRACKER_ID)
    for (const application of document.applications) {
      expect(body).not.toContain(application.company)
    }
    expect(parseUsageReport(report)).not.toBeNull()
  })

  it('holds reports made before the tracker is known, and sends them once it is', async () => {
    vi.stubEnv('VITE_USAGE_URL', '/app/__usage')
    recordUsage('exported', {})
    expect(beacon).not.toHaveBeenCalled()
    setUsageTracker(TRACKER_ID)
    const [body] = await sentBodies()
    expect(JSON.parse(body).event).toBe('exported')
  })

  it('sends nothing once turned off, and remembers the choice', async () => {
    vi.stubEnv('VITE_USAGE_URL', '/app/__usage')
    writeUsagePreference(false)
    expect(localStorage.getItem(USAGE_STORAGE_KEY)).toBe('off')
    setUsageTracker(TRACKER_ID)
    recordUsage('exported', {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(beacon).not.toHaveBeenCalled()
    expect(readUsagePreference()).toBe(false)
  })

  it('sends what waited on a tracker that never arrived under the unknown tag', async () => {
    vi.stubEnv('VITE_USAGE_URL', '/app/__usage')
    recordUsage('error', { kind: 'load' })
    setUsageTracker(null)
    const [body] = await sentBodies()
    expect(JSON.parse(body)).toMatchObject({ tracker: UNKNOWN_TRACKER, event: 'error', props: { kind: 'load' } })
  })

  it('counts an older file once per layout per page, wherever it was read', async () => {
    vi.stubEnv('VITE_USAGE_URL', '/app/__usage')
    setUsageTracker(TRACKER_ID)
    migrateDocument({ applications: [] })
    migrateDocument({ applications: [] })
    migrateDocument({ schema_version: 2, applications: [] })
    migrateDocument({ schema_version: 3, applications: [] })
    await vi.waitFor(() => expect(beacon).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 10))
    const reports = beacon.mock.calls.map(([, body]) => JSON.parse(String(body)))
    expect(reports.map((report) => report.props)).toEqual([{ from: '1' }, { from: '2' }])
  })

  it('times a place until it is left, and does not count a hidden tab', async () => {
    vi.stubEnv('VITE_USAGE_URL', '/app/__usage')
    setUsageTracker(TRACKER_ID)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(reference)
      const view = renderHook(({ place }) => useViewTime(place), { initialProps: { place: 'kanban' as const } })

      vi.setSystemTime(reference.getTime() + 20_000)
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      act(() => document.dispatchEvent(new Event('visibilitychange')))
      // An hour away, then back for two more minutes.
      vi.setSystemTime(reference.getTime() + 3_620_000)
      visibility.mockReturnValue('visible')
      act(() => document.dispatchEvent(new Event('visibilitychange')))
      vi.setSystemTime(reference.getTime() + 3_740_000)
      view.rerender({ place: 'table' as never })
      view.unmount()
    } finally {
      vi.useRealTimers()
    }
    await vi.waitFor(() => expect(beacon).toHaveBeenCalledTimes(3))
    const reports = beacon.mock.calls.map(([, body]) => JSON.parse(String(body)).props)
    expect(reports).toEqual([
      { place: 'kanban', duration: '10s-1m' },
      { place: 'kanban', duration: '1-5m' },
      { place: 'table', duration: '<10s' },
    ])
  })

  it('starts off where the browser sends Global Privacy Control, until turned on', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true })
    try {
      expect(readUsagePreference()).toBe(false)
      writeUsagePreference(true)
      expect(readUsagePreference()).toBe(true)
    } finally {
      Reflect.deleteProperty(navigator, 'globalPrivacyControl')
    }
  })
})

describe('the Worker', () => {
  const post = (body: unknown, headers: Record<string, string> = { 'Sec-Fetch-Site': 'same-origin' }) =>
    new Request('https://example.test/projects/job_apps_tracker/app/__usage', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  const env = () => ({ ASSETS: { fetch: vi.fn() }, USAGE: { writeDataPoint: vi.fn() } })

  it('stores a valid report and nothing about the request', async () => {
    const bindings = env()
    const response = await handleUsage(post(validOpen()), bindings)
    expect(response.status).toBe(204)
    expect(bindings.USAGE.writeDataPoint).toHaveBeenCalledWith(usageDataPoint(parseUsageReport(validOpen())!))
  })

  it('refuses what is not a report, and what came from another site', async () => {
    const bindings = env()
    expect((await handleUsage(post({ ...validOpen(), event: 'note_text' }), bindings)).status).toBe(400)
    expect((await handleUsage(post('not json'), bindings)).status).toBe(400)
    expect((await handleUsage(post(validOpen(), { 'Sec-Fetch-Site': 'cross-site' }), bindings)).status).toBe(403)
    expect((await handleUsage(new Request('https://example.test/__usage'), bindings)).status).toBe(405)
    expect(bindings.USAGE.writeDataPoint).not.toHaveBeenCalled()
  })
})

describe('the Worker’s summary for the progress page', () => {
  const configured = {
    ASSETS: { fetch: vi.fn() },
    ANALYTICS_ACCOUNT_ID: 'acct',
    ANALYTICS_TOKEN: 'read-token',
    USAGE_REPORT_KEY: 'shared-key',
  }
  const get = (authorization?: string, method = 'GET') =>
    new Request('https://example.test/projects/job_apps_tracker/app/__progress', {
      method,
      headers: authorization ? { Authorization: authorization } : {},
    })
  const stored = {
    timestamp: '2026-08-12 10:00:00',
    index1: '0123456789abcdef',
    blob1: 'application_added',
    blob2: 'live',
  }
  const analytics = (data: unknown[] = [stored], status = 200) =>
    vi.fn(async () => new Response(JSON.stringify({ data }), { status }))

  it('answers the report key with the report, asking Analytics Engine with the read token', async () => {
    const answer = analytics()
    const response = await handleProgress(get('Bearer shared-key'), configured, reference, answer)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await response.json()
    expect(body.version).toBe(USAGE_REPORT_VERSION)
    expect(body.weekly).toHaveLength(PROGRESS_WEEKS)
    expect(body.truncated).toBe(false)
    expect(body.weekly.at(-1)).toMatchObject({ writing: 1 })

    const [url, init] = answer.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/analytics_engine/sql')
    expect(init.headers).toEqual({ Authorization: 'Bearer read-token' })
    expect(String(init.body)).toContain(`INTERVAL '${PROGRESS_WEEKS * 7}' DAY`)
  })

  it('refuses a missing or wrong key without asking Analytics Engine', async () => {
    const answer = analytics()
    expect((await handleProgress(get(), configured, reference, answer)).status).toBe(401)
    expect((await handleProgress(get('Bearer shared-ke'), configured, reference, answer)).status).toBe(401)
    expect((await handleProgress(get('Bearer shared-keyy'), configured, reference, answer)).status).toBe(401)
    expect((await handleProgress(get('shared-key', 'POST'), configured, reference, answer)).status).toBe(405)
    expect(answer).not.toHaveBeenCalled()
  })

  it('refuses everything while unconfigured, an empty key included', async () => {
    const answer = analytics()
    const response = await handleProgress(get('Bearer '), { ...configured, USAGE_REPORT_KEY: '' }, reference, answer)
    expect(response.status).toBe(503)
    expect(answer).not.toHaveBeenCalled()
  })

  it('says Analytics Engine failed without passing on what it said', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await handleProgress(get('Bearer shared-key'), configured, reference, analytics([], 403))
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'analytics unavailable' })
    expect(error).toHaveBeenCalled()
  })

  it('says when the row limit cut the period short', async () => {
    const full = Array.from({ length: 50_000 }, () => stored)
    const response = await handleProgress(get('Bearer shared-key'), configured, reference, analytics(full))
    expect((await response.json()).truncated).toBe(true)
  })
})
