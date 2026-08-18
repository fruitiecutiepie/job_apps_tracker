import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

function icsFile(...lines: string[]) {
  const contents = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR']
    .join('\r\n')
  return new File([contents], 'invite.ics', { type: 'text/calendar' })
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

  it('records stage prep notes from the board and finds them again with search', async () => {
    const user = userEvent.setup()
    const { unmount } = await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))

    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })
    expect(within(dialog).getByRole('heading', { name: 'Applied' })).toBeInTheDocument()
    expect(within(dialog).getByText('Current stage')).toBeInTheDocument()

    await user.type(
      within(dialog).getByLabelText('Applied prep notes'),
      'Ask about the rebrand project',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save notes' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Prep notes saved.')

    const saved = readSavedDocument().applications.find(
      (application) => application.company === 'Marble & Finch',
    )!
    expect(saved.stage_notes).toEqual([
      expect.objectContaining({ state: 'applied', body: 'Ask about the rebrand project' }),
    ])
    expect(saved.state_history).toHaveLength(1)

    unmount()
    await renderLoadedApp()
    await user.type(screen.getByRole('searchbox', { name: 'Search applications' }), 'rebrand project')
    expect(screen.getByRole('button', { name: /Open Marble & Finch/ })).toBeInTheDocument()
  })

  it('shows the current stage notes first as a readable outline and can clear a stage', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))

    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })
    const headings = within(dialog).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['Interview 2', 'Interview 1', 'Offer'])

    // Saved notes render, rather than opening in a textarea.
    expect(within(dialog).queryByLabelText('Interview 2 prep notes')).not.toBeInTheDocument()
    expect(within(dialog).getByText('Cutting cycle time')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Edit Interview 1' }))
    await user.clear(within(dialog).getByLabelText('Interview 1 prep notes'))
    await user.click(within(dialog).getByRole('button', { name: 'Save notes' }))

    const saved = readSavedDocument().applications.find(
      (application) => application.company === 'Halcyon Maps',
    )!
    expect(saved.stage_notes.map((note) => note.state)).toEqual(['interview_2', 'offer'])
  })

  it('folds headings and sub-points in the reading view without changing saved notes', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    const themes = within(dialog).getByRole('button', { name: 'Leadership themes' })
    expect(themes).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getByText('Cutting cycle time')).toBeInTheDocument()

    await user.click(themes)
    expect(themes).toHaveAttribute('aria-expanded', 'false')
    expect(within(dialog).queryByText('Cutting cycle time')).not.toBeInTheDocument()

    await user.click(themes)
    const subPoints = within(dialog).getByRole('button', {
      name: 'Growing seniors into leads sub-points',
    })
    expect(within(dialog).getByText('The two promotions I sponsored last year')).toBeInTheDocument()

    await user.click(subPoints)
    expect(
      within(dialog).queryByText('The two promotions I sponsored last year'),
    ).not.toBeInTheDocument()
    expect(within(dialog).getByText('Cutting cycle time')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Collapse all points in Interview 2' }))
    expect(within(dialog).queryByText('Cutting cycle time')).not.toBeInTheDocument()

    // Folding is display state only.
    const saved = readSavedDocument().applications.find(
      (application) => application.company === 'Halcyon Maps',
    )!
    expect(saved.stage_notes.map((note) => note.state)).toEqual([
      'interview_1',
      'interview_2',
      'offer',
    ])
  })

  it('formats notes from the editor toolbar and renders the markdown back', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    const textarea = within(dialog).getByLabelText('Applied prep notes')
    await user.type(textarea, 'Rehearse the rebrand story')
    await user.click(within(dialog).getByRole('button', { name: 'Bullet point in Applied' }))

    expect(textarea).toHaveValue('- Rehearse the rebrand story')

    await user.click(within(dialog).getByRole('button', { name: 'Read Applied' }))
    expect(within(dialog).getByText('Rehearse the rebrand story')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Save notes' }))
    const saved = readSavedDocument().applications.find(
      (application) => application.company === 'Marble & Finch',
    )!
    expect(saved.stage_notes[0].body).toBe('- Rehearse the rebrand story')
  })

  it('adds prep notes for a stage the application has not reached yet', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Orbit & Oak' }))

    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })
    await user.selectOptions(within(dialog).getByLabelText('Add notes for another stage'), 'interview_1')
    await user.type(
      within(dialog).getByLabelText('Interview 1 prep notes'),
      'Prepare two operations stories',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save notes' }))

    const saved = readSavedDocument().applications.find(
      (application) => application.company === 'Orbit & Oak',
    )!
    expect(saved.state).toBe('online_assessment')
    expect(saved.stage_notes).toEqual([
      expect.objectContaining({ state: 'interview_1', body: 'Prepare two operations stories' }),
    ])
  })

  it('folds every level of hierarchy: headings, points with detail, quotes, and code', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByLabelText('Applied prep notes'))
    await user.paste(
      [
        '## Compensation',
        '- Base',
        '  - Eight percent below target',
        '- Timeline',
        '',
        '  They want an answer by Friday.',
        '',
        '> From the recruiter: bring three references and a portfolio link',
        '',
        '```ts',
        'const answer = 1',
        '```',
      ].join('\n'),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Read Applied' }))

    // Nested spans mean a phrase can match several ancestors; presence is what matters here.
    const shows = (text: string) => within(dialog).queryAllByText(text, { exact: false }).length > 0

    const detail = [
      'Eight percent below target',
      'They want an answer by Friday.',
      'portfolio link',
      'const answer = 1',
    ]
    for (const text of detail) expect(shows(text), text).toBe(true)

    // A point whose detail is a paragraph folds, just like one with sub-bullets.
    await user.click(within(dialog).getByRole('button', { name: 'Timeline sub-points' }))
    expect(shows('They want an answer by Friday.')).toBe(false)
    expect(shows('Eight percent below target')).toBe(true)

    // Quotes fold behind a preview of their own text.
    // The fold button previews the opening words, so the tail proves the body is hidden.
    await user.click(within(dialog).getByRole('button', { name: /^Quote: From the recruiter/ }))
    expect(shows('portfolio link')).toBe(false)

    // Code blocks fold behind a language and line count.
    await user.click(within(dialog).getByRole('button', { name: 'ts · 1 line' }))
    expect(shows('const answer = 1')).toBe(false)

    // Collapse all reaches every fold, including ones nested inside others.
    await user.click(within(dialog).getByRole('button', { name: 'Collapse all points in Applied' }))
    for (const text of [...detail, 'Base', 'Timeline']) expect(shows(text), text).toBe(false)
    expect(within(dialog).getByRole('button', { name: 'Compensation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    await user.click(within(dialog).getByRole('button', { name: 'Expand all points in Applied' }))
    for (const text of [...detail, 'Base', 'Timeline']) expect(shows(text), text).toBe(true)
  })

  it('folds from the text of a point, not just its chevron', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })
    const shows = (text: string) => within(dialog).queryAllByText(text, { exact: false }).length > 0

    // A point with sub-points folds when its own text is clicked.
    await user.click(within(dialog).getByText('Growing seniors into leads'))
    expect(shows('The two promotions I sponsored last year')).toBe(false)
    expect(
      within(dialog).getByRole('button', { name: 'Growing seniors into leads sub-points' }),
    ).toHaveAttribute('aria-expanded', 'false')

    await user.click(within(dialog).getByText('Growing seniors into leads'))
    expect(shows('The two promotions I sponsored last year')).toBe(true)

    // Heading text keeps working the same way.
    await user.click(within(dialog).getByText('Leadership themes'))
    expect(shows('Cutting cycle time')).toBe(false)

    // A point without sub-points has nothing to fold and no control to press.
    await user.click(within(dialog).getByText('Remote expectations'))
    expect(shows('Remote expectations')).toBe(true)
  })

  it('leaves links and text selection alone inside a foldable point', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })
    const shows = (text: string) => within(dialog).queryAllByText(text, { exact: false }).length > 0

    await user.click(within(dialog).getByLabelText('Applied prep notes'))
    await user.paste('- See the [job ad](https://example.com/ad)\n  - Salary band is listed')
    await user.click(within(dialog).getByRole('button', { name: 'Read Applied' }))

    // The link is a real link, not a button nested inside one.
    const link = within(dialog).getByRole('link', { name: 'job ad' })
    expect(link).toHaveAttribute('href', 'https://example.com/ad')
    expect(link.closest('button')).toBeNull()

    // Clicking the link navigates rather than folding the point.
    await user.click(link)
    expect(shows('Salary band is listed')).toBe(true)

    // Finishing a drag-selection over the point does not fold it either. fireEvent is used
    // here because user-event clears the selection on mousedown, before the handler runs.
    const text = within(dialog).getByText('See the', { exact: false })
    const range = document.createRange()
    range.selectNodeContents(text)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    fireEvent.click(text)
    expect(shows('Salary band is listed')).toBe(true)

    window.getSelection()?.removeAllRanges()
    fireEvent.click(text)
    expect(shows('Salary band is listed')).toBe(false)
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

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('button', { name: 'Reset demo data' }))
    expect(readSavedDocument().applications).toHaveLength(20)
    expect(search).toHaveValue('Reset Me')

    await user.click(screen.getByRole('button', { name: 'More actions' }))
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

  it('imports a calendar invite against a state and replaces it when it is rescheduled', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(
      screen.getByRole('button', { name: 'Open Paper Kite, Senior UX Researcher' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Edit application' })
    await user.upload(
      within(dialog).getByLabelText('Invite file'),
      icsFile(
        'UID:screen-1@example.com',
        'SUMMARY:Screening call with Dana',
        'DTSTART:20260901T040000Z',
        'DTEND:20260901T043000Z',
        'LOCATION:Video call',
      ),
    )

    const invite = within(dialog).getByRole('group', { name: 'Invite 1' })
    expect(within(invite).getByDisplayValue('Screening call with Dana')).toBeInTheDocument()
    expect(within(invite).getByDisplayValue('Video call')).toBeInTheDocument()
    // An imported invite is filed under the stage the application is in.
    expect(within(invite).getByRole('combobox')).toHaveValue('recruiter_messaged')
    expect(within(dialog).getByRole('status')).toHaveTextContent('1 added')

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    const paperKite = () =>
      readSavedDocument().applications.find((application) => application.company === 'Paper Kite')
    expect(paperKite()?.state_events).toHaveLength(1)
    expect(paperKite()?.state_events[0]).toMatchObject({
      state: 'recruiter_messaged',
      summary: 'Screening call with Dana',
      starts_at: '2026-09-01T04:00:00.000Z',
      ends_at: '2026-09-01T04:30:00.000Z',
      location: 'Video call',
      ics_uid: 'screen-1@example.com',
    })
    const storedId = paperKite()!.state_events[0]!.id

    await user.click(
      screen.getByRole('button', { name: 'Open Paper Kite, Senior UX Researcher' }),
    )
    const reopened = screen.getByRole('dialog', { name: 'Edit application' })
    await user.upload(
      within(reopened).getByLabelText('Invite file'),
      icsFile(
        'UID:screen-1@example.com',
        'SUMMARY:Screening call with Dana (moved)',
        'DTSTART:20260903T050000Z',
        'SEQUENCE:1',
      ),
    )

    expect(within(reopened).getAllByRole('group', { name: /^Invite/ })).toHaveLength(1)
    expect(within(reopened).getByRole('status')).toHaveTextContent('1 updated')
    await user.click(within(reopened).getByRole('button', { name: 'Save changes' }))

    expect(paperKite()?.state_events).toHaveLength(1)
    expect(paperKite()?.state_events[0]).toMatchObject({
      id: storedId,
      summary: 'Screening call with Dana (moved)',
      starts_at: '2026-09-03T05:00:00.000Z',
      sequence: 1,
    })

    await user.type(screen.getByRole('searchbox', { name: 'Search applications' }), 'screening call')
    expect(screen.getByText('1 of 19 applications shown')).toBeInTheDocument()
  })

  it('refuses to save an invite that has no start time', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(
      screen.getByRole('button', { name: 'Open Paper Kite, Senior UX Researcher' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Edit application' })
    await user.click(within(dialog).getByRole('button', { name: 'Add invite manually' }))
    const invite = within(dialog).getByRole('group', { name: 'Invite 1' })
    await user.type(within(invite).getByLabelText('What'), 'Panel interview')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Invite 1 needs a start date and time.',
    )
    expect(
      readSavedDocument().applications.find((application) => application.company === 'Paper Kite')
        ?.state_events,
    ).toEqual([])
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