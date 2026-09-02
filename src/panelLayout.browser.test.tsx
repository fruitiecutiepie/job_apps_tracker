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
import type { Application } from './domain'
import { StageNotesDialog } from './StageNotesDialog'
import type { NoteRef } from './notesLayout'

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
  const initialRef: NoteRef = { applicationId: halcyon.id, state: halcyon.state }
  render(
    <StageNotesDialog
      applications={applications}
      initialRef={initialRef}
      onCapture={async () => {}}
      onClose={() => {}}
      onExternalChange={async () => {}}
      onRevise={async () => {}}
      onSaveDrafts={async () => true}
    />,
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
   * The two below are skipped, and the reason is worth writing down, because it is a
   * property of the tooling rather than of the panel.
   *
   * Playwright drives a drag with synthetic mouse events, and a synthetic mouse does not
   * start a native HTML5 drag session: `dragstart` never fires, so the drop zones never
   * appear, the drop is never accepted, and the call waits until the test times out.
   * Retargeting does not help, and was tried against the tab, its slot and the strip.
   * Playwright Test would fare no better, being the same browser automation underneath,
   * which is part of why it was not the tool for this job.
   *
   * The divider above resizes from a plain mousedown and window mousemove, which is why
   * that drag is drivable here and these are not.
   *
   * So the tab drag is covered where it can be: the jsdom suite drives it with a
   * `DataTransfer` stub, exercising every handler and every layout call, but not the
   * browser's own drag machinery. The same gap applies to the Kanban card drag, which is
   * HTML5 drag-and-drop as well. Moving either to pointer events would make it drivable
   * here, and would incidentally make it work on touch, but that is a change to the app
   * rather than to its tests and not one to make on the way past.
   *
   * Kept rather than deleted: they say what should be true, and they are ready the day the
   * implementation can be driven.
   */
  it.skip('reorders a tab dragged within its own strip', async () => {
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

  it.skip('moves a tab dragged onto another pane’s strip', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Split' }))

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
