import { describe, expect, it } from 'vitest'

import { inlineText, parseInline, parseMarkdown } from './parseMarkdown'
import type { BlockNode, ListBlock, QuoteBlock, TableBlock } from './parseMarkdown'

function asList(block: BlockNode | undefined): ListBlock {
  if (block?.type !== 'list') throw new Error(`expected a list, received ${block?.type}`)
  return block
}

function asTable(block: BlockNode | undefined): TableBlock {
  if (block?.type !== 'table') throw new Error(`expected a table, received ${block?.type}`)
  return block
}

describe('markdown blocks', () => {
  it('parses headings with their level', () => {
    expect(parseMarkdown('# Panel\n### Questions')).toEqual([
      { type: 'heading', level: 1, content: [{ type: 'text', value: 'Panel' }], line: 0 },
      { type: 'heading', level: 3, content: [{ type: 'text', value: 'Questions' }], line: 1 },
    ])
  })

  it('keeps single line breaks inside a paragraph', () => {
    const [paragraph] = parseMarkdown('First line\nSecond line')

    expect(paragraph).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', value: 'First line' },
        { type: 'break' },
        { type: 'text', value: 'Second line' },
      ],
    })
  })

  it('nests list items by indentation', () => {
    const list = asList(parseMarkdown('- Panel\n  - Design\n  - Research\n- Case study')[0])

    expect(list.ordered).toBe(false)
    expect(list.items).toHaveLength(2)
    expect(inlineText(list.items[0].content)).toBe('Panel')
    expect(asList(list.items[0].children[0]).items.map((item) => inlineText(item.content))).toEqual([
      'Design',
      'Research',
    ])
    expect(list.items[1].children).toEqual([])
  })

  it('nests deeper levels and returns to shallower ones', () => {
    const list = asList(parseMarkdown('- One\n  - Two\n    - Three\n- Four')[0])

    const two = asList(list.items[0].children[0])
    expect(inlineText(two.items[0].content)).toBe('Two')
    expect(inlineText(asList(two.items[0].children[0]).items[0].content)).toBe('Three')
    expect(list.items.map((item) => inlineText(item.content))).toEqual(['One', 'Four'])
  })

  it('marks numbered lists as ordered', () => {
    const list = asList(parseMarkdown('1. First\n2. Second')[0])

    expect(list.ordered).toBe(true)
    expect(list.items).toHaveLength(2)
  })

  it('treats a wrapped line as more of the same point, not a child', () => {
    const list = asList(parseMarkdown('- Ask about on-call\n  including weekend rotation')[0])

    expect(inlineText(list.items[0].content)).toBe('Ask about on-call including weekend rotation')
    expect(list.items[0].children).toEqual([])
  })

  it('makes a detail paragraph under a point a foldable child', () => {
    const list = asList(parseMarkdown('- Comp\n\n  Base is 8% below target.')[0])

    expect(inlineText(list.items[0].content)).toBe('Comp')
    expect(list.items[0].children).toEqual([
      { type: 'paragraph', content: [{ type: 'text', value: 'Base is 8% below target.' }] },
    ])
  })

  it('keeps a code block indented under a point as that point\u2019s child', () => {
    const list = asList(parseMarkdown('- Snippet\n\n  ```ts\n  const x = 1\n  ```')[0])

    expect(list.items[0].children).toEqual([
      { type: 'code', language: 'ts', value: 'const x = 1' },
    ])
  })

  it('keeps a list going across blank lines between its items', () => {
    const list = asList(parseMarkdown('- One\n\n- Two')[0])

    expect(list.items.map((item) => inlineText(item.content))).toEqual(['One', 'Two'])
  })

  it('parses block quotes as their own nested blocks', () => {
    const [quote] = parseMarkdown('> From the job ad:\n> - Owns the roadmap')

    expect(quote.type).toBe('quote')
    const children = (quote as QuoteBlock).children
    expect(children[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', value: 'From the job ad:' }],
    })
    expect(asList(children[1]).items.map((item) => inlineText(item.content))).toEqual([
      'Owns the roadmap',
    ])
  })

  it('ends a list at a blank line that is not followed by another item', () => {
    const blocks = parseMarkdown('- Point\n\nA closing thought')

    expect(blocks.map((block) => block.type)).toEqual(['list', 'paragraph'])
  })

  it('keeps fenced code verbatim with its language', () => {
    const [block] = parseMarkdown('```ts\nconst answer = 1\n# not a heading\n```')

    expect(block).toEqual({
      type: 'code',
      language: 'ts',
      value: 'const answer = 1\n# not a heading',
    })
  })
})

describe('markdown tables', () => {
  it('reads the header, alignment, and rows of a pipe table', () => {
    const table = asTable(
      parseMarkdown('| Company | Level | Comp |\n| --- | :---: | ---: |\n| Orbit & Oak | Senior | 180k |')[0],
    )

    expect(table.header.map(inlineText)).toEqual(['Company', 'Level', 'Comp'])
    expect(table.align).toEqual([null, 'center', 'right'])
    expect(table.rows.map((row) => row.map(inlineText))).toEqual([['Orbit & Oak', 'Senior', '180k']])
  })

  it('works without a leading or trailing pipe', () => {
    const table = asTable(parseMarkdown('Company | Level\n--- | ---\nHalcyon | Staff')[0])

    expect(table.header.map(inlineText)).toEqual(['Company', 'Level'])
    expect(table.rows.map((row) => row.map(inlineText))).toEqual([['Halcyon', 'Staff']])
  })

  it('parses inline formatting inside a cell', () => {
    const table = asTable(parseMarkdown('| Note |\n| --- |\n| **Strong** point |')[0])

    expect(table.rows[0][0]).toEqual([
      { type: 'strong', children: [{ type: 'text', value: 'Strong' }] },
      { type: 'text', value: ' point' },
    ])
  })

  it('keeps a literal pipe written as \\|', () => {
    const table = asTable(parseMarkdown('| A |\n| --- |\n| this \\| that |')[0])

    expect(inlineText(table.rows[0][0])).toBe('this | that')
  })

  it('pads a short row and truncates a long one to the header width', () => {
    const table = asTable(
      parseMarkdown('| A | B | C |\n| --- | --- | --- |\n| short |\n| 1 | 2 | 3 | extra |')[0],
    )

    expect(table.rows[0].map(inlineText)).toEqual(['short', '', ''])
    expect(table.rows[1].map(inlineText)).toEqual(['1', '2', '3'])
  })

  it('ends a table at the first line without a pipe', () => {
    const blocks = parseMarkdown('| A |\n| --- |\n| 1 |\n\nA closing thought')

    expect(blocks.map((block) => block.type)).toEqual(['table', 'paragraph'])
    expect(asTable(blocks[0]).rows).toHaveLength(1)
  })

  it('does not mistake a bare divider under a line of text for a one-column table', () => {
    // `---` alone is a divider some notes use, not a delimiter row: nothing here has a `|`.
    const blocks = parseMarkdown('Title\n---\nmore text')

    expect(blocks.map((block) => block.type)).toEqual(['paragraph'])
  })

  it('opens a table without a blank line before it, interrupting a paragraph', () => {
    const blocks = parseMarkdown('Some intro text\n| A | B |\n| --- | --- |\n| 1 | 2 |')

    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'table'])
  })
})

describe('markdown inline formatting', () => {
  it('parses bold, italic, and code spans', () => {
    expect(parseInline('**bold** and _italic_ and `code`')).toEqual([
      { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
      { type: 'text', value: ' and ' },
      { type: 'emphasis', children: [{ type: 'text', value: 'italic' }] },
      { type: 'text', value: ' and ' },
      { type: 'code', value: 'code' },
    ])
  })

  it('leaves underscores inside identifiers alone', () => {
    expect(parseInline('check stage_notes_value first')).toEqual([
      { type: 'text', value: 'check stage_notes_value first' },
    ])
  })

  it('honors backslash escapes', () => {
    expect(parseInline('a \\*literal\\* star')).toEqual([
      { type: 'text', value: 'a *literal* star' },
    ])
  })

  it('links only http, https, and mailto targets', () => {
    expect(parseInline('[docs](https://example.com/jobs)')).toEqual([
      {
        type: 'link',
        href: 'https://example.com/jobs',
        children: [{ type: 'text', value: 'docs' }],
      },
    ])
    expect(parseInline('[bad](javascript:alert(1))')).toEqual([
      { type: 'text', value: 'bad' },
    ])
  })

  it('links a bare URL pasted into a note', () => {
    expect(parseInline('Posting: https://example.com/jobs?id=4 — read it')).toEqual([
      { type: 'text', value: 'Posting: ' },
      {
        type: 'link',
        href: 'https://example.com/jobs?id=4',
        children: [{ type: 'text', value: 'https://example.com/jobs?id=4' }],
      },
      { type: 'text', value: ' — read it' },
    ])
  })

  it('leaves sentence punctuation outside a bare URL', () => {
    expect(parseInline('Call is at https://meet.example.com/abc.')).toEqual([
      { type: 'text', value: 'Call is at ' },
      {
        type: 'link',
        href: 'https://meet.example.com/abc',
        children: [{ type: 'text', value: 'https://meet.example.com/abc' }],
      },
      { type: 'text', value: '.' },
    ])
  })

  it('keeps a closing parenthesis that the URL opened', () => {
    expect(parseInline('(see https://example.com/a_(b) now)')).toEqual([
      { type: 'text', value: '(see ' },
      {
        type: 'link',
        href: 'https://example.com/a_(b)',
        children: [{ type: 'text', value: 'https://example.com/a_(b)' }],
      },
      { type: 'text', value: ' now)' },
    ])
  })

  it('links a bare email address through mailto', () => {
    expect(parseInline('Recruiter is jane.doe@example.com')).toEqual([
      { type: 'text', value: 'Recruiter is ' },
      {
        type: 'link',
        href: 'mailto:jane.doe@example.com',
        children: [{ type: 'text', value: 'jane.doe@example.com' }],
      },
    ])
  })

  it('does not double the scheme on an address already written as mailto', () => {
    expect(parseInline('mailto:jane@example.com')).toEqual([
      {
        type: 'link',
        href: 'mailto:jane@example.com',
        children: [{ type: 'text', value: 'mailto:jane@example.com' }],
      },
    ])
  })

  it('links an angle-bracketed target', () => {
    expect(parseInline('<https://example.com/jobs>')).toEqual([
      {
        type: 'link',
        href: 'https://example.com/jobs',
        children: [{ type: 'text', value: 'https://example.com/jobs' }],
      },
    ])
    expect(parseInline('<javascript:alert(1)>')).toEqual([
      { type: 'text', value: '<javascript:alert(1)>' },
    ])
  })

  it('does not autolink inside a written link, which would nest links', () => {
    expect(parseInline('[https://example.com/jobs](https://example.com/jobs)')).toEqual([
      {
        type: 'link',
        href: 'https://example.com/jobs',
        children: [{ type: 'text', value: 'https://example.com/jobs' }],
      },
    ])
  })

  it('leaves the destination of a written link alone', () => {
    expect(parseInline('[docs](https://example.com/a@b)')).toEqual([
      {
        type: 'link',
        href: 'https://example.com/a@b',
        children: [{ type: 'text', value: 'docs' }],
      },
    ])
  })

  it('flattens inline nodes to plain text for fold labels', () => {
    expect(inlineText(parseInline('**Panel** with `three` [people](https://example.com)'))).toBe(
      'Panel with three people',
    )
  })
})
