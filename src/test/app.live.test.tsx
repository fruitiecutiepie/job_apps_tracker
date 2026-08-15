import { render, screen, waitFor } from '@testing-library/react'
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
  expect(screen.queryByRole('button', { name: 'Reset demo data' })).not.toBeInTheDocument()
  expect(testTrackerStore.getItem('job-applications-tracker:v1')).toContain('"applications":[]')
})
