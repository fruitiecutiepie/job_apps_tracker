import { describe, expect, it } from 'vitest'
import { lineEndOffset, lineStartOffset } from './noteEditorJump'

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
