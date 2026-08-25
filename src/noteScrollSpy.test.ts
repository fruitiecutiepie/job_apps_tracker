/**
 * These numbers are not invented: they were measured in Chrome against the real panel. The
 * note scrolls in a box inside the stage card, between a header and a dock that do not
 * scroll, and that box sits at 202.42 with 12px of padding — so a sticky heading pins at
 * 214.42, past the padding. Earlier versions of this worked the line out from a hardcoded
 * header height and landed 2px, and then 16px, short.
 */

import { describe, expect, it } from 'vitest'
import { headingAtScrollTop, readingTopLine } from './noteScrollSpy'

/** Measured in Chrome: the scrolling box's border box top. */
const BODY_TOP = 202.42
/** Measured in Chrome: its padding, which a sticky offset resolves past. */
const PADDING_TOP = 12
/** Where a heading with `top: 0` therefore pins. */
const CONTENT_TOP = BODY_TOP + PADDING_TOP

interface FakeHeading {
  key: string
  top: number
  /** Level 1 and 2 headings pin to the top of the note while their section is read. */
  sticky?: boolean
  height?: number
}

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    y: top,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    toJSON: () => ({}),
  } as DOMRect
}

/** The note's scrolling box, laid out as Chrome lays out the real one. */
function noteBody(headings: FakeHeading[], options: { paddingTop?: number } = {}): HTMLElement {
  const { paddingTop = PADDING_TOP } = options
  const container = document.createElement('div')
  container.style.paddingTop = `${paddingTop}px`
  Object.defineProperty(container, 'clientTop', { value: 0, configurable: true })
  container.getBoundingClientRect = () => rect(BODY_TOP, 650)

  for (const heading of headings) {
    const element = document.createElement('h4')
    element.dataset.sectionKey = heading.key
    if (heading.sticky) element.style.position = 'sticky'
    element.getBoundingClientRect = () => rect(heading.top, heading.height ?? 24)
    container.append(element)
  }
  return container
}

describe('readingTopLine', () => {
  it('starts past the padding, where a sticky heading actually pins', () => {
    // Reading the box's top alone would answer 202.42 and be a whole padding out.
    expect(readingTopLine(noteBody([]))).toBe(CONTENT_TOP)
  })

  it('follows the padding rather than assuming one', () => {
    expect(readingTopLine(noteBody([], { paddingTop: 0 }))).toBe(BODY_TOP)
  })

  /**
   * A heading pinned at the top is opaque and paints over the note, so a heading level
   * with it is hidden even though it has cleared the top of the box.
   */
  it('clears a heading pinned at the top of the note', () => {
    const container = noteBody([
      { key: 'recruiter-interview', top: CONTENT_TOP, sticky: true, height: 26 },
      { key: 'system-design', top: 400 },
    ])

    expect(readingTopLine(container)).toBe(CONTENT_TOP + 26)
  })

  it('does not ask the heading being jumped to to clear itself', () => {
    const container = noteBody([
      { key: 'recruiter-interview', top: CONTENT_TOP, sticky: true, height: 26 },
      { key: 'system-design', top: 400 },
    ])
    const target = container.querySelector('[data-section-key="recruiter-interview"]')

    expect(readingTopLine(container, target)).toBe(CONTENT_TOP)
  })

  it('ignores a heading that merely scrolled past, rather than one pinned at the top', () => {
    const container = noteBody([
      { key: 'recruiter-interview', top: -300, sticky: true, height: 26 },
      { key: 'system-design', top: 400 },
    ])

    expect(readingTopLine(container)).toBe(CONTENT_TOP)
  })
})

describe('headingAtScrollTop', () => {
  it('marks the heading jumped to, not an earlier one', () => {
    const container = noteBody([
      { key: 'recruiter-interview', top: -120 },
      { key: 'background', top: -40 },
      { key: 'system-design', top: CONTENT_TOP, sticky: true }, // pinned at the top
      { key: 'load-balancing', top: -400 },
      { key: 'multithreading', top: CONTENT_TOP }, // jumped to, landed on the line
      { key: 'behavioural', top: 585 },
    ])

    expect(headingAtScrollTop(container)).toBe('multithreading')
  })

  /**
   * A sticky heading pins down to the top while the content after it scrolls up past it,
   * so heading tops do not run in document order. Breaking at the first heading below the
   * line stopped at the pinned one and reported the heading before it.
   */
  it('does not stop early at a heading pinned at the top', () => {
    const container = noteBody([
      { key: 'recruiter-interview', top: -56 },
      { key: 'background', top: -147 },
      { key: 'system-design', top: CONTENT_TOP, sticky: true }, // pinned
      { key: 'load-balancing', top: 120 }, // above the line despite coming later
      { key: 'multithreading', top: 400 }, // genuinely below
    ])

    expect(headingAtScrollTop(container)).toBe('load-balancing')
  })

  it('reports nothing while the first heading is still below the top', () => {
    expect(headingAtScrollTop(noteBody([{ key: 'recruiter-interview', top: 400 }]))).toBeNull()
  })

  it('ignores headings below the line', () => {
    const container = noteBody([
      { key: 'recruiter-interview', top: -10 },
      { key: 'system-design', top: 400 },
      { key: 'multithreading', top: 700 },
    ])

    expect(headingAtScrollTop(container)).toBe('recruiter-interview')
  })
})
