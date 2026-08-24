import { describe, expect, it } from 'vitest'

import { fuzzyScore } from './quickOpenMatch'

describe('fuzzyScore', () => {
  it('matches characters in order without needing them adjacent', () => {
    expect(fuzzyScore('Online assessment', 'oa')).not.toBeNull()
    expect(fuzzyScore('Online assessment', 'onl')).not.toBeNull()
  })

  it('rejects a query whose characters are out of order', () => {
    expect(fuzzyScore('Online assessment', 'ao')).toBeNull()
  })

  it('rejects a character the label does not hold', () => {
    expect(fuzzyScore('Offer', 'z')).toBeNull()
  })

  it('accepts every label when nothing has been typed', () => {
    expect(fuzzyScore('Offer', '')).toBe(0)
  })

  it('ignores case on both sides', () => {
    expect(fuzzyScore('Take-home assessment', 'TAKE')).toBe(fuzzyScore('Take-home assessment', 'take'))
  })

  it('prefers a match that starts earlier', () => {
    const early = fuzzyScore('Applied', 'a')!
    const late = fuzzyScore('Recruiter interview', 'e')!
    expect(early).toBeLessThan(late)
  })

  it('prefers a match that skips fewer characters', () => {
    const tight = fuzzyScore('Interview 1', 'inte')!
    const loose = fuzzyScore('Interview 1', 'ine')!
    expect(tight).toBeLessThan(loose)
  })
})
