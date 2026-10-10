import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { INBOX_PAGE } from './inboxPage'
import type { FeedbackRecord } from './report'

/*
 * The inbox page is a document of its own, served by the feedback route rather than built by
 * the app, so it is mounted here the way a browser would run it: its markup and its style put
 * in the page, and its script run, against a stubbed route. In a real browser because the two
 * things that went wrong with it were layout — a `hidden` login form that stayed on screen,
 * and a notify control too faint to find — which jsdom cannot see.
 */
const REPORT: FeedbackRecord = {
  id: '01a11d9b-2ea9-7450-bb5f-dd610f0ee618',
  kind: 'bug',
  message: 'The card will not move.',
  email: 'sender@example.com',
  steps: [],
  context: { view: 'Kanban', build: 'local demo', path: '/', userAgent: 'Test', language: 'en', viewport: '1280×800', pixelRatio: 1 },
  created_at: '2026-10-10T06:00:00.000Z',
  received_at: '2026-10-10T06:00:01.000Z',
  status: 'new',
  screenshots: [],
}

let mounted: HTMLElement[] = []

function mountInbox() {
  const doc = new DOMParser().parseFromString(INBOX_PAGE, 'text/html')
  const style = document.createElement('style')
  style.textContent = doc.querySelector('style')!.textContent
  const main = doc.querySelector('main')!
  document.head.append(style)
  document.body.append(document.importNode(main, true))
  mounted = [style, document.body.querySelector('main')!]
  // The page's own script, run as the browser would run it.
  new Function(doc.querySelector('script')!.textContent!)()
}

beforeEach(() => {
  try { sessionStorage.clear() } catch { /* not ours to fail on */ }
  const stored = { ...REPORT }
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      Object.assign(stored, JSON.parse(String(init.body)) as Partial<FeedbackRecord>)
      return new Response(JSON.stringify(stored))
    }
    return new Response(JSON.stringify({ reports: [stored] }))
  }))
})

afterEach(() => {
  mounted.forEach((node) => node.remove())
})

async function signIn() {
  mountInbox()
  await userEvent.fill(screen.getByLabelText('Admin token'), 'local')
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  return screen.findByRole('article')
}

it('puts the token form away once signed in', async () => {
  await signIn()
  // Measured, not read off the attribute: `toBeVisible` trusts `hidden`, and the bug was a
  // stylesheet drawing the form anyway.
  await waitFor(() => expect(document.getElementById('login')!.getBoundingClientRect().height).toBe(0))
  expect(screen.getByRole('combobox', { name: 'Show' })).toBeVisible()
})

it('keeps a report on screen with its notify action once marked done, though the filter shows open ones', async () => {
  const card = await signIn()
  await userEvent.selectOptions(within(card).getByRole('combobox', { name: 'Status' }), 'done')

  const notify = await within(screen.getByRole('article')).findByRole('link', { name: 'Notify by email' })
  expect(notify).toBeVisible()
  expect(getComputedStyle(notify).opacity).toBe('1')
  const href = decodeURIComponent(notify.getAttribute('href')!)
  expect(href).toMatch(/^mailto:sender@example\.com\?/)
  expect(href).toContain('?subject=Thank you for your bug report about the job applications tracker&')
  expect(href).toContain('Thank you for taking the time to send your bug report')
  expect(href).toContain('The problem you reported is now fixed.')
  expect(href).toContain('Good luck with your job search!')
  expect(href).toContain('> The card will not move.')

  // Changing the filter is what lets it go.
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'all')
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'open')
  expect(screen.queryByRole('article')).toBeNull()
})

it('copies the reply for when no mail app opens', async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const card = await signIn()
  await userEvent.click(within(card).getByRole('button', { name: 'Copy reply' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
  const text = (writeText.mock.calls[0] as unknown as [string])[0]
  expect(text).toMatch(/^To: sender@example\.com\nSubject: Thank you for your bug report/)
  expect(within(card).getByRole('button', { name: 'Copied' })).toBeInTheDocument()
})
