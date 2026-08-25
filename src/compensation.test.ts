import { describe, expect, it } from 'vitest'

import { AMOUNT_STEP, AMOUNT_STEP_LARGE, currencyOptions, steppedAmount } from './compensation'
import type { CompensationValues } from './compensation'
import { CURRENCY_SUGGESTIONS } from './domain'

function values(currency: string): CompensationValues {
  return {
    currency,
    stages: {
      advertised: { from: '', to: '' },
      expected: { from: '', to: '' },
      offered: { from: '', to: '' },
    },
  }
}

describe('steppedAmount', () => {
  it('nudges by the step and reads back as money', () => {
    expect(steppedAmount('130000', 1)).toBe('135,000')
    expect(steppedAmount('130,000', -1)).toBe('125,000')
    expect(AMOUNT_STEP).toBe(5_000)
  })

  it('uses the coarse step with shift', () => {
    expect(steppedAmount('130,000', 1, true)).toBe('140,000')
    expect(AMOUNT_STEP_LARGE).toBe(10_000)
  })

  it('starts an empty box at one step up, and leaves it alone going down', () => {
    // Up on an empty box starting a value beats the key doing nothing at all; down has
    // nothing to count from, and a figure may not be zero or negative.
    expect(steppedAmount('', 1)).toBe('5,000')
    expect(steppedAmount('', -1)).toBeNull()
  })

  it('refuses to step to zero or below, which null already means', () => {
    expect(steppedAmount('5,000', -1)).toBeNull()
    expect(steppedAmount('3,000', -1)).toBeNull()
    expect(steppedAmount('6,000', -1)).toBe('1,000')
  })

  it('refuses text that is not a whole amount, so the key stays a plain keystroke', () => {
    expect(steppedAmount('lots', 1)).toBeNull()
    expect(steppedAmount('130.5', 1)).toBeNull()
    expect(steppedAmount('-100', 1)).toBeNull()
  })
})

describe('currencyOptions', () => {
  it('offers the suggestions when nothing unusual is stored', () => {
    expect(currencyOptions(values(''))).toEqual(CURRENCY_SUGGESTIONS)
    expect(currencyOptions(values('AUD'))).toEqual(CURRENCY_SUGGESTIONS)
  })

  it('keeps a stored code that is not a suggestion on the list', () => {
    // A picker that dropped an unrecognised code would rewrite the amounts' unit on the
    // next save, which is worse than showing a code the list did not anticipate.
    expect(currencyOptions(values('CHF'))).toEqual([...CURRENCY_SUGGESTIONS, 'CHF'])
    expect(currencyOptions(values('chf'))).toEqual([...CURRENCY_SUGGESTIONS, 'CHF'])
  })
})
