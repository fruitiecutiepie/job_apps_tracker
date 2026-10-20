/**
 * Moving a Kanban card by dragging it, in a real browser.
 *
 * The card was HTML5 drag-and-drop, which no phone starts and no browser automation can
 * drive, so the board could not be rearranged by touch and nothing could test that it
 * could be by mouse. It is pointer events now. The finger tests use real touch input
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

function renderBoard() {
  onMove = vi.fn()
  onOpen = vi.fn()
  render(
    <main>
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
const laneBody = (key: string) => centre(lane(key).querySelector('.kanban-lane__header')!)

afterEach(cleanup)

describe('dragging a card with a mouse', () => {
  beforeEach(() => page.viewport(1280, 800))

  it('moves it to the lane it is dropped on, and opens nothing', async () => {
    renderBoard()
    await userEvent.dragAndDrop(card('Marble & Finch'), lane('headhunted:active'))

    expect(onMove).toHaveBeenCalledWith(marble.id, { stage: 'headhunted', outcome: 'active' })
    expect(onOpen).not.toHaveBeenCalled()
    expect(document.querySelector('.application-card--ghost')).toBeNull()
  })
})

describe.runIf(server.browser === 'chromium')('dragging a card with a finger, on a phone', () => {
  beforeEach(() => page.viewport(390, 844))

  it('picks the card up once it is held, and drops it where the finger lifts', async () => {
    renderBoard()
    // Marble & Finch is in the second column, its left part on screen beside the first.
    const from = centre(card('Marble & Finch').querySelector('.application-card__open')!)
    const grip = { x: Math.min(from.x, window.innerWidth - 60), y: from.y }

    await touch([grip, laneBody('headhunted:active')], { holdMs: 500 })

    expect(onMove).toHaveBeenCalledWith(marble.id, { stage: 'headhunted', outcome: 'active' })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('leaves a finger that moves at once to scroll the board, and moves nothing', async () => {
    renderBoard()
    const from = centre(card('Northstar Labs'))

    await touch([from, { x: from.x - 150, y: from.y }])

    expect(scroller().scrollLeft).toBeGreaterThan(50)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('scrolls the board under a card held at its edge, to reach a stage off screen', async () => {
    renderBoard()
    const from = centre(card('Northstar Labs'))
    const edge = { x: window.innerWidth - 6, y: from.y }

    await touch([from, edge], { holdMs: 500, dwellMs: 1200 })

    expect(scroller().scrollLeft).toBeGreaterThan(300)
    expect(onMove).toHaveBeenCalledTimes(1)
    const [id, landing] = onMove.mock.calls[0]
    expect(id).toBe(northstar.id)
    expect(landing.stage).not.toBe('headhunted')
  })

  it('still opens a card that is tapped', async () => {
    renderBoard()
    const open = centre(card('Northstar Labs').querySelector('.application-card__open')!)

    await touch([open])

    expect(onOpen).toHaveBeenCalledWith(northstar.id)
    expect(onMove).not.toHaveBeenCalled()
  })
})
