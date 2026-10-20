/**
 * What only a browser can answer about the popovers and dialogs that open over the views:
 * whether each stays on screen and uncut by the board or table it opens inside, whether the
 * stages editor fits a phone, and whether the controls keep the touch size the
 * stylesheet promises under 760px. jsdom lays nothing out and applies no media queries.
 *
 * The real app is mounted on the demo (see `appHarness`). Panels are opened from the card
 * that is hardest on them — the last on the board, at the far edge of the scroller — rather
 * than from a chosen one.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { page, userEvent } from 'vitest/browser'

import {
  DESKTOP,
  PHONE,
  clippedBy,
  escapes,
  mountDemoApp,
  pinToDemoReference,
  releaseClock,
  settle,
  unmountDemoApp,
} from './test/appHarness'

const box = (element: Element) => element.getBoundingClientRect()

/** Puts away whatever a failed assertion left open, so the next test starts clean. */
async function dismiss(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const open = screen.queryByRole('dialog')
      ?? document.querySelector('.actions-menu__panel, .move-controls__panel')
    if (!open) return
    await userEvent.keyboard('{Escape}')
    await settle()
  }
}

function insideWindow(panel: Element, label: string): void {
  const edge = box(panel)
  expect(edge.left, label).toBeGreaterThanOrEqual(-1)
  expect(edge.right, label).toBeLessThanOrEqual(window.innerWidth + 1)
  expect(edge.top, label).toBeGreaterThanOrEqual(-1)
  expect(edge.bottom, label).toBeLessThanOrEqual(window.innerHeight + 1)
}

describe('the popovers and dialogs', () => {
  beforeAll(async () => {
    pinToDemoReference()
    await mountDemoApp()
  })

  afterEach(dismiss)

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

    it.each(['More actions', /^Theme:/])('keeps the %s panel on screen, every item on one piece', async (name) => {
      const trigger = within(document.querySelector<HTMLElement>('.topbar')!).getByRole('button', { name })
      await userEvent.click(trigger)
      const panel = document.querySelector<HTMLElement>('.actions-menu__panel')!
      insideWindow(panel, String(name))
      expect(clippedBy(panel)).toBeNull()
      expect(escapes(panel)).toEqual([])
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1)
    })

    it('keeps the End menu of the last card on screen and uncut by the board', async () => {
      const cards = [...document.querySelectorAll<HTMLElement>('.application-card')]
      const card = cards[cards.length - 1]
      card.scrollIntoView({ block: 'center', inline: 'center' })
      await settle()
      await userEvent.click(within(card).getByRole('button', { name: /^End/ }))
      const panel = card.querySelector<HTMLElement>('.move-controls__panel')!
      expect(panel).not.toBeNull()
      insideWindow(panel, 'End menu')
      expect(clippedBy(panel)).toBeNull()
      expect(escapes(panel)).toEqual([])
    })

    it('fits the window for the stages editor, with no box wider than the dialog', async () => {
      await userEvent.click(within(document.querySelector<HTMLElement>('.topbar')!).getByRole('button', { name: 'More actions' }))
      await userEvent.click(within(document.querySelector<HTMLElement>('.actions-menu__panel')!).getByRole('button', { name: /Stages/ }))
      const dialog = await screen.findByRole('dialog', { name: /Stages/ })
      insideWindow(dialog, 'Stages')
      const inner = dialog.clientWidth
      const wide = [...dialog.querySelectorAll<HTMLElement>('*')]
        .filter((node) => !node.closest('.sr-only') && box(node).width > inner + 1)
        .map((node) => `${node.tagName.toLowerCase()}.${node.className}`)
      expect(wide).toEqual([])
    })
  })

  describe('on a phone, where the controls grow to a finger', () => {
    beforeEach(async () => {
      await page.viewport(PHONE.width, PHONE.height)
      await settle()
    })

    it.each([
      ['the view strip', '.view-nav__item'],
      ['the filters', '.context-bar select'],
      ['the card\'s stage control', '.application-card__move'],
      ['the card\'s quick moves', '.application-card .move-controls__button'],
    ])('gives %s a 40px target', (_label, selector) => {
      const controls = [...document.querySelectorAll<HTMLElement>(selector)]
      expect(controls.length).toBeGreaterThan(0)
      for (const control of controls) {
        expect(box(control).height, `${selector} ${control.textContent}`).toBeGreaterThanOrEqual(39)
      }
    })
  })
})
