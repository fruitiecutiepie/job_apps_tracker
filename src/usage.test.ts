import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleUsage } from '../worker'
import { addApplication, createDemoDocument, createEmptyDocument, moveApplication } from './domain'
import { DEFAULT_DEMO_REFERENCE } from './domain/demo'
import type { StorageState } from './backend'
import {
  readUsagePreference,
  recordUsage,
  resetUsageForTests,
  setUsageTracker,
  USAGE_STORAGE_KEY,
  usageAvailable,
  usageTag,
  writeUsagePreference,
} from './usage'
import { parseUsageReport, USAGE_EVENTS, usageDataPoint } from './usageEvent'
import { usageChanges, usageSnapshot } from './usageSnapshot'

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
