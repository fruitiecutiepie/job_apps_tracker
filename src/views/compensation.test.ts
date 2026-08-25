import { describe, expect, it } from 'vitest'

import { createDemoDocument, emptyCompensation } from '../domain'
import type { Application, Compensation, StateId } from '../domain'
import {
  compensationFigureFor,
  compensationGapFor,
  compensationSortValue,
  compensationText,
  describeCompensationGap,
  formatCompensationBand,
  matchesCompensationRange,
  type CompensationRangeFilter,
} from './compensation'
import { focusGroups } from './focusGroups'
import { rankByUrgency, urgencyFor } from './urgency'

const at = '2026-08-14T02:00:00.000Z'

type Amount = number | readonly [number, number]

interface Money {
  currency?: string
  advertised?: Amount
  expected?: Amount
  offered?: Amount
}

function band(amount: Amount) {
  return typeof amount === 'number'
    ? { min: amount, max: amount }
    : { min: amount[0], max: amount[1] }
}

function money({ currency = 'AUD', ...stages }: Money): Compensation {
  const record = emptyCompensation()
  for (const stage of ['advertised', 'expected', 'offered'] as const) {
    const amount = stages[stage]
    if (amount !== undefined) record[stage] = band(amount)
  }
  record.currency = Object.keys(stages).length > 0 ? currency : null
  return record
}

function application(compensation: Compensation, company = 'Fixture'): Application {
  const state: StateId = 'applied'
  return {
    id: `00000000-0000-7000-8000-${company.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(12, '0').slice(0, 12)}`,
    company,
    role: null,
    url: null,
    source: null,
    state,
    state_history: [{ state, at }],
    next_action: null,
    next_action_at: null,
    deadline_at: null,
    notes: null,
    completed_actions: [],
    stage_notes: [],
    state_events: [],
    attachments: [],
    ratings: [],
    compensation,
    created_at: at,
    updated_at: at,
  }
}

describe('compensationFigureFor', () => {
  it('prefers the offer over the posting, because that is the number that now applies', () => {
    const figure = compensationFigureFor(
      application(money({ advertised: [130_000, 150_000], offered: 152_000 })),
    )

    expect(figure).toEqual({
      stage: 'offered',
      band: { min: 152_000, max: 152_000 },
      currency: 'AUD',
    })
  })

  it('falls back to the posting when nothing has been offered yet', () => {
    expect(compensationFigureFor(application(money({ advertised: [130_000, 150_000] })))?.stage)
      .toBe('advertised')
  })

  it('ignores an expectation, because a target is not a figure anyone quoted', () => {
    // This is the whole reason the column can show a number and still sort last: what you
    // want is not what the job pays.
    const target = application(money({ expected: 190_000 }))

    expect(compensationFigureFor(target)).toBeNull()
    expect(compensationSortValue(target)).toBeNull()
    expect(compensationText(target)).toBe('AUD · Expected 190,000')
  })

  it('returns null for an empty record', () => {
    expect(compensationFigureFor(application(emptyCompensation()))).toBeNull()
    expect(compensationSortValue(application(emptyCompensation()))).toBeNull()
    expect(compensationText(application(emptyCompensation()))).toBe('')
  })

  it('sorts by the midpoint of the quoted band', () => {
    expect(compensationSortValue(application(money({ advertised: [130_000, 150_000] }))))
      .toBe(140_000)
    expect(compensationSortValue(application(money({ offered: 152_000 })))).toBe(152_000)
  })
})

describe('compensationGapFor', () => {
  it('is null without a target to measure against', () => {
    expect(compensationGapFor(application(money({ advertised: [130_000, 150_000] })))).toBeNull()
  })

  it('is null when there is a target but nothing was quoted', () => {
    expect(compensationGapFor(application(money({ expected: 150_000 })))).toBeNull()
  })

  it('measures a point value against a point target as the plain percentage', () => {
    const gap = compensationGapFor(application(money({ expected: 250_000, offered: 230_000 })))!

    expect(gap.verdict).toBe('below')
    expect(gap.difference).toBe(-20_000)
    expect(gap.share).toBeCloseTo(-0.08, 10)
    expect(describeCompensationGap(gap)).toBe('8% below target')
  })

  it('reports a band that reaches into the target as undecided rather than short', () => {
    // 120,000-140,000 against a 135,000 target is not short: it might land either side, and
    // calling it "4% below" from the midpoint would be a policy pretending to be a fact.
    const gap = compensationGapFor(application(money({ advertised: [120_000, 140_000], expected: 135_000 })))!

    expect(gap.verdict).toBe('within')
    expect(gap.difference).toBe(0)
    expect(gap.share).toBe(0)
    expect(describeCompensationGap(gap)).toBe('within target')
  })

  it('measures from the nearest ends, so only a guaranteed gap is reported', () => {
    const below = compensationGapFor(application(money({ advertised: [100_000, 115_000], expected: 130_000 })))!
    expect(below.verdict).toBe('below')
    expect(below.difference).toBe(-15_000)
    expect(describeCompensationGap(below)).toBe('12% below target')

    const above = compensationGapFor(application(money({ expected: [180_000, 200_000], offered: 215_000 })))!
    expect(above.verdict).toBe('above')
    expect(above.difference).toBe(15_000)
    expect(describeCompensationGap(above)).toBe('8% above target')
  })

  it('treats a gap too small to round to a percent as a direction rather than zero', () => {
    // "0% above target" would read as on target, which is the one thing it is not.
    const gap = compensationGapFor(application(money({ expected: 200_000, offered: 200_100 })))!

    expect(gap.verdict).toBe('above')
    expect(describeCompensationGap(gap)).toBe('just above target')
  })

  it('compares the offer once one exists, not the posting it replaced', () => {
    const gap = compensationGapFor(
      application(money({ advertised: [230_000, 260_000], expected: 250_000, offered: 230_000 })),
    )!

    expect(gap.figure.stage).toBe('offered')
    expect(describeCompensationGap(gap)).toBe('8% below target')
  })
})

describe('formatCompensationBand', () => {
  it('shows one number for a point value and both ends for a band', () => {
    expect(formatCompensationBand({ min: 152_000, max: 152_000 })).toBe('152,000')
    expect(formatCompensationBand({ min: 130_000, max: 150_000 })).toBe('130,000–150,000')
  })
})

describe('compensationText', () => {
  it('states the currency once, then the progression, then the gap', () => {
    expect(
      compensationText(
        application(money({ advertised: [180_000, 210_000], expected: 200_000, offered: 215_000 })),
      ),
    ).toBe('AUD · Advertised 180,000–210,000 · Expected 200,000 · Offered 215,000 · 8% above target')
  })

  it('omits the gap when there is nothing to compare', () => {
    expect(compensationText(application(money({ advertised: [110_000, 125_000] })))).toBe(
      'AUD · Advertised 110,000–125,000',
    )
  })
})

describe('demo coverage', () => {
  it('exercises every verdict and both ways a comparison can be missing', () => {
    // The equivalent of the Focus test that asserts no group empties out: if a seed's numbers
    // are retuned, one of these cell shapes silently stops being visible in the demo.
    const document = createDemoDocument(new Date('2026-08-14T02:00:00.000Z'))
    const verdicts = document.applications.map(
      (application) => compensationGapFor(application)?.verdict ?? 'none',
    )

    expect(new Set(verdicts)).toEqual(new Set(['above', 'within', 'below', 'none']))
    // A target with nothing quoted against it, and a quote with no target.
    expect(
      document.applications.some(
        (application) =>
          compensationFigureFor(application) === null
          && application.compensation.expected !== null,
      ),
    ).toBe(true)
    expect(
      document.applications.some(
        (application) =>
          compensationFigureFor(application) !== null
          && application.compensation.expected === null,
      ),
    ).toBe(true)
    // More than one currency, so the column's currency-blind sort is visible in the demo.
    expect(
      new Set(
        document.applications.flatMap((application) =>
          application.compensation.currency ? [application.compensation.currency] : [],
        ),
      ).size,
    ).toBeGreaterThan(1)
  })
})

describe('compensation and the other rankings', () => {
  it('never changes urgency, ranking, or Focus placement', () => {
    // The same rule ratings live under, for the same reason: urgency already carries a stage
    // factor, and a second factor compounds until a deadline today loses to one next week
    // that happens to pay better. Pay is a separate axis and stays one.
    const today = new Date(2026, 7, 14, 12)
    const plain = application(emptyCompensation(), 'Plain Co')
    const paid = {
      ...plain,
      compensation: money({ advertised: [500_000, 600_000], expected: 100_000 }),
    }

    expect(urgencyFor(paid, today)).toEqual({ ...urgencyFor(plain, today)!, application: paid })
    expect(rankByUrgency([paid], today).map(({ score, reason }) => [score, reason])).toEqual(
      rankByUrgency([plain], today).map(({ score, reason }) => [score, reason]),
    )
    expect(
      focusGroups([paid], today).map(({ id, rows }) => [id, rows.map(({ reason }) => reason)]),
    ).toEqual(
      focusGroups([plain], today).map(({ id, rows }) => [id, rows.map(({ reason }) => reason)]),
    )
  })
})

describe('matchesCompensationRange', () => {
  function range(overrides: Partial<CompensationRangeFilter> = {}): CompensationRangeFilter {
    return { stage: 'any', min: '', max: '', ...overrides }
  }

  it('matches everything when neither bound is set, whatever the stage', () => {
    expect(matchesCompensationRange(application(emptyCompensation()), range())).toBe(true)
    expect(
      matchesCompensationRange(
        application(money({ advertised: [100_000, 120_000] })),
        range({ stage: 'offered' }),
      ),
    ).toBe(true)
  })

  it('treats the range as overlap, not containment', () => {
    const overlapping = application(money({ advertised: [100_000, 120_000] }))
    expect(
      matchesCompensationRange(overlapping, range({ stage: 'advertised', min: '110000', max: '200000' })),
    ).toBe(true)
    expect(
      matchesCompensationRange(overlapping, range({ stage: 'advertised', min: '130000' })),
    ).toBe(false)
  })

  it('reads one open bound as at-least or at-most rather than requiring both', () => {
    const posting = application(money({ advertised: [100_000, 120_000] }))
    expect(matchesCompensationRange(posting, range({ stage: 'advertised', min: '90000' }))).toBe(true)
    expect(matchesCompensationRange(posting, range({ stage: 'advertised', min: '150000' }))).toBe(false)
    expect(matchesCompensationRange(posting, range({ stage: 'advertised', max: '150000' }))).toBe(true)
    expect(matchesCompensationRange(posting, range({ stage: 'advertised', max: '90000' }))).toBe(false)
  })

  it('scopes to the named stage, so the right number in the wrong stage does not match', () => {
    const offer = application(money({ offered: 115_000 }))
    expect(matchesCompensationRange(offer, range({ stage: 'advertised', min: '100000', max: '120000' })))
      .toBe(false)
    expect(matchesCompensationRange(offer, range({ stage: 'offered', min: '100000', max: '120000' })))
      .toBe(true)
    // "any" checks every stage, so the same query catches it without picking one out.
    expect(matchesCompensationRange(offer, range({ min: '100000', max: '120000' }))).toBe(true)
  })

  it('has nothing to match against a stage the application never recorded', () => {
    const advertisedOnly = application(money({ advertised: [100_000, 120_000] }))
    expect(matchesCompensationRange(advertisedOnly, range({ stage: 'offered', min: '100000' })))
      .toBe(false)
  })

  it('treats unparseable text as an unset bound rather than a bound of zero', () => {
    // A half-typed box should not hide every row while the rest of the number is entered.
    const posting = application(money({ advertised: [100_000, 120_000] }))
    expect(matchesCompensationRange(posting, range({ stage: 'advertised', min: 'abc' }))).toBe(true)
  })
})
