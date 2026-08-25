/**
 * Where each heading is written in the source, which is what the outline jumps to while a
 * note is open for writing. Counted by the parser because only the parser knows a `#`
 * inside a fenced code block is not a heading.
 */

import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parseMarkdown'
import { buildSections, outlineTree, sectionHeadingLine } from './sections'

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
