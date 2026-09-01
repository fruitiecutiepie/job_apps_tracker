import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { loadTrackerDocument } from '../domain/storage'
import App from '../App'
import { seedFullDemo } from './fixture'
import { testTrackerStore } from './trackerStore'

function readSavedDocument() {
  return loadTrackerDocument(testTrackerStore)
}

async function renderLoadedApp() {
  const view = render(<App />)
  await waitFor(() => expect(screen.queryByText('Loading tracker data…')).not.toBeInTheDocument())
  return view
}

it('completes the primary tracker journey and persists it across reloads', async () => {
  // The journey counts what is there and resets it, so it wants the demo entire.
  seedFullDemo()
  const user = userEvent.setup()
  const firstRender = await renderLoadedApp()

  const contextBar = within(screen.getByRole('region', { name: 'View context and filters' }))

  expect(contextBar.getByText('19 of 19 applications shown')).toBeInTheDocument()
  expect(readSavedDocument().applications).toHaveLength(19)

  /*
   * Scoped to the nav rather than searched for across the page. A role query walks the
   * tree computing an accessible name per candidate, and each of those asks jsdom for a
   * computed style — which costs about 30ms there whether or not any CSS is loaded. Over
   * a thousand-node app that is most of what this journey spends its time on, and the
   * six buttons it wants are all in one small landmark.
   */
  const views = within(screen.getByRole('navigation', { name: 'Tracker views' }))

  for (const view of [
    'Table',
    'Focus',
    'Calendar',
    'Stale',
    'Statistics',
  ]) {
    const viewButton = views.getByRole('button', { name: view })
    await user.click(viewButton)
    expect(viewButton).toHaveAttribute('aria-current', 'page')
  }
  console.log('DEBUG: views done')

  await user.click(views.getByRole('button', { name: 'Kanban' }))
  expect(screen.getByRole('heading', { name: 'Applied' })).toBeInTheDocument()
  console.log('DEBUG: kanban done')

  await user.click(screen.getByRole('button', { name: 'Add application' }))
  const addDialog = screen.getByRole('dialog', { name: 'Add application' })
  await user.type(within(addDialog).getByLabelText('Company'), 'Smoke Test Co')
  await user.type(within(addDialog).getByLabelText('Role'), 'Product Designer')
  await user.type(within(addDialog).getByLabelText('Source'), 'Referral')
  await user.selectOptions(within(addDialog).getByLabelText('State'), 'applied')
  await user.type(within(addDialog).getByLabelText('Next action'), 'Send portfolio')
  await user.click(within(addDialog).getByRole('button', { name: 'Add application' }))
  console.log('DEBUG: add application done')

  expect(screen.getByRole('status')).toHaveTextContent('Application added.')
  await user.type(contextBar.getByRole('searchbox'), 'Smoke Test Co')
  console.log('DEBUG: search typed')

  await user.click(
    screen.getByRole('button', { name: 'Open Smoke Test Co, Product Designer' }),
  )
  const editDialog = screen.getByRole('dialog', { name: 'Edit application' })
  await user.selectOptions(within(editDialog).getByLabelText('State'), 'offer')
  await user.click(within(editDialog).getByRole('button', { name: 'Save changes' }))
  console.log('DEBUG: edit done')

  expect(screen.getByRole('status')).toHaveTextContent('Application updated.')

  await user.click(screen.getByRole('button', { name: 'Add prep notes for Smoke Test Co' }))
  console.log('DEBUG: prep dialog opened')
  const prepDialog = screen.getByRole('dialog', { name: 'Stage prep notes' })
  await user.type(within(prepDialog).getByLabelText('Offer prep notes'), 'Confirm the review cycle')
  console.log('DEBUG: prep notes typed')

  // Prep notes write themselves once the typing pauses; there is nothing to submit.
  await waitFor(
    () =>
      expect(
        readSavedDocument()
          .applications.find((application) => application.company === 'Smoke Test Co')
          ?.stage_notes,
      ).toHaveLength(1),
    { timeout: 4000 },
  )
  await user.click(within(prepDialog).getByRole('button', { name: 'Close dialog' }))

  const savedAfterEdit = readSavedDocument()
  const smokeApplication = savedAfterEdit.applications.find(
    (application) => application.company === 'Smoke Test Co',
  )

  expect(savedAfterEdit.applications).toHaveLength(20)
  expect(smokeApplication?.state).toBe('offer')
  expect(smokeApplication?.source).toBe('Referral')
  expect(smokeApplication?.state_history.map((entry) => entry.state)).toEqual([
    'applied',
    'offer',
  ])
  expect(smokeApplication?.stage_notes).toEqual([
    expect.objectContaining({ state: 'offer', body: 'Confirm the review cycle' }),
  ])

  firstRender.unmount()

  const reloadedUser = userEvent.setup()
  await renderLoadedApp()
  await reloadedUser.type(screen.getByRole('searchbox'), 'Smoke Test Co')

  expect(
    screen.getByRole('button', { name: 'Open Smoke Test Co, Product Designer' }),
  ).toBeInTheDocument()
  expect(readSavedDocument().applications).toHaveLength(20)

  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await reloadedUser.click(screen.getByRole('button', { name: 'More actions' }))
  await reloadedUser.click(screen.getByRole('button', { name: 'Reset demo data' }))

  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByRole('status')).toHaveTextContent('Demo data restored.')
  expect(readSavedDocument().applications).toHaveLength(19)
  expect(
    readSavedDocument().applications.some(
      (application) => application.company === 'Smoke Test Co',
    ),
  ).toBe(false)
},
/*
 * This journey gets its own budget, past the 15s the rest of the suite runs on. It
 * renders the whole app twice, walks all six views and opens three dialogs, and what
 * costs is not the app: a role query asks jsdom for a computed style per candidate to
 * decide what is visible, and jsdom answers in milliseconds rather than microseconds
 * whether or not a stylesheet is loaded. Measured with `process.cpuUsage`, the journey
 * is around 10s of CPU, so 15s left it no headroom and it failed whenever the machine
 * had other work on. Trimming the journey would cost coverage for a saving the queries
 * dominate anyway, so the budget is what moves.
 */
30_000)
