/**
 * What only a browser can answer about the Compare board: whether its default leaves two
 * notes side by side at a size that reads, and whether dragging a card's edges actually
 * resizes it. jsdom lays nothing out, so both are unanswerable there — a card measures zero
 * whatever the stylesheet says, and the handles have nothing to measure from.
 *
 * The view is mounted directly with stub callbacks, like the rest of this suite: nothing
 * here loads or stores a note.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { page, userEvent } from 'vitest/browser'

import { createDemoDocument } from './domain/demo'
import { CompareNotesView } from './views'

function renderBoard() {
  render(
    <div className="app-shell">
      <header className="topbar">
        <span>Chrome above the board</span>
      </header>
      <main>
        <section className="view-surface">
          <CompareNotesView
            applications={createDemoDocument().applications}
            onOpenStageNotes={() => {}}
            onSaveStageNote={async () => {}}
          />
        </section>
        {/* Somewhere below the cards for a height drag to be aimed at. */}
        <div data-testid="below" style={{ height: 600 }} />
      </main>
    </div>,
  )
  // The demo's default stage is Offer, which holds two notes.
  const board = screen.getByRole('region', { name: 'Offer' })
  const cards = within(board).getAllByRole('article')
  return { board, cards }
}

const box = (element: Element) => element.getBoundingClientRect()

describe('the Compare board', () => {
  beforeEach(async () => {
    await page.viewport(1280, 800)
  })

  it('lays two notes side by side by default, each wide enough to read', async () => {
    const { board, cards } = renderBoard()
    const [first, second] = cards.map(box)

    // One row, not a stack.
    expect(Math.abs(first!.top - second!.top)).toBeLessThan(1)
    expect(second!.left).toBeGreaterThan(first!.right)
    // Around fifty characters of note at the least, and neither card past the board.
    for (const card of [first!, second!]) {
      expect(card.width).toBeGreaterThan(360)
      expect(card.right).toBeLessThanOrEqual(box(board).right + 1)
    }
    // Short enough that a card and the window it sits in fit together.
    expect(first!.height).toBeLessThanOrEqual(window.innerHeight)
  })

  it('narrows a card from its edge and puts it back on a double-click', async () => {
    const { cards } = renderBoard()
    const card = cards[0]!
    const before = box(card).width
    const handle = within(card).getByRole('separator', { name: /^Resize the width of/ })

    // The card's own title sits left of its centre, so this pulls the edge well inwards.
    await userEvent.dragAndDrop(handle, within(card).getByRole('heading', { level: 4 }))
    const narrowed = box(card).width
    expect(narrowed).toBeLessThan(before - 60)
    expect(narrowed).toBeGreaterThanOrEqual(240)

    await userEvent.dblClick(handle)
    expect(Math.abs(box(card).width - before)).toBeLessThan(1)
  })

  it('makes a card taller from its bottom edge and back again', async () => {
    const { cards } = renderBoard()
    const card = cards[1]!
    const before = box(card).height
    const handle = within(card).getByRole('separator', { name: /^Resize the height of/ })

    await userEvent.dragAndDrop(handle, screen.getByTestId('below'))
    expect(box(card).height).toBeGreaterThan(before + 60)

    await userEvent.dblClick(handle)
    expect(Math.abs(box(card).height - before)).toBeLessThan(1)
  })
})
