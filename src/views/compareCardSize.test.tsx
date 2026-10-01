import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createDemoDocument } from '../domain/demo'
import { CompareNotesView } from './CompareNotesView'
import {
  MAX_CARD_HEIGHT,
  MIN_CARD_HEIGHT,
  MIN_CARD_WIDTH,
  clampCardHeight,
  clampCardWidth,
} from './compareCardSize'

describe('card size limits', () => {
  it('holds a width between the floor and the room the board has', () => {
    expect(clampCardWidth(100, 900)).toBe(MIN_CARD_WIDTH)
    expect(clampCardWidth(500.4, 900)).toBe(500)
    expect(clampCardWidth(1200, 900)).toBe(900)
    // A board narrower than the floor still leaves the floor, not a card too thin to read.
    expect(clampCardWidth(300, 200)).toBe(MIN_CARD_WIDTH)
  })

  it('holds a height between the floor and the ceiling', () => {
    expect(clampCardHeight(10)).toBe(MIN_CARD_HEIGHT)
    expect(clampCardHeight(9999)).toBe(MAX_CARD_HEIGHT)
  })
})

/*
 * jsdom lays nothing out, so each test says what the card measures and how much room the
 * board has. The pointer path is the browser suite's; this is the keyboard one, which is the
 * way a separator is reached without a pointer at all.
 */
function renderCard(measures: { width: number; height: number }, room = 1000) {
  render(
    <CompareNotesView
      applications={createDemoDocument().applications}
      onOpenStageNotes={() => {}}
      onSaveStageNote={async () => {}}
    />,
  )
  const card = within(screen.getByRole('region', { name: 'Offer' })).getAllByRole('article')[0]!
  card.getBoundingClientRect = () => new DOMRect(0, 0, measures.width, measures.height)
  Object.defineProperty(card.parentElement!, 'clientWidth', { configurable: true, value: room })
  return card
}

describe('resizing a comparison card from the keyboard', () => {
  it('steps the width from what the card measures, and Enter puts it back', () => {
    const card = renderCard({ width: 400, height: 300 })
    const handle = within(card).getByRole('separator', { name: /^Resize the width of/ })

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(card.style.width).toBe('416px')
    expect(handle).toHaveAttribute('aria-valuenow', '416')
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
    expect(card.style.width).toBe('336px')

    // Back to following the row, not to a number that happens to match the default.
    fireEvent.keyDown(handle, { key: 'Enter' })
    expect(card.style.width).toBe('')
    expect(card).not.toHaveClass('compare-notes__card--sized-width')
  })

  it('steps the height on the other pair of arrows, and a double-click resets it', () => {
    const card = renderCard({ width: 400, height: 300 })
    const handle = within(card).getByRole('separator', { name: /^Resize the height of/ })

    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(card.style.height).toBe('316px')
    // The width's arrows do nothing here, so one handle cannot move the other edge.
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(card.style.width).toBe('')

    fireEvent.doubleClick(handle)
    expect(card.style.height).toBe('')
  })

  it('does not widen a card past the board', () => {
    const card = renderCard({ width: 590, height: 300 }, 600)
    const handle = within(card).getByRole('separator', { name: /^Resize the width of/ })
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(card.style.width).toBe('600px')
  })
})
