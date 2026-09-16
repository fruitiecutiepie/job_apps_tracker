import { describe, expect, it } from 'vitest'

import { correspondenceMarkdown } from './correspondence'
import { parseMarkdown } from './parseMarkdown'
import { buildSections } from './sections'
import { outlineTree } from './sections'

// Deterministic formatters, so these tests read the same in any locale.
const day = (at: string) => at.slice(0, 10)
const time = (at: string) => at.slice(11, 16)

function message(overrides: Partial<Parameters<typeof correspondenceMarkdown>[0][number]> = {}) {
  return {
    direction: 'received' as const,
    channel: 'Email',
    who: 'Dana Okafor',
    body: 'Could you send me some windows?',
    at: '2026-08-10T09:14:00.000Z',
    ...overrides,
  }
}

describe('correspondenceMarkdown', () => {
  it('is empty for no messages', () => {
    expect(correspondenceMarkdown([], day, time)).toBe('')
  })

  it('reads a message under the day it was sent, with who and how it arrived', () => {
    expect(correspondenceMarkdown([message()], day, time)).toBe(
      ['### 2026-08-10', '', '- `09:14` **Received** — Dana Okafor · Email', '', '  Could you send me some windows?'].join('\n'),
    )
  })

  it('says only which way a message went when nobody and no channel was recorded', () => {
    const rendered = correspondenceMarkdown(
      [message({ channel: null, who: null, direction: 'sent' })],
      day,
      time,
    )

    expect(rendered).toContain('- `09:14` **Sent**\n')
    expect(rendered).not.toContain('—')
  })

  it('drops just the part that is missing', () => {
    expect(correspondenceMarkdown([message({ channel: null })], day, time)).toContain(
      '**Received** — Dana Okafor',
    )
    expect(correspondenceMarkdown([message({ who: null })], day, time)).toContain(
      '**Received** — Email',
    )
  })

  it('gives each day its own heading and puts them in send order', () => {
    const rendered = correspondenceMarkdown(
      [
        message({ body: 'Third', at: '2026-08-11T22:00:00.000Z' }),
        message({ body: 'First', at: '2026-08-10T09:14:00.000Z' }),
        message({ body: 'Second', at: '2026-08-10T17:02:00.000Z' }),
      ],
      day,
      time,
    )

    expect(outlineTree(buildSections(parseMarkdown(rendered))).map((node) => node.text)).toEqual([
      '2026-08-10',
      '2026-08-11',
    ])
    expect(rendered.indexOf('First')).toBeLessThan(rendered.indexOf('Second'))
    expect(rendered.indexOf('Second')).toBeLessThan(rendered.indexOf('Third'))
  })

  it('orders a message sent with an offset against one sent in UTC', () => {
    // 09:00 at +10:00 is 23:00Z the day before, so these two sort one way as strings and the
    // other way as instants. Read in UTC so both fall on one day and only the order is at
    // stake here.
    const utcDay = (at: string) => new Date(at).toISOString().slice(0, 10)
    const rendered = correspondenceMarkdown(
      [
        message({ body: 'Earlier', at: '2026-08-21T09:00:00+10:00' }),
        message({ body: 'Later', at: '2026-08-20T23:30:00.000Z' }),
      ],
      utcDay,
      time,
    )

    expect(rendered.indexOf('Earlier')).toBeLessThan(rendered.indexOf('Later'))
  })

  it('does not reorder the records it was given', () => {
    const entries = [
      message({ body: 'Second', at: '2026-08-11T09:00:00.000Z' }),
      message({ body: 'First', at: '2026-08-10T09:00:00.000Z' }),
    ]
    correspondenceMarkdown(entries, day, time)

    expect(entries.map((entry) => entry.body)).toEqual(['Second', 'First'])
  })

  it('keeps the paragraph breaks of a message someone else wrote', () => {
    const rendered = correspondenceMarkdown(
      [message({ body: 'Thanks for your time.\n\nThe panel will be Ravi and Sam.' })],
      day,
      time,
    )
    const [, list] = parseMarkdown(rendered)

    // Both paragraphs live inside the one bullet, rather than the blank line ending the list.
    expect(list!.type).toBe('list')
    expect(list!.type === 'list' && list.items).toHaveLength(1)
    expect(rendered).toContain('  Thanks for your time.\n\n  The panel will be Ravi and Sam.')
  })

  it('keeps a quoted reply quoted and a nested list nested', () => {
    const rendered = correspondenceMarkdown(
      [message({ body: '> On Tue, Dana wrote:\n> Are you free?\n\n- Wednesday\n- Thursday' })],
      day,
      time,
    )
    const blocks = parseMarkdown(rendered)

    expect(blocks.map((block) => block.type)).toEqual(['heading', 'list'])
    expect(rendered).toContain('  > On Tue, Dana wrote:')
    expect(rendered).toContain('  - Wednesday')
  })

  it.each([
    ['a heading', '### Subject line'],
    ['a bullet', '- A point they made'],
    ['a quote', '> Quoted back at me'],
    ['a rule', '---'],
  ])('cannot let %s in a message escape its bullet', (_name, line) => {
    const rendered = correspondenceMarkdown(
      [message({ body: `Some context.\n\n${line}\n\nAnd a close.` })],
      day,
      time,
    )
    const blocks = parseMarkdown(rendered)

    expect(blocks.map((block) => block.type)).toEqual(['heading', 'list'])
    expect(blocks[1]!.type === 'list' && blocks[1].items).toHaveLength(1)
  })

  it('keeps two messages on one day as two bullets', () => {
    const rendered = correspondenceMarkdown(
      [
        message({ body: 'First\n\nwith a second paragraph' }),
        message({ body: 'Second', at: '2026-08-10T17:02:00.000Z', direction: 'sent' }),
      ],
      day,
      time,
    )
    const [, list] = parseMarkdown(rendered)

    expect(list!.type === 'list' && list.items).toHaveLength(2)
  })

  it('trims the blank lines a pasted message arrives wrapped in', () => {
    const rendered = correspondenceMarkdown(
      [message({ body: '\n\nThe whole message.\n\n\n' })],
      day,
      time,
    )

    expect(rendered).toBe(
      ['### 2026-08-10', '', '- `09:14` **Received** — Dana Okafor · Email', '', '  The whole message.'].join('\n'),
    )
  })
})
