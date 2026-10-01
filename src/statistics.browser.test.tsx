/**
 * Where one question on Statistics ends and the next begins has to be visible. A hairline
 * over each card was not enough: the lists, axes and bars inside a card draw hairlines of
 * their own, so a card's top edge read as one more line inside the card above it.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { page } from '@vitest/browser/context'

import { DEFAULT_DEMO_REFERENCE, createDemoDocument } from './domain/demo'
import { DEFAULT_STATS_SETTINGS } from './statsSettings'
import { StatisticsView } from './views/StatisticsView'

function mount() {
  render(
    <main className="view-surface">
      <StatisticsView
        applications={createDemoDocument().applications}
        onOpen={() => {}}
        onSettingChange={() => {}}
        settings={DEFAULT_STATS_SETTINGS}
        today={new Date(DEFAULT_DEMO_REFERENCE)}
      />
    </main>,
  )
  return [...document.querySelectorAll<HTMLElement>('.question-card')]
}

describe('the questions on Statistics', () => {
  for (const [name, width] of [['wide', 1300], ['narrow', 400]] as const) {
    it(`each reads as its own enclosed region (${name})`, async () => {
      await page.viewport(width, 900)
      const cards = mount()
      expect(cards).toHaveLength(9)

      for (const card of cards) {
        const style = getComputedStyle(card)
        // An edge on every side, not one line that the card's own contents also draw.
        for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
          expect(parseFloat(style[`border${side}Width`]), `${side} edge`).toBeGreaterThan(0)
          expect(style[`border${side}Style`]).not.toBe('none')
        }
      }

      // No two questions touch: there is space between every pair, so a boundary is never
      // shared and never reads as one card continuing into the next.
      const boxes = cards.map((card) => card.getBoundingClientRect())
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]!
          const b = boxes[j]!
          const apart = a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top
          expect(apart, `cards ${i} and ${j} touch or overlap`).toBe(true)
        }
      }
    })
  }

  for (const width of [1920, 2560]) {
    it(`uses the whole width of a large screen (${width}px)`, async () => {
      await page.viewport(width, 1200)
      const cards = mount()
      const groups = document.querySelector('.statistics__groups')!.getBoundingClientRect()
      const boxes = cards.map((card) => card.getBoundingClientRect())

      // Most of the column area holds cards. Before the tall card was split this was 64%
      // at 1920px — one column holding a single short card over a thousand pixels of
      // nothing — and 43% at 2560px, where two of six columns stood empty. A last-column
      // check alone passes the first of those, so measure the space instead.
      const gap = parseFloat(getComputedStyle(document.querySelector('.statistics__groups')!).columnGap)
      const columnWidth = boxes[0]!.width
      const columns = Math.round((groups.width + gap) / (columnWidth + gap))
      const filled = boxes.reduce((sum, box) => sum + box.height, 0)
      expect(filled / (columns * groups.height)).toBeGreaterThan(0.7)

      // And the last column holds a card, so the right of the screen is never left empty.
      const rightmost = Math.max(...boxes.map((box) => box.right))
      expect(groups.right - rightmost).toBeLessThan(2)
    })
  }
})
