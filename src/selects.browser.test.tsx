/**
 * What only a browser can answer about a native select: whether it is as tall as its
 * stylesheet asks. jsdom lays nothing out, and the engines disagree — see below.
 *
 * The real app is mounted on the demo (see `appHarness`).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { page, userEvent } from 'vitest/browser'

import {
  DESKTOP,
  PHONE,
  mountDemoApp,
  pinToDemoReference,
  releaseClock,
  settle,
  unmountDemoApp,
} from './test/appHarness'

const box = (element: Element) => element.getBoundingClientRect()

/*
 * WebKit ignores `min-height` on a native select and sizes it to its text, so a select that
 * asks for a floor and says nothing else renders 21px tall on every iPhone and in Safari
 * while Chromium draws it at the size asked. The stylesheet says `height` as well wherever
 * the size matters; this is what notices a select added without it.
 */
describe('every select', () => {
  beforeAll(async () => {
    pinToDemoReference()
    await mountDemoApp()
  })

  afterAll(() => {
    unmountDemoApp()
    releaseClock()
  })

  /*
   * The floor is a number rather than the computed `min-height`: WebKit reports 18px for a
   * select whatever the stylesheet declares, so reading the floor back from the engine that
   * ignores it would excuse the very thing this checks. 28px is the smallest a select in
   * these views is asked to be, and 40px is what the stylesheet raises them all to at phone
   * width.
   */
  it.each([
    ['a laptop', DESKTOP, 28],
    ['a phone', PHONE, 40],
  ])('is as tall as it was asked to be on %s, in the board and then the table', async (_name, viewport, floor) => {
    await page.viewport(viewport.width, viewport.height)
    await settle()
    for (const view of ['Kanban', 'Table']) {
      await userEvent.click(within(screen.getByRole('navigation', { name: 'Tracker views' })).getByRole('button', { name: view }))
      await settle()
      const selects = [...document.querySelectorAll<HTMLSelectElement>('select')]
        // The card's stage select is laid invisibly over its trigger and takes the trigger's size.
        .filter((select) => getComputedStyle(select).opacity !== '0')
        .filter((select) => box(select).width > 0)
      expect(selects.length, view).toBeGreaterThan(0)
      const short = selects
        .filter((select) => box(select).height < floor - 1)
        .map((select) => `${select.getAttribute('aria-label')} ${Math.round(box(select).height)}<${floor}`)
      expect(short, `${view} on ${viewport.width}px`).toEqual([])
    }
  })
})
