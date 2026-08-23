import { describe, expect, it } from 'vitest'

import { capturedMarkdown } from './capture'
import { parseMarkdown } from './parseMarkdown'
import { buildSections, outlineTree } from './sections'

/** Reads a timestamp as the day heading it is grouped under, ignoring the time of day. */
const day = (at: string) => at.slice(0, 10)

describe('capturedMarkdown', () => {
  it('is empty when nothing has been captured', () => {
    expect(capturedMarkdown([], day)).toBe('')
  })

  it('reads a day as a heading with its lines beneath it', () => {
    const entries = [
      { body: 'Panel is three people', at: '2026-08-23T09:00:00.000Z' },
      { body: 'Dana runs the loop', at: '2026-08-23T09:04:00.000Z' },
    ]

    expect(capturedMarkdown(entries, day)).toBe(
      '### 2026-08-23\n\n- Panel is three people\n- Dana runs the loop',
    )
  })

  it('opens a heading per day rather than restating the date on every line', () => {
    const entries = [
      { body: 'Panel is three people', at: '2026-08-23T09:00:00.000Z' },
      { body: 'They pushed on incident response', at: '2026-08-24T14:00:00.000Z' },
      { body: 'Two more rounds after this', at: '2026-08-24T14:02:00.000Z' },
    ]
    const captured = capturedMarkdown(entries, day)

    expect(captured).toBe(
      '### 2026-08-23\n\n- Panel is three people\n\n### 2026-08-24\n\n'
      + '- They pushed on incident response\n- Two more rounds after this',
    )
    expect(outlineTree(buildSections(parseMarkdown(captured))).map((node) => node.text))
      .toEqual(['2026-08-23', '2026-08-24'])
  })

  it('reads in the order lines were captured, whatever order they are held in', () => {
    const entries = [
      { body: 'Said second', at: '2026-08-23T09:05:00.000Z' },
      { body: 'Said first', at: '2026-08-23T09:00:00.000Z' },
    ]

    expect(capturedMarkdown(entries, day)).toBe('### 2026-08-23\n\n- Said first\n- Said second')
  })

  it('groups by how the day reads rather than by the timestamp itself', () => {
    // Two moments on one day, which the caller's formatter reads as one heading.
    const entries = [
      { body: 'Morning call', at: '2026-08-23T09:00:00.000Z' },
      { body: 'Afternoon follow-up', at: '2026-08-23T16:30:00.000Z' },
    ]

    expect(capturedMarkdown(entries, () => '23 Aug 2026')).toBe(
      '### 23 Aug 2026\n\n- Morning call\n- Afternoon follow-up',
    )
  })

  it('reads a line as it was typed, so Markdown written into it works', () => {
    const entries = [{ body: 'Level is **Staff**, not Senior', at: '2026-08-23T09:00:00.000Z' }]

    expect(capturedMarkdown(entries, day)).toContain('- Level is **Staff**, not Senior')
  })

  it('leaves the stored records alone', () => {
    const entries = [
      { body: 'Said second', at: '2026-08-23T09:05:00.000Z' },
      { body: 'Said first', at: '2026-08-23T09:00:00.000Z' },
    ]
    capturedMarkdown(entries, day)

    expect(entries.map((entry) => entry.body)).toEqual(['Said second', 'Said first'])
  })
})
