import { render, screen, within } from '@testing-library/react'
import { userEvent, page } from 'vitest/browser'
import { beforeEach, describe, expect, it } from 'vitest'

import { FeedbackWidget } from './FeedbackWidget'

/*
 * The panel floats over the page at a fixed corner, so the window is the only thing that
 * bounds it. These measure what jsdom cannot: that it stays inside the window at a laptop's
 * width and a phone's, and that nothing inside it is wider than it is.
 */
async function openWithContent() {
  render(
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__actions"><FeedbackWidget where="Kanban" /></div>
      </header>
      <button type="button">A control on the page with a rather long accessible name to record</button>
    </div>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Feedback' }))
  const panel = screen.getByRole('dialog', { name: 'Feedback' })
  await userEvent.fill(
    within(panel).getByRole('textbox', { name: 'What went wrong?' }),
    'The card does not move when I drag it to Interview 2.',
  )
  await userEvent.click(within(panel).getByRole('button', { name: /Show me/ }))
  for (let index = 0; index < 3; index += 1) {
    await userEvent.click(screen.getByRole('button', { name: /A control on the page/ }))
    await userEvent.keyboard('{Escape}')
  }
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  return screen.getByRole('dialog', { name: 'Feedback' })
}

function expectInside(panel: HTMLElement) {
  const box = panel.getBoundingClientRect()
  expect(box.left).toBeGreaterThanOrEqual(0)
  expect(box.top).toBeGreaterThanOrEqual(0)
  expect(box.right).toBeLessThanOrEqual(window.innerWidth)
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight)
  for (const element of panel.querySelectorAll<HTMLElement>('*')) {
    expect(element.getBoundingClientRect().width, element.className.toString())
      .toBeLessThanOrEqual(box.width + 0.5)
  }
}

/* Send is the one control the panel exists for; a report too long to fit must not push it
   out of sight behind a scroll. */
function expectSendVisible(panel: HTMLElement) {
  const send = within(panel).getByRole('button', { name: 'Send' }).getBoundingClientRect()
  const box = panel.getBoundingClientRect()
  expect(send.height).toBeGreaterThan(0)
  expect(send.bottom).toBeLessThanOrEqual(box.bottom)
  expect(send.top).toBeGreaterThanOrEqual(box.top)
}

beforeEach(async () => {
  await page.viewport(1280, 800)
})

describe('the feedback panel', () => {
  it('stays inside a laptop window', async () => {
    const panel = await openWithContent()
    // Three clicks and three Escapes, each its own step.
    expect(within(panel).getAllByRole('listitem')).toHaveLength(6)
    expectInside(panel)
    expectSendVisible(panel)
  })

  it('stays inside a phone window, with Send still in reach', async () => {
    await page.viewport(375, 667)
    const panel = await openWithContent()
    expectInside(panel)
    expectSendVisible(panel)
  })
})
