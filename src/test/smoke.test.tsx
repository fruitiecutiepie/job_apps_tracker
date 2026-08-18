import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { loadTrackerDocument } from '../domain/storage'
import App from '../App'
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
  const user = userEvent.setup()
  const firstRender = await renderLoadedApp()

  expect(screen.getByText('19 of 19 applications shown')).toBeInTheDocument()
  expect(readSavedDocument().applications).toHaveLength(19)

  for (const view of [
    'Table',
    'Next actions',
    'Calendar',
    'Stale',
    'Statistics',
  ]) {
    const viewButton = screen.getByRole('button', { name: view })
    await user.click(viewButton)
    expect(viewButton).toHaveAttribute('aria-current', 'page')
  }

  await user.click(screen.getByRole('button', { name: 'Kanban' }))
  expect(screen.getByRole('heading', { name: 'Applied' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Add application' }))
  const addDialog = screen.getByRole('dialog', { name: 'Add application' })
  await user.type(within(addDialog).getByLabelText('Company'), 'Smoke Test Co')
  await user.type(within(addDialog).getByLabelText('Role'), 'Product Designer')
  await user.type(within(addDialog).getByLabelText('Source'), 'Referral')
  await user.selectOptions(within(addDialog).getByLabelText('State'), 'applied')
  await user.type(within(addDialog).getByLabelText('Next action'), 'Send portfolio')
  await user.click(within(addDialog).getByRole('button', { name: 'Add application' }))

  expect(screen.getByRole('status')).toHaveTextContent('Application added.')
  await user.type(screen.getByRole('searchbox'), 'Smoke Test Co')

  await user.click(
    screen.getByRole('button', { name: 'Open Smoke Test Co, Product Designer' }),
  )
  const editDialog = screen.getByRole('dialog', { name: 'Edit application' })
  await user.selectOptions(within(editDialog).getByLabelText('State'), 'offer')
  await user.click(within(editDialog).getByRole('button', { name: 'Save changes' }))

  expect(screen.getByRole('status')).toHaveTextContent('Application updated.')

  await user.click(screen.getByRole('button', { name: 'Add prep notes for Smoke Test Co' }))
  const prepDialog = screen.getByRole('dialog', { name: 'Stage prep notes' })
  await user.type(within(prepDialog).getByLabelText('Offer prep notes'), 'Confirm the review cycle')
  await user.click(within(prepDialog).getByRole('button', { name: 'Save notes' }))

  expect(screen.getByRole('status')).toHaveTextContent('Prep notes saved.')

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
  await reloadedUser.click(screen.getByRole('button', { name: 'Reset demo data' }))

  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByRole('status')).toHaveTextContent('Demo data restored.')
  expect(readSavedDocument().applications).toHaveLength(19)
  expect(
    readSavedDocument().applications.some(
      (application) => application.company === 'Smoke Test Co',
    ),
  ).toBe(false)
})
