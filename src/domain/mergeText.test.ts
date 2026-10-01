import { describe, expect, it } from 'vitest'

import { mapOffset, mergeText, rebaseDraft } from './mergeText'

describe('mergeText', () => {
  const base = 'Ask about the team.\nAsk about on-call.\n'

  it('keeps one side when only it changed', () => {
    expect(mergeText(base, base + 'More.', base)).toBe(base + 'More.')
    expect(mergeText(base, base, base + 'More.')).toBe(base + 'More.')
  })

  it('keeps both edits made in different places', () => {
    const ours = base.replace('the team', 'the platform team')
    const theirs = base + 'Ask about the roadmap.\n'
    expect(mergeText(base, ours, theirs)).toBe(
      'Ask about the platform team.\nAsk about on-call.\nAsk about the roadmap.\n',
    )
  })

  it('applies the edits in the order they sit, whichever side made which', () => {
    const ours = base + 'End.'
    const theirs = 'Start. ' + base
    expect(mergeText(base, ours, theirs)).toBe('Start. ' + base + 'End.')
  })

  /*
   * Two tabs typing at the end of one note is the likeliest collision, and nothing says
   * which line came first. Both are kept rather than one being chosen.
   */
  it('keeps both when both typed at the same point', () => {
    expect(mergeText(base, base + 'Mine.', base + 'Theirs.')).toBe(base + 'Theirs.Mine.')
  })

  it('keeps both replacements of one stretch rather than choosing', () => {
    expect(mergeText('a b c', 'a X c', 'a Y c')).toBe('a YX c')
  })

  it('does not double an edit both sides made identically', () => {
    expect(mergeText(base, base + 'Same.', base + 'Same.')).toBe(base + 'Same.')
  })

  it('keeps text typed into a stretch the other side deleted', () => {
    expect(mergeText('one two three', 'one twoX three', 'one three')).toContain('twoX')
  })
})

describe('mapOffset', () => {
  it('leaves a caret before the change where it was', () => {
    expect(mapOffset('hello world', 'hello world!', 3)).toBe(3)
  })

  it('moves a caret after the change by what the change added', () => {
    expect(mapOffset('world', 'hello world', 2)).toBe(8)
  })

  it('puts a caret inside a replaced stretch at the end of what replaced it', () => {
    expect(mapOffset('a bcd e', 'a X e', 4)).toBe(3)
  })
})

describe('rebaseDraft', () => {
  it('keeps the draft as it is when nothing else wrote the note', () => {
    expect(rebaseDraft('Notes', 'Notes and more', 'Notes')).toBe('Notes and more')
  })

  /*
   * A stored body is trimmed. This tab's own write coming back without the space it was
   * typed with is not an edit from elsewhere, and treating it as one would merge the
   * space away from under the next word.
   */
  it('does not mistake its own trimmed write for another tab\'s edit', () => {
    expect(rebaseDraft('Notes ', 'Notes and more', 'Notes')).toBe('Notes and more')
  })

  it('merges when another tab did write the note', () => {
    expect(rebaseDraft('Notes', 'Notes. Mine', 'First. Notes')).toBe('First. Notes. Mine')
  })

  it('keeps what was typed into a note another tab emptied', () => {
    expect(rebaseDraft('Notes', 'Notes kept', '')).toBe('Notes kept')
  })
})
