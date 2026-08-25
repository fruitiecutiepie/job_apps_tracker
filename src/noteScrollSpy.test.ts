/**
 * These numbers are not invented: they were measured in Chrome against the real panel.
 * A pane at 126.42 with a 2px border and 16px of padding puts its sticky header's bottom
 * edge at 193.42, and that is exactly where a level-2 heading pins. Two earlier attempts
 * computed that line instead of measuring it and landed 2px and then 16px short.
 */

import { describe, expect, it } from 'vitest'
import { headingAtScrollTop, readingTopLine } from './noteScrollSpy'

/** Measured in Chrome: the pane's border box top. */
const PANE_TOP = 126.42
/** Measured in Chrome: the sticky header's bottom, and the line headings pin to. */
const HEADER_BOTTOM = 193.42

interface FakeHeading {
  key: string
  top: number
  /** Level 1 and 2 headings pin beneath the stage header while their section is read. */
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

/** A stage pane laid out as Chrome lays out the real one. */
function pane(headings: FakeHeading[], options: { withHeader?: boolean } = {}): HTMLElement {
  const { withHeader = true } = options
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientTop', { value: 2, configurable: true })
  container.getBoundingClientRect = () => rect(PANE_TOP, 650)

  if (withHeader) {
    const header = document.createElement('header')
    header.className = 'stage-note__header'
    header.getBoundingClientRect = () => rect(HEADER_BOTTOM - 49, 49)
    container.append(header)
  }

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
  it('measures the sticky header rather than computing it from the pane', () => {
    // Adding up border (2) and a 49px header from the pane top gives 177.42, which is the
    // wrong answer by exactly the pane's 16px of padding.
    expect(readingTopLine(pane([]))).toBe(HEADER_BOTTOM)
  })

  it('falls back to the pane content edge when no header is rendered', () => {
    expect(readingTopLine(pane([], { withHeader: false }))).toBe(PANE_TOP + 2)
  })

  /**
   * A level-2 heading pinned beneath the header is opaque and paints over the note, so a
   * heading level with it is hidden even though it clears the header. Measured in Chrome:
   * jumping to "Multithreading" put it at 193.28 under "Java-specific", which covered it.
   */
  it('clears a sticky heading pinned beneath the header, not just the header', () => {
    const container = pane([
      { key: 'java-specific', top: HEADER_BOTTOM, sticky: true, height: 26 },
      { key: 'multithreading', top: 400 },
    ])

    expect(readingTopLine(container)).toBe(HEADER_BOTTOM + 26)
  })

  it('does not ask the heading being jumped to to clear itself', () => {
    const container = pane([
      { key: 'java-specific', top: HEADER_BOTTOM, sticky: true, height: 26 },
      { key: 'multithreading', top: 400 },
    ])
    const target = container.querySelector('[data-section-key="java-specific"]')

    expect(readingTopLine(container, target)).toBe(HEADER_BOTTOM)
  })

  it('ignores a heading that merely scrolled past, rather than one pinned on the line', () => {
    const container = pane([
      { key: 'background', top: -300, sticky: true, height: 26 },
      { key: 'multithreading', top: 400 },
    ])

    expect(readingTopLine(container)).toBe(HEADER_BOTTOM)
  })
})

describe('headingAtScrollTop', () => {
  /**
   * The layout Chrome reported after clicking "Multithreading" in the outline, which used
   * to leave the outline marking "AI when developing software".
   */
  it('marks the heading jumped to, not an earlier one', () => {
    const container = pane([
      { key: 'background', top: -56.61 },
      { key: 'emerging-tech', top: -272.33 },
      { key: 'ai-when-developing', top: -147.63 },
      { key: 'java-specific', top: HEADER_BOTTOM }, // sticky, pinned on the line
      { key: 'commercial-java', top: -400 },
      { key: 'java-version', top: -300 },
      { key: 'equals-hashcode', top: -200 },
      { key: 'multithreading', top: HEADER_BOTTOM }, // jumped to, landed on the line
      { key: 'synchronization', top: 585.14 },
    ])

    expect(headingAtScrollTop(container)).toBe('multithreading')
  })

  /**
   * A sticky heading pins down to the line while the content after it scrolls up past it,
   * so heading tops do not run in document order. Breaking at the first heading below the
   * line stopped at the pinned one and reported the heading before it.
   */
  it('does not stop early at a sticky heading pinned on the line', () => {
    const container = pane([
      { key: 'background', top: -56.61 },
      { key: 'ai-when-developing', top: -147.63 },
      { key: 'java-specific', top: HEADER_BOTTOM }, // pinned
      { key: 'commercial-java', top: 107.33 }, // above the line despite coming later
      { key: 'java-version', top: 232.03 }, // genuinely below
    ])

    expect(headingAtScrollTop(container)).toBe('commercial-java')
  })

  it('reports nothing while the first heading is still below the header', () => {
    expect(headingAtScrollTop(pane([{ key: 'background', top: 400 }]))).toBeNull()
  })

  it('ignores headings below the line', () => {
    const container = pane([
      { key: 'background', top: -10 },
      { key: 'java-specific', top: 400 },
      { key: 'multithreading', top: 700 },
    ])

    expect(headingAtScrollTop(container)).toBe('background')
  })
})
