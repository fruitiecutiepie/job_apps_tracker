import { describe, expect, it } from 'vitest'

import { emptyCompensation } from '../domain'
import type { Application, StateId } from '../domain'
import { IDLE_THRESHOLD_DAYS, describeIdle, idleFilterMatches, idleStatusFor } from './idle'

const today = new Date(2026, 7, 14, 12)

function at(daysFromToday: number, hour = 9): string {
  const date = new Date(today)
  date.setHours(hour, 0, 0, 0)
  date.setDate(date.getDate() + daysFromToday)
  return date.toISOString()
}

function application(
  company: string,
  { state = 'applied' as StateId, movedDaysAgo = 1, ...overrides }: Partial<Application> & {
    state?: StateId
    movedDaysAgo?: number
  } = {},
): Application {
  return {
    id: `00000000-0000-7000-8000-${company.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(12, '0').slice(0, 12)}`,
    company,
    role: null,
    url: null,
    source: null,
    state,
    state_history: [{ state, at: at(-movedDaysAgo) }],
    next_action: null,
    next_action_at: null,
    deadline_at: null,
    notes: null,
    completed_actions: [],
    stage_notes: [],
    state_events: [],
    attachments: [],
    ratings: [],
    compensation: emptyCompensation(),
    updated_at: at(-movedDaysAgo),
    created_at: at(-90),
    ...overrides,
  }
}

describe('idleStatusFor', () => {
  it('leaves an application that moved recently alone', () => {
    expect(idleStatusFor(application('Fresh', { movedDaysAgo: 1 }), today)).toBeNull()
  })

  it('is not idle one day short of the threshold', () => {
    const days = IDLE_THRESHOLD_DAYS - 1
    expect(idleStatusFor(application('Almost', { movedDaysAgo: days }), today)).toBeNull()
  })

  /** Inclusive, like the stale thresholds: exactly the threshold qualifies. */
  it('is idle exactly on the threshold', () => {
    const app = application('Boundary', { movedDaysAgo: IDLE_THRESHOLD_DAYS })
    expect(idleStatusFor(app, today)).toEqual({ days: IDLE_THRESHOLD_DAYS })
  })

  it('reports the full count past the threshold', () => {
    expect(idleStatusFor(application('Quiet', { movedDaysAgo: 34 }), today)).toEqual({ days: 34 })
  })

  /**
   * The Northstar Labs shape: edited today, but the stage has not moved in weeks. Reading
   * `updated_at` would call this fresh, which is the mistake this measure exists to avoid.
   */
  it('counts silence from the last stage change, not the last edit', () => {
    const app = application('Northstar Labs', { movedDaysAgo: 40, updated_at: at(0) })
    expect(idleStatusFor(app, today)).toEqual({ days: 40 })
  })

  it('leaves rejected and closed applications out, however long they have sat', () => {
    for (const state of ['auto_rejected', 'accepted', 'no_openings'] as StateId[]) {
      const app = application(`Finished ${state}`, { state, movedDaysAgo: 60 })
      expect(idleStatusFor(app, today)).toBeNull()
    }
  })

  it('survives an application with no history rather than throwing', () => {
    const app = application('Historyless', { state_history: [] })
    expect(() => idleStatusFor(app, today)).not.toThrow()
    expect(idleStatusFor(app, today)).toBeNull()
  })
})

describe('describeIdle', () => {
  it('names the count, singular and plural', () => {
    expect(describeIdle({ days: 34 })).toBe('Idle 34 days')
    expect(describeIdle({ days: 1 })).toBe('Idle 1 day')
  })

  it('says nothing for an application that is not idle', () => {
    expect(describeIdle(null)).toBe('')
  })
})

describe('idleFilterMatches', () => {
  const idle = application('Quiet', { movedDaysAgo: 40 })
  const active = application('Moving', { movedDaysAgo: 2 })
  const rejected = application('Turned down', { state: 'auto_rejected', movedDaysAgo: 60 })

  it('admits everything when unset', () => {
    for (const app of [idle, active, rejected]) {
      expect(idleFilterMatches('all', app, today)).toBe(true)
    }
  })

  it('narrows to the idle ones', () => {
    expect(idleFilterMatches('idle', idle, today)).toBe(true)
    expect(idleFilterMatches('idle', active, today)).toBe(false)
    expect(idleFilterMatches('idle', rejected, today)).toBe(false)
  })

  /** Not-idle is the complement, so a finished application is in it rather than nowhere. */
  it('keeps everything else under not idle', () => {
    expect(idleFilterMatches('not_idle', idle, today)).toBe(false)
    expect(idleFilterMatches('not_idle', active, today)).toBe(true)
    expect(idleFilterMatches('not_idle', rejected, today)).toBe(true)
  })
})
