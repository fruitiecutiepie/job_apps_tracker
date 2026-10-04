import { describe, expect, it } from 'vitest'

import {
  answeringAnswer,
  durationsAnswer,
  ghostingAnswer,
  losingAnswer,
  momentumAnswer,
  rankSources,
  replyBuckets,
  sourcesAnswer,
} from './statsAnswers'
import type { WeekActivity } from './outcomes'

function week(started: number, replies = 0): WeekActivity {
  return { start: new Date(2026, 7, 10), started, replies }
}

describe('the answers', () => {
  it('says the same day rather than within 0 days', () => {
    expect(answeringAnswer(2, { replied: [0, 0], waiting: 0 })).toBe(
      '2 of 2 heard back. Half of them the same day.',
    )
    expect(answeringAnswer(3, { replied: [], waiting: 3 })).toBe('Nobody has replied yet.')
  })

  it('buckets reply waits without losing one at a boundary', () => {
    const buckets = replyBuckets({ replied: [0, 6, 7, 13, 14, 29, 30, 90], waiting: 0 })
    expect(buckets.map((bucket) => bucket.count)).toEqual([2, 2, 2, 2])
  })

  it('agrees with itself about one and many', () => {
    expect(ghostingAnswer([], 1)).toBe('Nothing live has gone 1 day without a stage change.')
  })

  it('says nothing has stalled rather than naming a stage that lost nothing', () => {
    const rows = [{ state: 'applied' as const, decided: 5, passed: 5, pending: 0 }]
    expect(losingAnswer(rows, 5)).toEqual({
      answer: 'Nothing has stalled yet: every decided application got past its stage.',
      worst: null,
    })
  })

  it('names the earliest stage when two lose at the same rate', () => {
    const rows = [
      { state: 'applied' as const, decided: 6, passed: 3, pending: 0 },
      { state: 'interview_1' as const, decided: 6, passed: 3, pending: 0 },
    ]
    expect(losingAnswer(rows, 5).worst).toBe('applied')
  })

  it('will not rank a source on one lucky application', () => {
    const ranked = rankSources(
      [
        { source: 'Big', total: 6, heardBack: 4, advanced: 2 },
        { source: 'Lucky', total: 1, heardBack: 1, advanced: 1 },
        { source: 'Middling', total: 4, heardBack: 3, advanced: 2 },
      ],
      3,
    )
    expect(ranked.comparable.map((row) => row.source)).toEqual(['Middling', 'Big'])
    expect(ranked.tooFew.map((row) => row.source)).toEqual(['Lucky'])
    expect(sourcesAnswer(ranked, 3)).toBe('Middling got furthest: 2 of 4 past the first stage.')
  })

  it('reads this week against the four before it', () => {
    expect(momentumAnswer([week(1), week(2), week(4), week(3), week(2, 1)])).toBe(
      'This week: 2 applications, 1 reply. The 4 weeks before averaged 2.5 a week.',
    )
    expect(momentumAnswer([week(0), week(0), week(0), week(0), week(0)])).toBe(
      'No new applications in the last 5 weeks.',
    )
  })

  it('switches from listing durations to a median once there are enough', () => {
    expect(durationsAnswer({ toOffer: [41, 34], toRejection: [] })).toBe('Your 2 offers took 34 and 41 days.')
    expect(durationsAnswer({ toOffer: [], toRejection: [3, 9, 12, 20, 40] })).toBe(
      'Rejections took 12 days at the median.',
    )
  })
})
