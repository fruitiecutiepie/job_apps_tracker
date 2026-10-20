/**
 * What only a browser can answer about a first visit: whether the intro on the empty tracker
 * fits the window with its primary action in reach, and whether the topbar still fits once
 * the first application has been typed and the storage pill asks for a copy. jsdom lays
 * nothing out.
 *
 * The real app is mounted on the real tracker's profile (see `appHarness`), which opens
 * empty. The demo cannot show either surface: it seeds nineteen applications and never keeps
 * a backlog.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { page, userEvent } from 'vitest/browser'

import {
  DESKTOP,
  PHONE,
  escapes,
  mountEmptyApp,
  pageScrollsSideways,
  pinToDemoReference,
  releaseClock,
  settle,
  unmountDemoApp,
} from './test/appHarness'

const box = (element: Element) => element.getBoundingClientRect()

describe('a first visit', () => {
  beforeAll(async () => {
    pinToDemoReference()
    await mountEmptyApp()
  })

  afterAll(() => {
    unmountDemoApp()
    releaseClock()
  })

  describe.each([
    ['a laptop', DESKTOP],
    ['a phone', PHONE],
    ['the narrowest phone', { width: 320, height: 640 }],
  ])('on %s', (_name, viewport) => {
    beforeEach(async () => {
      await page.viewport(viewport.width, viewport.height)
      await settle()
    })

    it('shows the intro inside the window, its actions in reach', () => {
      const intro = document.querySelector<HTMLElement>('.storage-intro')!
      expect(intro).not.toBeNull()
      expect(box(intro).left).toBeGreaterThanOrEqual(-1)
      expect(box(intro).right).toBeLessThanOrEqual(window.innerWidth + 1)
      expect(escapes(intro)).toEqual([])
      expect(pageScrollsSideways()).toBe(false)
      for (const control of intro.querySelectorAll('button')) {
        expect(box(control).right).toBeLessThanOrEqual(box(intro).right + 1)
      }
    })

    it('keeps the intro\'s primary action on screen without scrolling, on a laptop', () => {
      if (window.innerWidth < 1000) return
      const intro = document.querySelector<HTMLElement>('.storage-intro')!
      const first = intro.querySelector('button')!
      expect(box(first).bottom).toBeLessThanOrEqual(window.innerHeight)
    })
  })

  describe('once the first application is typed', () => {
    beforeAll(async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height)
      await settle()
      await userEvent.click(within(document.querySelector<HTMLElement>('.topbar')!).getByRole('button', { name: 'Add application' }))
      const dialog = await screen.findByRole('dialog', { name: 'Add application' })
      await userEvent.type(within(dialog).getByLabelText('Company'), 'Pill Test Company')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Add application' }))
      await waitFor(() => expect(document.querySelector('.application-card')).not.toBeNull())
    })

    it.each([375, 761, 1280])('asks for a copy without widening the topbar at %ipx', async (width) => {
      await page.viewport(width, 800)
      await settle()
      const pill = document.querySelector<HTMLElement>('.storage-status--attention')
      expect(pill, 'a pill asking for a copy').not.toBeNull()
      expect(document.querySelector('.storage-intro')).toBeNull()
      expect(box(pill!).right).toBeLessThanOrEqual(window.innerWidth + 1)
      expect(escapes(document.querySelector('.topbar')!, undefined, '.view-nav')).toEqual([])
      expect(pageScrollsSideways()).toBe(false)
    })
  })
})
