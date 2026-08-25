import { describe, expect, it } from 'vitest'
import { lineAtOffset, lineEndOffset, lineStartOffset } from './noteEditorJump'

const NOTE = ['## System design', '', 'A paragraph.', '', '### Load balancing', ''].join('\n')

describe('lineStartOffset', () => {
  it('starts the first line at nothing', () => {
    expect(lineStartOffset(NOTE, 0)).toBe(0)
  })

  it('counts the newline that ends each line before it', () => {
    expect(NOTE.slice(lineStartOffset(NOTE, 2))).toMatch(/^A paragraph\./)
    expect(NOTE.slice(lineStartOffset(NOTE, 4))).toMatch(/^### Load balancing/)
  })

  it('treats a line before the start as the start', () => {
    expect(lineStartOffset(NOTE, -3)).toBe(0)
  })

  it('stops at the last line rather than running off the end', () => {
    const offset = lineStartOffset(NOTE, 99)
    expect(offset).toBeLessThanOrEqual(NOTE.length)
    expect(NOTE.slice(offset)).toBe('')
  })

  it('handles a note that is one line with no newline at all', () => {
    expect(lineStartOffset('## Only', 0)).toBe(0)
    expect(lineStartOffset('## Only', 1)).toBe(0)
  })
})

describe('lineAtOffset', () => {
  it('reads back the line every line start was written for', () => {
    for (let line = 0; line < NOTE.split('\n').length; line += 1) {
      expect(lineAtOffset(NOTE, lineStartOffset(NOTE, line))).toBe(line)
    }
  })

  it('keeps a caret in the middle of a line on that line', () => {
    const start = lineStartOffset(NOTE, 2)
    expect(lineAtOffset(NOTE, start + 3)).toBe(2)
  })

  it('counts the newline as ending its own line, not starting the next', () => {
    expect(lineAtOffset(NOTE, lineEndOffset(NOTE, 0))).toBe(0)
    expect(lineAtOffset(NOTE, lineEndOffset(NOTE, 0) + 1)).toBe(1)
  })

  it('clamps a caret outside the text', () => {
    expect(lineAtOffset(NOTE, -5)).toBe(0)
    expect(lineAtOffset(NOTE, NOTE.length + 50)).toBe(NOTE.split('\n').length - 1)
  })
})

describe('lineEndOffset', () => {
  it('ends a line before its newline', () => {
    expect(NOTE.slice(lineStartOffset(NOTE, 0), lineEndOffset(NOTE, 0))).toBe('## System design')
    expect(NOTE.slice(lineStartOffset(NOTE, 4), lineEndOffset(NOTE, 4))).toBe('### Load balancing')
  })

  it('ends the last line at the end of the text', () => {
    const text = 'one\ntwo'
    expect(text.slice(lineStartOffset(text, 1), lineEndOffset(text, 1))).toBe('two')
  })
})
