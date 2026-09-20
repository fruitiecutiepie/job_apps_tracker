/**
 * The find paints its matches on a layer behind the note being written, because a
 * textarea carries no highlight and an unfocused one paints no selection either. That
 * only works while the layer wraps its text exactly where the box does, so this pins
 * every property that decides where a character lands.
 *
 * It is a real failure mode, not a theoretical one: the layer first shipped wrapping on
 * `overflow-wrap: break-word` against a box left on the browser's default, and then with
 * the box on `overflow-y: auto`, which takes its scrollbar's width out of the text only
 * once a note is long enough to overflow — so the highlights held on short notes and
 * slid on exactly the long ones worth searching.
 *
 * jsdom has no layout, so this compares declarations rather than positions. Border width
 * is left out: jsdom cannot resolve the `border: 1px solid var(--line-strong)` shorthand
 * the box is styled with and reports a default for it, though both sides declare 1px.
 * Alignment itself still needs a browser; this only holds the declarations level.
 */

import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import styles from './styles.css?raw'
import { StageNoteEditor } from './StageNoteEditor'

const NOTE = '## Themes\n\nGrowing seniors into leads, and leads into managers.'

/** Every property that moves a character, and so has to agree on both layers. */
const PLACEMENT = [
  'font-size',
  'font-family',
  'font-weight',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'tab-size',
  'text-indent',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'white-space',
  'overflow-wrap',
  'word-break',
  'overflow-x',
  'overflow-y',
]

function editor(query: string, currentMatch: number | null = null) {
  return render(
    <div className="panel__notes">
      <section className="stage-note">
        <StageNoteEditor
          currentMatch={currentMatch}
          label="Interview 2"
          matchBase={0}
          onChange={() => {}}
          query={query}
          sourceId="interview_2"
          value={NOTE}
        />
      </section>
    </div>,
  ).container
}

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = styles
  document.head.append(style)
})

describe('the layer behind a note being written', () => {
  it('agrees with the box on everything that places a character', () => {
    const container = editor('leads')
    const box = getComputedStyle(container.querySelector('textarea')!)
    const layer = getComputedStyle(container.querySelector('.stage-note__marks')!)

    const differing = PLACEMENT.filter(
      (property) => box.getPropertyValue(property) !== layer.getPropertyValue(property),
    )
    expect(differing).toEqual([])
  })

  it('reserves the same scrollbar gutter as the box, however long the note', () => {
    const container = editor('leads')
    const box = getComputedStyle(container.querySelector('textarea')!)
    const layer = getComputedStyle(container.querySelector('.stage-note__marks')!)
    // Both scroll rather than either being auto: a gutter that comes and goes takes its
    // width out of one side's text and not the other's.
    expect(box.overflowY).toBe('scroll')
    expect(layer.overflowY).toBe('scroll')
  })

  it('names each match so the find can scroll the box to it, marking the current one', () => {
    const container = editor('leads', 1)
    const marks = [...container.querySelectorAll('[data-source-match-id]')]
    expect(marks.map((mark) => mark.getAttribute('data-source-match-id'))).toEqual(['0', '1'])
    expect(marks[1].className).toContain('markdown__match--current')
    expect(marks[0].className).not.toContain('markdown__match--current')
  })

  it('mirrors nothing until there is a query to mirror', () => {
    const container = editor('')
    expect(container.querySelector('[data-source-match-id]')).toBeNull()
    expect(container.querySelector('.stage-note__marks')!.textContent!.trim()).toBe('')
  })

  it('draws a mark with the same metrics as the text it sits behind', () => {
    const container = editor('leads')
    const box = getComputedStyle(container.querySelector('textarea')!)
    const mark = getComputedStyle(container.querySelector('[data-source-match-id]')!)
    // A heavier mark sets its own run wider than the same characters in the box, which
    // pushes everything after it on that line out of step.
    for (const property of ['font-size', 'font-family', 'font-weight', 'letter-spacing']) {
      expect([property, mark.getPropertyValue(property)]).toEqual([
        property,
        box.getPropertyValue(property),
      ])
    }
  })

  it('keeps the mirror out of the box’s name', () => {
    // The mirror holds the whole note. Inside the label it would be read as the box's
    // name, which is how it first shipped and how this was caught.
    const { getByLabelText } = render(
      <StageNoteEditor
        label="Interview 2"
        onChange={() => {}}
        query="leads"
        sourceId="interview_2"
        value={NOTE}
      />,
    )
    expect(getByLabelText('Interview 2 prep notes').tagName).toBe('TEXTAREA')
  })
})

const FOLDABLE = [
  '## Themes',
  '',
  'Growing seniors into leads.',
  '',
  '## Questions',
  '',
  '- On-call',
  '',
  '  How often is the weekend rotation?',
].join('\n')

/**
 * The editor is controlled, and folding only means anything against a note that is being
 * written back: what the box shows is a projection of the note, and the note is the prop.
 */
function Writing({ note = FOLDABLE }: { note?: string }) {
  const [value, setValue] = useState(note)
  return (
    <StageNoteEditor label="Interview 2" onChange={setValue} sourceId="interview_2" value={value} />
  )
}

function box() {
  return screen.getByLabelText('Interview 2 prep notes') as HTMLTextAreaElement
}

describe('folding a note that is open for writing', () => {
  it('closes a heading over what is written under it, and opens it again', () => {
    render(<Writing />)

    fireEvent.click(screen.getByLabelText('Collapse Themes in Interview 2'))
    expect(box().value).not.toContain('Growing seniors into leads.')
    expect(box().value).toContain('## Questions')

    fireEvent.click(screen.getByLabelText('Expand Themes in Interview 2'))
    expect(box().value).toBe(FOLDABLE)
  })

  it('folds a point onto the detail under it', () => {
    render(<Writing />)

    fireEvent.click(screen.getByLabelText('Collapse On-call in Interview 2'))
    expect(box().value).not.toContain('weekend rotation')
    expect(box().value).toContain('- On-call')
  })

  it('collapses the whole note at once, and says so on the same control', () => {
    render(<Writing />)

    fireEvent.click(screen.getByLabelText('Collapse all points in Interview 2'))
    // What a folded heading holds is folded with it, the point under `## Questions`
    // included, which is the shape Collapse all leaves in the reading view too.
    expect(box().value).toBe('## Themes\n\n## Questions')

    fireEvent.click(screen.getByLabelText('Expand all points in Interview 2'))
    expect(box().value).toBe(FOLDABLE)
  })

  it('writes what is typed into the whole note, not just the part on show', () => {
    render(<Writing />)
    fireEvent.click(screen.getByLabelText('Collapse Themes in Interview 2'))

    const typed = box().value.replace('## Questions', '## Questions to ask')
    // The caret is where typing left it, which is what says where the edit was: two
    // strings alone cannot tell one deleted line break from another.
    fireEvent.change(box(), {
      target: { value: typed, selectionStart: typed.indexOf('## Questions to ask') + 19 },
    })

    // The heading is still folded, and what it folds is still in the note.
    expect(box().value).not.toContain('Growing seniors into leads.')
    fireEvent.click(screen.getByLabelText('Expand Themes in Interview 2'))
    expect(box().value).toBe(FOLDABLE.replace('## Questions', '## Questions to ask'))
  })

  it('opens a fold an edit reaches into rather than writing through it', () => {
    render(<Writing />)
    fireEvent.click(screen.getByLabelText('Collapse Themes in Interview 2'))

    // Backspace at the end of the folded heading: in the box it joins two lines that have
    // everything folded sitting between them.
    fireEvent.change(box(), {
      target: { value: box().value.replace('## Themes\n', '## Themes'), selectionStart: 9 },
    })

    expect(box().value).toBe(FOLDABLE)
  })

  it('opens the fold a jump from the outline lands in, and says so to the panel', () => {
    const { rerender } = render(
      <StageNoteEditor label="Interview 2" onChange={() => {}} value={FOLDABLE} />,
    )
    fireEvent.click(screen.getByLabelText('Collapse Themes in Interview 2'))
    // The lines the box is not showing, which is how the panel counts a caret or a jump
    // back into the note's own lines.
    expect(box().getAttribute('data-fold-hidden')).toBe('[{"start":1,"end":2}]')

    rerender(
      <StageNoteEditor
        label="Interview 2"
        onChange={() => {}}
        revealKeys={new Set(['root.h1'])}
        value={FOLDABLE}
      />,
    )
    expect(box().value).toBe(FOLDABLE)
    expect(box().getAttribute('data-fold-hidden')).toBe('[]')
  })

  it('keeps a fold open while the find has a match inside it', () => {
    const { rerender } = render(
      <StageNoteEditor label="Interview 2" onChange={() => {}} query="" value={FOLDABLE} />,
    )
    fireEvent.click(screen.getByLabelText('Collapse Themes in Interview 2'))
    expect(box().value).not.toContain('Growing seniors into leads.')

    rerender(
      <StageNoteEditor label="Interview 2" onChange={() => {}} query="seniors" value={FOLDABLE} />,
    )
    // A folded match would be one the find counts and cannot show.
    expect(box().value).toContain('Growing seniors into leads.')
  })
})

function lineNumbers(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.stage-note__line-number')].map(
    (node) => node.textContent ?? '',
  )
}

describe('line numbers beside the note being written', () => {
  it('numbers every line while nothing is folded', () => {
    const { container } = render(<Writing />)
    expect(lineNumbers(container)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
  })

  it('is hidden from assistive tech, since the box already carries the note', () => {
    const { container } = render(<Writing />)
    expect(container.querySelector('.stage-note__line-numbers')?.getAttribute('aria-hidden')).toBe(
      'true',
    )
  })

  it('jumps across a closed fold rather than renumbering what is still shown', () => {
    const { container } = render(<Writing />)
    fireEvent.click(screen.getByLabelText('Collapse Themes in Interview 2'))
    // Lines 2 and 3 (the blank line and the point folded under Themes) are hidden, so the
    // numbers on either side of the fold keep the source line they always named.
    expect(lineNumbers(container)).toEqual(['1', '4', '5', '6', '7', '8', '9'])
  })
})

describe('auto-continuing a list on Enter', () => {
  it('repeats the marker on the next line', () => {
    render(<Writing note="- first" />)
    box().setSelectionRange(box().value.length, box().value.length)
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(box().value).toBe('- first\n- ')
  })

  it('increments a numbered marker', () => {
    render(<Writing note="1. first" />)
    box().setSelectionRange(box().value.length, box().value.length)
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(box().value).toBe('1. first\n2. ')
  })

  it('clears an empty item instead of continuing it', () => {
    render(<Writing note={'- first\n- '} />)
    box().setSelectionRange(box().value.length, box().value.length)
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(box().value).toBe('- first\n')
  })

  it('leaves a plain line break alone outside a list', () => {
    render(<Writing note="Just a paragraph" />)
    box().setSelectionRange(box().value.length, box().value.length)
    fireEvent.keyDown(box(), { key: 'Enter' })
    // Nothing here is a list continuation's business, so the value is untouched — the
    // native newline jsdom does not simulate is the box's own concern, not this handler's.
    expect(box().value).toBe('Just a paragraph')
  })

  it('leaves Shift+Enter to the box’s native behaviour', () => {
    render(<Writing note="- first" />)
    box().setSelectionRange(box().value.length, box().value.length)
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })
    expect(box().value).toBe('- first')
  })
})
