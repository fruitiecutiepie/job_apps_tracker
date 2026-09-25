import { describe, expect, it } from 'vitest'

import { emptyCompensation } from '../domain'
import type { Application, StateEvent, StateId } from '../domain'
import {
  advanced,
  daysToFirstReply,
  furthestLiveState,
  heardBack,
  outcomeSummary,
  sourceOutcomes,
  stageOutcomes,
} from './outcomes'

const today = new Date(2026, 7, 14, 12)

function at(daysFromToday: number, hour = 9): string {
  const date = new Date(today)
  date.setHours(hour, 0, 0, 0)
  date.setDate(date.getDate() + daysFromToday)
  return date.toISOString()
}

/** A history built from `[state, daysAgo]` pairs, oldest first. */
function history(entries: readonly (readonly [StateId, number])[]) {
  return entries.map(([state, daysAgo]) => ({ state, at: at(-daysAgo) }))
}

function application(
  company: string,
  entries: readonly (readonly [StateId, number])[],
  overrides: Partial<Application> = {},
): Application {
  const trail = history(entries)
  // Tolerates an empty list so a test can supply an out-of-order or single-entry history
  // of its own through `overrides` without the helper deriving state from nothing.
  const last = trail.at(-1)
  return {
    id: `00000000-0000-7000-8000-${company.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(12, '0').slice(0, 12)}`,
    company,
    role: null,
    url: null,
    source: null,
    state: last?.state ?? 'applied',
    state_history: trail,
    next_action: null,
    next_action_at: null,
    deadline_at: null,
    notes: null,
    compensation: emptyCompensation(),
    ratings: [],
    stage_notes: [],
    state_events: [] as StateEvent[],
    correspondence: [],
    completed_actions: [],
    attachments: [],
    created_at: trail[0]?.at ?? at(0),
    updated_at: last?.at ?? at(0),
    ...overrides,
  }
}

describe('hearing back', () => {
  it('is false while nothing has been recorded since the application was filed', () => {
    expect(heardBack(application('Silent Co', [['applied', 20]]))).toBe(false)
    expect(daysToFirstReply(application('Silent Co', [['applied', 20]]))).toBeNull()
  })

  it('counts a rejection, because a rejection is a reply', () => {
    const rejected = application('Turned Down Co', [
      ['applied', 20],
      ['auto_rejected', 18],
    ])

    expect(heardBack(rejected)).toBe(true)
    expect(daysToFirstReply(rejected)).toBe(2)
  })

  it('measures to the first reply, not to the most recent move', () => {
    const long = application('Slow Co', [
      ['applied', 30],
      ['recruiter_messaged', 25],
      ['recruiter_interview', 2],
    ])

    expect(daysToFirstReply(long)).toBe(5)
  })

  it('reads two moves on one day as no days, like every other span', () => {
    const sameDay = application('Fast Co', [])
    const trail = [
      { state: 'applied' as StateId, at: at(-3, 9) },
      { state: 'auto_rejected' as StateId, at: at(-3, 17) },
    ]

    expect(daysToFirstReply({ ...sameDay, state_history: trail })).toBe(0)
  })

  it('reads history in time order rather than trusting the stored order', () => {
    const scrambled = application('Jumbled Co', [])
    const trail = [
      { state: 'recruiter_messaged' as StateId, at: at(-10) },
      { state: 'applied' as StateId, at: at(-20) },
    ]

    expect(daysToFirstReply({ ...scrambled, state_history: trail })).toBe(10)
  })
})

describe('advancing', () => {
  it('is false for an application that only ever got rejected', () => {
    const rejected = application('Turned Down Co', [
      ['applied', 20],
      ['auto_rejected', 18],
    ])

    expect(heardBack(rejected)).toBe(true)
    // Hearing back is not the same as getting anywhere, which is why both are counted.
    expect(advanced(rejected)).toBe(false)
  })

  it('is true for a move to a later live stage, including one that skips stages', () => {
    expect(
      advanced(application('Leapt Co', [
        ['applied', 20],
        ['interview_2', 10],
      ])),
    ).toBe(true)
  })

  it('is false for a move backwards to an earlier live stage', () => {
    expect(
      advanced(application('Restarted Co', [
        ['recruiter_interview', 20],
        ['applied', 10],
      ])),
    ).toBe(false)
  })

  it('does not count reaching an ending that is not a live stage', () => {
    expect(
      advanced(application('Closed Co', [
        ['applied', 20],
        ['no_openings', 10],
      ])),
    ).toBe(false)
  })
})

describe('the furthest live stage reached', () => {
  it('is the latest in live order, not the last recorded', () => {
    expect(
      furthestLiveState(application('Wound Back Co', [
        ['applied', 30],
        ['interview_1', 20],
        ['applied', 10],
      ])),
    ).toBe('interview_1')
  })

  it('ignores rejected states, which are not stages of their own', () => {
    expect(
      furthestLiveState(application('Turned Down Co', [
        ['applied', 30],
        ['recruiter_interview', 20],
        ['recruiter_interview_rejected', 10],
      ])),
    ).toBe('recruiter_interview')
  })

  it('is null for an application that has only ever been rejected', () => {
    const trail = [{ state: 'auto_rejected' as StateId, at: at(-5) }]
    expect(
      furthestLiveState({ ...application('Filed Closed Co', []), state_history: trail }),
    ).toBeNull()
  })
})

describe('stage outcomes', () => {
  const applications = [
    application('Waiting Co', [['applied', 20]]),
    application('Also Waiting Co', [['applied', 18]]),
    application('Bounced Co', [
      ['applied', 30],
      ['auto_rejected', 28],
    ]),
    application('Talking Co', [
      ['applied', 25],
      ['recruiter_interview', 12],
    ]),
    application('Nearly Co', [
      ['applied', 40],
      ['recruiter_interview', 30],
      ['recruiter_interview_rejected', 20],
    ]),
  ]

  it('counts reaching a stage apart from sitting in it and apart from ending there', () => {
    expect(stageOutcomes(applications)).toEqual([
      { state: 'applied', reached: 5, here: 2, ended: 1 },
      { state: 'recruiter_interview', reached: 2, here: 1, ended: 1 },
    ])
  })

  it('leaves out a stage nothing has reached rather than printing a row of zeros', () => {
    expect(stageOutcomes(applications).map(({ state }) => state)).not.toContain('offer')
  })

  it('orders rows by live stage, not by how many reached them', () => {
    expect(stageOutcomes(applications).map(({ state }) => state)).toEqual([
      'applied',
      'recruiter_interview',
    ])
  })

  it('counts a stage once for an application that passed through it twice', () => {
    const revisited = [
      application('Back Again Co', [
        ['applied', 30],
        ['recruiter_interview', 20],
        ['applied', 10],
      ]),
    ]

    expect(stageOutcomes(revisited)).toEqual([
      { state: 'applied', reached: 1, here: 1, ended: 0 },
      { state: 'recruiter_interview', reached: 1, here: 0, ended: 0 },
    ])
  })

  it('accounts for every application exactly once across here and ended', () => {
    const rows = stageOutcomes(applications)
    const here = rows.reduce((sum, row) => sum + row.here, 0)
    const ended = rows.reduce((sum, row) => sum + row.ended, 0)

    expect(here + ended).toBe(applications.length)
  })
})

describe('source outcomes', () => {
  const applications = [
    application('A', [['applied', 20]], { source: 'LinkedIn' }),
    application('B', [['applied', 20], ['auto_rejected', 18]], { source: 'LinkedIn' }),
    application('C', [['applied', 20], ['recruiter_interview', 10]], { source: 'LinkedIn' }),
    application('D', [['applied', 20], ['offer', 5]], { source: 'Referral' }),
    application('E', [['applied', 20]], { source: null }),
  ]

  it('separates hearing back from getting somewhere, per source', () => {
    expect(sourceOutcomes(applications)).toEqual([
      { source: 'LinkedIn', total: 3, heardBack: 2, advanced: 1 },
      { source: 'Referral', total: 1, heardBack: 1, advanced: 1 },
      { source: null, total: 1, heardBack: 0, advanced: 0 },
    ])
  })

  it('keeps the busiest source first and the unrecorded one last', () => {
    expect(sourceOutcomes(applications).map(({ source }) => source)).toEqual([
      'LinkedIn',
      'Referral',
      null,
    ])
  })

  it('treats a blank source as no source rather than as its own', () => {
    const blanks = [
      application('F', [['applied', 5]], { source: '   ' }),
      application('G', [['applied', 5]], { source: null }),
    ]

    expect(sourceOutcomes(blanks)).toEqual([
      { source: null, total: 2, heardBack: 0, advanced: 0 },
    ])
  })

  it('does not fold two spellings of one source together', () => {
    const spellings = [
      application('H', [['applied', 5]], { source: 'LinkedIn' }),
      application('I', [['applied', 5]], { source: 'linkedin' }),
    ]

    expect(sourceOutcomes(spellings)).toHaveLength(2)
  })
})

describe('the summary as a whole', () => {
  it('reports zeros and nulls for an empty collection rather than throwing', () => {
    expect(outcomeSummary([])).toEqual({
      total: 0,
      live: 0,
      heardBack: 0,
      advanced: 0,
      medianDaysToFirstReply: null,
      stages: [],
      sources: [],
    })
  })

  it('takes the median over the applications that have a reply to measure', () => {
    const applications = [
      application('Silent Co', [['applied', 20]]),
      application('Quick Co', [['applied', 20], ['auto_rejected', 19]]),
      application('Slow Co', [['applied', 30], ['recruiter_messaged', 20]]),
      application('Middling Co', [['applied', 20], ['recruiter_messaged', 15]]),
    ]

    // 1, 5 and 10 days; the silent one is absent rather than counted as zero.
    expect(outcomeSummary(applications).medianDaysToFirstReply).toBe(5)
  })

  it('takes the lower middle on an even count, so the figure is one something took', () => {
    const applications = [
      application('Quick Co', [['applied', 20], ['auto_rejected', 18]]),
      application('Slow Co', [['applied', 30], ['recruiter_messaged', 20]]),
    ]

    // 2 and 10 days: 2, not 6, which no application waited.
    expect(outcomeSummary(applications).medianDaysToFirstReply).toBe(2)
  })

  it('counts live separately from heard back, which overlap but are not the same', () => {
    const summary = outcomeSummary([
      application('Waiting Co', [['applied', 20]]),
      application('Talking Co', [['applied', 25], ['recruiter_interview', 12]]),
      application('Bounced Co', [['applied', 30], ['auto_rejected', 28]]),
    ])

    expect(summary).toMatchObject({ total: 3, live: 2, heardBack: 2, advanced: 1 })
  })
})
