import { describe, expect, it } from 'vitest'

import { moveFeedback } from './moveFeedback'

const context = { othersRunning: 4 }

describe('moveFeedback', () => {
  it('cheers a step on to a later stage', () => {
    const reaction = moveFeedback({ state: 'round_1', outcome: 'active' }, { state: 'round_2' }, context, 0)
    expect(reaction).toEqual({ kind: 'progress', message: 'Keep it up!' })
  })

  it('cheers a jump over several stages the same way', () => {
    expect(moveFeedback({ state: 'applied', outcome: 'active' }, { state: 'offer' }, context)?.kind).toBe('progress')
  })

  it('varies the cheer by turn rather than repeating one', () => {
    const from = { state: 'applied', outcome: 'active' } as const
    const first = moveFeedback(from, { state: 'round_1' }, context, 0)?.message
    const second = moveFeedback(from, { state: 'round_1' }, context, 1)?.message
    expect(first).not.toBe(second)
  })

  it('celebrates arriving at Accepted', () => {
    expect(moveFeedback({ state: 'offer', outcome: 'active' }, { state: 'accepted' }, context)?.kind).toBe('accepted')
  })

  it('says nothing for a step back, which is most often a correction', () => {
    expect(moveFeedback({ state: 'round_2', outcome: 'active' }, { state: 'round_1' }, context)).toBeNull()
    expect(moveFeedback({ state: 'accepted', outcome: 'active' }, { state: 'offer' }, context)).toBeNull()
  })

  it('says nothing when nothing moved', () => {
    expect(moveFeedback({ state: 'offer', outcome: 'active' }, { state: 'offer' }, context)).toBeNull()
    expect(moveFeedback({ state: 'offer', outcome: 'rejected' }, { outcome: 'rejected' }, context)).toBeNull()
  })

  it('encourages on every way of ending, with words for that way', () => {
    const from = { state: 'round_1', outcome: 'active' } as const
    const rejected = moveFeedback(from, { outcome: 'rejected' }, context)
    const withdrawn = moveFeedback(from, { outcome: 'withdrawn' }, context)
    const closed = moveFeedback(from, { outcome: 'closed' }, context)
    expect(rejected).toMatchObject({ kind: 'ended', outcome: 'rejected' })
    expect(withdrawn).toMatchObject({ kind: 'ended', outcome: 'withdrawn' })
    expect(closed).toMatchObject({ kind: 'ended', outcome: 'closed' })
    expect(new Set([rejected?.message, withdrawn?.message, closed?.message]).size).toBe(3)
  })

  it('reads an ending lane further along as an ending, not progress', () => {
    const reaction = moveFeedback({ state: 'applied', outcome: 'active' }, { state: 'offer', outcome: 'rejected' }, context)
    expect(reaction?.kind).toBe('ended')
  })

  it('says a line for each way of ending, then how many others are still going', () => {
    const from = { state: 'round_2', outcome: 'active' } as const
    expect(moveFeedback(from, { outcome: 'rejected' }, context)?.message).toBe(
      'Sorry, that one stings. 4 others on your board are still going.',
    )
    expect(moveFeedback(from, { outcome: 'withdrawn' }, { ...context, othersRunning: 1 })?.message).toBe(
      'Good on you for choosing where your time goes. 1 other on your board is still going.',
    )
    expect(moveFeedback(from, { outcome: 'closed' }, { ...context, othersRunning: 0 })?.message).toBe(
      "That one's on them, not you. Take a breather, then add the next one.",
    )
  })

  it('congratulates on taking the job', () => {
    expect(moveFeedback({ state: 'offer', outcome: 'active' }, { state: 'accepted' }, context)?.message)
      .toBe('Congratulations, you earned this one!')
  })

  it('says nothing for a reopen where it stopped', () => {
    expect(moveFeedback({ state: 'offer', outcome: 'rejected' }, { outcome: 'active' }, context)).toBeNull()
  })
})
