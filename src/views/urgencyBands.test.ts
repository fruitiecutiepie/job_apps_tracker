import { describe, expect, it } from 'vitest'

import { emptyCompensation } from '../domain'
import type { Application, StateEvent, StateId } from '../domain'
import { URGENCY_BANDS, bandRank, urgencyBandFor } from './urgencyBands'

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
    state_history: [{ state, at: at(-1) }],
    next_action: null,
    next_action_at: null,
    deadline_at: null,
    notes: null,
    compensation: emptyCompensation(),
    ratings: [],
    stage_notes: [],
    state_events: [],
    completed_actions: [],
    attachments: [],
    posting: null,
    created_at: at(-40),
    updated_at: at(-1),
    ...overrides,
  }
}

function invite(overrides: Partial<StateEvent> = {}): StateEvent {
  return {
    id: '00000000-0000-7000-8000-000000000001',
    state: 'recruiter_interview',
    summary: 'Recruiter interview',
    starts_at: at(2),
    ends_at: null,
    location: null,
    url: null,
    ics_uid: null,
    sequence: 0,
    cancelled: false,
    created_at: at(-1),
    updated_at: at(-1),
    ...overrides,
  }
}

describe('band membership', () => {
  it('puts a live application with no date at all in the undated band', () => {
    expect(urgencyBandFor(application('Quiet Co'), today)).toEqual({
      band: 'undated',
      days: null,
    })
  })

  it('keeps a named task with no date undated, because the band is about dates', () => {
    const placement = urgencyBandFor(
      application('Task Co', { next_action: 'Follow up' }),
      today,
    )

    expect(placement.band).toBe('undated')
    expect(placement.days).toBeNull()
  })

  it('bands a dated next action by its distance, negative when overdue', () => {
    expect(
      urgencyBandFor(
        application('Overdue Co', { next_action: 'Follow up', next_action_at: at(-3) }),
        today,
      ),
    ).toEqual({ band: 'due', days: -3 })
  })

  it('ignores a date whose action text was removed, the way the ranking does', () => {
    expect(
      urgencyBandFor(application('Orphan Co', { next_action_at: at(2) }), today).band,
    ).toBe('undated')
  })

  it('bands a deadline with no action of its own', () => {
    expect(urgencyBandFor(application('Closing Co', { deadline_at: at(4) }), today)).toEqual({
      band: 'due',
      days: 4,
    })
  })

  it('bands an invite still ahead', () => {
    expect(
      urgencyBandFor(application('Invited Co', { state_events: [invite()] }), today),
    ).toEqual({ band: 'due', days: 2 })
  })

  it('takes the nearest date when several compete, whichever field it came from', () => {
    const placement = urgencyBandFor(
      application('Busy Co', {
        next_action: 'Follow up',
        next_action_at: at(9),
        deadline_at: at(5),
        state_events: [invite({ starts_at: at(7) })],
      }),
      today,
    )

    expect(placement).toEqual({ band: 'due', days: 5 })
  })

  it('bands a dated action past its pressure horizon by the date, not as unplanned', () => {
    // The action pressure decays to nothing after a week, so this scores zero. It is still
    // dated, and a band that read the score would file it with the rows that have no plan.
    expect(
      urgencyBandFor(
        application('Far Off Co', { next_action: 'Submit the exercise', next_action_at: at(30) }),
        today,
      ),
    ).toEqual({ band: 'due', days: 30 })
  })

  it('treats a cancelled invite as no date at all', () => {
    expect(
      urgencyBandFor(
        application('Called Off Co', { state_events: [invite({ cancelled: true })] }),
        today,
      ).band,
    ).toBe('undated')
  })

  it('treats an invite today as dated, not as something already past', () => {
    expect(
      urgencyBandFor(application('Today Co', { state_events: [invite({ starts_at: at(0, 17) })] }), today),
    ).toEqual({ band: 'due', days: 0 })
  })

  it('separates a finished application that still carries a task from one that does not', () => {
    const rejected = {
      state: 'auto_rejected' as StateId,
      state_history: [{ state: 'auto_rejected' as StateId, at: at(-2) }],
    }

    expect(
      urgencyBandFor(application('Loose End Co', { ...rejected, next_action: 'Ask for feedback' }), today)
        .band,
    ).toBe('outstanding')
    expect(urgencyBandFor(application('Done Co', rejected), today).band).toBe('closed')
  })

  it('bands a finished application by its outcome, not by a date still on it', () => {
    const placement = urgencyBandFor(
      application('Ended Co', {
        state: 'accepted',
        state_history: [{ state: 'accepted', at: at(-2) }],
        deadline_at: at(1),
      }),
      today,
    )

    // Closed rather than due: the ranking never scores it, so a band that promised a date
    // order would be ordering rows nothing else ranks.
    expect(placement).toEqual({ band: 'closed', days: null })
  })
})

describe('band order', () => {
  it('runs from what is dated to what is finished', () => {
    expect(URGENCY_BANDS.map(({ id }) => id)).toEqual([
      'due',
      'undated',
      'outstanding',
      'closed',
    ])
    expect(bandRank('due')).toBeLessThan(bandRank('undated'))
    expect(bandRank('undated')).toBeLessThan(bandRank('outstanding'))
    expect(bandRank('outstanding')).toBeLessThan(bandRank('closed'))
  })

  it('gives every band a heading that states its own membership test', () => {
    expect(URGENCY_BANDS.every(({ heading }) => heading.trim().length > 0)).toBe(true)
    expect(new Set(URGENCY_BANDS.map(({ heading }) => heading)).size).toBe(URGENCY_BANDS.length)
  })
})
