import { describe, expect, it } from 'vitest'

import { inlineText, parseInline, parseMarkdown } from './parseMarkdown'
import type { BlockNode, ListBlock, QuoteBlock } from './parseMarkdown'

function asList(block: BlockNode | undefined): ListBlock {
  if (block?.type !== 'list') throw new Error(`expected a list, received ${block?.type}`)
  return block
}

describe('markdown blocks', () => {
  it('parses headings with their level', () => {
    expect(parseMarkdown('# Panel\n### Questions')).toEqual([
      { type: 'heading', level: 1, content: [{ type: 'text', value: 'Panel' }] },
      { type: 'heading', level: 3, content: [{ type: 'text', value: 'Questions' }] },
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

  it('flattens inline nodes to plain text for fold labels', () => {
    expect(inlineText(parseInline('**Panel** with `three` [people](https://example.com)'))).toBe(
      'Panel with three people',
    )
  })
})
