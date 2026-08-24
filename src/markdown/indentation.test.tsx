/**
 * The reading view indents what a fold holds by one --fold-indent, so it lines up with
 * the text of the row that folds it. That is CSS, so these tests load the real
 * stylesheet and read the cascade back rather than asserting on markup alone: an earlier
 * version of this rule targeted the right elements with the wrong property and left
 * quotes looking unindented, which no markup assertion could have caught.
 *
 * Two jsdom limits shape what is asserted here. It drops a shorthand carrying a var(),
 * so a quote's own `padding-left` longhand can be checked but the code slab's `padding`
 * cannot. And it weighs source order more heavily than specificity — which is useful:
 * the indent rule has to come last to read that way, and this pins it there.
 */

import { render } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { MarkdownNotes } from './MarkdownNotes'
// The real stylesheet as text, so the cascade under test is the one the app ships.
// Imported rather than read off disk: this runs in a browser-shaped environment with
// no filesystem, and the bundler resolves the path the same way the app does.
import styles from '../styles.css?raw'

const NOTE = [
  '## Themes',
  '',
  'A paragraph under the heading.',
  '',
  '- Growing seniors into leads',
  '  - The promotion I sponsored',
  '',
  '  A detail paragraph under the point.',
  '',
  '  > A quote under the point',
  '',
  '  ```sql',
  '  select 1',
  '  ```',
  '',
  '### Deeper',
  '',
  '> A quote under the deeper heading',
].join('\n')

const INDENT = 'var(--fold-indent)'

let root: HTMLElement

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = styles
  document.head.append(style)
})

// Rendered per test, not once for the file: the testing library unmounts what a test
// rendered when it finishes, so a tree shared across tests is empty by the second one.
beforeEach(() => {
  root = render(<MarkdownNotes label="Test" source={NOTE} />).container
})

const one = (selector: string) => {
  const found = root.querySelector(selector)
  if (!found) throw new Error(`nothing matched ${selector}`)
  return getComputedStyle(found)
}

const all = (selector: string) =>
  // Wrapped rather than passed straight to map, which would hand the index in as the
  // pseudo-element argument.
  [...root.querySelectorAll(selector)].map((found) => getComputedStyle(found))

describe('what a fold holds is indented', () => {
  it('indents a heading’s body, and leaves the heading itself in place', () => {
    expect(one('.markdown__section--titled > .markdown__paragraph').marginLeft).toBe(INDENT)
    expect(one('.markdown__heading').marginLeft).not.toBe(INDENT)
  })

  it('indents every kind of body under a point, not only a nested list', () => {
    const item = '.markdown__item >'
    expect(one(`${item} .markdown__list`).marginLeft).toBe(INDENT)
    expect(one(`${item} .markdown__paragraph`).marginLeft).toBe(INDENT)
    expect(one(`${item} .markdown__quote`).marginLeft).toBe(INDENT)
    expect(one(`${item} .markdown__code-block`).marginLeft).toBe(INDENT)
    // The point's own line stays put: it is what the body is indented under.
    expect(one('.markdown__item > .markdown__item-line').marginLeft).not.toBe(INDENT)
  })

  it('indents a quote as a whole, keeping the gap to its own border', () => {
    // Every quote moves, wherever it sits: under a point and under a heading.
    const quotes = all('.markdown__quote')
    expect(quotes).toHaveLength(2)
    for (const quote of quotes) {
      expect(quote.marginLeft).toBe(INDENT)
      // The rule must not take over the padding the quote sets for itself, or the
      // border stays at the parent's edge and only the text moves across.
      expect(quote.paddingLeft).toBe('var(--s3)')
    }
    // A quote's body clears its own summary row.
    expect(one('.markdown__quote > .markdown__paragraph').marginLeft).toBe(INDENT)
    expect(one('.markdown__quote > .markdown__fold-row').marginLeft).not.toBe(INDENT)
  })

  it('moves a code slab rather than padding it out', () => {
    expect(one('.markdown__code').marginLeft).toBe(INDENT)
    expect(one('.markdown__code-block > .markdown__fold-row').marginLeft).not.toBe(INDENT)
  })

  it('indents each heading level once more than the one above it', () => {
    const sections = all('.markdown__section--titled')
    expect(sections).toHaveLength(2)
    // A top-level heading has nothing above it to indent under; the one nested in it does.
    expect(sections[0].marginLeft).not.toBe(INDENT)
    expect(sections[1].marginLeft).toBe(INDENT)
  })

  it('leaves the note’s own top level flush', () => {
    // The root section wraps the whole note, so nothing hangs off it to indent under.
    const rootSection = root.querySelector('.markdown__section')!
    expect(rootSection.classList.contains('markdown__section--titled')).toBe(false)
    expect(getComputedStyle(rootSection).marginLeft).not.toBe(INDENT)
  })
})
