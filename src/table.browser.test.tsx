/**
 * What only a browser can answer about the Table view: whether the band headings span the
 * whole table, whether the quick moves in the Stage cell stay on one line inside it, whether
 * the table scrolls inside its own box, and whether a column's width follows its handle.
 * jsdom lays nothing out, so every one of these measures zero there.
 *
 * The real app is mounted on the demo's nineteen applications (see `appHarness`), and the
 * demo populates every band, so no heading goes unexercised. Cells are checked across every
 * row rather than a chosen one: "nothing sticks out of its cell" is false for any cause,
 * where a test naming one long company would be green the day a different column grew.
 */

// First, for the backend it selects; see `appEnv`.
import {
  DESKTOP,
  PHONE,
  clippedBy,
  escapes,
  mountDemoApp,
  pageScrollsSideways,
  pinToDemoReference,
  releaseClock,
  settle,
  unmountDemoApp,
} from './test/appHarness'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { page, userEvent } from 'vitest/browser'

import { URGENCY_BANDS } from './views/urgencyBands'

const box = (element: Element) => element.getBoundingClientRect()

const table = () => document.querySelector<HTMLTableElement>('.table-view table')!
const bodyRows = () => [...document.querySelectorAll<HTMLElement>('.table-view tbody tr:not(.table-view__band)')]

describe('the Table view', () => {
  beforeAll(async () => {
    pinToDemoReference()
    await mountDemoApp()
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Tracker views' })).getByRole('button', { name: 'Table' }),
    )
    await screen.findByRole('heading', { name: 'All applications' })
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

    it('opens banded by urgency, every band under a heading that spans the table', () => {
      const columns = table().querySelectorAll('thead th').length
      const headings = [...document.querySelectorAll<HTMLTableCellElement>('.table-view__band th')]
      expect(headings.map((heading) => heading.querySelector('.table-view__band-heading')!.textContent))
        .toEqual(URGENCY_BANDS.map((band) => band.heading))
      for (const heading of headings) {
        expect(heading.getAttribute('scope')).toBe('rowgroup')
        expect(heading.colSpan).toBe(columns)
        expect(Math.round(box(heading).width)).toBe(Math.round(box(table()).width))
        // Each band is its own tbody, so the heading is the first thing in its group.
        expect(heading.closest('tbody')!.firstElementChild).toBe(heading.parentElement)
      }
    })

    it('scrolls inside its own box, which itself stays inside the window', () => {
      const scroller = document.querySelector<HTMLElement>('.table-scroll')!
      // Fifteen columns at 160px each, on either screen.
      expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth)
      expect(box(scroller).right).toBeLessThanOrEqual(window.innerWidth + 1)
    })

    it('keeps every cell\'s contents inside the cell', () => {
      expect(bodyRows().length).toBe(18)
      for (const row of bodyRows()) {
        for (const cell of row.querySelectorAll('td, th')) {
          expect(escapes(cell), `${row.textContent?.slice(0, 40)}`).toEqual([])
        }
      }
    })

    it('keeps the quick moves on one line, inside the Stage cell', () => {
      const rows = [...document.querySelectorAll<HTMLElement>('.move-controls--table')]
      expect(rows).toHaveLength(18)
      for (const row of rows) {
        const buttons = [...row.querySelectorAll('button')].map((button) => box(button))
        expect(new Set(buttons.map((button) => Math.round(button.top))).size).toBe(1)
        expect(box(row).right).toBeLessThanOrEqual(box(row.closest('td')!).right + 1)
      }
    })
  })

  describe('on a laptop', () => {
    beforeEach(async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height)
      await settle()
    })

    it('opens the End menu from the first and the last running row, on top and uncut', async () => {
      // A finished row offers Reopen, not End.
      const running = bodyRows().filter((candidate) => within(candidate).queryByRole('button', { name: /^End/ }))
      for (const row of [running[0], running[running.length - 1]]) {
        const name = row.textContent?.slice(0, 30)
        row.scrollIntoView({ block: 'center', inline: 'nearest' })
        await settle()
        await userEvent.click(within(row).getByRole('button', { name: /^End/ }))
        const panel = row.querySelector<HTMLElement>('.move-controls__panel')!
        expect(panel, name).not.toBeNull()
        try {
          expect(box(panel).right, name).toBeLessThanOrEqual(window.innerWidth + 1)
          expect(clippedBy(panel), name).toBeNull()
          // What is on top at its middle is the panel, not the row it opened over.
          const middle = document.elementFromPoint(box(panel).left + box(panel).width / 2, box(panel).top + box(panel).height / 2)
          expect(panel.contains(middle), name).toBe(true)
        } finally {
          await userEvent.keyboard('{Escape}')
        }
      }
    })

    it('does not widen the page, however wide the table is', () => {
      expect(pageScrollsSideways()).toBe(false)
    })

    it('widens a column by a step on the arrow key, and takes it back', async () => {
      const handle = screen.getByRole('separator', { name: 'Resize Company column' })
      const header = handle.closest('th')!
      const before = box(header).width
      const value = Number(handle.getAttribute('aria-valuenow'))
      handle.focus()
      await userEvent.keyboard('{ArrowRight}')
      expect(Number(handle.getAttribute('aria-valuenow'))).toBeGreaterThan(value)
      expect(box(header).width).toBeGreaterThan(before + 1)
      await userEvent.keyboard('{ArrowLeft}')
      expect(Math.abs(box(header).width - before)).toBeLessThanOrEqual(1)
    })

    it('tints an archived row and bars its left edge, apart from the rows around it', async () => {
      const archive = screen.getByRole('combobox', { name: 'Filter by archive' })
      await userEvent.selectOptions(archive, 'Current and archived')
      try {
        expect(bodyRows()).toHaveLength(19)
        const archived = document.querySelector<HTMLElement>('.table-row--archived')!
        const current = bodyRows().find((row) => !row.matches('.table-row--archived'))!
        const cell = (row: HTMLElement) => row.querySelector('td')!
        expect(getComputedStyle(cell(archived)).backgroundColor)
          .not.toBe(getComputedStyle(cell(current)).backgroundColor)
        expect(getComputedStyle(archived.querySelector('th')!).boxShadow).not.toBe('none')
        expect(getComputedStyle(current.querySelector('th')!).boxShadow).toBe('none')
        expect(archived.textContent).toContain('Archived')
      } finally {
        await userEvent.selectOptions(archive, 'Current search')
      }
    })
  })
})
