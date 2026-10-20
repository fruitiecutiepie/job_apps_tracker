/**
 * The app on a phone, in a real browser: what opens stays on screen, the Prep sidebar
 * starts out of the way, and how each surface looks is locked in by a screenshot.
 *
 * The screenshots are the website's arrangement (fruitiecutiepie.com's specimens): one
 * baseline per surface at phone and desktop width, committed, so a change to how
 * something looks fails here with a diff instead of being found on a phone. The clock is
 * pinned to the demo's reference instant, or "Idle 95 days" would be a different picture
 * tomorrow.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { page, userEvent } from 'vitest/browser'

import { DEFAULT_DEMO_REFERENCE, createDemoDocument } from './domain/demo'
import { KanbanView } from './views/KanbanView'
import { renderPanel } from './test/panelHarness'

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

function renderBoard() {
  render(
    <main>
      <section className="view-surface">
        <KanbanView
          applications={createDemoDocument().applications.filter((application) => !application.archived_at)}
          onArchive={vi.fn()}
          onCompleteAction={vi.fn()}
          onMove={vi.fn()}
          onOpen={vi.fn()}
          onOpenMessages={vi.fn()}
          onOpenPosting={vi.fn()}
          onOpenStageNotes={vi.fn()}
        />
      </section>
    </main>,
  )
}

/**
 * Whether a popup is wholly on screen and actually showing there: inside the window, and
 * the topmost thing at its own corners. The second half is what catches a panel clipped by
 * a scroller around it, which reports the box it would have had whatever is cut off.
 */
function expectOnScreen(panel: Element) {
  const box = panel.getBoundingClientRect()
  expect(box.left).toBeGreaterThanOrEqual(0)
  expect(box.top).toBeGreaterThanOrEqual(0)
  expect(box.right).toBeLessThanOrEqual(window.innerWidth)
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight)
  // In from each corner by more than the corner's rounding, which Firefox hit-tests: a
  // point inside the box but outside the curve is over whatever is behind.
  const inset = 12
  for (const [x, y] of [
    [box.left + inset, box.top + inset],
    [box.right - inset, box.top + inset],
    [box.left + inset, box.bottom - inset],
    [box.right - inset, box.bottom - inset],
  ]) {
    expect(panel.contains(document.elementFromPoint(x, y))).toBe(true)
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(DEFAULT_DEMO_REFERENCE))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('menus on a phone', () => {
  beforeEach(() => page.viewport(PHONE.width, PHONE.height))

  it('opens every card\'s End menu on screen, past the edge of the board', async () => {
    renderBoard()
    const board = document.querySelector<HTMLElement>('.kanban__scroller')!
    // Each End brought against the board's right edge first: that is where the menu ran
    // out of the board's scroll box and was cut off, and on a phone it is where the second
    // column's cards sit.
    for (const trigger of screen.getAllByRole('button', { name: /^End / })) {
      const edge = board.getBoundingClientRect().right - 8
      board.scrollLeft += trigger.getBoundingClientRect().right - edge
      if (trigger.getBoundingClientRect().bottom > window.innerHeight) continue
      await userEvent.click(trigger)
      expectOnScreen(trigger.parentElement!.querySelector('.move-controls__panel')!)
      await userEvent.click(trigger)
    }
  })

  it('locks in the board, and a card\'s End menu open on it', async () => {
    renderBoard()
    await expect.element(page.elementLocator(document.querySelector('.kanban')!)).toMatchScreenshot('kanban-phone')

    await userEvent.click(screen.getByRole('button', { name: 'End Northstar Labs' }))
    await expect.element(page.elementLocator(document.body)).toMatchScreenshot('kanban-end-menu-phone')
  })
})

describe('Prep on a phone', () => {
  beforeEach(() => page.viewport(PHONE.width, PHONE.height))

  it('starts with the sidebar closed, leaving the screen to the note', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: 'Sidebar' })).toHaveAttribute('aria-pressed', 'false')
    expect(document.querySelector('.panel__sidebar')).toBeNull()
  })

  it('opens Split and the shortcuts list on screen', async () => {
    renderPanel()
    const bar = document.querySelector<HTMLElement>('.panel__titlebar')!
    for (const name of ['Split', 'Keyboard shortcuts']) {
      const trigger = within(bar).getByRole('button', { name })
      await userEvent.click(trigger)
      expectOnScreen(trigger.parentElement!.querySelector('.panel__shortcuts-panel')!)
      await userEvent.keyboard('{Escape}')
    }
  })

  it('opens the stage picker over the title bar, clear of the keyboard', async () => {
    renderPanel()
    await userEvent.click(within(document.querySelector<HTMLElement>('.panel__titlebar')!).getByRole('button', { name: 'Open' }))
    const picker = document.querySelector('.quick-open')!
    expectOnScreen(picker)
    // In the top half: the keyboard a phone raises for its search box takes the bottom.
    expect(picker.getBoundingClientRect().top).toBeLessThan(window.innerHeight / 3)
  })

  it('locks in the panel', async () => {
    renderPanel()
    await expect.element(page.elementLocator(document.querySelector('.panel')!)).toMatchScreenshot('prep-phone')
  })
})

describe('on a desktop', () => {
  beforeEach(() => page.viewport(DESKTOP.width, DESKTOP.height))

  it('keeps the Prep sidebar open', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: 'Sidebar' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('locks in the board and the panel', async () => {
    renderBoard()
    await expect.element(page.elementLocator(document.querySelector('.kanban')!)).toMatchScreenshot('kanban-desktop')
    cleanup()
    renderPanel()
    await expect.element(page.elementLocator(document.querySelector('.panel')!)).toMatchScreenshot('prep-desktop')
  })
})
