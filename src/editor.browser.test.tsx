/**
 * What only a browser can answer about the application editor: whether the dialog fits the
 * window, whether any box inside it is wider than the dialog, whether Save stays reachable,
 * and whether the next action's three controls share a baseline. jsdom lays nothing out.
 *
 * The real app is mounted on the demo (see `appHarness`) and the editor is opened from every
 * card on the board rather than a chosen one: the demo's applications differ in how much
 * they hold — messages, invites, ratings, compensation, a posting, long history — and a
 * layout rule that fails for one of them is the one a user will find.
 *
 * The assertions are the ones that are false for any cause: no box wider than the dialog
 * (`dialogScroll.browser.test.tsx` explains why `scrollWidth` is not that), the dialog inside
 * the window, and the actions strip inside it.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

function cardNames(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.application-card__open strong')].map(
    (name) => name.textContent ?? '',
  )
}

async function openEditor(company: string): Promise<HTMLElement> {
  const card = [...document.querySelectorAll<HTMLElement>('.application-card')].find(
    (candidate) => candidate.querySelector('.application-card__open strong')?.textContent === company,
  )!
  await userEvent.click(card.querySelector('.application-card__open')!)
  return screen.findByRole('dialog')
}

async function closeEditor(): Promise<void> {
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => screen.queryByRole('dialog')).toBeNull()
}

describe('the application editor', () => {
  beforeAll(async () => {
    pinToDemoReference()
    await mountDemoApp()
  })

  // A failed assertion leaves the dialog open, and every test after it would wait on it.
  afterEach(async () => {
    if (screen.queryByRole('dialog')) await closeEditor()
  })

  afterAll(() => {
    unmountDemoApp()
    releaseClock()
  })

  describe.each([
    ['a laptop', DESKTOP],
    ['a tablet', { width: 761, height: 800 }],
    ['a phone', PHONE],
    ['the narrowest phone', { width: 320, height: 640 }],
  ])('on %s', (_name, viewport) => {
    beforeEach(async () => {
      await page.viewport(viewport.width, viewport.height)
      await settle()
    })

    it('fits the window for every application, with no box wider than the dialog', async () => {
      const names = cardNames()
      expect(names).toHaveLength(18)
      for (const name of names) {
        const dialog = await openEditor(name)
        const edge = box(dialog)
        expect(edge.left, name).toBeGreaterThanOrEqual(-1)
        expect(edge.right, name).toBeLessThanOrEqual(window.innerWidth + 1)
        expect(edge.bottom, name).toBeLessThanOrEqual(window.innerHeight + 1)
        const inner = dialog.clientWidth
        const wide = [...dialog.querySelectorAll<HTMLElement>('*')]
          .filter((node) => !node.closest('.sr-only') && box(node).width > inner + 1)
          .map((node) => `${node.tagName.toLowerCase()}.${node.className} ${Math.round(box(node).width)}>${inner}`)
        expect(wide, name).toEqual([])
        // Save is pinned to the foot of the dialog, so a long form never scrolls it away.
        const actions = dialog.querySelector<HTMLElement>('.dialog__actions')!
        expect(box(actions).bottom, name).toBeLessThanOrEqual(window.innerHeight + 1)
        expect(box(actions).top, name).toBeGreaterThanOrEqual(0)
        await closeEditor()
      }
    })
  })

  it('lines the next action, its date and Done up on the inputs, in that order', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await settle()
    // The first card carrying a task: Done renders only where there is one.
    const withTask = [...document.querySelectorAll<HTMLElement>('.application-card')].find((card) =>
      card.querySelector('.application-card__action'),
    )!
    await userEvent.click(withTask.querySelector('.application-card__open')!)
    const dialog = await screen.findByRole('dialog')
    const row = dialog.querySelector<HTMLElement>('.next-action-field')!
    const [action, date] = row.querySelectorAll<HTMLElement>('input')
    const done = within(row).getByRole('button', { name: 'Mark next action done' })
    // Source order is what a keyboard walks: the control follows the fields it acts on.
    expect(action.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(date.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Aligned on the inputs rather than on the labels above them.
    expect(Math.abs(box(done).bottom - box(action).bottom)).toBeLessThanOrEqual(2)
    expect(Math.abs(box(date).bottom - box(action).bottom)).toBeLessThanOrEqual(2)
    // All on one line.
    expect(Math.abs(box(done).top - box(action).top)).toBeLessThan(box(action).height)
    await closeEditor()
  })
})
