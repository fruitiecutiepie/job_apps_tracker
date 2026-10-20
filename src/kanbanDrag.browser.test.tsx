/**
 * Moving a Kanban card by dragging it, in a real browser.
 *
 * The card was HTML5 drag-and-drop, which no phone starts and no browser automation can
 * drive, so the board could not be rearranged by touch and nothing could test that it
 * could be by mouse. It is pointer events now, from a grip on each card, so the rest of
 * the card selects like text. The finger tests use real touch input
 * (`src/test/touch.ts`), because what went wrong on a phone happened in the browser — the
 * page scrolling under a held finger and cancelling the drag — where a synthetic event
 * never reaches.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { page, server, userEvent } from 'vitest/browser'

import { createDemoDocument } from './domain/demo'
import { KanbanView } from './views/KanbanView'
import { centre, touch } from './test/touch'

const applications = createDemoDocument().applications.filter((application) => !application.archived_at)
const marble = applications.find((application) => application.company === 'Marble & Finch')!
const northstar = applications.find((application) => application.company === 'Northstar Labs')!

let onMove = vi.fn()
let onOpen = vi.fn()

function renderBoard({ tall = false } = {}) {
  onMove = vi.fn()
  onOpen = vi.fn()
  render(
    <main style={tall ? { paddingBottom: '150vh' } : undefined}>
      <section className="view-surface">
        <KanbanView
          applications={applications}
          onArchive={vi.fn()}
          onCompleteAction={vi.fn()}
          onMove={onMove}
          onOpen={onOpen}
          onOpenMessages={vi.fn()}
          onOpenPosting={vi.fn()}
          onOpenStageNotes={vi.fn()}
        />
      </section>
    </main>,
  )
}

const card = (company: string) =>
  screen.getByRole('button', { name: new RegExp(`^Open ${company}`) }).closest('article')!
const lane = (key: string) => document.querySelector(`[data-kanban-lane="${key}"]`)!
const scroller = () => document.querySelector<HTMLElement>('.kanban__scroller')!
const grip = (company: string) => card(company).querySelector('.application-card__grip')!

afterEach(() => {
  cleanup()
  window.scrollTo(0, 0)
})

describe('dragging a card with a mouse', () => {
  beforeEach(() => page.viewport(1280, 800))

  it('moves it by its grip to the lane it is dropped on, and opens nothing', async () => {
    renderBoard()
    await userEvent.dragAndDrop(grip('Marble & Finch'), lane('headhunted:active'))

    expect(onMove).toHaveBeenCalledWith(marble.id, { stage: 'headhunted', outcome: 'active' })
    expect(onOpen).not.toHaveBeenCalled()
    expect(document.querySelector('.application-card--ghost')).toBeNull()
  })

  it('selects the card\'s text when dragged across anywhere but the grip', async () => {
    renderBoard()
    const action = card('Marble & Finch').querySelector('.application-card__action')!
    await userEvent.dragAndDrop(action, lane('headhunted:active'))

    expect(onMove).not.toHaveBeenCalled()
    expect(String(window.getSelection())).toContain('Follow up')
  })

  /*
   * Not in WebKit, which will not select text inside a <button> whatever the stylesheet
   * says, and the name is the card's open button. Chromium and Firefox do.
   */
  it.skipIf(server.browser === 'webkit')('selects the company name without opening the card', async () => {
    renderBoard()
    const name = card('Marble & Finch').querySelector('.application-card__open strong')!
    await userEvent.dragAndDrop(name, lane('headhunted:active'))

    expect(onMove).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
    expect(String(window.getSelection())).toContain('Marble')
  })

  it('still opens a card whose name is clicked', async () => {
    renderBoard()
    await userEvent.click(screen.getByRole('button', { name: /^Open Marble & Finch/ }))
    expect(onOpen).toHaveBeenCalledWith(marble.id)
  })
})

describe.runIf(server.browser === 'chromium')('dragging a card with a finger, on a phone', () => {
  beforeEach(() => page.viewport(390, 844))

  /*
   * Marble & Finch's grip and the Headhunted lane both on screen at once: the board scrolled
   * until the grip sits inside the window, the drop aimed at what is left of the first
   * column. A phone shows little more than one column, so either alone is easy and both
   * take arranging.
   */
  function marbleToHeadhunted() {
    const board = scroller()
    board.scrollLeft = 0
    const right = board.getBoundingClientRect().right - 24
    board.scrollLeft = Math.max(0, centre(grip('Marble & Finch')).x - right)
    const first = lane('headhunted:active').getBoundingClientRect()
    const left = Math.max(first.left, board.getBoundingClientRect().left) + 16
    return [centre(grip('Marble & Finch')), { x: left, y: first.top + 20 }]
  }

  it('moves a card by its grip at once, with no hold, to where the finger lifts', async () => {
    renderBoard()
    await touch(marbleToHeadhunted())

    expect(onMove).toHaveBeenCalledWith(marble.id, { stage: 'headhunted', outcome: 'active' })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('leaves a finger on the rest of the card to scroll the board, held or not', async () => {
    renderBoard()
    const from = centre(card('Northstar Labs').querySelector('.application-card__open')!)

    await touch([from, { x: from.x - 150, y: from.y }])
    expect(scroller().scrollLeft).toBeGreaterThan(50)

    scroller().scrollLeft = 0
    await touch([from, { x: from.x - 150, y: from.y }], { holdMs: 500 })
    expect(onMove).not.toHaveBeenCalled()
  })

  it('scrolls the board under a card held at its edge, to reach a stage off screen', async () => {
    renderBoard()
    const from = centre(grip('Northstar Labs'))
    const edge = { x: window.innerWidth - 6, y: from.y }

    await touch([from, edge], { dwellMs: 1200 })

    expect(scroller().scrollLeft).toBeGreaterThan(300)
    expect(onMove).toHaveBeenCalledTimes(1)
    const [id, landing] = onMove.mock.calls[0]
    expect(id).toBe(northstar.id)
    expect(landing.stage).not.toBe('headhunted')
  })

  it('puts the card back when Escape is pressed mid-drag', async () => {
    renderBoard()
    await touch(marbleToHeadhunted(), {
      beforeLift: async () => {
        expect(document.querySelector('.application-card--ghost')).not.toBeNull()
        await userEvent.keyboard('{Escape}')
        expect(document.querySelector('.application-card--ghost')).toBeNull()
      },
    })

    expect(onMove).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
  })

  /** A grip on screen and clear of both edge zones, to start a vertical carry from. */
  const visibleGrip = () =>
    [...document.querySelectorAll('.application-card__grip')]
      .map((element) => centre(element))
      .find((at) => at.x < window.innerWidth - 60 && at.y > 80 && at.y < window.innerHeight - 80)!

  it('scrolls the page down under a card held at the bottom of the window', async () => {
    renderBoard({ tall: true })
    const from = visibleGrip()

    await touch([from, { x: from.x, y: window.innerHeight - 6 }], { dwellMs: 600 })

    expect(window.scrollY).toBeGreaterThan(100)
  })

  it('scrolls the page back up under a card held at the top of the window', async () => {
    renderBoard({ tall: true })
    window.scrollTo(0, 150)
    const from = visibleGrip()

    await touch([from, { x: from.x, y: 6 }], { dwellMs: 600 })

    expect(window.scrollY).toBeLessThan(150)
  })

  it('still opens a card that is tapped', async () => {
    renderBoard()
    const open = centre(card('Northstar Labs').querySelector('.application-card__open')!)

    await touch([open])

    expect(onOpen).toHaveBeenCalledWith(northstar.id)
    expect(onMove).not.toHaveBeenCalled()
  })

})
