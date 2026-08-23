import { describe, expect, it } from 'vitest'

import { emptyCompensation, RATING_IDS } from '../domain'
import type { Application, Rating, RatingDimensionId, StateId } from '../domain'
import { focusGroups, type FocusGroupId } from './focusGroups'
import {
  DEFAULT_RATING_WEIGHTS,
  MAX_UNKNOWN_DISCOUNT,
  preferenceFor,
  type RatingWeights,
} from './preference'
import { rankByUrgency, urgencyFor } from './urgency'

const at = '2026-08-14T02:00:00.000Z'

/** Omit a dimension for never-assessed; give it null for an explicit "don't know". */
type Scores = Partial<Record<RatingDimensionId, number | null>>

function ratings(scores: Scores): Rating[] {
  return RATING_IDS.flatMap((dimension) =>
    dimension in scores
      ? [{ dimension, score: scores[dimension] ?? null, created_at: at, updated_at: at }]
      : [],
  )
}

function application(scores: Scores): Application {
  const state: StateId = 'applied'
  return {
    id: '00000000-0000-7000-8000-000000000001',
    company: 'Fixture',
    role: null,
    url: null,
    source: null,
    state,
    state_history: [{ state, at }],
    next_action: null,
    next_action_at: null,
    deadline_at: null,
    notes: null,
    stage_notes: [],
    state_events: [],
    attachments: [],
    ratings: ratings(scores),
    compensation: emptyCompensation(),
    created_at: at,
    updated_at: at,
  }
}

function score(scores: Scores, weights?: RatingWeights): number | null {
  return preferenceFor(application(scores), weights)?.score ?? null
}

describe('preferenceFor', () => {
  it('returns null when nothing has been judged', () => {
    expect(preferenceFor(application({}))).toBeNull()
  })

  it('returns null when every dimension is an explicit unknown', () => {
    // "Asked and cannot tell" across the board is still nothing to rank on.
    expect(preferenceFor(application({ work: null, growth: null, people: null, company: null })))
      .toBeNull()
  })

  it('scores a fully judged application as the plain mean', () => {
    expect(score({ work: 4, growth: 4, people: 4, company: 4 })).toBe(4)
    expect(score({ work: 5, growth: 5, people: 4, company: 4 })).toBe(4.5)
  })

  it('discounts by weight share of what is missing', () => {
    // One of four rated: discount = 0.75 * 3/4 = 0.5625
    expect(score({ work: 5 })).toBeCloseTo(4.4375, 10)
    // Three rated, one unknown: discount = 0.75 * 1/4 = 0.1875
    expect(score({ work: 5, growth: 5, people: 5, company: null })).toBeCloseTo(4.8125, 10)
  })

  it('scores an unknown and an unrated dimension identically but reports them apart', () => {
    const unknown = preferenceFor(application({ work: 4, growth: 4, people: 4, company: null }))!
    const unrated = preferenceFor(application({ work: 4, growth: 4, people: 4 }))!

    expect(unknown.score).toBe(unrated.score)
    expect(unknown.unknown).toEqual(['company'])
    expect(unknown.unrated).toEqual([])
    expect(unrated.unknown).toEqual([])
    expect(unrated.unrated).toEqual(['company'])
  })

  it('ranks a blind spot below the same score fully known', () => {
    const known = score({ work: 4, growth: 4, people: 4, company: 4 })!
    const blind = score({ work: 4, growth: 4, people: 4, company: null })!
    const missing = score({ work: 4, growth: 4, people: 4 })!

    expect(blind).toBeLessThan(known)
    expect(missing).toBeLessThan(known)
  })

  it('holds the bound mean - MAX < score <= mean for every combination', () => {
    const values: (number | null)[] = [null, 1, 3, 5]
    let checked = 0

    for (const work of [undefined, ...values]) {
      for (const growth of [undefined, ...values]) {
        for (const people of [undefined, ...values]) {
          for (const company of [undefined, ...values]) {
            const scores = { work, growth, people, company } as Scores
            const result = preferenceFor(application(scores))
            if (result === null) continue

            const rated = RATING_IDS.map((d) => scores[d]).filter(
              (value): value is number => typeof value === 'number',
            )
            const mean = rated.reduce((sum, value) => sum + value, 0) / rated.length

            expect(result.score).toBeLessThanOrEqual(mean + Number.EPSILON)
            expect(result.score).toBeGreaterThan(mean - MAX_UNKNOWN_DISCOUNT)
            checked++
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(500)
  })

  it('holds the same bound when the dimension set grows', () => {
    // The discount is a weight share, so more dimensions cannot widen it past the bound.
    const sparse = { work: 5 }
    const wide: RatingWeights = { work: 1, growth: 1, people: 1, company: 1 }
    const heavier = { ...wide, growth: 3, people: 3, company: 3 } as RatingWeights

    expect(score(sparse, wide)!).toBeGreaterThan(5 - MAX_UNKNOWN_DISCOUNT)
    expect(score(sparse, heavier)!).toBeGreaterThan(5 - MAX_UNKNOWN_DISCOUNT)
  })

  it('lets a smaller mean win when the larger one is mostly unknown', () => {
    // Deliberate and asserted so nobody "fixes" it: the fully known application is safer.
    const partial = score({ work: 5 })!
    const complete = score({ work: 5, growth: 5, people: 4, company: 4 })!

    expect(partial).toBeCloseTo(4.4375, 10)
    expect(complete).toBe(4.5)
    expect(complete).toBeGreaterThan(partial)
  })

  it('never overturns a mean gap of the full discount', () => {
    const low = score({ work: 4, growth: 4, people: 4, company: 4 })!
    const highButSparse = score({ work: 5 })!

    expect(4.75 - 4).toBeGreaterThanOrEqual(MAX_UNKNOWN_DISCOUNT)
    expect(score({ work: 5, growth: 5, people: 5, company: 4 })!).toBeGreaterThan(low)
    expect(highButSparse).toBeGreaterThan(low - MAX_UNKNOWN_DISCOUNT)
  })

  it('surfaces the weakest judgement so a mean cannot hide a dealbreaker', () => {
    const dealbreaker = preferenceFor(application({ work: 5, growth: 5, people: 5, company: 1 }))!
    const even = preferenceFor(application({ work: 4, growth: 4, people: 4, company: 4 }))!

    expect(dealbreaker.score).toBe(4)
    expect(even.score).toBe(4)
    expect(dealbreaker.lowest).toEqual({ dimension: 'company', score: 1 })
    expect(even.lowest).toEqual({ dimension: 'work', score: 4 })
  })

  it('breaks a lowest tie by configured dimension order', () => {
    const result = preferenceFor(application({ work: 2, growth: 2, people: 5, company: 5 }))!

    expect(result.lowest).toEqual({ dimension: 'work', score: 2 })
  })

  it('ignores an unknown when choosing the lowest', () => {
    const result = preferenceFor(application({ work: 3, growth: null }))!

    expect(result.lowest).toEqual({ dimension: 'work', score: 3 })
  })

  describe('weights', () => {
    const ignorePeople: RatingWeights = { ...DEFAULT_RATING_WEIGHTS, people: 0 }

    it('charges nothing for a gap in a dimension weighted zero', () => {
      const gap = score({ work: 4, growth: 4, company: 4 }, ignorePeople)
      const filled = score({ work: 4, growth: 4, people: 1, company: 4 }, ignorePeople)

      expect(gap).toBe(4)
      expect(filled).toBe(4)
      // A count-share discount would have charged 0.1875 for the same gap.
      expect(score({ work: 4, growth: 4, company: 4 })).toBeCloseTo(3.8125, 10)
    })

    it('keeps a zero-weighted dimension out of the lowest', () => {
      const result = preferenceFor(
        application({ work: 4, growth: 4, people: 1, company: 4 }),
        ignorePeople,
      )!

      expect(result.lowest).toEqual({ dimension: 'work', score: 4 })
    })

    it('returns null when only zero-weighted dimensions are judged', () => {
      expect(preferenceFor(application({ people: 5 }), ignorePeople)).toBeNull()
      // Still honest about what it saw, so a caller cannot claim nothing was assessed.
      const seen = preferenceFor(application({ people: 5 }))!
      expect(seen.unrated).toEqual(['work', 'growth', 'company'])
    })

    it('clamps a negative or non-finite weight to zero', () => {
      const negative = { ...DEFAULT_RATING_WEIGHTS, work: -1 } as RatingWeights
      const result = preferenceFor(application({ growth: 5 }), negative)!

      // With work clamped out, three dimensions carry weight and one of them is rated.
      expect(result.score).toBeGreaterThan(5 - MAX_UNKNOWN_DISCOUNT)
      expect(result.score).toBeLessThanOrEqual(5)
      expect(Number.isNaN(result.score)).toBe(false)

      const broken = { work: Number.NaN, growth: 1, people: 1, company: 1 } as RatingWeights
      expect(preferenceFor(application({ growth: 4 }), broken)!.score).toBeGreaterThan(
        4 - MAX_UNKNOWN_DISCOUNT,
      )
    })

    it('returns null and never NaN when every weight is zero', () => {
      const none: RatingWeights = { work: 0, growth: 0, people: 0, company: 0 }

      expect(preferenceFor(application({ work: 5, growth: 5 }), none)).toBeNull()
    })
  })
})
describe('separation from urgency', () => {
  // Preference is a different axis. Folding it in inverts urgency: urgency already carries a
  // stage factor, so a second factor compounds and a deadline today on a poorly rated
  // application loses to one ten days out that happens to be rated well.
  const today = new Date(2026, 7, 14, 12)

  function dated(daysFromToday: number, scores: Scores): Application {
    const deadline = new Date(today)
    deadline.setHours(17, 0, 0, 0)
    deadline.setDate(deadline.getDate() + daysFromToday)
    return { ...application(scores), deadline_at: deadline.toISOString() }
  }

  it('leaves the urgency score and reason untouched', () => {
    const unrated = dated(0, {})
    const loved = dated(0, { work: 5, growth: 5, people: 5, company: 5 })
    const loathed = dated(0, { work: 1, growth: 1, people: 1, company: 1 })

    expect(urgencyFor(loved, today)).toEqual({ ...urgencyFor(unrated, today)!, application: loved })
    expect(urgencyFor(loathed, today)).toEqual({
      ...urgencyFor(unrated, today)!,
      application: loathed,
    })
  })

  it('keeps a deadline today ahead of one ten days out however they are rated', () => {
    const urgentButLoathed = dated(0, { work: 1, growth: 1, people: 1, company: 1 })
    const distantButLoved = dated(10, { work: 5, growth: 5, people: 5, company: 5 })
    const ranked = rankByUrgency([distantButLoved, urgentButLoathed], today)

    expect(ranked[0]!.application).toBe(urgentButLoathed)
    expect(preferenceFor(urgentButLoathed)!.score).toBeLessThan(
      preferenceFor(distantButLoved)!.score,
    )
  })

  it('leaves Focus placement and row reason untouched', () => {
    const unrated = dated(0, {})
    const loathed = dated(0, { work: 1, growth: 1, people: 1, company: 1 })

    const before = focusGroups([unrated], today).map(({ id, rows }) => [
      id,
      rows.map(({ reason }) => reason),
    ])
    const after = focusGroups([loathed], today).map(({ id, rows }) => [
      id,
      rows.map(({ reason }) => reason),
    ])

    expect(after).toEqual(before)
  })
})

describe('focus ordering', () => {
  // Preference is appended to the end of the within-group chain, so it decides only where a
  // group's own rule and the urgency score have already tied. Everything here is built to
  // tie deliberately, because in real data the tiebreak is invisible until enough
  // applications are rated.
  const today = new Date(2026, 7, 14, 12)

  function at(daysFromToday: number, hour = 9): string {
    const date = new Date(today)
    date.setHours(hour, 0, 0, 0)
    date.setDate(date.getDate() + daysFromToday)
    return date.toISOString()
  }

  /** Distinct ids that sort in company order, so the id fallback is visible when it wins. */
  function row(company: string, id: string, scores: Scores, deadline: string): Application {
    return {
      ...application(scores),
      id: `00000000-0000-7000-8000-00000000000${id}`,
      company,
      state_history: [{ state: 'applied', at: at(-1) }],
      updated_at: at(-1),
      deadline_at: deadline,
    }
  }

  function companiesIn(applications: Application[], id: FocusGroupId): string[] {
    const group = focusGroups(applications, today).find((candidate) => candidate.id === id)!
    return group.rows.map(({ application: item }) => item.company)
  }

  const loved: Scores = { work: 5, growth: 5, people: 5, company: 5 }
  const loathed: Scores = { work: 2, growth: 2, people: 2, company: 2 }

  it('breaks an exact tie by preference, and by id when nothing is rated', () => {
    const deadline = at(3, 17)
    const rated = [
      row('Aardvark', '1', loathed, deadline),
      row('Zebra', '2', loved, deadline),
    ]
    const unrated = [row('Aardvark', '1', {}, deadline), row('Zebra', '2', {}, deadline)]

    // Same state, same silence, the same deadline timestamp: the urgency score is identical
    // and the ranking would otherwise fall through to the id.
    expect(companiesIn(unrated, 'due_week')).toEqual(['Aardvark', 'Zebra'])
    expect(companiesIn(rated, 'due_week')).toEqual(['Zebra', 'Aardvark'])
  })

  it('keeps an unrated application above nothing but below a judged tie', () => {
    // Unrated is not the same as rated badly, so a null sorts last among tied rows rather
    // than below the worst score — the treatment the table's Preference column gives it.
    const deadline = at(3, 17)
    const applications = [
      row('Aardvark', '1', {}, deadline),
      row('Zebra', '2', loathed, deadline),
    ]

    expect(companiesIn(applications, 'due_week')).toEqual(['Zebra', 'Aardvark'])
  })

  it('never lets preference reorder a schedule', () => {
    // The group's own rule comes first: a date always beats a rating.
    const applications = [
      row('Loathed Sooner', '1', loathed, at(1, 17)),
      row('Loved Later', '2', loved, at(5, 17)),
    ]

    expect(companiesIn(applications, 'due_week')).toEqual(['Loathed Sooner', 'Loved Later'])
  })

  it('keeps an alphabetical group alphabetical', () => {
    const undated = (company: string, id: string, scores: Scores): Application => ({
      ...row(company, id, scores, at(3, 17)),
      deadline_at: null,
      next_action: 'Review the posting',
    })

    expect(companiesIn([undated('Zebra', '2', loved), undated('Aardvark', '1', loathed)], 'no_date'))
      .toEqual(['Aardvark', 'Zebra'])
  })
})
