import { describe, expect, it } from 'vitest'

import { parseMarkdown } from './parseMarkdown'
import { buildSections, collectFoldableKeys, outlineTree, sectionPath } from './sections'
import { searchNote, splitMatches } from './searchNote'

function search(source: string, query: string) {
  return searchNote(buildSections(parseMarkdown(source)), query)
}

describe('splitMatches', () => {
  it('alternates plain and matching runs', () => {
    expect(splitMatches('a cat and a cat', 'cat')).toEqual([
      { text: 'a ', isMatch: false },
      { text: 'cat', isMatch: true },
      { text: ' and a ', isMatch: false },
      { text: 'cat', isMatch: true },
    ])
  })

  it('keeps the text as typed while matching without case', () => {
    expect(splitMatches('Panel', 'pan')).toEqual([
      { text: 'Pan', isMatch: true },
      { text: 'el', isMatch: false },
    ])
  })

  it('returns the whole string when there is no query', () => {
    expect(splitMatches('Panel', '')).toEqual([{ text: 'Panel', isMatch: false }])
  })
})

describe('searchNote', () => {
  it('finds nothing without a query', () => {
    expect(search('# Panel', '').count).toBe(0)
  })

  it('counts every match in the note', () => {
    expect(search('# Panel\n\n- Panel notes\n- Another panel', 'panel').count).toBe(3)
  })

  it('matches the text a reader sees, not the Markdown around it', () => {
    expect(search('- **bold** and _italic_', 'bold').count).toBe(1)
    expect(search('- **bold**', '*').count).toBe(0)
  })

  it('counts matches inside a link’s text', () => {
    expect(search('- See [the panel](https://example.com/panel)', 'panel').count).toBe(1)
  })

  it('numbers matches in reading order: heading, then blocks, then subsections', () => {
    const result = search(
      '# One panel\n\nA panel paragraph\n\n## Two\n\n- A panel point',
      'panel',
    )
    expect(result.count).toBe(3)
    expect([...result.bases.values()]).toEqual([0, 1, 2])
  })

  it('opens the folds a match sits behind, and only those', () => {
    const source = '## Themes\n\n- Growing leads\n  - The promotion I sponsored\n\n## Questions\n\n- What next?'
    const section = buildSections(parseMarkdown(source))
    const foldable = collectFoldableKeys(section)

    const { reveal } = searchNote(section, 'promotion')
    // The heading it lives under, and the point whose sub-points hold it.
    expect(reveal.size).toBe(2)
    for (const key of reveal) expect(foldable).toContain(key)
  })

  it('leaves a heading’s own text unfolded, since a folded heading still shows it', () => {
    expect(search('## Themes\n\n- A point', 'themes').reveal.size).toBe(0)
  })

  it('opens a code block for a match in its body', () => {
    const source = '```sql\nselect 1\n```'
    const section = buildSections(parseMarkdown(source))
    const { count, reveal } = searchNote(section, 'select')
    expect(count).toBe(1)
    expect([...reveal]).toEqual(collectFoldableKeys(section))
  })

  it('opens a quote for a match in its body', () => {
    const source = '> occasional travel to the London office'
    const section = buildSections(parseMarkdown(source))
    const { count, reveal } = searchNote(section, 'london')
    expect(count).toBe(1)
    expect([...reveal]).toEqual(collectFoldableKeys(section))
  })

  it('opens nothing for a note with no match', () => {
    const { count, reveal, bases } = search('## Themes\n\n- A point', 'absent')
    expect(count).toBe(0)
    expect(reveal.size).toBe(0)
    expect(bases.size).toBe(0)
  })
})

/** The outline's shape as nested text, so a test can state hierarchy in one line. */
function shape(nodes: ReturnType<typeof outlineTree>): unknown[] {
  return nodes.map((node) =>
    node.children.length > 0 ? [node.text, shape(node.children)] : node.text,
  )
}

describe('outlineTree', () => {
  it('nests each heading under the one it belongs to', () => {
    const section = buildSections(parseMarkdown('# One\n\n## Two\n\n### Three\n\n# Four'))
    expect(shape(outlineTree(section))).toEqual([['One', [['Two', ['Three']]]], 'Four'])
  })

  it('keeps headings of the same level as siblings', () => {
    const section = buildSections(parseMarkdown('## Themes\n\n## Questions'))
    expect(shape(outlineTree(section))).toEqual(['Themes', 'Questions'])
  })

  it('nests by structure, not by comparing levels to the top of the note', () => {
    // A note that opens deep and then uses a higher level still reads as a tree.
    const section = buildSections(parseMarkdown('### Deep first\n\n## Higher later\n\n### Under it'))
    expect(shape(outlineTree(section))).toEqual(['Deep first', ['Higher later', ['Under it']]])
  })

  it('reports the heading level as written, for how loudly a row reads', () => {
    const section = buildSections(parseMarkdown('### Only'))
    expect(outlineTree(section)[0].level).toBe(3)
  })

  it('reads a heading as its text, without the emphasis around it', () => {
    const section = buildSections(parseMarkdown('## The **panel**'))
    expect(outlineTree(section)[0].text).toBe('The panel')
  })

  it('is empty for a note with no headings', () => {
    expect(outlineTree(buildSections(parseMarkdown('- Just a point')))).toEqual([])
  })
})

describe('sectionPath', () => {
  it('names the headings above a section, itself last', () => {
    const section = buildSections(parseMarkdown('# One\n\n## Two\n\n### Three'))
    const deepest = outlineTree(section)[0].children[0].children[0]
    expect(sectionPath(section, deepest.key).map((entry) => entry.text)).toEqual([
      'One',
      'Two',
      'Three',
    ])
  })

  it('carries the key of each heading, so the outline can mark the path', () => {
    const section = buildSections(parseMarkdown('# One\n\n## Two'))
    const child = outlineTree(section)[0].children[0]
    expect(sectionPath(section, child.key).map((entry) => entry.key)).toEqual([
      outlineTree(section)[0].key,
      child.key,
    ])
  })

  it('is empty when no section is named', () => {
    const section = buildSections(parseMarkdown('# One'))
    expect(sectionPath(section, null)).toEqual([])
    expect(sectionPath(section, 'root.h99')).toEqual([])
  })
})
