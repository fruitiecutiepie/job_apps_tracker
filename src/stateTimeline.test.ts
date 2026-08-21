import { describe, expect, it } from 'vitest'

import { formatSpan, stateTimeline } from './stateTimeline'

const at = (day: number, hour = 9) =>
  new Date(2026, 2, day, hour).toISOString()

describe('stateTimeline', () => {
  it('labels each entry from the state configuration, oldest first', () => {
    const entries = stateTimeline(
      [
        { state: 'applied', at: at(1) },
        { state: 'recruiter_interview', at: at(4) },
      ],
      new Date(2026, 2, 6),
    )
    expect(entries.map((entry) => entry.label)).toEqual(['Applied', 'Recruiter interview'])
  })

  it('measures a finished span to the move that ended it', () => {
    const [applied] = stateTimeline(
      [
        { state: 'applied', at: at(1) },
        { state: 'online_assessment', at: at(4) },
      ],
      new Date(2026, 2, 20),
    )
    expect(applied.days).toBe(3)
    expect(applied.current).toBe(false)
  })

  it('measures the last span to now and marks it current', () => {
    const entries = stateTimeline([{ state: 'applied', at: at(1) }], new Date(2026, 2, 6))
    expect(entries[0]).toMatchObject({ days: 5, current: true })
  })

  it('counts local days, so two moves on one day span none', () => {
    const [first] = stateTimeline(
      [
        { state: 'applied', at: at(1, 8) },
        { state: 'online_assessment', at: at(1, 23) },
      ],
      new Date(2026, 2, 2),
    )
    expect(first.days).toBe(0)
  })

  it('never reports a negative span for history recorded out of order', () => {
    const [first] = stateTimeline(
      [
        { state: 'applied', at: at(9) },
        { state: 'online_assessment', at: at(4) },
      ],
      new Date(2026, 2, 20),
    )
    expect(first.days).toBe(0)
  })

  it('reports no span rather than a wrong one when a timestamp cannot be read', () => {
    const [first] = stateTimeline(
      [
        { state: 'applied', at: 'not a timestamp' },
        { state: 'online_assessment', at: at(4) },
      ],
      new Date(2026, 2, 20),
    )
    expect(first.days).toBeNull()
    expect(formatSpan(first)).toBeNull()
  })
})

describe('formatSpan', () => {
  const span = (days: number | null, current: boolean) =>
    formatSpan({ state: 'applied', label: 'Applied', at: at(1), days, current })

  it('words a finished span, with same-day moves saying so', () => {
    expect(span(0, false)).toBe('Same day')
    expect(span(1, false)).toBe('1 day')
    expect(span(12, false)).toBe('12 days')
  })

  it('words a running span as unfinished', () => {
    expect(span(0, true)).toBe('Today')
    expect(span(1, true)).toBe('1 day so far')
    expect(span(12, true)).toBe('12 days so far')
  })
})
