import { describe, expect, it } from 'vitest'

import { capturedMarkdown } from './capture'
import { parseMarkdown } from './parseMarkdown'
import { buildSections, outlineTree } from './sections'

/** Reads a timestamp as the day heading it is grouped under, ignoring the time of day. */
const day = (at: string) => at.slice(0, 10)
/** Reads a timestamp as the stamp on its own line, which carries no date. */
const time = (at: string) => at.slice(11, 16)

describe('capturedMarkdown', () => {
  it('is empty when nothing has been captured', () => {
    expect(capturedMarkdown([], day, time)).toBe('')
  })

  it('reads a day as a heading with its lines beneath it', () => {
    const entries = [
      { body: 'Panel is three people', at: '2026-08-23T09:00:00.000Z' },
      { body: 'Dana runs the loop', at: '2026-08-23T09:04:00.000Z' },
    ]

    expect(capturedMarkdown(entries, day, time)).toBe(
      '### 2026-08-23\n\n- `09:00` Panel is three people\n- `09:04` Dana runs the loop',
    )
  })

  it('opens a heading per day rather than restating the date on every line', () => {
    const entries = [
      { body: 'Panel is three people', at: '2026-08-23T09:00:00.000Z' },
      { body: 'They pushed on incident response', at: '2026-08-24T14:00:00.000Z' },
      { body: 'Two more rounds after this', at: '2026-08-24T14:02:00.000Z' },
    ]
    const captured = capturedMarkdown(entries, day, time)

    expect(captured).toBe(
      '### 2026-08-23\n\n- `09:00` Panel is three people\n\n### 2026-08-24\n\n'
      + '- `14:00` They pushed on incident response\n- `14:02` Two more rounds after this',
    )
    expect(outlineTree(buildSections(parseMarkdown(captured))).map((node) => node.text))
      .toEqual(['2026-08-23', '2026-08-24'])
  })

  it('reads in the order lines were captured, whatever order they are held in', () => {
    const entries = [
      { body: 'Said second', at: '2026-08-23T09:05:00.000Z' },
      { body: 'Said first', at: '2026-08-23T09:00:00.000Z' },
    ]

    expect(capturedMarkdown(entries, day, time)).toBe(
      '### 2026-08-23\n\n- `09:00` Said first\n- `09:05` Said second',
    )
  })

  it('groups by how the day reads rather than by the timestamp itself', () => {
    // Two moments on one day, which the caller's formatter reads as one heading.
    const entries = [
      { body: 'Morning call', at: '2026-08-23T09:00:00.000Z' },
      { body: 'Afternoon follow-up', at: '2026-08-23T16:30:00.000Z' },
    ]

    expect(capturedMarkdown(entries, () => '23 Aug 2026', time)).toBe(
      '### 23 Aug 2026\n\n- `09:00` Morning call\n- `16:30` Afternoon follow-up',
    )
  })

  it('stamps a line with its time as a code span, leaving the date to the heading', () => {
    const captured = capturedMarkdown(
      [{ body: 'Panel is three people', at: '2026-08-23T09:00:00.000Z' }],
      () => '23 Aug 2026',
      () => '9:00 am',
    )

    expect(captured).toBe('### 23 Aug 2026\n\n- `9:00 am` Panel is three people')

    // The stamp parses as code rather than as part of what was said, so it cannot be
    // mistaken for it and the date is never restated on the line.
    const list = parseMarkdown(captured).find((block) => block.type === 'list')!
    const [stamp, said] = list.items[0].content
    expect(stamp).toEqual({ type: 'code', value: '9:00 am' })
    expect(said).toEqual({ type: 'text', value: ' Panel is three people' })
  })

  it('reads a line as it was typed, so Markdown written into it works', () => {
    const entries = [{ body: 'Level is **Staff**, not Senior', at: '2026-08-23T09:00:00.000Z' }]

    expect(capturedMarkdown(entries, day, time)).toContain('- `09:00` Level is **Staff**, not Senior')
  })

  it('leaves the stored records alone', () => {
    const entries = [
      { body: 'Said second', at: '2026-08-23T09:05:00.000Z' },
      { body: 'Said first', at: '2026-08-23T09:00:00.000Z' },
    ]
    capturedMarkdown(entries, day, time)

    expect(entries.map((entry) => entry.body)).toEqual(['Said second', 'Said first'])
  })

  /*
   * A capture can run to more than one line now that the box it is typed into is
   * multi-line. Every one of these escaped its own bullet before the continuation was
   * indented: an unindented line ended the list, `-` opened a capture nobody made, and a
   * heading or quote opened a block in the middle of the log.
   */
  describe('a capture of more than one line', () => {
    const oneEntry = (body: string) =>
      parseMarkdown(capturedMarkdown([{ body, at: '2026-08-23T09:00:00.000Z' }], day, time))

    it('indents the lines after the first so they stay in the bullet', () => {
      expect(capturedMarkdown([{ body: 'Asked about scale\nUsed the rollout story', at: '2026-08-23T09:00:00.000Z' }], day, time))
        .toBe('### 2026-08-23\n\n- `09:00` Asked about scale\n  Used the rollout story')
    })

    it.each([
      ['a plain second line', 'Asked about scale\nUsed the rollout story'],
      ['a blank line in the middle', 'Asked about scale\n\nUsed the rollout story'],
      ['a line that starts a bullet', 'Asked about scale\n- the rollout story'],
      ['a line that starts a heading', 'Asked about scale\n## Next'],
      ['a line that starts a quote', 'Asked about scale\n> their words'],
      ['several lines', 'One\nTwo\nThree'],
    ])('keeps %s inside one entry', (_name, body) => {
      const blocks = oneEntry(body)
      expect(blocks.map((block) => block.type)).toEqual(['heading', 'list'])
      const list = blocks[1]
      if (list.type !== 'list') throw new Error('expected a list')
      expect(list.items).toHaveLength(1)
    })

    it('leaves a single line exactly as it was typed', () => {
      expect(capturedMarkdown([{ body: 'Just the one', at: '2026-08-23T09:00:00.000Z' }], day, time))
        .toBe('### 2026-08-23\n\n- `09:00` Just the one')
    })
  })
})
