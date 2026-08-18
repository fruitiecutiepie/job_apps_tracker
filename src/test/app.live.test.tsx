import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import App from '../App'
import { testTrackerStore } from './trackerStore'

vi.mock('../domain/trackerProfile', () => ({
  isDemoTrackerProfile: () => false,
  trackerProfile: () => 'live',
  trackerDatabasePath: () => 'data/tracker.json',
}))

beforeEach(() => {
  testTrackerStore.clear()
})

it('starts with an empty live tracker and does not offer demo reset', async () => {
  render(<App />)
  await waitFor(() => expect(screen.queryByText('Loading tracker data…')).not.toBeInTheDocument())

  expect(screen.getByText('0 of 0 applications shown')).toBeInTheDocument()

  // Open the actions menu so the absence of Reset is the profile guard rather
  // than a closed panel: Import and Export prove the panel itself is showing.
  await userEvent.setup().click(screen.getByRole('button', { name: 'More actions' }))
  expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Reset demo data' })).not.toBeInTheDocument()
  expect(testTrackerStore.getItem('job-applications-tracker:v1')).toContain('"applications":[]')
})
