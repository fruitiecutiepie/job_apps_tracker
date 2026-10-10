import { describe, expect, it } from 'vitest'

import { emptyCompensation, legacyStatus } from '../domain'
import type { Application, StateEvent, StateHistoryEntry } from '../domain'
import {
  advanced,
  daysToFirstReply,
  heardBack,
  median,
  replyWaits,
  sourceOutcomes,
  finishDurations,
  stageMoveKind,
  stageMoves,
  stagePassRates,
  weeklyActivity,
} from './outcomes'

const today = new Date(2026, 7, 14, 12)

function at(daysFromToday: number, hour = 9): string {
  const date = new Date(today)
  date.setHours(hour, 0, 0, 0)
  date.setDate(date.getDate() + daysFromToday)
  return date.toISOString()
}

/**
 * A history built from `[status, daysAgo]` pairs, oldest first. A status is written the way a
 * reader says it — `auto_rejected`, `recruiter_interview_rejected` — and read through the
 * same table that migrates old files, so the tables below stay one word per move.
 */
function history(entries: readonly (readonly [string, number])[]): StateHistoryEntry[] {
  return entries.map(([status, daysAgo]) => ({ ...legacyStatus(status)!, at: at(-daysAgo) }))
}

/** A move end written the way a reader says it, read through the migration's table. */
const status = (name: string) => legacyStatus(name)!

function application(
  company: string,
  entries: readonly (readonly [string, number])[],
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
    outcome: last?.outcome ?? 'active',
    state_history: trail,
    archived_at: null,
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
    posting: null,
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
      ['screening', 2],
    ])

    expect(daysToFirstReply(long)).toBe(5)
  })

  it('reads two moves on one day as no days, like every other span', () => {
    const sameDay = application('Fast Co', [])
    const trail: StateHistoryEntry[] = [
      { state: 'applied', outcome: 'active', at: at(-3, 9) },
      { state: 'applied', outcome: 'rejected', at: at(-3, 17) },
    ]

    expect(daysToFirstReply({ ...sameDay, state_history: trail })).toBe(0)
  })

  it('reads history in time order rather than trusting the stored order', () => {
    const scrambled = application('Jumbled Co', [])
    const trail: StateHistoryEntry[] = [
      { state: 'recruiter_messaged', outcome: 'active', at: at(-10) },
      { state: 'applied', outcome: 'active', at: at(-20) },
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
        ['round_2', 10],
      ])),
    ).toBe(true)
  })

  it('is false for a move backwards to an earlier live stage', () => {
    expect(
      advanced(application('Restarted Co', [
        ['screening', 20],
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

describe('source outcomes', () => {
  const applications = [
    application('A', [['applied', 20]], { source: 'LinkedIn' }),
    application('B', [['applied', 20], ['auto_rejected', 18]], { source: 'LinkedIn' }),
    application('C', [['applied', 20], ['screening', 10]], { source: 'LinkedIn' }),
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

describe('replyWaits', () => {
  it('measures each reply and counts the live applications still waiting', () => {
    const applications = [
      application('Silent Co', [['applied', 20]]),
      application('Quick Co', [['applied', 20], ['auto_rejected', 19]]),
      application('Slow Co', [['applied', 30], ['recruiter_messaged', 20]]),
      application('Middling Co', [['applied', 20], ['recruiter_messaged', 15]]),
    ]

    const waits = replyWaits(applications)
    expect([...waits.replied].sort((a, b) => a - b)).toEqual([1, 5, 10])
    expect(waits.waiting).toBe(1)
    // The silent one is absent from the median rather than counted as zero.
    expect(median(waits.replied)).toBe(5)
  })

  it('does not count a finished application as waiting', () => {
    const closed = application('Closed Co', [['no_openings', 5]])
    expect(replyWaits([closed]).waiting).toBe(0)
  })
})

describe('median', () => {
  it('takes the lower middle on an even count, so the figure is one something took', () => {
    // 2 and 10 days: 2, not 6, which no application waited.
    expect(median([10, 2])).toBe(2)
  })

  it('is null with nothing to measure', () => {
    expect(median([])).toBeNull()
  })
})

describe('stageMoves', () => {
  it('counts each consecutive pair of history entries as one move', () => {
    const applications = [
      application('One Co', [['applied', 20], ['screening', 10], ['round_1', 5]]),
      application('Two Co', [['applied', 20], ['screening', 12]]),
      application('Three Co', [['applied', 20], ['auto_rejected', 18]]),
    ]

    // In configured state order on both ends: Auto-rejected sits right after Applied.
    expect(stageMoves(applications)).toEqual([
      { from: status('applied'), to: status('auto_rejected'), count: 1 },
      { from: status('applied'), to: status('screening'), count: 2 },
      { from: status('screening'), to: status('round_1'), count: 1 },
    ])
  })

  it('counts a stage crossed twice as two moves, backwards included', () => {
    const revisited = application('Back Co', [
      ['screening', 30],
      ['applied', 20],
      ['screening', 10],
    ])

    expect(stageMoves([revisited])).toEqual([
      { from: status('applied'), to: status('screening'), count: 1 },
      { from: status('screening'), to: status('applied'), count: 1 },
    ])
  })

  it('reads history in time order, not in the order it was stored', () => {
    const shuffled = application('Shuffled Co', [], {
      state: 'screening',
      state_history: [
        { state: 'screening', outcome: 'active', at: at(-5) },
        { state: 'applied', outcome: 'active', at: at(-10) },
      ],
    })

    expect(stageMoves([shuffled])).toEqual([
      { from: status('applied'), to: status('screening'), count: 1 },
    ])
  })
})

describe('stageMoveKind', () => {
  it('calls a move further only when it lands on a later live stage', () => {
    expect(stageMoveKind({ from: status('applied'), to: status('round_1') })).toBe('further')
    expect(stageMoveKind({ from: status('round_1'), to: status('applied') })).toBe('other')
  })

  it('names a rejection as one, and a close without one as neither', () => {
    expect(stageMoveKind({ from: status('applied'), to: status('auto_rejected') })).toBe('rejected')
    // Accepted is the stage after Offer, so taking the job is going further.
    expect(stageMoveKind({ from: status('offer'), to: status('accepted') })).toBe('further')
    expect(stageMoveKind({ from: status('applied'), to: status('no_openings') })).toBe('other')
  })
})

describe('stagePassRates', () => {
  it('leaves the applications still in a stage out of its rate', () => {
    const rows = stagePassRates([
      application('Through Co', [['applied', 20], ['screening', 10]]),
      application('Stopped Co', [['applied', 20], ['auto_rejected', 15]]),
      application('Waiting Co', [['applied', 5]]),
    ])

    expect(rows.find((row) => row.state === 'applied')).toEqual({
      state: 'applied',
      decided: 2,
      passed: 1,
      pending: 1,
    })
  })

  it('counts a skipped stage as passing the one before it', () => {
    const skipped = application('Skipped Co', [['applied', 20], ['round_1', 10]])
    expect(stagePassRates([skipped])[0]).toEqual({ state: 'applied', decided: 1, passed: 1, pending: 0 })
  })

  it('does not count going back as passing, and counts accepting as passing Offer', () => {
    const rows = stagePassRates([
      application('Back Co', [['screening', 20], ['applied', 10]]),
      application('Hired Co', [['offer', 10], ['accepted', 5]]),
    ])

    expect(rows.find((row) => row.state === 'screening')).toMatchObject({ decided: 1, passed: 0 })
    expect(rows.find((row) => row.state === 'offer')).toMatchObject({ decided: 1, passed: 1 })
  })
})

describe('weeklyActivity', () => {
  it('counts starts and first replies in the local week they happened, Monday first', () => {
    // 14 August 2026 is a Friday, so this week began on Monday the 10th.
    const weeks = weeklyActivity(
      [
        application('This Week Co', [['applied', 4], ['recruiter_messaged', 1]]),
        application('Last Week Co', [['applied', 5]]),
        application('Old Co', [['applied', 200]]),
      ],
      today,
      3,
    )

    expect(weeks.map((week) => week.start.getDate())).toEqual([27, 3, 10])
    expect(weeks.map(({ started, replies }) => [started, replies])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ])
  })
})

describe('finishDurations', () => {
  it('times a rejection to the rejection and an offer to first reaching Offer', () => {
    expect(
      finishDurations([
        application('Turned Down Co', [['applied', 30], ['screening', 20], ['recruiter_interview_rejected', 10]]),
        application('Offered Co', [['applied', 40], ['offer', 5], ['accepted', 1]]),
        application('Live Co', [['applied', 10]]),
      ]),
    ).toEqual({ toRejection: [20], toOffer: [35] })
  })
})
