/**
 * What only a browser can answer about the Kanban board: whether a card holds its own
 * contents, whether the controls on it stay on one line, and whether the board scrolls
 * inside its own box rather than pushing the page sideways. jsdom lays nothing out, so a
 * card measures zero whatever the stylesheet says.
 *
 * The real app is mounted on the demo's nineteen applications (see `appHarness`). A card
 * is checked against every card on the board rather than a chosen one: the assertion that
 * nothing sticks out is false for any cause, where a test naming one long company would be
 * green the day a different field grew.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { page, userEvent } from 'vitest/browser'

import {
  DESKTOP,
  PHONE,
  escapes,
  mountDemoApp,
  pageScrollsSideways,
  pinToDemoReference,
  releaseClock,
  settle,
  unmountDemoApp,
} from './test/appHarness'

const box = (element: Element) => element.getBoundingClientRect()

function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.application-card')]
}

describe('the Kanban board', () => {
  beforeAll(async () => {
    pinToDemoReference()
    await mountDemoApp()
  })

  afterAll(() => {
    unmountDemoApp()
    releaseClock()
  })

  describe.each([
    ['a laptop', DESKTOP],
    ['a phone', PHONE],
  ])('on %s', (_name, viewport) => {
    beforeEach(async () => {
      await page.viewport(viewport.width, viewport.height)
      await settle()
    })

    it('opens on the board, with a card for each application in view', () => {
      // The demo's default view reads 18 of 19: one is archived and stays out of sight.
      expect(cards()).toHaveLength(18)
    })

    it('keeps every card inside its lane, and every box inside its card', () => {
      for (const card of cards()) {
        const lane = card.closest('.kanban-lane')!
        expect(box(card).right, card.textContent ?? '').toBeLessThanOrEqual(box(lane).right + 1)
        expect(escapes(card)).toEqual([])
      }
    })

    it('scrolls the board inside its own box, which itself stays inside the window', () => {
      const scroller = document.querySelector<HTMLElement>('.kanban__scroller')!
      // Ten columns of 250px cannot fit a phone, and do not fit a laptop with the gutters.
      expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth)
      expect(box(scroller).right).toBeLessThanOrEqual(window.innerWidth + 1)
    })

    it('draws every column at one width, however many lanes it holds', () => {
      const widths = [...document.querySelectorAll('.kanban-column')].map((column) =>
        Math.round(box(column).width),
      )
      expect(widths).toHaveLength(10)
      expect(new Set(widths)).toEqual(new Set([250]))
    })

    it('keeps the quick moves on one line, inside the card', () => {
      const rows = [...document.querySelectorAll<HTMLElement>('.move-controls')]
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        const buttons = [...row.querySelectorAll('button')].map((button) => box(button))
        const tops = new Set(buttons.map((button) => Math.round(button.top)))
        expect(tops.size, row.textContent ?? '').toBe(1)
        expect(box(row).right).toBeLessThanOrEqual(box(row.closest('.application-card')!).right + 1)
      }
    })

    it('lays the stage select over its trigger, so the trigger is what a press lands on', () => {
      for (const card of cards()) {
        const trigger = card.querySelector<HTMLElement>('.application-card__move')!
        const select = trigger.querySelector<HTMLSelectElement>('select')!
        const triggerBox = box(trigger)
        const selectBox = box(select)
        expect(getComputedStyle(select).opacity).toBe('0')
        expect(Math.abs(selectBox.left - triggerBox.left)).toBeLessThanOrEqual(1)
        expect(Math.abs(selectBox.right - triggerBox.right)).toBeLessThanOrEqual(1)
        expect(Math.abs(selectBox.top - triggerBox.top)).toBeLessThanOrEqual(1)
        expect(Math.abs(selectBox.bottom - triggerBox.bottom)).toBeLessThanOrEqual(1)
        const centre = [triggerBox.left + triggerBox.width / 2, triggerBox.top + triggerBox.height / 2]
        card.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        const at = document.elementFromPoint(
          box(trigger).left + box(trigger).width / 2,
          box(trigger).top + box(trigger).height / 2,
        )
        // Only meaningful while the card is on screen; a scroll above brought it there.
        expect(at, `${centre}`).toBe(select)
      }
    })
  })

  it.each([
    ['a laptop', DESKTOP],
    ['a phone', PHONE],
  ])('does not widen the page on %s', async (_name, viewport) => {
    await page.viewport(viewport.width, viewport.height)
    await settle()
    expect(pageScrollsSideways()).toBe(false)
  })

  describe('with the archived application showing', () => {
    const archiveFilter = () => screen.getByRole('combobox', { name: 'Filter by archive' })

    beforeAll(async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height)
      await userEvent.selectOptions(archiveFilter(), 'Current and archived')
    })

    afterAll(async () => {
      await userEvent.selectOptions(archiveFilter(), 'Current search')
    })

    it('draws it dashed and transparent, apart from the cards around it', () => {
      expect(cards()).toHaveLength(19)
      const archived = document.querySelector<HTMLElement>('.application-card--archived')!
      const current = cards().find((card) => !card.matches('.application-card--archived'))!
      expect(within(archived).getByText('Archived')).toBeVisible()
      expect(getComputedStyle(archived).borderStyle).toBe('dashed')
      expect(getComputedStyle(current).borderStyle).toBe('solid')
      expect(getComputedStyle(archived).backgroundColor).not.toBe(
        getComputedStyle(current).backgroundColor,
      )
      expect(escapes(archived)).toEqual([])
    })
  })
})
