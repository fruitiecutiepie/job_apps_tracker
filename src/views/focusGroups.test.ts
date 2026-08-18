import { describe, expect, it } from 'vitest'

import type { Application, StateId } from '../domain'
import { DUE_SOON_DAYS, focusGroups, type FocusGroupId } from './focusGroups'

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
    state_history: [{ state, at: at(-40) }],
    next_action: null,
    next_action_at: null,
    deadline_at: null,
    notes: null,
    stage_notes: [],
    state_events: [],
    attachments: [],
    updated_at: at(-1),
    created_at: at(-40),
    ...overrides,
  }
}

function companiesIn(applications: Application[], id: FocusGroupId): string[] {
  const group = focusGroups(applications, today).find((candidate) => candidate.id === id)!
  return group.rows.map(({ application: item }) => item.company)
}

describe('focusGroups', () => {
  it('returns every group in a fixed order even when empty', () => {
    expect(focusGroups([], today).map(({ id }) => id)).toEqual([
      'due_now',
      'due_week',
      'due_later',
      'no_date',
      'nudge',
      'quiet',
      'wrapping_up',
    ])
    expect(focusGroups([], today).every(({ rows }) => rows.length === 0)).toBe(true)
  })

  it('states its own membership rule in every heading', () => {
    expect(focusGroups([], today).map(({ heading }) => heading)).toEqual([
      'Overdue or due today',
      'Due in 1 to 7 days',
      'Due in more than 7 days',
      'Action with no date',
      'No change in more than 7 days',
      'Nothing dated or planned',
      'Finished, action outstanding',
    ])
  })

  it('marks scheduled and oldest-first groups ordered, alphabetical ones unordered', () => {
    const ordered = Object.fromEntries(
      focusGroups([], today).map(({ id, ordered: flag }) => [id, flag]),
    )

    expect(ordered).toEqual({
      due_now: true,
      due_week: true,
      due_later: true,
      nudge: true,
      no_date: false,
      quiet: false,
      wrapping_up: false,
    })
  })

  it('places a dated action past its pressure horizon by its date, not as unplanned', () => {
    // Action pressure decays to zero after 7 days, but the action is still dated.
    const applications = [application('Far Off', { next_action: 'Interview', next_action_at: at(10) })]

    expect(companiesIn(applications, 'due_later')).toEqual(['Far Off'])
    expect(companiesIn(applications, 'quiet')).toEqual([])

    const dueLater = focusGroups(applications, today).find(({ id }) => id === 'due_later')!
    expect(dueLater.rows[0].reason).toBe('Action in 10 days')
  })

  it('places by the nearest date when both a deadline and an action are dated', () => {
    const applications = [
      application('Action First', {
        deadline_at: at(9),
        next_action: 'Call',
        next_action_at: at(2),
      }),
    ]

    const dueWeek = focusGroups(applications, today).find(({ id }) => id === 'due_week')!
    expect(dueWeek.rows.map(({ application: item }) => item.company)).toEqual(['Action First'])
    expect(dueWeek.rows[0].reason).toBe('Action in 2 days')
  })

  it('splits dated applications at today and at the one-week boundary', () => {
    const applications = [
      application('Deadline Passed', { deadline_at: at(-2) }),
      application('Deadline Today', { deadline_at: at(0, 1) }),
      application('Action Overdue', { next_action: 'Chase', next_action_at: at(-1) }),
      application('Boundary', { deadline_at: at(DUE_SOON_DAYS) }),
      application('Just Over', { deadline_at: at(DUE_SOON_DAYS + 1) }),
    ]

    expect(companiesIn(applications, 'due_now')).toHaveLength(3)
    expect(companiesIn(applications, 'due_week')).toEqual(['Boundary'])
    expect(companiesIn(applications, 'due_later')).toEqual(['Just Over'])
  })

  it('sorts date-driven groups chronologically rather than by score', () => {
    // The offer stage scores higher, but a schedule is read in date order.
    const applications = [
      application('Offer Later', {
        state: 'offer',
        state_history: [{ state: 'offer', at: at(-4) }],
        deadline_at: at(9),
      }),
      application('Applied Sooner', { deadline_at: at(2) }),
      application('Offer Soonest', {
        state: 'offer',
        state_history: [{ state: 'offer', at: at(-4) }],
        deadline_at: at(1),
      }),
    ]

    expect(companiesIn(applications, 'due_week')).toEqual(['Offer Soonest', 'Applied Sooner'])
    expect(companiesIn(applications, 'due_later')).toEqual(['Offer Later'])
  })

  it('separates an undated action from silence and from having no plan', () => {
    const applications = [
      application('Undated', { next_action: 'Review portfolio' }),
      application('Quiet', { updated_at: at(-25) }),
      application('Fresh', {}),
    ]

    expect(companiesIn(applications, 'no_date')).toEqual(['Undated'])
    expect(companiesIn(applications, 'nudge')).toEqual(['Quiet'])
    expect(companiesIn(applications, 'quiet')).toEqual(['Fresh'])
  })

  it('places a named undated task by the task, and still reports the silence', () => {
    const applications = [
      application('Quiet With Task', {
        next_action: 'Review portfolio',
        updated_at: at(-25),
      }),
    ]

    expect(companiesIn(applications, 'no_date')).toEqual(['Quiet With Task'])
    expect(companiesIn(applications, 'nudge')).toEqual([])

    // The group states the structural fact; the row still surfaces what drives the score.
    const noDate = focusGroups(applications, today).find(({ id }) => id === 'no_date')!
    expect(noDate.rows[0].reason).toBe('No change for 25 days')
  })

  it('keeps a task on a finished application and labels it with its state', () => {
    const applications = [
      application('Rejected Co', {
        state: 'interview_2_rejected',
        state_history: [{ state: 'interview_2_rejected', at: at(-4) }],
        next_action: 'Stay in touch',
      }),
      application('Silent Rejection', {
        state: 'auto_rejected',
        state_history: [{ state: 'auto_rejected', at: at(-4) }],
      }),
    ]

    const wrappingUp = focusGroups(applications, today).find(({ id }) => id === 'wrapping_up')!
    expect(wrappingUp.rows).toHaveLength(1)
    expect(wrappingUp.rows[0].application.company).toBe('Rejected Co')
    expect(wrappingUp.rows[0].reason).toBe('Interview 2 — Rejected')
  })

  it('never places a finished application in a live group', () => {
    const applications = [
      application('Rejected With Deadline', {
        state: 'offer_rejected',
        state_history: [{ state: 'offer_rejected', at: at(-4) }],
        deadline_at: at(1),
        next_action: 'Reply',
        next_action_at: at(-1),
      }),
    ]

    const groups = focusGroups(applications, today)
    for (const group of groups) {
      if (group.id !== 'wrapping_up') expect(group.rows).toHaveLength(0)
    }

    expect(companiesIn(applications, 'wrapping_up')).toEqual(['Rejected With Deadline'])
  })

  it('describes a dated row by its date', () => {
    const applications = [application('Closing', { deadline_at: at(2) })]
    const dueWeek = focusGroups(applications, today).find(({ id }) => id === 'due_week')!

    expect(dueWeek.rows[0].reason).toBe('Deadline in 2 days')
  })

  it('sorts a chronological group by date and an alphabetical group by company', () => {
    const dated = [
      application('Zebra', { deadline_at: at(1) }),
      application('Alpha', { deadline_at: at(5) }),
    ]
    expect(companiesIn(dated, 'due_week')).toEqual(['Zebra', 'Alpha'])

    const undated = [
      application('Zebra', { next_action: 'Review' }),
      application('Alpha', { next_action: 'Review' }),
    ]
    expect(companiesIn(undated, 'no_date')).toEqual(['Alpha', 'Zebra'])
  })
})
