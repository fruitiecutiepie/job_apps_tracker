/**
 * Where each heading is written in the source, which is what the outline jumps to while a
 * note is open for writing. Counted by the parser because only the parser knows a `#`
 * inside a fenced code block is not a heading.
 */

import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parseMarkdown'
import { buildSections, outlineTree, sectionAtLine, sectionHeadingLine } from './sections'

/** The line each heading was found on, paired with its text, in document order. */
function headingLines(source: string): [string, number][] {
  const root = buildSections(parseMarkdown(source))
  const out: [string, number][] = []
  const walk = (section: Parameters<typeof outlineTree>[0]) => {
    for (const child of section.children) {
      if (child.heading) out.push([child.key, child.heading.line])
      walk(child)
    }
  }
  walk(root)
  return out.map(([key, line]) => [key, line])
}

describe('heading source lines', () => {
  it('reports the line each heading is written on', () => {
    const source = ['## One', '', 'Text.', '', '### Two', '', 'More.', '', '## Three'].join('\n')
    const lines = source.split('\n')

    for (const [key, line] of headingLines(source)) {
      expect(lines[line], `heading ${key}`).toMatch(/^#{2,3} /)
    }
    expect(headingLines(source).map(([, line]) => line)).toEqual([0, 4, 8])
  })

  it('does not count a hash inside a fenced code block', () => {
    const source = [
      '## Real heading', // 0
      '',
      '```bash',
      '# not a heading, a shell comment',
      'echo hi',
      '```',
      '',
      '## Second real heading', // 7
    ].join('\n')

    expect(headingLines(source).map(([, line]) => line)).toEqual([0, 7])
  })

  it('counts blank lines and long paragraphs correctly', () => {
    const body = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}.`).join('\n\n')
    const source = ['# Top', '', body, '', '## After'].join('\n')
    const lines = source.split('\n')

    const found = headingLines(source)
    expect(lines[found[0][1]]).toBe('# Top')
    expect(lines[found[1][1]]).toBe('## After')
  })

  it('finds the section a line falls inside, for following the caret', () => {
    //             0        1  2         3  4          5  6        7  8
    const source = ['# Top', '', 'Intro.', '', '## One', '', 'Body.', '', '### Deep'].join('\n')
    const root = buildSections(parseMarkdown(source))
    const [top] = outlineTree(root)
    const one = top.children[0]
    const deep = one.children[0]

    expect(sectionAtLine(root, 0)).toBe(top.key) // on the heading itself
    expect(sectionAtLine(root, 2)).toBe(top.key) // in its body
    expect(sectionAtLine(root, 4)).toBe(one.key)
    expect(sectionAtLine(root, 6)).toBe(one.key)
    expect(sectionAtLine(root, 8)).toBe(deep.key)
    expect(sectionAtLine(root, 99)).toBe(deep.key) // past the end, still the last section
  })

  it('reports no section above the first heading', () => {
    const source = ['Loose opening line.', '', '## First'].join('\n')
    const root = buildSections(parseMarkdown(source))

    expect(sectionAtLine(root, 0)).toBeNull()
    expect(sectionAtLine(root, 2)).toBe(outlineTree(root)[0].key)
  })

  it('does not put the caret in a heading that is only a comment in a code block', () => {
    const source = ['## Real', '', '```bash', '# comment', '```', '', '## Next'].join('\n')
    const root = buildSections(parseMarkdown(source))
    const [real, next] = outlineTree(root)

    expect(sectionAtLine(root, 3)).toBe(real.key) // the comment line is still in Real
    expect(sectionAtLine(root, 6)).toBe(next.key)
  })

  it('finds the line for a section by its key', () => {
    const source = ['## One', '', '### Two'].join('\n')
    const root = buildSections(parseMarkdown(source))
    const outline = outlineTree(root)

    expect(sectionHeadingLine(root, outline[0].key)).toBe(0)
    expect(sectionHeadingLine(root, outline[0].children[0].key)).toBe(2)
    expect(sectionHeadingLine(root, 'root.h99')).toBeNull()
    expect(sectionHeadingLine(root, null)).toBeNull()
  })
})
