/**
 * What only a browser can answer about the shell around the views: whether the topbar fits
 * the window at every width the app is used at, whether the context bar stays put while a
 * filter is chosen, and whether the Prep view is pinned to the window rather than scrolling
 * the page. jsdom lays nothing out and applies no media queries, so each of these is
 * unanswerable there.
 *
 * The real app is mounted on the demo (see `appHarness`). The widths are either side of the
 * two breakpoints the topbar has — 760px and 1000px — and the narrowest a phone is.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { page, userEvent } from 'vitest/browser'

import {
  escapes,
  mountDemoApp,
  pageScrollsSideways,
  pinToDemoReference,
  releaseClock,
  settle,
  unmountDemoApp,
} from './test/appHarness'

const box = (element: Element) => element.getBoundingClientRect()
const topbar = () => document.querySelector<HTMLElement>('.topbar')!

const WIDTHS = [320, 375, 600, 760, 761, 1000, 1001, 1280]

describe('the shell', () => {
  beforeAll(async () => {
    pinToDemoReference()
    await mountDemoApp()
  })

  afterAll(() => {
    unmountDemoApp()
    releaseClock()
  })

  describe.each(WIDTHS)('the topbar at %ipx', (width) => {
    beforeEach(async () => {
      await page.viewport(width, 800)
      await settle()
    })

    it('does not widen the page', () => {
      expect(pageScrollsSideways()).toBe(false)
    })

    it('keeps every control inside the bar', () => {
      // The strip of views scrolls on purpose when the bar is tight; it is checked as a box.
      expect(escapes(topbar(), topbar(), '.view-nav')).toEqual([])
      expect(box(topbar()).right).toBeLessThanOrEqual(window.innerWidth + 1)
    })
  })

  it('puts the views beside the actions on a laptop, and on a row of their own under 1000px', async () => {
    await page.viewport(1280, 800)
    await settle()
    const identity = document.querySelector('.topbar__identity')!
    const places = document.querySelector('.topbar__places')!
    expect(box(places).top).toBeLessThan(box(identity).bottom)

    await page.viewport(800, 800)
    await settle()
    expect(box(places).top).toBeGreaterThanOrEqual(box(identity).bottom - 1)
  })

  describe('the context bar', () => {
    const filters = () => [...document.querySelectorAll<HTMLSelectElement>('.context-bar__filters select')]

    beforeEach(async () => {
      await page.viewport(1280, 800)
      await settle()
    })

    it('draws every filter at one width', () => {
      const widths = filters().map((select) => Math.round(box(select).width))
      expect(widths.length).toBeGreaterThan(3)
      expect(new Set(widths).size).toBe(1)
    })

    it('does not move under the pointer when a filter is chosen', async () => {
      const clear = () => screen.getByRole('button', { name: 'Clear filters' })
      const before = [...filters(), clear()].map((element) => box(element).toJSON())
      expect(clear()).toBeDisabled()
      const stage = screen.getByRole('combobox', { name: 'Filter by stage' })
      await userEvent.selectOptions(stage, 'Round 1')
      try {
        expect(clear()).toBeEnabled()
        const after = [...filters(), clear()].map((element) => box(element).toJSON())
        expect(after).toEqual(before)
      } finally {
        await userEvent.click(clear())
      }
    })
  })

  describe.each(WIDTHS)('every view at %ipx', (width) => {
    it.each(['Kanban', 'Table', 'Statistics', 'Compare'])('keeps %s inside the window', async (view) => {
      await page.viewport(width, 800)
      await settle()
      if (document.querySelector('.view-surface--panel')) {
        await userEvent.click(within(topbar()).getByRole('button', { name: 'Prep' }))
      }
      await userEvent.click(within(screen.getByRole('navigation', { name: 'Tracker views' })).getByRole('button', { name: view }))
      await settle()
      expect(pageScrollsSideways(), view).toBe(false)
      const main = document.querySelector<HTMLElement>('main')!
      // The board and the table scroll inside their own boxes on purpose.
      expect(escapes(main, main, '.kanban__scroller, .table-scroll, .view-nav'), view).toEqual([])
    })
  })

  describe.each([1280, 375])('Prep, laid over the shell at %ipx', (width) => {
    beforeEach(async () => {
      await page.viewport(width, 800)
      await settle()
      if (!document.querySelector('.view-surface--panel')) {
        await userEvent.click(within(topbar()).getByRole('button', { name: 'Prep' }))
      }
      await settle()
    })

    it('leaves the page nothing to scroll, and drops the context bar', () => {
      expect(document.querySelector('.context-bar')).toBeNull()
      expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight + 1)
      expect(pageScrollsSideways()).toBe(false)
      expect(box(document.querySelector('.view-surface--panel')!).bottom).toBeLessThanOrEqual(window.innerHeight + 1)
    })
  })
})
