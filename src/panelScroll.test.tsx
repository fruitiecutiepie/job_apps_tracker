/**
 * A note scrolls inside its own card, which only works while every box between the panel
 * and that card can shrink below what it holds. A flex item will not do that along the
 * main axis unless it is told to, and one link missing from the chain does not fail
 * locally: the note grows, its card grows with it, and the overflow escapes upwards until
 * something outside the panel scrolls instead. The note then looks fine and simply will
 * not scroll.
 *
 * Which axis is the main one changes with the window: the notes row lays its panes out in
 * a row until it runs out of width and stacks them in a column. So the chain is asserted
 * on both axes — a pane that could only shrink sideways is exactly the bug this pins, and
 * it showed up only once the window was narrow enough to stack.
 *
 * The stylesheet is the subject here, not a component, so this renders the classes the
 * panel puts on the page rather than the panel itself. jsdom applies no media queries, so
 * the narrow layout cannot be exercised directly — which is the reason to hold the base
 * declarations to something true in either direction.
 */

import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import styles from './styles.css?raw'

/**
 * The boxes between the panel and the scrolling note, outermost first. A split adds three
 * more links — the split, the child holding one side of it, and the pane's own group — and
 * each has to shrink for the same reason the rest do.
 */
const CHAIN = [
  '.panel__main',
  '.panel__notes',
  '.panel__split',
  '.panel__split-child',
  '.panel__group',
  '.panel__pane',
  '.stage-note',
  '.stage-note__body',
]

beforeAll(() => {
  const sheet = document.createElement('style')
  sheet.textContent = styles
  document.head.append(sheet)
})

/** The classes the panel puts on the page, rendered fresh: the DOM is cleaned between tests. */
function panel() {
  return render(
    <div className="dialog dialog--panel">
      <div className="panel__body">
        <div className="panel__main">
          <div className="panel__notes">
            <div className="panel__split panel__split--row">
              <div className="panel__split-child">
                <div className="panel__group">
                  <div className="panel__tabs" />
                  <div className="panel__pane">
                    <section className="stage-note">
                      <header className="stage-note__header" />
                      <div className="stage-note__body" />
                      <div className="stage-note__dock" />
                    </section>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
  ).container
}

const style = (selector: string) => getComputedStyle(panel().querySelector(selector)!)

describe('the chain a note scrolls inside', () => {
  it('lets every box in it shrink below what it holds', () => {
    const container = panel()
    const stuck = CHAIN.filter(
      (selector) => getComputedStyle(container.querySelector(selector)!).minHeight !== '0px',
    )
    expect(stuck).toEqual([])
  })

  /*
   * Sideways only matters for the boxes that are flex items in a row: the split, the child
   * holding one side of it, the group, and the pane. Above them the panel is a grid whose
   * tracks are already `minmax(0, 1fr)`, and the card below is bounded by the pane.
   */
  it('lets every flex item in a row shrink sideways too', () => {
    const container = panel()
    const inRow = ['.panel__split', '.panel__split-child', '.panel__group', '.panel__pane']
    const stuck = inRow.filter(
      (selector) => getComputedStyle(container.querySelector(selector)!).minWidth !== '0px',
    )
    expect(stuck).toEqual([])
  })

  it('scrolls at the note and nowhere above it', () => {
    expect(style('.stage-note__body').overflowY).toBe('auto')
    // The card clips to its own corners; the pane holds it and does not scroll itself.
    expect(style('.stage-note').overflow).toBe('hidden')
  })
})
