import { render, screen, within } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { beforeEach, expect, it } from 'vitest'

import { FeedbackWidget } from './FeedbackWidget'

/*
 * The one test that takes a real screenshot: Chromium with its fake capture device and the
 * prompt auto-accepted (`vitest.capture.config.ts`). It exists because a picture taken from
 * the recording pill used to wait forever on a frame callback a detached video never fires
 * in Chrome, leaving the pill hidden and the screenshot gone — which no stubbed test saw.
 */
beforeEach(() => {
  window.localStorage.clear()
})

/*
 * By class rather than by role: the pill steps out of the picture while a screenshot is
 * taken, and an element under `display: none` has no accessible name to be found by.
 */
function pill() {
  const found = document.querySelector<HTMLElement>('.feedback-pill')
  if (!found) throw new Error('The recording pill is not on the page.')
  return found
}

async function pillBack() {
  await expect.poll(() => pill().hidden, { timeout: 15_000 }).toBe(false)
}

it('keeps screenshots taken from the recording pill, explaining the prompt the first time only', async () => {
  render(<div className="app-shell"><FeedbackWidget where="Kanban" /><p>Page content</p></div>)
  await userEvent.click(screen.getByRole('button', { name: 'Feedback' }))
  await userEvent.click(screen.getByRole('button', { name: /Show me/ }))

  await userEvent.click(within(pill()).getByRole('button', { name: 'Take a screenshot' }))
  const notice = within(pill()).getByRole('group', { name: 'Before the screenshot' })
  expect(notice).toHaveTextContent('Your browser will ask to share this tab.')
  await userEvent.click(within(notice).getByRole('button', { name: 'Continue' }))
  await pillBack()

  // Told once; the second goes straight to the browser.
  await userEvent.click(within(pill()).getByRole('button', { name: 'Take a screenshot' }))
  expect(pill().querySelector('.feedback-notice')).toBeNull()
  await pillBack()

  await userEvent.click(within(pill()).getByRole('button', { name: 'Done' }))
  const panel = screen.getByRole('dialog', { name: 'Feedback' })
  expect(within(panel).getAllByRole('img', { name: /^Screenshot \d$/ })).toHaveLength(2)
  expect(within(panel).queryByRole('alert')).toBeNull()
})
