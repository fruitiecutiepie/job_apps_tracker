import { describe, expect, it } from 'vitest'

import { continueList } from './listContinuation'

describe('continueList', () => {
  it('repeats the same bullet character, with its indent', () => {
    for (const bullet of ['-', '*', '+']) {
      const text = `${bullet} first`
      expect(continueList(text, text.length)).toEqual({
        text: `${bullet} first\n${bullet} `,
        caret: text.length + 1 + 2,
      })
    }
  })

  it('preserves a nested item’s indent', () => {
    const text = '  - nested'
    expect(continueList(text, text.length)).toEqual({
      text: '  - nested\n  - ',
      caret: text.length + 1 + 4,
    })
  })

  it('increments a numbered marker, keeping its punctuation', () => {
    expect(continueList('1. first', 8)).toEqual({ text: '1. first\n2. ', caret: 12 })
    expect(continueList('3) first', 8)).toEqual({ text: '3) first\n4) ', caret: 12 })
  })

  it('carries a multi-digit number over correctly', () => {
    expect(continueList('9. ninth', 8)).toEqual({ text: '9. ninth\n10. ', caret: 13 })
  })

  it('clears an empty item instead of continuing it, leaving an empty line behind', () => {
    const text = 'Intro\n- \nAfter'
    expect(continueList(text, 8)).toEqual({ text: 'Intro\n\nAfter', caret: 6 })
  })

  it('clears an empty numbered item the same way', () => {
    const text = '1. '
    expect(continueList(text, text.length)).toEqual({ text: '', caret: 0 })
  })

  it('splits the line’s text at the caret, moving what follows onto the new marker', () => {
    const text = '- take derek to the vet'
    const caret = text.indexOf('to the vet')
    expect(continueList(text, caret)).toEqual({
      text: '- take derek \n- to the vet',
      caret: caret + 1 + 2,
    })
  })

  it('treats a caret inside the marker as sitting at the start of the item’s text', () => {
    const text = '- something'
    expect(continueList(text, 1)).toEqual({
      text: '- \n- something',
      caret: 5,
    })
  })

  it('returns null for a line that is not a list item', () => {
    expect(continueList('Just a paragraph', 5)).toBeNull()
  })

  it('returns null for a heading or a quote line', () => {
    expect(continueList('## Themes', 5)).toBeNull()
    expect(continueList('> quoted', 5)).toBeNull()
  })

  it('only looks at the line the caret is on, in a multi-line note', () => {
    const text = 'Above\n- item\nBelow'
    const caret = text.indexOf('- item') + '- item'.length
    expect(continueList(text, caret)).toEqual({
      text: 'Above\n- item\n- \nBelow',
      caret: caret + 1 + 2,
    })
  })
})
