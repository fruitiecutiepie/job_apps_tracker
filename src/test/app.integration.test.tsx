import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { loadTrackerDocument } from '../domain/storage'
import App from '../App'
import { testTrackerStore } from './trackerStore'

const states = [
  'Headhunted',
  'No openings',
  'Applied',
  'Auto-rejected',
  'Recruiter messaged',
  'Recruiter messaged — Rejected',
  'Online assessment',
  'Online assessment — Rejected',
  'Recruiter interview',
  'Recruiter interview — Rejected',
  'Take-home assessment',
  'Take-home assessment — Rejected',
  'Interview 1',
  'Interview 1 — Rejected',
  'Interview 2',
  'Interview 2 — Rejected',
  'Offer',
  'Offer — Rejected',
  'Accepted',
] as const

function readSavedDocument() {
  return loadTrackerDocument(testTrackerStore)
}

async function renderLoadedApp() {
  const view = render(<App />)
  await waitFor(() => expect(screen.queryByText('Loading tracker data…')).not.toBeInTheDocument())
  return view
}

function jsonFile(contents: string, name = 'applications.json') {
  const file = new File([contents], name, { type: 'application/json' })
  Object.defineProperty(file, 'text', {
    configurable: true,
    value: vi.fn().mockResolvedValue(contents),
  })
  return file
}

describe('job applications tracker', () => {
  it('starts with every configured state represented in the Kanban', async () => {
    await renderLoadedApp()

    for (const state of states) {
      expect(screen.getByRole('heading', { name: state })).toBeInTheDocument()
    }

    const savedDocument = readSavedDocument()
    expect(savedDocument.applications).toHaveLength(19)
    expect(savedDocument.schema).toBeDefined()
    expect(savedDocument.indexes.by_id).toBeDefined()
    expect(new Set(savedDocument.applications.map((application) => application.state)).size).toBe(19)
  })

  it('shows an error when saved data is unreadable and leaves storage untouched', async () => {
    testTrackerStore.setItem('job-applications-tracker:v1', '{invalid')

    render(<App />)
    await waitFor(() => expect(screen.getByText('Could not load tracker data')).toBeInTheDocument())

    expect(testTrackerStore.getItem('job-applications-tracker:v1')).toBe('{invalid')
  })

  it('offers all six views and keeps the shared collection available while navigating', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    for (const view of ['Table', 'Next actions', 'Calendar', 'Stale', 'Statistics'] as const) {
      await user.click(screen.getByRole('button', { name: view }))
      expect(screen.getByRole('button', { name: view })).toHaveAttribute('aria-current', 'page')
    }

    await user.click(screen.getByRole('button', { name: 'Kanban' }))
    expect(screen.getByRole('heading', { name: 'Applied' })).toBeInTheDocument()
  })

  it('creates an application through the accessible form and can find it globally', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add application' }))

    const dialog = screen.getByRole('dialog', { name: 'Add application' })
    await user.type(within(dialog).getByLabelText('Company'), 'Paper Kite Labs')
    await user.type(within(dialog).getByLabelText('Role'), 'Design systems engineer')
    await user.type(within(dialog).getByLabelText('Source'), 'LinkedIn')
    await user.selectOptions(within(dialog).getByLabelText('State'), 'applied')
    await user.type(within(dialog).getByLabelText('Next action'), 'Send portfolio follow-up')
    await user.click(within(dialog).getByRole('button', { name: /save|add application/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const search = screen.getByRole('searchbox', { name: 'Search applications' })
    await user.type(search, 'LinkedIn')
    expect(screen.getByRole('button', { name: /Open Paper Kite Labs/ })).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'Paper Kite')

    const savedDocument = readSavedDocument()
    expect(savedDocument.applications).toHaveLength(20)
    expect(savedDocument.applications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          company: 'Paper Kite Labs',
          role: 'Design systems engineer',
          source: 'LinkedIn',
          state: 'applied',
          next_action: 'Send portfolio follow-up',
        }),
      ]),
    )
  })

  it('filters the Kanban by state without changing saved applications', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.selectOptions(screen.getByLabelText('Filter by state'), 'accepted')

    expect(screen.getByRole('heading', { name: 'Accepted' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Applied' })).not.toBeInTheDocument()

    const savedDocument = readSavedDocument()
    expect(savedDocument.applications).toHaveLength(19)
  })

  it('filters views by company without changing saved applications', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.selectOptions(screen.getByLabelText('Filter by company'), 'Saffron Systems')

    expect(screen.getByRole('button', { name: 'Open Saffron Systems, Product Operations Manager' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open Marble & Finch/ })).not.toBeInTheDocument()
    expect(readSavedDocument().applications).toHaveLength(19)
  })

  it('persists edits across reloads and appends history only when state changes', async () => {
    const user = userEvent.setup()
    const { unmount } = await renderLoadedApp()
    const before = readSavedDocument().applications.find(
      (application) => application.company === 'Saffron Systems',
    )!

    await user.click(
      screen.getByRole('button', {
        name: 'Open Saffron Systems, Product Operations Manager',
      }),
    )

    const dialog = screen.getByRole('dialog', { name: 'Edit application' })
    const company = within(dialog).getByLabelText('Company')
    await user.clear(company)
    await user.type(company, 'Saffron Systems International')
    await user.selectOptions(within(dialog).getByLabelText('State'), 'interview_2')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    const after = readSavedDocument().applications.find(
      (application) => application.id === before.id,
    )!
    expect(after.company).toBe('Saffron Systems International')
    expect(after.state).toBe('interview_2')
    expect(after.state_history).toHaveLength(before.state_history.length + 1)
    expect(after.state_history.at(-1)?.state).toBe('interview_2')

    unmount()
    await renderLoadedApp()
    await user.type(
      screen.getByRole('searchbox', { name: 'Search applications' }),
      'Saffron Systems International',
    )
    expect(screen.getByRole('button', { name: /Open Saffron Systems International/ })).toBeInTheDocument()
    expect(readSavedDocument().applications).toHaveLength(19)
  })

  it('honors deletion cancellation before deleting and saving an application', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await renderLoadedApp()

    await user.click(
      screen.getByRole('button', {
        name: 'Open Saffron Systems, Product Operations Manager',
      }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Edit application' })

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('dialog', { name: 'Edit application' })).toBeInTheDocument()
    expect(readSavedDocument().applications).toHaveLength(19)

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readSavedDocument().applications).toHaveLength(18)
    expect(readSavedDocument().applications.some((application) => application.company === 'Saffron Systems')).toBe(
      false,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Application deleted')
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('resets to the same 19 examples only after confirmation and clears display filters', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add application' }))
    const dialog = screen.getByRole('dialog', { name: 'Add application' })
    await user.type(within(dialog).getByLabelText('Company'), 'Reset Me Incorporated')
    await user.click(within(dialog).getByRole('button', { name: 'Add application' }))
    expect(readSavedDocument().applications).toHaveLength(20)

    const search = screen.getByRole('searchbox', { name: 'Search applications' })
    const stateFilter = screen.getByLabelText('Filter by state')
    const companyFilter = screen.getByLabelText('Filter by company')
    await user.type(search, 'Reset Me')
    await user.selectOptions(stateFilter, 'applied')
    await user.selectOptions(companyFilter, 'Reset Me Incorporated')

    await user.click(screen.getByRole('button', { name: 'Reset demo data' }))
    expect(readSavedDocument().applications).toHaveLength(20)
    expect(search).toHaveValue('Reset Me')

    await user.click(screen.getByRole('button', { name: 'Reset demo data' }))
    expect(readSavedDocument().applications).toHaveLength(19)
    expect(new Set(readSavedDocument().applications.map((application) => application.state)).size).toBe(19)
    expect(search).toHaveValue('')
    expect(stateFilter).toHaveValue('all')
    expect(screen.getByLabelText('Filter by company')).toHaveValue('all')
    expect(screen.getByRole('status')).toHaveTextContent('Demo data restored')
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('replaces saved data from a valid import only after confirmation', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await renderLoadedApp()

    const original = readSavedDocument()
    const imported = {
      ...original,
      applications: [
        {
          ...original.applications[0],
          company: 'Imported Company',
          extra_future_field: 'ignored',
        },
      ],
      extra_document_field: true,
    }
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = jsonFile(JSON.stringify(imported))

    await user.upload(input, file)
    expect(readSavedDocument().applications).toHaveLength(19)

    await user.upload(input, file)
    await waitFor(() => expect(readSavedDocument().applications).toHaveLength(1))
    expect(readSavedDocument().applications[0].company).toBe('Imported Company')
    expect(screen.getByRole('button', { name: /Open Imported Company/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Imported 1 application')
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('leaves saved data untouched when an import document is invalid', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm')
    await renderLoadedApp()
    const before = JSON.stringify(readSavedDocument())

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await user.upload(input, jsonFile('{"schema_version":2,"applications":[]}'))

    expect(await screen.findByRole('status')).toHaveTextContent(/Import failed:.*schema/i)
    expect(JSON.stringify(readSavedDocument())).toBe(before)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('exposes form labels and prevents an orphaned next-action date', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add application' }))
    const dialog = screen.getByRole('dialog', { name: 'Add application' })
    expect(within(dialog).getByLabelText('Company')).toHaveFocus()
    expect(within(dialog).getByLabelText('Company')).toBeRequired()
    expect(within(dialog).getByLabelText('Next action date')).toBeDisabled()

    await user.type(within(dialog).getByLabelText('Next action'), 'Follow up with recruiter')
    expect(within(dialog).getByLabelText('Next action date')).toBeEnabled()
    await user.clear(within(dialog).getByLabelText('Next action'))
    expect(within(dialog).getByLabelText('Next action date')).toBeDisabled()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readSavedDocument().applications).toHaveLength(19)
  })

  it('adds and removes an attachment from the application editor', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(
      screen.getByRole('button', {
        name: 'Open Saffron Systems, Product Operations Manager',
      }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Edit application' })
    const file = new File(['cover letter'], 'cover-letter.txt', { type: 'text/plain' })
    await user.upload(within(dialog).getByLabelText('Attachments'), file)
    expect(within(dialog).getByText('cover-letter.txt')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    const saved = readSavedDocument()
    const saffron = saved.applications.find((application) => application.company === 'Saffron Systems')
    expect(saffron?.attachments).toHaveLength(1)
    expect(saffron?.attachments[0]?.filename).toBe('cover-letter.txt')

    await user.click(
      screen.getByRole('button', {
        name: 'Open Saffron Systems, Product Operations Manager',
      }),
    )
    const editDialog = screen.getByRole('dialog', { name: 'Edit application' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(within(editDialog).getByRole('button', { name: 'Remove' }))
    await user.click(within(editDialog).getByRole('button', { name: 'Save changes' }))

    expect(confirm).toHaveBeenCalled()
    expect(
      readSavedDocument().applications.find((application) => application.company === 'Saffron Systems')?.attachments,
    ).toHaveLength(0)
  })
})