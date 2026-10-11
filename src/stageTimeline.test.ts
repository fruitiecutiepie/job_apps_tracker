import { describe, expect, it } from 'vitest'

import { formatSpan, stageTimeline } from './stageTimeline'

const at = (day: number, hour = 9) =>
  new Date(2026, 2, day, hour).toISOString()

describe('stageTimeline', () => {
  it('labels each entry from the stage configuration, oldest first', () => {
    const entries = stageTimeline(
      [
        { stage: 'applied', outcome: 'active', at: at(1) },
        { stage: 'screening', outcome: 'active', at: at(4) },
      ],
      new Date(2026, 2, 6),
    )
    expect(entries.map((entry) => entry.label)).toEqual(['Applied', 'Screening call'])
  })

  it('measures a finished span to the move that ended it', () => {
    const [applied] = stageTimeline(
      [
        { stage: 'applied', outcome: 'active', at: at(1) },
        { stage: 'online_assessment', outcome: 'active', at: at(4) },
      ],
      new Date(2026, 2, 20),
    )
    expect(applied.days).toBe(3)
    expect(applied.current).toBe(false)
  })

  it('measures the last span to now and marks it current', () => {
    const entries = stageTimeline([{ stage: 'applied', outcome: 'active', at: at(1) }], new Date(2026, 2, 6))
    expect(entries[0]).toMatchObject({ days: 5, current: true })
  })

  it('counts local days, so two moves on one day span none', () => {
    const [first] = stageTimeline(
      [
        { stage: 'applied', outcome: 'active', at: at(1, 8) },
        { stage: 'online_assessment', outcome: 'active', at: at(1, 23) },
      ],
      new Date(2026, 2, 2),
    )
    expect(first.days).toBe(0)
  })

  it('never reports a negative span for history recorded out of order', () => {
    const [first] = stageTimeline(
      [
        { stage: 'applied', outcome: 'active', at: at(9) },
        { stage: 'online_assessment', outcome: 'active', at: at(4) },
      ],
      new Date(2026, 2, 20),
    )
    expect(first.days).toBe(0)
  })

  it('names an ending by its stage and how it went', () => {
    const entries = stageTimeline(
      [
        { stage: 'round_1', outcome: 'active', at: at(1) },
        { stage: 'round_1', outcome: 'rejected', at: at(4) },
      ],
      new Date(2026, 2, 6),
    )
    expect(entries.map((entry) => entry.label)).toEqual(['Round 1', 'Round 1 — Rejected'])
  })

  it('reports no span rather than a wrong one when a timestamp cannot be read', () => {
    const [first] = stageTimeline(
      [
        { stage: 'applied', outcome: 'active', at: 'not a timestamp' },
        { stage: 'online_assessment', outcome: 'active', at: at(4) },
      ],
      new Date(2026, 2, 20),
    )
    expect(first.days).toBeNull()
    expect(formatSpan(first)).toBeNull()
  })
})

describe('formatSpan', () => {
  const span = (days: number | null, current: boolean) =>
    formatSpan({ stage: 'applied', outcome: 'active', label: 'Applied', at: at(1), days, current })

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
