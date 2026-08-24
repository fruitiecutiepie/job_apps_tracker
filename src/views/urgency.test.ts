import { describe, expect, it } from 'vitest'

import { emptyCompensation } from '../domain'
import type { Application, StateEvent, StateId } from '../domain'
import {
  ACTION_HORIZON_DAYS,
  DEADLINE_HORIZON_DAYS,
  INVITE_HORIZON_DAYS,
  STALE_GRACE_DAYS,
  STALE_PEAK_DAYS,
  classifyLifecycle,
  rankByUrgency,
  urgencyFor,
} from './urgency'

const today = new Date(2026, 7, 14, 12)

function at(daysFromToday: number, hour = 9): string {
  const date = new Date(today)
  date.setHours(hour, 0, 0, 0)
  date.setDate(date.getDate() + daysFromToday)
  return date.toISOString()
}

function application(company: string, overrides: Partial<Application> = {}): Application {
  const state: StateId = 'applied'
  return {
    id: `00000000-0000-7000-8000-${company.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(12, '0').slice(0, 12)}`,
    company,
    role: null,
    url: null,
    source: null,
    state,
    // Moved recently, so fixtures start with no silence pressure.
    state_history: [{ state, at: at(-1) }],
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
    // Inside the staleness grace period, so fixtures start with no pressure at all.
    updated_at: at(-1),
    created_at: at(-40),
    ...overrides,
  }
}

function invite(daysFromToday: number, overrides: Partial<StateEvent> = {}): StateEvent {
  return {
    id: `00000000-0000-7000-8000-${String(daysFromToday + 100).padStart(12, '0')}`,
    state: 'interview_1',
    summary: 'Research panel',
    starts_at: at(daysFromToday, 14),
    ends_at: null,
    location: null,
    url: null,
    ics_uid: null,
    sequence: 0,
    cancelled: false,
    created_at: at(-5),
    updated_at: at(-5),
    ...overrides,
  }
}

function movedDaysAgo(days: number): Pick<Application, 'state_history' | 'updated_at'> {
  // updated_at stays fresh on purpose: an edit must not count as movement.
  return { state_history: [{ state: 'applied', at: at(-days) }], updated_at: at(0) }
}

function score(overrides: Partial<Application>): number {
  return urgencyFor(application('Fixture', overrides), today)!.score
}

function reason(overrides: Partial<Application>): string {
  return urgencyFor(application('Fixture', overrides), today)!.reason
}

describe('lifecycle classification', () => {
  it('separates live stages from rejected and closed outcomes', () => {
    expect(classifyLifecycle('applied')).toBe('live')
    expect(classifyLifecycle('headhunted')).toBe('live')
    expect(classifyLifecycle('offer')).toBe('live')

    expect(classifyLifecycle('auto_rejected')).toBe('rejected')
    expect(classifyLifecycle('interview_2_rejected')).toBe('rejected')
    expect(classifyLifecycle('offer_rejected')).toBe('rejected')

    expect(classifyLifecycle('accepted')).toBe('closed')
    expect(classifyLifecycle('no_openings')).toBe('closed')
  })

  it('leaves rejected and closed applications out of the ranking', () => {
    const applications = [
      application('Live Co'),
      application('Rejected Co', {
        state: 'interview_1_rejected',
        state_history: [{ state: 'interview_1_rejected', at: at(-3) }],
      }),
      application('Accepted Co', {
        state: 'accepted',
        state_history: [{ state: 'accepted', at: at(-3) }],
      }),
      application('Closed Co', {
        state: 'no_openings',
        state_history: [{ state: 'no_openings', at: at(-3) }],
      }),
    ]

    expect(urgencyFor(applications[1], today)).toBeNull()
    expect(urgencyFor(applications[2], today)).toBeNull()
    expect(urgencyFor(applications[3], today)).toBeNull()
    expect(rankByUrgency(applications, today).map(({ application: item }) => item.company)).toEqual([
      'Live Co',
    ])
  })
})

describe('deadline pressure', () => {
  it('peaks on the deadline day and decays across the horizon', () => {
    expect(score({ deadline_at: at(0) })).toBeGreaterThan(score({ deadline_at: at(1) }))
    expect(score({ deadline_at: at(1) })).toBeGreaterThan(score({ deadline_at: at(7) }))
    expect(score({ deadline_at: at(7) })).toBeGreaterThan(score({ deadline_at: at(13) }))
  })

  it('stops contributing at and beyond the horizon', () => {
    const none = score({})
    expect(score({ deadline_at: at(DEADLINE_HORIZON_DAYS) })).toBe(none)
    expect(score({ deadline_at: at(DEADLINE_HORIZON_DAYS + 10) })).toBe(none)
  })

  it('treats a deadline earlier today as due today, not passed', () => {
    expect(reason({ deadline_at: at(0, 1) })).toBe('Deadline today')
  })

  it('keeps a passed deadline high and says so', () => {
    expect(reason({ deadline_at: at(-3) })).toBe('Deadline passed 3 days ago')
    expect(reason({ deadline_at: at(-1) })).toBe('Deadline passed 1 day ago')
    expect(score({ deadline_at: at(-3) })).toBeGreaterThan(score({ deadline_at: at(5) }))
  })
})

describe('next-action pressure', () => {
  it('treats overdue and same-day actions as equally due', () => {
    const overdue = score({ next_action: 'Follow up', next_action_at: at(-2) })
    const dueToday = score({ next_action: 'Follow up', next_action_at: at(0, 1) })

    expect(overdue).toBe(dueToday)
    expect(reason({ next_action: 'Follow up', next_action_at: at(-2) })).toBe('Action overdue 2 days')
    expect(reason({ next_action: 'Follow up', next_action_at: at(0, 1) })).toBe('Action due today')
  })

  it('decays over a shorter horizon than a deadline', () => {
    const none = score({})
    expect(score({ next_action: 'Follow up', next_action_at: at(ACTION_HORIZON_DAYS) })).toBe(none)
    expect(score({ next_action: 'Follow up', next_action_at: at(3) })).toBeGreaterThan(none)

    // Same number of days out, the external deadline outranks a self-set action date.
    expect(score({ deadline_at: at(5) })).toBeGreaterThan(
      score({ next_action: 'Follow up', next_action_at: at(5) }),
    )
  })

  it('gives an undated action a small nudge', () => {
    expect(reason({ next_action: 'Follow up' })).toBe('Action not scheduled')
    expect(score({ next_action: 'Follow up' })).toBeGreaterThan(score({}))
    expect(score({ next_action: 'Follow up' })).toBeLessThan(
      score({ next_action: 'Follow up', next_action_at: at(1) }),
    )
  })

  it('ignores a blank action', () => {
    expect(score({ next_action: '   ' })).toBe(score({}))
  })
})

describe('invite pressure', () => {
  it('peaks on the day and decays more slowly than a deadline', () => {
    expect(reason({ state_events: [invite(0)] })).toBe('Invite today')
    expect(score({ state_events: [invite(0)] })).toBe(score({ deadline_at: at(0) }))

    // Same distance, firmer commitment: the horizon is longer, so the value is higher.
    expect(score({ state_events: [invite(5)] })).toBeGreaterThan(score({ deadline_at: at(5) }))
    expect(score({ state_events: [invite(5)] })).toBeGreaterThan(score({ state_events: [invite(9)] }))
  })

  it('stops contributing at and beyond its horizon', () => {
    const none = score({})
    expect(score({ state_events: [invite(INVITE_HORIZON_DAYS)] })).toBe(none)
    expect(score({ state_events: [invite(INVITE_HORIZON_DAYS + 5)] })).toBe(none)
  })

  it('ignores a meeting that already happened, unlike a deadline that slipped', () => {
    // The meeting is history; a passed deadline still needs dealing with.
    expect(score({ state_events: [invite(-2)] })).toBe(score({}))
    expect(score({ deadline_at: at(-2) })).toBeGreaterThan(score({}))
  })

  it('ignores a cancelled invite and takes the soonest one still ahead', () => {
    expect(score({ state_events: [invite(1, { cancelled: true })] })).toBe(score({}))

    const mixed = {
      state_events: [invite(9), invite(2, { cancelled: true }), invite(4)],
    }
    expect(reason(mixed)).toBe('Invite in 4 days')
  })

  it('outranks every other term at the same distance', () => {
    const day = 3
    const inviteScore = score({ state_events: [invite(day)] })

    expect(inviteScore).toBeGreaterThan(score({ deadline_at: at(day) }))
    expect(inviteScore).toBeGreaterThan(
      score({ next_action: 'Prepare', next_action_at: at(day) }),
    )
    expect(inviteScore).toBeGreaterThan(score(movedDaysAgo(60)))
  })

  it('wins the reason on an exact tie with a deadline', () => {
    expect(reason({ state_events: [invite(0)], deadline_at: at(0) })).toBe('Invite today')
  })

  it('still loses to an overdue action, which is already late', () => {
    expect(score({ next_action: 'Chase', next_action_at: at(-1) })).toBeGreaterThan(
      score({ state_events: [invite(2)] }),
    )
  })
})

describe('staleness pressure', () => {
  it('stays silent inside the grace period and rises to the peak', () => {
    const fresh = score({ ...movedDaysAgo(STALE_GRACE_DAYS) })
    expect(fresh).toBe(score(movedDaysAgo(0)))
    expect(score(movedDaysAgo(14))).toBeGreaterThan(fresh)
    expect(score({ ...movedDaysAgo(STALE_PEAK_DAYS) })).toBeGreaterThan(score(movedDaysAgo(14)))
  })

  it('does not keep climbing past the peak', () => {
    expect(score({ ...movedDaysAgo(STALE_PEAK_DAYS + 30) })).toBe(
      score({ ...movedDaysAgo(STALE_PEAK_DAYS) }),
    )
  })

  it('stays below every near-term fact but above a far-off deadline', () => {
    const maxStale = score(movedDaysAgo(60))

    expect(maxStale).toBeLessThan(score({ deadline_at: at(0) }))
    expect(maxStale).toBeLessThan(score({ deadline_at: at(-2) }))
    expect(maxStale).toBeLessThan(score({ deadline_at: at(5) }))
    expect(maxStale).toBeLessThan(score({ next_action: 'Follow up', next_action_at: at(-1) }))

    // A deadline nearly two weeks out is genuinely not pressing, so silence outranks it.
    expect(maxStale).toBeGreaterThan(score({ deadline_at: at(DEADLINE_HORIZON_DAYS - 1) }))
    expect(maxStale).toBeGreaterThan(score({ next_action: 'Follow up' }))
  })

  it('measures movement, so an edit does not reset the silence', () => {
    const moved = movedDaysAgo(30)

    // updated_at is today in both; only the history differs.
    expect(score({ ...moved, updated_at: at(0) })).toBe(score(moved))
    expect(score({ ...moved, updated_at: at(0) })).toBeGreaterThan(score(movedDaysAgo(1)))
  })

  it('raises urgency rather than lowering it', () => {
    expect(score(movedDaysAgo(30))).toBeGreaterThan(score(movedDaysAgo(1)))
    expect(reason(movedDaysAgo(30))).toBe('No stage change for 30 days')
  })
})

describe('score composition', () => {
  it('ranks later stages above earlier ones under equal pressure', () => {
    const offer = score({
      state: 'offer',
      state_history: [{ state: 'offer', at: at(-3) }],
      deadline_at: at(2),
    })
    const applied = score({ deadline_at: at(2) })
    const headhunted = score({
      state: 'headhunted',
      state_history: [{ state: 'headhunted', at: at(-3) }],
      deadline_at: at(2),
    })

    expect(offer).toBeGreaterThan(applied)
    expect(applied).toBeGreaterThan(headhunted)
  })

  it('reports the dominant pressure and prefers the external deadline on a tie', () => {
    // Both terms sit at full pressure; the deadline is the one worth naming.
    expect(reason({ deadline_at: at(0), next_action: 'Follow up', next_action_at: at(-1) })).toBe(
      'Deadline today',
    )
    expect(reason({ deadline_at: at(10), next_action: 'Follow up', next_action_at: at(0) })).toBe(
      'Action due today',
    )
  })

  it('lets extra pressures stack without overtaking the dominant one', () => {
    const deadlineOnly = score({ deadline_at: at(2) })
    const stacked = score({
      deadline_at: at(2),
      next_action: 'Follow up',
      next_action_at: at(4),
      ...movedDaysAgo(20),
    })
    const soonerDeadline = score({ deadline_at: at(0) })

    expect(stacked).toBeGreaterThan(deadlineOnly)
    expect(stacked).toBeLessThan(soonerDeadline)
  })

  it('explains a live application with nothing pending', () => {
    const quiet = urgencyFor(application('Quiet Co'), today)!
    expect(quiet.reason).toBe('Nothing scheduled')
    expect(quiet.score).toBe(0)
  })
})

describe('ranking order', () => {
  it('sorts most urgent first without touching the input', () => {
    const applications = [
      application('Quiet Co'),
      application('Stale Co', movedDaysAgo(25)),
      application('Deadline Co', { deadline_at: at(1) }),
      application('Overdue Co', { next_action: 'Follow up', next_action_at: at(-2) }),
    ]
    const order = [...applications]

    const ranked = rankByUrgency(applications, today)

    // An overdue action is already late, so it leads a deadline that is still a day away:
    // deadlines get a longer horizon than actions, not a higher ceiling.
    expect(ranked.map(({ application: item }) => item.company)).toEqual([
      'Overdue Co',
      'Deadline Co',
      'Stale Co',
      'Quiet Co',
    ])
    expect(ranked.map(({ reason: text }) => text)).toEqual([
      'Action overdue 2 days',
      'Deadline in 1 day',
      'No stage change for 25 days',
      'Nothing scheduled',
    ])
    expect(applications).toEqual(order)
  })

  it('breaks ties by deadline, then action date, then age, then id', () => {
    const base = { deadline_at: at(3) }
    const applications = [
      application('Ddd Co', { ...base, deadline_at: at(4) }),
      application('Ccc Co', { ...base, next_action: 'Follow up', next_action_at: at(6) }),
      application('Bbb Co', { ...base, next_action: 'Follow up', next_action_at: at(5) }),
      application('Aaa Co', { ...base }),
    ]

    const ranked = rankByUrgency(applications, today)

    // Bbb and Ccc share a deadline but stack a nearer action date, so they lead; Aaa has the
    // same deadline with no action; Ddd's deadline is a day further out.
    expect(ranked.map(({ application: item }) => item.company)).toEqual([
      'Bbb Co',
      'Ccc Co',
      'Aaa Co',
      'Ddd Co',
    ])
  })

  it('applies the tiebreak to scores that only differ by floating-point noise', () => {
    // 6/7 x 7/9 and 1 x 2/3 are the same number reached two ways, so these tie in practice.
    const soon = application('Soon Co', {
      state: 'recruiter_interview',
      state_history: [{ state: 'recruiter_interview', at: at(-2) }],
      next_action: 'Prepare',
      next_action_at: at(1),
      updated_at: at(-2),
    })
    const late = application('Late Co', {
      state: 'recruiter_messaged',
      state_history: [{ state: 'recruiter_messaged', at: at(-3) }],
      next_action: 'Send availability',
      next_action_at: at(-1),
      updated_at: at(-3),
    })

    expect(Math.abs(urgencyFor(soon, today)!.score - urgencyFor(late, today)!.score)).toBeLessThan(1e-9)
    expect(rankByUrgency([soon, late], today).map(({ application: item }) => item.company)).toEqual([
      'Late Co',
      'Soon Co',
    ])
  })

  it('orders identical records by age and then id', () => {
    const older = application('Older Co', { deadline_at: at(2), updated_at: at(-3) })
    const newer = application('Newer Co', { deadline_at: at(2), updated_at: at(-1) })
    const ranked = rankByUrgency([newer, older], today)

    expect(ranked.map(({ application: item }) => item.company)).toEqual(['Older Co', 'Newer Co'])

    const first = application('Aaa Co', { deadline_at: at(2) })
    const second = application('Bbb Co', { deadline_at: at(2) })
    expect(
      rankByUrgency([second, first], today).map(({ application: item }) => item.id),
    ).toEqual([first.id, second.id].sort((left, right) => left.localeCompare(right)))
  })
})
