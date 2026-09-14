/**
 * What only a browser can answer about the prep notes panel.
 *
 * The jsdom suite covers what the panel does; this covers where things end up, which jsdom
 * cannot say at all. It has no layout — every box measures zero — and it applies no media
 * queries, so "these two panes sit side by side", "this pane is still wide enough to read",
 * and "a narrow window stacks them" are all unanswerable there. The resize drag is the
 * sharpest case: its arithmetic divides by the split's width, so in jsdom the handler's own
 * guard returns before the code under test runs, and only a stubbed box gets past it.
 *
 * These tests mount the panel directly with stub callbacks. Nothing here loads or stores a
 * note, which is deliberate: the dev server's `/__db` reads and writes the real tracker
 * file, and a suite that measures pixels has no business anywhere near it. `fetch` throws
 * in the setup, and the server behind this config has no such route to begin with.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'

import { createDemoDocument } from './domain/demo'
import { stateLabel } from './domain'
import type { Application } from './domain'
import { StageNotesPanel } from './StageNotesPanel'
import { openingLayout } from './notesArrangement'

/** Two companies with notes between them, which is all any of these tests needs. */
const COMPANIES = ['Halcyon Maps', 'Echo Robotics']

/** Wider than the 760px breakpoint where panes stop being laid out in a row. */
const WIDE = { width: 1280, height: 800 }

function fixtureApplications(): Application[] {
  return createDemoDocument().applications.filter((application) =>
    COMPANIES.includes(application.company),
  )
}

/** The same fixture with one note long enough to overflow a pane, for the scrolling test. */
function withLongNote(applications: Application[]): Application[] {
  const long = Array.from({ length: 120 }, (_, line) => `- Line ${line + 1} of a long note`)
    .join('\n')
  return applications.map((application) =>
    application.company === 'Halcyon Maps'
      ? {
          ...application,
          stage_notes: application.stage_notes.map((note) =>
            note.state === application.state ? { ...note, body: long } : note,
          ),
        }
      : application,
  )
}

function renderPanel(applications = fixtureApplications()) {
  const halcyon = applications.find((application) => application.company === 'Halcyon Maps')!
  const layout = openingLayout(halcyon, halcyon.state)
  render(
    /*
     * Mounted inside the page structure it lives in — the shell column, a stand-in for the
     * chrome above it, and the view surface — because the panel's height now comes from
     * that column rather than from a viewport measurement. A bare mount would size itself
     * correctly whatever the chain above it did.
     */
    <div className="app-shell">
      <header className="topbar">
        <span>Chrome above the panel</span>
      </header>
      <main>
        <div className="context-bar">
          <h1>Prep notes</h1>
        </div>
        <section className="view-surface view-surface--panel">
          <section aria-label="Stage prep notes" className="panel-view">
            <StageNotesPanel
              applications={applications}
              initial={{ layout, focusedGroupId: layout.id }}
              onArrange={() => {}}
              onCapture={async () => {}}
              onEmpty={() => {}}
              onExternalChange={async () => {}}
              onRevise={async () => {}}
              onSaveDrafts={async () => true}
              request={null}
            />
          </section>
        </section>
      </main>
    </div>,
  )
  return { halcyon }
}

/** The box a pane occupies, which is the sized wrapper rather than the note inside it. */
function paneBoxes(): DOMRect[] {
  return screen
    .getAllByRole('tabpanel')
    .map((pane) => (pane.closest('.panel__split-child') ?? pane).getBoundingClientRect())
}

const splitBox = () =>
  document.querySelector('.panel__split')!.getBoundingClientRect()

/** Splits downward, which the keyboard reaches without depending on a drag. */
const splitDown = () => userEvent.keyboard('{Control>}{Shift>}{ArrowDown}{/Shift}{/Control}')

describe('the panel in a real browser', () => {
  beforeEach(async () => {
    // Explicit per test: `page.viewport` outlives the test that called it.
    await page.viewport(WIDE.width, WIDE.height)
  })

  it('lays two panes side by side, each wide enough to read a note in', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Split' }))

    const [left, right] = paneBoxes()
    expect(paneBoxes()).toHaveLength(2)

    // Side by side: level with each other, and the second starting where the first ends.
    expect(Math.abs(left.top - right.top)).toBeLessThan(2)
    expect(right.left).toBeGreaterThanOrEqual(left.right - 1)
    // Near enough equal, allowing for the handle between them.
    expect(Math.abs(left.width - right.width)).toBeLessThan(20)
    // A pane nobody could read a note in would satisfy every assertion above.
    expect(left.width).toBeGreaterThan(200)
    expect(left.height).toBeGreaterThan(200)
  })

  it('ends inside the viewport, under the chrome above it', async () => {
    renderPanel()

    const panel = document.querySelector('.panel')!.getBoundingClientRect()
    const status = document.querySelector('.panel__statusbar')!.getBoundingClientRect()
    const chrome = document.querySelector('.topbar')!.getBoundingClientRect()

    // Below the header rather than under it, and ending on screen rather than past it:
    // the status bar is the last row of the panel's grid, so it is what falls off first.
    expect(panel.top).toBeGreaterThanOrEqual(chrome.bottom - 1)
    expect(panel.bottom).toBeLessThanOrEqual(WIDE.height + 1)
    expect(status.bottom).toBeLessThanOrEqual(WIDE.height + 1)
    // And tall enough to read a note in, not merely inside the window.
    expect(panel.height).toBeGreaterThan(300)
  })

  it('keeps the panel inside a narrow window, where the chrome above it wraps', async () => {
    renderPanel()
    await page.viewport(480, 800)

    const panel = document.querySelector('.panel')!.getBoundingClientRect()
    expect(panel.bottom).toBeLessThanOrEqual(801)
    expect(document.querySelector('.panel__statusbar')!.getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(801)
  })

  it('leaves the page nothing to scroll, at a tall window and a short one', async () => {
    renderPanel()

    // The panel pins its title bar and its status bar, so a page that scrolled behind it
    // would carry both off screen — the arrangement would still be there, just not where
    // it says it is.
    for (const height of [WIDE.height, 480]) {
      await page.viewport(WIDE.width, height)
      const shell = document.querySelector('.app-shell')!
      expect(shell.scrollHeight).toBeLessThanOrEqual(height + 1)
      expect(document.documentElement.scrollHeight)
        .toBeLessThanOrEqual(document.documentElement.clientHeight + 1)
      expect(document.querySelector('.panel')!.getBoundingClientRect().bottom)
        .toBeLessThanOrEqual(height + 1)
    }
  })

  it('narrows the notes column to the panel rather than to its own content', async () => {
    renderPanel()
    await page.viewport(900, 800)

    // The notes are a grid item whose track is `auto`, so without a floor of zero the
    // column takes its min-content — about a thousand pixels of tab strip, header and
    // capture box — and the panel clips the difference. What goes first is the right of
    // every note, the breadcrumbs, and the status bar's save state.
    const panel = document.querySelector('.panel')!.getBoundingClientRect()
    for (const selector of ['.panel__notes', '.panel__breadcrumbs', '.panel__statusbar', '.panel__pane']) {
      const box = document.querySelector(selector)!.getBoundingClientRect()
      expect(box.right).toBeLessThanOrEqual(panel.right + 1)
    }
  })

  it('scrolls a strip to the tab just opened, once there are more than fit', async () => {
    const { halcyon } = renderPanel()
    await page.viewport(640, 800)

    const strip = () => document.querySelector('.panel__tabs')!
    const activeTab = () => strip().querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!

    // Enough tabs that the strip overflows, which is the only state this is about. None
    // of them is a stage the fixture already has open — the picker offers a row's other
    // stages, and one already on a tab is not among them.
    const opening = ['applied', 'recruiter_messaged', 'recruiter_interview', 'take_home_assessment'] as const
    for (const state of opening) {
      await userEvent.click(screen.getByRole('button', { name: 'Open' }))
      await userEvent.selectOptions(
        screen.getByRole('combobox', { name: new RegExp(`Other stages for ${halcyon.company}`) }),
        [stateLabel(state)],
      )
    }
    expect(strip().scrollWidth).toBeGreaterThan(strip().clientWidth)

    // The tab that names the note now showing is in view rather than off the end of the
    // strip — jsdom cannot tell these apart, which is why it is asked here.
    const box = strip().getBoundingClientRect()
    const tab = activeTab().getBoundingClientRect()
    expect(tab.left).toBeGreaterThanOrEqual(box.left - 1)
    expect(tab.right).toBeLessThanOrEqual(box.right + 1)
  })

  it('stacks the panes when the panel is narrow in a window that is not', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Split' }))
    expect(paneBoxes()[1].left).toBeGreaterThan(paneBoxes()[0].left)

    // A wide window with a narrow panel in it — what a media query cannot tell apart from
    // a wide panel, and the reason the panel's own layout is asked of the panel.
    const surface = document.querySelector<HTMLElement>('.view-surface--panel')!
    surface.style.width = '520px'

    const [first, second] = paneBoxes()
    expect(Math.abs(first.left - second.left)).toBeLessThan(2)
    expect(second.top).toBeGreaterThanOrEqual(first.bottom - 1)
    // And nothing runs past the panel it is in.
    const panel = document.querySelector('.panel')!.getBoundingClientRect()
    expect(first.right).toBeLessThanOrEqual(panel.right + 1)
  })

  it('stacks the panes when the split runs the other way', async () => {
    renderPanel()
    await splitDown()

    const [top, bottom] = paneBoxes()
    expect(paneBoxes()).toHaveLength(2)

    expect(Math.abs(top.left - bottom.left)).toBeLessThan(2)
    expect(bottom.top).toBeGreaterThanOrEqual(top.bottom - 1)
    expect(top.width).toBeGreaterThan(200)
  })

  it('stacks a row of panes at a narrow window, where jsdom applies no media query', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Split' }))

    // Wide: side by side.
    expect(paneBoxes()[1].left).toBeGreaterThan(paneBoxes()[0].left)

    // Narrower than the 760px breakpoint, with the same tree underneath.
    await page.viewport(600, 800)

    const [first, second] = paneBoxes()
    expect(Math.abs(first.left - second.left)).toBeLessThan(2)
    expect(second.top).toBeGreaterThanOrEqual(first.bottom - 1)
    // Still two panes: the arrangement changed direction, not shape.
    expect(screen.getAllByRole('tablist')).toHaveLength(2)
  })

  it('resizes both panes when the handle is dragged, and keeps them tiling the split', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Split' }))

    const before = paneBoxes()
    const handle = screen.getByRole('separator', { name: 'Resize pane 1 and pane 2' })
    // The handle has real width here, which is what the arithmetic divides by — in jsdom
    // it is zero and the handler returns before doing anything.
    expect(handle.getBoundingClientRect().width).toBeGreaterThan(0)

    // Dragged towards the far pane's own tab strip, which is well to the right.
    await userEvent.dragAndDrop(handle, screen.getAllByRole('tablist')[1])

    const after = paneBoxes()
    expect(after[0].width).toBeGreaterThan(before[0].width + 20)
    expect(after[1].width).toBeLessThan(before[1].width - 20)
    // Still tiling: the two panes and the handle account for the whole split.
    const total = after[0].width + after[1].width + handle.getBoundingClientRect().width
    expect(Math.abs(total - splitBox().width)).toBeLessThan(4)
  })

  it('holds a pane at its minimum rather than dragging it out of sight', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Split' }))

    const handle = screen.getByRole('separator', { name: 'Resize pane 1 and pane 2' })
    // The outline sidebar is the leftmost thing on screen, so this drags well past the limit.
    await userEvent.dragAndDrop(handle, screen.getByRole('list', { name: 'Outline' }))

    const [left] = paneBoxes()
    const share = left.width / splitBox().width
    // MIN_PANE_FRACTION is 0.15. Still on screen, still that wide, not collapsed.
    expect(share).toBeGreaterThan(0.1)
    expect(share).toBeLessThan(0.25)
    expect(left.width).toBeGreaterThan(0)
    expect(screen.getAllByRole('tabpanel')).toHaveLength(2)
  })

  it('answers the keyboard chord that moves a tab, if the browser lets it through', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Split' }))

    const tabCounts = () =>
      screen.getAllByRole('tablist').map((strip) => within(strip).getAllByRole('tab').length)
    expect(tabCounts()).toEqual([2, 1])

    // Whether this reaches the page at all is the question: nothing intercepts a chord in
    // jsdom, and a real browser or window manager can take one first.
    await userEvent.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')

    expect(tabCounts()).toEqual([1, 2])
  })

  it('scrolls a long note inside its own card, not the page', async () => {
    renderPanel(withLongNote(fixtureApplications()))

    const note = document.querySelector('.stage-note__body') as HTMLElement
    // Real overflow, which is the thing `panelScroll.test.tsx` can only assert the
    // declarations for: it pins the rules that should make this true without ever
    // measuring whether it is.
    expect(note.scrollHeight).toBeGreaterThan(note.clientHeight)

    note.scrollTop = 400
    expect(note.scrollTop).toBeGreaterThan(0)
    // The panel is fixed over the page, and the page itself must not have moved.
    expect(window.scrollY).toBe(0)
    expect(document.documentElement.scrollHeight)
      .toBeLessThanOrEqual(window.innerHeight + 1)
  })

  /*
   * These two could not be driven at all while the tabs used HTML5 drag-and-drop: a
   * synthetic mouse does not start a native drag session in any engine, so `dragstart`
   * never fired and the call hung until the test timed out. They are pointer events now,
   * which is what made a finger work as well, and a pointer is something a test can send.
   */
  /**
   * A finger, on the instance that has one.
   *
   * Vitest's `userEvent` drives a mouse, so the gesture itself is dispatched here: real
   * `PointerEvent`s with `pointerType: 'touch'`, at coordinates read from real boxes, hit
   * tested by the real document. What that leaves synthetic is the trust bit on the event,
   * which nothing in the panel reads. What it exercises is everything that used to be
   * impossible: the hold that tells carrying a tab from scrolling the strip, and the drop
   * landing where the finger actually was.
   */
  async function touchDrag(source: Element, over: Element) {
    const at = (element: Element) => {
      const box = element.getBoundingClientRect()
      return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }
    }
    const send = (target: EventTarget, type: string, point: { clientX: number; clientY: number }) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType: 'touch',
          isPrimary: true,
          ...point,
        }),
      )

    send(source, 'pointerdown', at(source))
    // Past TOUCH_HOLD_MS, which is the whole point: a finger has to stay put to pick a tab
    // up, or every swipe along the strip would carry one off instead of scrolling.
    await new Promise((resolve) => setTimeout(resolve, 450))
    send(window, 'pointermove', at(over))
    send(window, 'pointerup', at(over))
  }

  it('picks a tab up with a held finger and carries it, on a phone-sized screen', async () => {
      await page.viewport(420, 860)
      renderPanel()

      const names = () => screen.getAllByRole('tab').map((tab) => tab.textContent)
      const before = names()
      expect(before).toHaveLength(3)

      const offer = screen.getByRole('tab', { name: /^Halcyon Maps · .* · Offer$/ })
      const first = screen.getAllByRole('tab')[0].closest('.panel__tab-slot')!
      await touchDrag(offer, first)

      // Carried to the front, by a gesture a mouse cannot make.
    expect(names()[0]).toBe(before[2])
    expect(names()).toHaveLength(3)
  })

  it('leaves a finger that moves straight away to the scroller', async () => {
      await page.viewport(420, 860)
      renderPanel()

      const before = screen.getAllByRole('tab').map((tab) => tab.textContent)
      const offer = screen.getByRole('tab', { name: /^Halcyon Maps · .* · Offer$/ })
      const box = offer.getBoundingClientRect()
      const point = (x: number) => ({ clientX: x, clientY: box.top + box.height / 2 })
      const send = (target: EventTarget, type: string, x: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 8,
            pointerType: 'touch',
            isPrimary: true,
            ...point(x),
          }),
        )

      // No hold: straight into a swipe, which on a strip that scrolls sideways is what
      // scrolling looks like. Nothing should have been picked up.
      send(offer, 'pointerdown', box.left + box.width / 2)
      send(window, 'pointermove', box.left + box.width / 2 - 80)
      expect(document.querySelectorAll('[data-drop-edge]')).toHaveLength(0)
      send(window, 'pointerup', box.left + box.width / 2 - 80)

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(before)
  })

  it('reorders a tab dragged within its own strip', async () => {
    renderPanel()

    const names = () => screen.getAllByRole('tab').map((tab) => tab.textContent)
    const slots = () => [...document.querySelectorAll<HTMLElement>('.panel__tab-slot')]
    const before = names()
    expect(before).toHaveLength(3)

    // Dropped on the slot, not on the tab inside it: the slot is what carries the drag
    // handlers, and a drop lands wherever the pointer is rather than on whatever element
    // the test happened to name.
    await userEvent.dragAndDrop(screen.getAllByRole('tab')[2], slots()[0])

    const after = names()
    expect(after).toHaveLength(3)
    expect(after[0]).toBe(before[2])
  })

  it('moves a tab dragged onto another pane’s strip', async () => {
    renderPanel()
    /*
     * Split from the keyboard rather than by clicking the button, because of the driver
     * rather than the panel. Playwright's WebKit swallows the `pointerdown` of the first
     * press after a click in the same test — the drag below then arrives as two moves and
     * a release, nothing is ever picked up, and the failure reads as a WebKit bug in the
     * drag. Measured: with the click the sequence is `pointermove, pointermove, pointerup`
     * and without it `pointermove, pointerdown, pointermove, pointerup`, in the same
     * browser on the same drag. Chromium and Firefox send the press either way.
     */
    await splitDown()

    const strips = () => screen.getAllByRole('tablist')
    const counts = () => strips().map((strip) => within(strip).getAllByRole('tab').length)
    expect(counts()).toEqual([2, 1])

    // Onto the far pane's own tab slot. Its strip would also take the drop, but only on
    // the strip's bare background, and a strip holding a tab has little of that to aim at.
    const target = strips()[1].querySelector<HTMLElement>('.panel__tab-slot')!
    await userEvent.dragAndDrop(within(strips()[0]).getAllByRole('tab')[1], target)

    expect(counts()).toEqual([1, 2])
  })
})
