/**
 * Folding a note that is open for writing. The box can only hold one string, so what is
 * folded is taken out of it — which means every position crossing between the box and the
 * note has to be mapped, and an edit typed into the box has to be written back into the
 * whole note rather than into the part of it on screen.
 */

import { describe, expect, it } from 'vitest'

import { buildSections, foldRegions, parseMarkdown } from './markdown'
import {
  applyProjectedEdit,
  hiddenRanges,
  projectText,
  toProjectedLine,
  toProjectedOffset,
  toSourceLine,
  toSourceOffset,
} from './noteFolds'

const NOTE = [
  '## Themes',
  '',
  'Growing seniors into leads.',
  '',
  '## Questions',
  '',
  '- On-call',
  '',
  '  How often is the weekend rotation?',
  '',
  '- Comp',
  '',
  '## Close',
  '',
  'Ask about the timeline.',
].join('\n')

function fold(source: string, ...headers: number[]) {
  const lines = source.split('\n')
  const regions = foldRegions(buildSections(parseMarkdown(source)), lines)
  const ranges = hiddenRanges(regions, new Set(headers))
  return { lines, regions, ranges, projected: projectText(lines, ranges) }
}

describe('what folds in a note being written', () => {
  it('folds a heading through to the next heading at its own level', () => {
    const { regions } = fold(NOTE)
    const heading = regions.find((region) => region.line === 0)!

    // Line 3 is the blank before `## Questions`, which stays so the folded heading is not
    // left jammed against the one after it.
    expect([heading.start, heading.end]).toEqual([1, 2])
  })

  it('folds a point onto the detail under it, gap included', () => {
    const { regions } = fold(NOTE)
    const point = regions.find((region) => region.line === 6)!

    expect([point.start, point.end]).toEqual([7, 8])
  })

  it('offers nothing to fold on a point that has no detail', () => {
    const { regions } = fold(NOTE)
    expect(regions.map((region) => region.line)).not.toContain(10)
  })

  it('folds a fenced block onto its own fence', () => {
    const source = '```ts\nconst answer = 1\n```\n\nAfter'
    const { regions } = fold(source)

    expect(regions.map((region) => [region.line, region.start, region.end])).toEqual([[0, 1, 2]])
  })

  it('folds a quote onto its first line', () => {
    const source = '> From the job ad:\n> Owns the roadmap\n\nAfter'
    const { regions } = fold(source)

    expect(regions.map((region) => [region.line, region.start, region.end])).toEqual([[0, 1, 1]])
  })
})

describe('the note as the box holds it', () => {
  it('leaves out what is folded and keeps the rest as written', () => {
    const { projected } = fold(NOTE, 0)

    expect(projected).toBe(
      ['## Themes', '', '## Questions', '', '- On-call', '', '  How often is the weekend rotation?', '', '- Comp', '', '## Close', '', 'Ask about the timeline.'].join('\n'),
    )
  })

  it('counts a fold inside a folded heading once', () => {
    // The point at line 6 is inside the section at line 4. Counted twice, every line after
    // it would map two lines out.
    const { ranges, projected } = fold(NOTE, 4, 6)

    // Line 11 is the blank before `## Close`, left out the same way.
    expect(ranges).toEqual([{ start: 5, end: 10 }])
    expect(projected).toBe(
      ['## Themes', '', 'Growing seniors into leads.', '', '## Questions', '', '## Close', '', 'Ask about the timeline.'].join('\n'),
    )
  })

  it('maps a line of the box to the line of the note it came from', () => {
    const { ranges } = fold(NOTE, 0)

    expect(toSourceLine(0, ranges)).toBe(0)
    expect(toSourceLine(1, ranges)).toBe(3)
    expect(toProjectedLine(4, ranges)).toBe(2)
    // A line inside a fold is shown by its header, which is where the reader is looking.
    expect(toProjectedLine(2, ranges)).toBe(0)
  })

  it('maps a caret in the box to the same character of the note', () => {
    const { ranges, projected } = fold(NOTE, 0)
    const offset = projected.indexOf('Ask about')

    expect(NOTE.slice(toSourceOffset(projected, NOTE, ranges, offset))).toBe('Ask about the timeline.')
    expect(toProjectedOffset(projected, NOTE, ranges, NOTE.indexOf('Ask about'))).toBe(offset)
  })
})

describe('typing into a folded note', () => {
  it('writes what was typed into the whole note, not just the part on screen', () => {
    const { ranges, projected, regions } = fold(NOTE, 0)
    const typed = projected.replace('Ask about the timeline.', 'Ask about the timeline today.')

    const result = applyProjectedEdit(NOTE, projected, typed, ranges, new Set([0]), regions, typed.length)

    expect(result.opened).toEqual([])
    expect(result.text).toBe(NOTE.replace('Ask about the timeline.', 'Ask about the timeline today.'))
    // The fold is above the edit, so it has not moved.
    expect([...result.anchors]).toEqual([0])
  })

  it('moves the folds below an edit by the lines it added', () => {
    const { ranges, projected, regions } = fold(NOTE, 12)
    const typed = projected.replace('## Themes\n', '## Themes\nStarted today.\n')

    const result = applyProjectedEdit(NOTE, projected, typed, ranges, new Set([12]), regions, typed.indexOf('Started today.') + 'Started today.\n'.length)

    expect(result.opened).toEqual([])
    expect([...result.anchors]).toEqual([13])
  })

  it('opens a fold an edit would delete, and leaves the note alone', () => {
    const { ranges, projected, regions } = fold(NOTE, 0)
    // Backspace at the end of the folded heading: in the box it joins the two lines the
    // box is showing, which in the note means swallowing everything folded between them.
    const typed = projected.replace('## Themes\n', '## Themes')

    // The caret is left where the backspace was, which is what says which of the two line
    // breaks it took: the one at the end of the folded heading.
    const result = applyProjectedEdit(NOTE, projected, typed, ranges, new Set([0]), regions, '## Themes'.length)

    expect(result.applied).toBe(false)
    expect(result.opened).toEqual([0])
    expect(result.text).toBe(NOTE)
    expect([...result.anchors]).toEqual([])
    // The caret stays where the key was pressed, which is now the end of a heading with
    // everything it was folding open below it.
    expect(result.caret).toBe('## Themes'.length)
  })

  it('opens the fold a new line is typed into, and makes the edit', () => {
    const { ranges, projected, regions } = fold(NOTE, 0)
    // Enter at the end of the folded heading. The line it starts is the first line that
    // heading folds, so leaving the fold shut would put it where it cannot be seen.
    const at = '## Themes'.length
    const typed = `${projected.slice(0, at)}\n${projected.slice(at)}`

    const result = applyProjectedEdit(NOTE, projected, typed, ranges, new Set([0]), regions, at + 1)

    expect(result.applied).toBe(true)
    expect(result.opened).toEqual([0])
    expect([...result.anchors]).toEqual([])
    expect(result.text).toBe(`${NOTE.slice(0, at)}\n${NOTE.slice(at)}`)
    // Where Enter leaves the caret anywhere else: on the line it just started.
    expect(result.caret).toBe(at + 1)
  })

  it('leaves a fold shut for a word typed into the heading it folds by', () => {
    const { ranges, projected, regions } = fold(NOTE, 0)
    const at = '## Themes'.length
    const typed = projected.replace('## Themes', '## Themes and threads')

    const result = applyProjectedEdit(NOTE, projected, typed, ranges, new Set([0]), regions, '## Themes and threads'.length)

    expect(result.applied).toBe(true)
    // Nothing was written into the folded lines, so there is nothing to see inside them.
    expect(result.opened).toEqual([])
    expect([...result.anchors]).toEqual([0])
    expect(result.caret).toBe(at + ' and threads'.length)
  })
})
