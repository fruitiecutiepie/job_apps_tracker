import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_DEMO_REFERENCE } from '../domain/demo'
import { loadTrackerDocument } from '../domain/storage'
import { formatShortDate, formatTimeOfDay } from '../views/viewUtils'
import App from '../App'
import { testTrackerStore } from './trackerStore'
import {
  readTestEditorNote,
  setTestEditorLaunchResponse,
  testEditorSessionCount,
  writeTestEditorNote,
} from './noteEditStore'

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

/** Comfortably past the panel's own wait, for asserting that nothing was written. */
const AUTOSAVE_SETTLE_MS = 1500

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
  /*
   * Pin the wall clock to the instant the demo seeds are measured from. The seeds are
   * deterministic but a view's "today" is not, so without this the two drift apart until a
   * seed crosses a stale, overdue or calendar boundary and assertions here start failing on
   * a date rather than on a change — which is exactly what happened to the Kanban card names
   * below once Saffron Systems aged past DEFAULT_STALE_THRESHOLD_DAYS.
   *
   * Only Date is faked. Faking the timers as well would hang every waitFor in this file:
   * Testing Library's fake-timer support is gated on a global `jest`, which vitest does not
   * define, so its polling would sit on a setInterval that nothing ever advances.
   */
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(DEFAULT_DEMO_REFERENCE))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs at the demo reference date, so every date-driven assertion here is deterministic', () => {
    // A guard for the whole file rather than a behaviour test: if the pinning above is ever
    // removed, this fails with the reason instead of leaving a later assertion to fail months
    // later on an accessible name that gained a stale suffix.
    expect(new Date().toISOString()).toBe(DEFAULT_DEMO_REFERENCE)
  })

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

    for (const view of ['Table', 'Focus', 'Calendar', 'Stale', 'Statistics'] as const) {
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

  it('marks a next action done from the board, logging it in the notes and persisting it', async () => {
    const user = userEvent.setup()
    const { unmount } = await renderLoadedApp()
    const before = readSavedDocument().applications.find(
      (application) => application.company === 'Saffron Systems',
    )!
    expect(before.next_action).toBe('Prepare questions for onboarding')

    await user.click(
      screen.getByRole('button', {
        name: 'Mark done for Saffron Systems: Prepare questions for onboarding',
      }),
    )

    const after = readSavedDocument().applications.find((item) => item.id === before.id)!
    expect(after.next_action).toBeNull()
    expect(after.next_action_at).toBeNull()
    // The plan is gone but what was done is on the record. Exact, because the clock is pinned
    // — but built from the app's own formatter rather than one locale's rendering of it, since
    // the day the date reads as is the reader's locale, not this app's contract.
    expect(after.notes).toBe(
      `${before.notes}\n${formatShortDate(DEFAULT_DEMO_REFERENCE)} — Prepare questions for onboarding`,
    )
    // Resolving a task is not a stage change.
    expect(after.state_history).toEqual(before.state_history)
    expect(after.deadline_at).toBe(before.deadline_at)

    // The control goes away with the action it resolved, and the change survives a reload.
    expect(
      screen.queryByRole('button', { name: /^Mark done for Saffron Systems/ }),
    ).not.toBeInTheDocument()

    unmount()
    await renderLoadedApp()
    expect(
      screen.queryByRole('button', { name: /^Mark done for Saffron Systems/ }),
    ).not.toBeInTheDocument()
    expect(readSavedDocument().applications).toHaveLength(19)
  })

  it('shows the state history of an application it is editing, and none for a new one', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(
      screen.getByRole('button', {
        name: 'Open Saffron Systems, Product Operations Manager',
      }),
    )

    const dialog = screen.getByRole('dialog', { name: 'Edit application' })
    const history = within(dialog).getByRole('list', { name: 'History' })
    const rows = within(history).getAllByRole('listitem')
    const saved = readSavedDocument().applications.find(
      (application) => application.company === 'Saffron Systems',
    )!
    expect(rows).toHaveLength(saved.state_history.length)
    expect(rows[0]).toHaveTextContent('Applied')
    expect(rows.at(-1)).toHaveTextContent('Accepted')
    // The last move is still running, so its span reads as unfinished.
    expect(rows.at(-1)).toHaveTextContent(/so far|Today/)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Add application' }))
    const adding = screen.getByRole('dialog', { name: 'Add application' })
    expect(within(adding).queryByRole('list', { name: 'History' })).not.toBeInTheDocument()
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

    // No Save: the note writes itself once the typing pauses, with the panel still open.
    const savedNotes = () =>
      readSavedDocument().applications.find(
        (application) => application.company === 'Marble & Finch',
      )!
    await waitFor(
      () =>
        expect(savedNotes().stage_notes).toEqual([
          expect.objectContaining({ state: 'applied', body: 'Ask about the rebrand project' }),
        ]),
      { timeout: 4000 },
    )
    expect(screen.getByRole('dialog', { name: 'Stage prep notes' })).toBeInTheDocument()
    expect(savedNotes().state_history).toHaveLength(1)

    // A write per pause in typing would put a toast permanently over the note it names.
    expect(screen.queryByText('Prep notes saved.')).not.toBeInTheDocument()
    expect(within(dialog).getByText(/^Saved/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    unmount()
    await renderLoadedApp()
    await user.type(screen.getByRole('searchbox', { name: 'Search applications' }), 'rebrand project')
    expect(screen.getByRole('button', { name: /Open Marble & Finch/ })).toBeInTheDocument()
  })

  it('keeps the last keystrokes when the panel is closed before they were written', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })
    await user.type(within(dialog).getByLabelText('Applied prep notes'), 'Salary band question')

    // Closed straight away, well inside the wait: the keystrokes just before the panel
    // goes are the ones the wait has not run out on, and the ones worth keeping.
    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await waitFor(() =>
      expect(
        readSavedDocument()
          .applications.find((application) => application.company === 'Marble & Finch')!
          .stage_notes,
      ).toEqual([expect.objectContaining({ state: 'applied', body: 'Salary band question' })]),
    )
  })

  it('writes only the stage that changed, leaving the other stages as they were', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    const notes = () =>
      readSavedDocument().applications.find(
        (application) => application.company === 'Halcyon Maps',
      )!.stage_notes
    const stamps = new Map(notes().map((note) => [note.state, note.updated_at]))

    await user.click(within(dialog).getByRole('tab', { name: 'Offer' }))
    await user.click(within(dialog).getByRole('button', { name: 'Edit Offer' }))
    await user.type(within(dialog).getByLabelText('Offer prep notes'), ' and the review cycle')

    // The clock is pinned, so a rewritten note is stamped now and an untouched one keeps
    // the date it was seeded with — which is what tells the two apart.
    await waitFor(
      () =>
        expect(notes().find((note) => note.state === 'offer')!.updated_at)
          .toBe(DEFAULT_DEMO_REFERENCE),
      { timeout: 4000 },
    )
    for (const state of ['interview_1', 'interview_2'] as const) {
      expect(notes().find((note) => note.state === state)!.updated_at).toBe(stamps.get(state))
    }
  })

  it('takes a stage off the tab bar without deleting the note behind it', async () => {
    const user = userEvent.setup()
    const { unmount } = await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    // The application's own stage is always listed, so only the others can be closed.
    expect(within(dialog).queryByRole('button', { name: 'Close the Interview 2 tab' }))
      .not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Close the Offer tab' }))
    expect(within(dialog).getAllByRole('tab').map((tab) => tab.textContent))
      .toEqual(['Interview 2Current stage', 'Interview 1'])

    // Off screen, not deleted: the note is untouched and the tab is back next time.
    expect(
      readSavedDocument()
        .applications.find((application) => application.company === 'Halcyon Maps')!
        .stage_notes.map((note) => note.state),
    ).toEqual(['interview_1', 'interview_2', 'offer'])

    unmount()
    await renderLoadedApp()
    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    expect(
      within(screen.getByRole('dialog', { name: 'Stage prep notes' }))
        .getByRole('tab', { name: 'Offer' }),
    ).toBeInTheDocument()
  })

  it('captures a line into the note being read and stores it without Save', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    // Reading the prep note for the current stage, not editing it.
    const notes = within(dialog).getByRole('tabpanel')
    expect(within(notes).getByText('Cutting cycle time')).toBeInTheDocument()

    await user.type(
      within(notes).getByLabelText('Capture a line in Interview 2'),
      'Two more rounds after this{Enter}',
    )

    // Enter files the line rather than submitting the panel around it, so the note is
    // still open to be read from and captured into again.
    expect(within(dialog).getByRole('tabpanel')).toBeInTheDocument()
    expect(within(notes).getByLabelText('Capture a line in Interview 2')).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('Note captured.')

    // It reads in the docked log, under today, and only there: the prep note above is
    // a different field and does not gain a copy of it.
    const log = within(notes).getByRole('log', { name: 'Heard in Interview 2' })
    expect(within(log).getByText('Two more rounds after this')).toBeInTheDocument()
    expect(within(notes).getAllByText('Two more rounds after this')).toHaveLength(1)

    // The line is stamped with the time it was captured. The date is not restated on it:
    // it is already the heading the line sits under.
    const stamp = formatTimeOfDay(DEFAULT_DEMO_REFERENCE)
    expect(within(log).getByText(stamp)).toBeInTheDocument()
    expect(within(log).getByRole('heading', { name: formatShortDate(DEFAULT_DEMO_REFERENCE) }))
      .toBeInTheDocument()
    expect(within(log).getByText('Two more rounds after this').textContent)
      .not.toContain(formatShortDate(DEFAULT_DEMO_REFERENCE))

    // Stored on capture: the panel was never saved and is still open.
    const stored = readSavedDocument().applications.find(
      (application) => application.company === 'Halcyon Maps',
    )!
    const captured = stored.stage_notes.find((note) => note.state === 'interview_2')!
    expect(captured.heard.map((entry) => entry.body)).toEqual([
      'Team is 40 engineers across four squads',
      'Platform work gets a fixed 20% of each quarter',
      'Decision comes back by the end of next week',
      'Two more rounds after this',
    ])
    // The prepared body it was captured against is untouched, and so are the other stages.
    expect(captured.body).toContain('Cutting cycle time')
    expect(captured.body).not.toContain('Two more rounds after this')
    expect(stored.stage_notes.map((note) => note.state)).toEqual([
      'interview_1',
      'interview_2',
      'offer',
    ])
  })

  it('keeps captures on screen and writable while the prep note is being edited', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    // Captures are their own field, so writing the prep note cannot race them: the log
    // and its capture line stay put rather than being replaced by the editor.
    await user.click(within(dialog).getByRole('button', { name: 'Edit Interview 2' }))
    expect(within(dialog).getByLabelText('Interview 2 prep notes')).toBeInTheDocument()

    const log = within(dialog).getByRole('log', { name: 'Heard in Interview 2' })
    expect(within(log).getByText('Team is 40 engineers across four squads')).toBeInTheDocument()

    await user.type(
      within(dialog).getByLabelText('Capture a line in Interview 2'),
      'Offer decision sits with the VP{Enter}',
    )

    const stored = readSavedDocument().applications.find(
      (application) => application.company === 'Halcyon Maps',
    )!
    const captured = stored.stage_notes.find((note) => note.state === 'interview_2')!
    expect(captured.heard.at(-1)?.body).toBe('Offer decision sits with the VP')
  })

  it('keeps what you were told when the prep note for that stage is cleared', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByRole('button', { name: 'Edit Interview 2' }))
    await user.clear(within(dialog).getByLabelText('Interview 2 prep notes'))

    // A blank body drops a note that holds nothing else. This one was told things.
    const captured = () =>
      readSavedDocument()
        .applications.find((application) => application.company === 'Halcyon Maps')!
        .stage_notes.find((note) => note.state === 'interview_2')!
    await waitFor(() => expect(captured().body).toBe(''), { timeout: 4000 })
    expect(captured().heard).toHaveLength(3)
  })

  it('reaches the capture line of whichever pane is focused from the keyboard', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    await user.keyboard('{Control>}k{/Control}')
    expect(within(dialog).getByLabelText('Capture a line in Interview 2')).toHaveFocus()

    // Split, then read the second pane: capture follows the pane being read rather than
    // the one that was open first.
    await user.keyboard('{Control>}\\{/Control}')
    await user.click(within(dialog).getByRole('heading', { name: 'Interview 1' }))
    await user.keyboard('{Control>}k{/Control}')
    expect(within(dialog).getByLabelText('Capture a line in Interview 1')).toHaveFocus()
  })

  it('opens a tab per stage with the current one first, and can clear a stage', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))

    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })
    const tabs = within(dialog).getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['Interview 2Current stage', 'Interview 1', 'Offer'])

    // The current stage is the tab on show, and its saved notes render rather than
    // opening in a textarea.
    const notes = within(dialog).getByRole('tabpanel')
    expect(within(dialog).getByRole('tab', { selected: true })).toHaveTextContent('Interview 2')
    expect(within(notes).queryByLabelText('Interview 2 prep notes')).not.toBeInTheDocument()
    expect(within(notes).getByText('Cutting cycle time')).toBeInTheDocument()

    // Another stage's note is one tab away, and clearing it drops the note on its own.
    await user.click(within(dialog).getByRole('tab', { name: 'Interview 1' }))
    await user.click(within(dialog).getByRole('button', { name: 'Edit Interview 1' }))
    await user.clear(within(dialog).getByLabelText('Interview 1 prep notes'))

    const savedStates = () =>
      readSavedDocument()
        .applications.find((application) => application.company === 'Halcyon Maps')!
        .stage_notes.map((note) => note.state)
    await waitFor(() => expect(savedStates()).toEqual(['interview_2', 'offer']), { timeout: 4000 })

    // The stage keeps its tab and its pane: the note went, but the caret that emptied it
    // is still in the box, and a stage typed into must not vanish from under it.
    expect(within(dialog).getByRole('tab', { name: 'Interview 1' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Interview 1 prep notes')).toBeInTheDocument()
  })

  it('finds text across every stage and follows the matches from tab to tab', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByRole('button', { name: 'Find' }))
    await user.type(within(dialog).getByLabelText('Find in notes'), 'they')

    // "They pushed hard" in Interview 1 and "They hinted at Staff" in Offer. Neither is
    // the stage on show, so the find has to reach into tabs that are not rendered.
    expect(within(dialog).getByText('1 of 2')).toBeInTheDocument()
    expect(within(dialog).getByRole('tab', { name: /Interview 1/ })).toHaveTextContent('1')
    expect(within(dialog).getByRole('tab', { name: /Offer/ })).toHaveTextContent('1')

    // Typing lands on the first match, which means switching to the tab holding it.
    expect(within(dialog).getByRole('tab', { selected: true })).toHaveTextContent('Interview 1')
    expect(within(dialog).getByRole('tabpanel')).toHaveTextContent('They pushed hard')

    // Stepping crosses into the next stage's note, and wraps back round.
    await user.click(within(dialog).getByRole('button', { name: 'Next match' }))
    expect(within(dialog).getByText('2 of 2')).toBeInTheDocument()
    expect(within(dialog).getByRole('tab', { selected: true })).toHaveTextContent('Offer')
    expect(within(dialog).getByRole('tabpanel')).toHaveTextContent('They hinted at Staff')

    await user.click(within(dialog).getByRole('button', { name: 'Next match' }))
    expect(within(dialog).getByText('1 of 2')).toBeInTheDocument()
    expect(within(dialog).getByRole('tab', { selected: true })).toHaveTextContent('Interview 1')

    await user.click(within(dialog).getByRole('button', { name: 'Previous match' }))
    expect(within(dialog).getByText('2 of 2')).toBeInTheDocument()
    expect(within(dialog).getByRole('tab', { selected: true })).toHaveTextContent('Offer')
  })

  it('reveals a match inside a folded section, and refolds it when the find closes', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    const notes = within(dialog).getByRole('tabpanel')

    // A folded row is unmounted, so the browser's own find could never reach this.
    await user.click(within(notes).getByRole('button', { name: 'Leadership themes' }))
    expect(within(notes).queryByText('Cutting cycle time')).not.toBeInTheDocument()

    await user.keyboard('{Control>}f{/Control}')
    await user.type(within(dialog).getByLabelText('Find in notes'), 'cycle time')

    expect(within(dialog).getByText('1 of 1')).toBeInTheDocument()
    expect(within(notes).getByText('cycle time')).toBeInTheDocument()
    expect(within(notes).getByRole('button', { name: 'Leadership themes' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    // Closing the find puts the outline back the way the reader had folded it.
    await user.click(within(dialog).getByRole('button', { name: 'Close find' }))
    expect(within(notes).queryByText('Cutting cycle time')).not.toBeInTheDocument()
    expect(within(notes).getByRole('button', { name: 'Leadership themes' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('reports a query that matches nothing without disturbing the notes', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    await user.keyboard('{Control>}f{/Control}')
    await user.type(within(dialog).getByLabelText('Find in notes'), 'nothing here')

    expect(within(dialog).getByText('No results')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Next match' })).toBeDisabled()
    expect(within(within(dialog).getByRole('tabpanel')).getByText('Cutting cycle time')).toBeInTheDocument()
  })

  it('closes the find with Escape and the panel with the next one', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    await user.keyboard('{Control>}f{/Control}')
    await user.type(within(dialog).getByLabelText('Find in notes'), 'they')

    // Escape belongs to the find while it is open, the way it does in an editor.
    await user.keyboard('{Escape}')
    expect(within(dialog).queryByLabelText('Find in notes')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Stage prep notes' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Stage prep notes' })).not.toBeInTheDocument()
  })

  it('moves between stage tabs with the arrow keys and renames the breadcrumb trail', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    const active = () => within(dialog).getByRole('tab', { selected: true })
    expect(active()).toHaveTextContent('Interview 2')

    active().focus()
    await user.keyboard('{ArrowRight}')
    expect(active()).toHaveTextContent('Interview 1')

    // The breadcrumbs name the stage on show, so switching tabs re-labels them.
    expect(within(dialog).getByText('Interview 1', { selector: '.panel__crumb' })).toBeInTheDocument()

    await user.keyboard('{ArrowLeft}')
    expect(active()).toHaveTextContent('Interview 2')

    // Stepping past the last tab wraps to the first.
    await user.keyboard('{ArrowLeft}')
    expect(active()).toHaveTextContent('Offer')
  })

  it('outlines the headings of the stage on show and scrolls to one on request', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    expect(within(dialog).getByRole('button', { name: 'Go to Leadership themes' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Go to Questions to ask' })).toBeInTheDocument()

    // Selecting a heading takes the note to it.
    await user.click(within(dialog).getByRole('button', { name: 'Go to Questions to ask' }))
    expect(within(dialog).getByRole('tabpanel')).toHaveTextContent('Questions to ask')

    // And marks the heading picked, not the one above it. A heading near the end of a note
    // cannot scroll to the top of the pane — the note runs out first — so reading the
    // position back would name the heading before it.
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Go to Questions to ask' })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })
    expect(
      within(dialog).getByRole('button', { name: 'Go to Leadership themes' }),
    ).not.toHaveAttribute('aria-current')

    // The jump holds its target un-sticky while it measures where the note really has it,
    // and has to put that back: left static, a heading would never pin under the header
    // again. Level 1 and 2 headings are the sticky ones, so this is not cosmetic.
    for (const heading of within(dialog)
      .getByRole('tabpanel')
      .querySelectorAll<HTMLElement>('[data-section-key]')) {
      expect(heading.style.position).toBe('')
    }

    // The outline follows the tab: Interview 1's note is prose with no headings at all.
    await user.click(within(dialog).getByRole('tab', { name: 'Interview 1' }))
    expect(
      within(dialog).queryByRole('button', { name: 'Go to Leadership themes' }),
    ).not.toBeInTheDocument()
    expect(within(dialog).getByText('This note has no headings to outline.')).toBeInTheDocument()
  })

  it('takes the caret to a heading picked from the outline while the note is being written', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    // Writing rather than reading: there is no rendered heading to scroll to, only the
    // line the heading was typed on.
    await user.click(within(dialog).getByRole('button', { name: 'Edit Interview 2' }))
    const editor = within(dialog).getByRole('textbox', {
      name: 'Interview 2 prep notes',
    }) as HTMLTextAreaElement

    await user.click(within(dialog).getByRole('button', { name: 'Go to Questions to ask' }))

    await waitFor(() => {
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe(
        '## Questions to ask',
      )
    })

    // And the outline marks it, the same as it does when reading.
    expect(within(dialog).getByRole('button', { name: 'Go to Questions to ask' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('opens the editor at the heading that was being read, not at the top', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    // Read partway down, then reach for the editor: it should open where reading left off.
    await user.click(within(dialog).getByRole('button', { name: 'Go to Questions to ask' }))
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Go to Questions to ask' })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })

    await user.click(within(dialog).getByRole('button', { name: 'Edit Interview 2' }))
    const editor = within(dialog).getByRole('textbox', {
      name: 'Interview 2 prep notes',
    }) as HTMLTextAreaElement

    await waitFor(() => {
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe(
        '## Questions to ask',
      )
    })
  })

  it('follows the caret through the outline while the note is being written', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })
    await user.click(within(dialog).getByRole('button', { name: 'Edit Interview 2' }))
    const editor = within(dialog).getByRole('textbox', {
      name: 'Interview 2 prep notes',
    }) as HTMLTextAreaElement

    // Writing under the first heading marks it, wherever the editor was opened.
    const themes = editor.value.indexOf('Growing seniors')
    await user.type(editor, 'x', {
      initialSelectionStart: themes,
      initialSelectionEnd: themes,
    })
    await waitFor(() => {
      expect(
        within(dialog).getByRole('button', { name: 'Go to Leadership themes' }),
      ).toHaveAttribute('aria-current', 'true')
    })

    // Moving on to the next section moves the outline with it.
    const questions = editor.value.indexOf('How is platform work')
    await user.type(editor, 'y', {
      initialSelectionStart: questions,
      initialSelectionEnd: questions,
    })
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Go to Questions to ask' })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })
    expect(
      within(dialog).getByRole('button', { name: 'Go to Leadership themes' }),
    ).not.toHaveAttribute('aria-current')

    // And above the first heading the note is in no section at all.
    await user.type(editor, 'z', { initialSelectionStart: 0, initialSelectionEnd: 0 })
    await waitFor(() => {
      expect(
        within(dialog).getByRole('button', { name: 'Go to Questions to ask' }),
      ).not.toHaveAttribute('aria-current')
    })
  })

  it('drops a pane whose stage stops being open while the panel is up', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    const target = readSavedDocument().applications.find(
      (application) => application.company === 'Halcyon Maps',
    )!

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByRole('button', { name: 'Split' }))
    expect(within(dialog).getAllByRole('tabpanel')[1]).toHaveAccessibleName('Interview 1')

    // Emptying the note in an external editor commits straight away, with the panel still
    // up: the stage leaves the tab bar, so the pane holding it cannot stay open either.
    await user.click(within(dialog).getByRole('button', { name: 'Open Interview 1 in an editor' }))
    writeTestEditorNote(target.id, 'interview_1', '')

    await waitFor(
      () => {
        expect(within(dialog).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
          'Interview 2Current stage',
          'Offer',
        ])
      },
      // The scratch file is re-read once a second, so this cannot land any sooner.
      { timeout: 4000 },
    )
    const panes = within(dialog).getAllByRole('tabpanel')
    expect(panes).toHaveLength(1)
    expect(panes[0]).toHaveAccessibleName('Interview 2')
  })

  it('splits into two panes, each reading a different stage, and unsplits again', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    expect(within(dialog).getAllByRole('tabpanel')).toHaveLength(1)

    await user.click(within(dialog).getByRole('button', { name: 'Split' }))
    const panes = within(dialog).getAllByRole('tabpanel')
    expect(panes).toHaveLength(2)

    // The second pane opens on a different stage, and each names the tab it is showing.
    expect(panes[0]).toHaveAccessibleName('Interview 2')
    expect(panes[1]).toHaveAccessibleName('Interview 1')
    expect(within(panes[0]).getByText('Leadership themes')).toBeInTheDocument()
    expect(within(panes[1]).getByText('incident response', { exact: false })).toBeInTheDocument()

    // Both tabs read as open; the focused one is the pane the sidebar describes.
    expect(within(dialog).getAllByRole('tab', { selected: true })).toHaveLength(2)

    await user.click(within(dialog).getByRole('button', { name: 'Unsplit' }))
    expect(within(dialog).getAllByRole('tabpanel')).toHaveLength(1)
  })

  it('never opens the same stage in both panes', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByRole('button', { name: 'Split' }))
    // Panes hold Interview 2 and Interview 1. Asking the focused pane for a stage the
    // other pane already holds has to move focus, not duplicate the note — two copies
    // would give one match two ids and the find would step onto the wrong one.
    await user.click(within(dialog).getByRole('tab', { name: /Interview 1/ }))

    const panes = within(dialog).getAllByRole('tabpanel')
    expect(panes).toHaveLength(2)
    expect(panes[0]).toHaveAccessibleName('Interview 2')
    expect(panes[1]).toHaveAccessibleName('Interview 1')
  })

  it('closes one pane of a split without touching the other', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    // Nothing to close while a single pane is the whole panel.
    expect(within(dialog).queryByRole('button', { name: /pane$/ })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Split' }))
    await user.click(within(dialog).getByRole('button', { name: 'Close the Interview 1 pane' }))

    const panes = within(dialog).getAllByRole('tabpanel')
    expect(panes).toHaveLength(1)
    expect(panes[0]).toHaveAccessibleName('Interview 2')
  })

  it('takes the find into a pane and hides the outline on request', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByRole('button', { name: 'Split' }))
    await user.keyboard('{Control>}f{/Control}')
    await user.type(within(dialog).getByLabelText('Find in notes'), 'equity refresh')

    // Offer is in neither pane, so the find puts it in the focused one.
    expect(within(dialog).getByText('1 of 1')).toBeInTheDocument()
    const panes = within(dialog).getAllByRole('tabpanel')
    expect(panes[0]).toHaveAccessibleName('Offer')
    expect(panes[1]).toHaveAccessibleName('Interview 1')

    // The outline collapses away to give the notes the full width, and comes back.
    expect(within(dialog).getByText('Outline')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Hide the outline' }))
    expect(within(dialog).queryByText('Outline')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Show the outline' }))
    expect(within(dialog).getByText('Outline')).toBeInTheDocument()
  })

  it('nests the outline under the headings the note nests them under', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByLabelText('Applied prep notes'))
    await user.paste('# Panel\n\n## Case study\n\n### The numbers\n\n# Questions')
    await user.click(within(dialog).getByRole('button', { name: 'Read Applied' }))

    // The hierarchy is in the markup, not only in the indentation: each heading's
    // children hang off its own row, so the shape is there for a reader and a reader's
    // screen reader alike.
    const top = within(dialog).getByRole('list', { name: 'Outline' })
    const rows = within(top).getAllByRole('button').map((row) => row.textContent)
    expect(rows).toEqual(['Panel', 'Case study', 'The numbers', 'Questions'])

    const panelRow = within(top).getByRole('button', { name: 'Go to Panel' })
    const under = panelRow.parentElement!.querySelector('ul')!
    expect(within(under).getByRole('button', { name: 'Go to Case study' })).toBeInTheDocument()
    expect(within(under).getByRole('button', { name: 'Go to The numbers' })).toBeInTheDocument()
    // A sibling heading is not nested under it.
    expect(within(under).queryByRole('button', { name: 'Go to Questions' })).not.toBeInTheDocument()

    // Depth drives how loudly a row reads, and it is nesting depth, not heading level.
    expect(panelRow).toHaveAttribute('data-depth', '0')
    expect(within(top).getByRole('button', { name: 'Go to Case study' })).toHaveAttribute('data-depth', '1')
    expect(within(top).getByRole('button', { name: 'Go to The numbers' })).toHaveAttribute('data-depth', '2')
  })

  it('opens any stage from the quick open picker, and closes it with Escape', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByRole('button', { name: 'Go to stage' }))
    const picker = within(dialog).getByLabelText('Go to stage')
    const choices = () => within(within(dialog).getByRole('list', { name: 'Stages' }))

    // Every stage is reachable, and the ones already open say so.
    expect(choices().getAllByRole('button')).toHaveLength(19)
    // Exact, because "Interview 2" is also the start of "Interview 2 — Rejected".
    const interviewTwo = choices().getByText('Interview 2', { selector: '.quick-open__label' })
    expect(interviewTwo.closest('button')).toHaveTextContent('Open')

    await user.type(picker, 'takeh')
    expect(choices().getAllByRole('button')).toHaveLength(2)
    expect(choices().getAllByRole('button')[0]).toHaveTextContent('Take-home assessment')

    // Escape leaves the picker without opening anything.
    await user.keyboard('{Escape}')
    expect(within(dialog).queryByLabelText('Go to stage')).not.toBeInTheDocument()
    expect(within(dialog).getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('dialog', { name: 'Stage prep notes' })).toBeInTheDocument()

    // Picking one opens it as a tab, ready to type into.
    await user.click(within(dialog).getByRole('button', { name: 'Go to stage' }))
    await user.type(within(dialog).getByLabelText('Go to stage'), 'takeh')
    await user.keyboard('{Enter}')

    expect(within(dialog).getAllByRole('tab')).toHaveLength(4)
    expect(within(dialog).getByRole('tab', { selected: true })).toHaveTextContent('Take-home assessment')
    expect(within(dialog).getByLabelText('Take-home assessment prep notes')).toBeInTheDocument()
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

    const savedBody = () =>
      readSavedDocument().applications.find(
        (application) => application.company === 'Marble & Finch',
      )!.stage_notes[0]?.body
    await waitFor(() => expect(savedBody()).toBe('- Rehearse the rebrand story'), { timeout: 4000 })
  })

  it('adds prep notes for a stage the application has not reached yet', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Orbit & Oak' }))

    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    // Quick open reaches every stage, not only the ones already on screen.
    await user.keyboard('{Control>}p{/Control}')
    await user.type(within(dialog).getByLabelText('Go to stage'), 'inter1')
    await user.keyboard('{Enter}')

    expect(within(dialog).getByRole('tab', { selected: true })).toHaveTextContent('Interview 1')
    await user.type(
      within(dialog).getByLabelText('Interview 1 prep notes'),
      'Prepare two operations stories',
    )

    const saved = () =>
      readSavedDocument().applications.find(
        (application) => application.company === 'Orbit & Oak',
      )!
    await waitFor(
      () =>
        expect(saved().stage_notes).toEqual([
          expect.objectContaining({ state: 'interview_1', body: 'Prepare two operations stories' }),
        ]),
      { timeout: 4000 },
    )
    // Writing a note for a stage does not move the application to it.
    expect(saved().state).toBe('online_assessment')
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

    // Nested spans mean a phrase can match several ancestors, and a code block's tokens
    // split a line across siblings entirely; a plain substring check over the dialog's
    // full text sidesteps both, since a fold removes its content rather than hiding it.
    const shows = (text: string) => (dialog.textContent ?? '').includes(text)

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
    // Scoped to the note: the sidebar outline lists the same headings by design.
    const notes = () => within(within(dialog).getByRole('tabpanel'))
    const shows = (text: string) => notes().queryAllByText(text, { exact: false }).length > 0

    // A point with sub-points folds when its own text is clicked.
    await user.click(notes().getByText('Growing seniors into leads'))
    expect(shows('The two promotions I sponsored last year')).toBe(false)
    expect(
      notes().getByRole('button', { name: 'Growing seniors into leads sub-points' }),
    ).toHaveAttribute('aria-expanded', 'false')

    await user.click(notes().getByText('Growing seniors into leads'))
    expect(shows('The two promotions I sponsored last year')).toBe(true)

    // Heading text keeps working the same way.
    await user.click(notes().getByText('Leadership themes'))
    expect(shows('Cutting cycle time')).toBe(false)

    // A point without sub-points has nothing to fold and no control to press.
    await user.click(within(dialog).getByRole('tab', { name: 'Offer' }))
    await user.click(notes().getByText('Remote expectations'))
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

  it('hands a stage note to an external editor and stores what comes back', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    const target = readSavedDocument().applications.find(
      (application) => application.company === 'Marble & Finch',
    )!

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByLabelText('Applied prep notes'))
    await user.paste('Draft from the app')
    await user.click(within(dialog).getByRole('button', { name: 'Open Applied in an editor' }))

    // The current draft is what gets handed over, not the last saved value.
    expect(readTestEditorNote(target.id, 'applied')).toBe('Draft from the app')
    expect(within(dialog).getByRole('status')).toHaveTextContent('test-editor')
    expect(within(dialog).getByText('data/editing/', { exact: false })).toBeInTheDocument()

    // While the editor owns the stage, the in-app textarea steps aside.
    expect(within(dialog).queryByLabelText('Applied prep notes')).not.toBeInTheDocument()

    // Stand in for saving the file in the editor.
    writeTestEditorNote(target.id, 'applied', '## Rewritten\n\n- In my editor')

    await waitFor(
      () => {
        expect(
          readSavedDocument().applications.find((application) => application.id === target.id)
            ?.stage_notes[0]?.body,
        ).toBe('## Rewritten\n\n- In my editor')
      },
      { timeout: 4000 },
    )

    // External saves commit on their own; there is no Save button in an editor.
    expect(screen.getByText('Prep notes saved from your editor.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Rewritten' })).toBeInTheDocument()

    // The file coming back is not then written a second time as though it had been typed
    // here. Counted in writes rather than in timestamps: the clock is pinned, so a second
    // write of the same text would be indistinguishable from the first by its stamp.
    const writes = () =>
      vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT').length
    const before = writes()
    await new Promise((resolve) => setTimeout(resolve, AUTOSAVE_SETTLE_MS))
    expect(writes()).toBe(before)

    await user.click(within(dialog).getByRole('button', { name: 'Stop editing Applied externally' }))
    expect(testEditorSessionCount()).toBe(0)
    expect(within(dialog).getByRole('button', { name: 'Edit Applied' })).toBeInTheDocument()
  })

  it('ends every editing session when the prep notes dialog closes', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByRole('button', { name: 'Open Interview 2 in an editor' }))
    // A session outlives the tab that started it, so both are still open at the end.
    await user.click(within(dialog).getByRole('tab', { name: 'Offer' }))
    await user.click(within(dialog).getByRole('button', { name: 'Open Offer in an editor' }))
    expect(testEditorSessionCount()).toBe(2)

    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => expect(testEditorSessionCount()).toBe(0))
  })

  it('hands the file to this machine when the server returns an editor URL', async () => {
    const user = userEvent.setup()
    setTestEditorLaunchResponse({
      path: 'data/editing/x/applied.md',
      absolute_path: '/remote/repo/data/editing/x/applied.md',
      editor: 'cursor',
      source: 'url',
      open_url: 'cursor://vscode-remote/ssh-remote+box/remote/repo/data/editing/x/applied.md',
    })
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })
    await user.click(within(dialog).getByRole('button', { name: 'Open Applied in an editor' }))

    // The browser is the one that opens it, so the URL is offered as a link too.
    const link = within(dialog).getByRole('link', { name: 'cursor' })
    expect(link).toHaveAttribute(
      'href',
      'cursor://vscode-remote/ssh-remote+box/remote/repo/data/editing/x/applied.md',
    )
    expect(within(dialog).getByRole('status')).toHaveTextContent('on this machine')
  })

  it('says which host it opened on when the editor ran somewhere else', async () => {
    const user = userEvent.setup()
    setTestEditorLaunchResponse({
      path: 'data/editing/x/applied.md',
      absolute_path: '/remote/repo/data/editing/x/applied.md',
      editor: 'xdg-open',
      source: 'os',
      host: 'devbox',
    })
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))
    const dialog = screen.getByRole('dialog', { name: 'Stage prep notes' })
    await user.click(within(dialog).getByRole('button', { name: 'Open Applied in an editor' }))

    const banner = within(dialog).getByRole('status')
    expect(banner).toHaveTextContent('on devbox')
    expect(banner).toHaveTextContent('TRACKER_EDITOR_URL')
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

  it('saves ratings set while adding an application', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add application' }))
    const dialog = screen.getByRole('dialog', { name: 'Add application' })

    await user.type(within(dialog).getByLabelText('Company'), 'Rated Rail')
    await user.selectOptions(within(dialog).getByLabelText('Work'), '5')
    await user.selectOptions(within(dialog).getByLabelText('Growth'), '4')
    // "Don't know" is a judgement of its own, not a blank.
    await user.selectOptions(within(dialog).getByLabelText('People'), 'unknown')
    await user.click(within(dialog).getByRole('button', { name: 'Add application' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const saved = readSavedDocument().applications.find(({ company }) => company === 'Rated Rail')
    expect(saved?.ratings.map(({ dimension, score }) => [dimension, score])).toEqual([
      ['work', 5],
      ['growth', 4],
      ['people', null],
    ])
  })

  it('saves a rating and a field edit in the same submit, and can clear one', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: /Open Marble & Finch/ }))
    let dialog = screen.getByRole('dialog', { name: 'Edit application' })

    const company = within(dialog).getByLabelText('Company')
    await user.clear(company)
    await user.type(company, 'Marble and Finch')
    await user.selectOptions(within(dialog).getByLabelText('Work'), '3')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    const edited = () =>
      readSavedDocument().applications.find(({ company: name }) => name === 'Marble and Finch')
    expect(edited()?.ratings.map(({ dimension, score }) => [dimension, score])).toEqual([
      ['work', 3],
    ])

    // Blanking a select returns the dimension to never assessed, not to a zero.
    await user.click(screen.getByRole('button', { name: /Open Marble and Finch/ }))
    dialog = screen.getByRole('dialog', { name: 'Edit application' })
    await user.selectOptions(within(dialog).getByLabelText('Work'), '')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(edited()?.ratings).toEqual([])
  })

  it('saves a compensation band and point value while adding an application', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add application' }))
    const dialog = screen.getByRole('dialog', { name: 'Add application' })

    await user.type(within(dialog).getByLabelText('Company'), 'Paid Pier')
    await user.type(within(dialog).getByLabelText('Currency'), 'aud')
    // Thousands separators are how people write salaries, so they are accepted.
    await user.type(within(dialog).getByLabelText('Advertised from'), '130,000')
    await user.type(within(dialog).getByLabelText('Advertised to'), '150,000')
    // A blank "to" is the point value, not a missing half of a band.
    await user.type(within(dialog).getByLabelText('Expected from'), '145000')
    await user.click(within(dialog).getByRole('button', { name: 'Add application' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const saved = readSavedDocument().applications.find(({ company }) => company === 'Paid Pier')
    expect(saved?.compensation).toEqual({
      currency: 'AUD',
      advertised: { min: 130_000, max: 150_000 },
      expected: { min: 145_000, max: 145_000 },
      offered: null,
    })
  })

  it('reads a stored record back into the boxes it was typed in and records an offer', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    // Halcyon Maps ships with all three stages, so this is a genuine round trip.
    await user.click(screen.getByRole('button', { name: /Open Halcyon Maps/ }))
    const dialog = screen.getByRole('dialog', { name: 'Edit application' })

    expect(within(dialog).getByLabelText('Currency')).toHaveValue('AUD')
    expect(within(dialog).getByLabelText('Advertised from')).toHaveValue('180000')
    expect(within(dialog).getByLabelText('Advertised to')).toHaveValue('210000')
    expect(within(dialog).getByLabelText('Expected from')).toHaveValue('200000')
    // A point value reads back with an empty "to", the way it was entered.
    expect(within(dialog).getByLabelText('Expected to')).toHaveValue('')
    expect(within(dialog).getByLabelText('Offered from')).toHaveValue('215000')

    const offered = within(dialog).getByLabelText('Offered from')
    await user.clear(offered)
    await user.type(offered, '225000')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    const saved = readSavedDocument().applications.find(({ company }) => company === 'Halcyon Maps')
    expect(saved?.compensation.offered).toEqual({ min: 225_000, max: 225_000 })
    // The stages it did not touch are untouched, not rebuilt as blanks.
    expect(saved?.compensation.advertised).toEqual({ min: 180_000, max: 210_000 })
  })

  it('refuses to save an amount with no currency to read it in', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: /Open Echo Robotics/ }))
    const dialog = screen.getByRole('dialog', { name: 'Edit application' })
    await user.type(within(dialog).getByLabelText('Offered from'), '200000')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Compensation needs a currency, so the amounts can be read.',
    )
    expect(
      readSavedDocument().applications.find(({ company }) => company === 'Echo Robotics')
        ?.compensation.offered,
    ).toBeNull()
  })

  it('saves a deadline that stands alone from the next action', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add application' }))
    const dialog = screen.getByRole('dialog', { name: 'Add application' })

    const deadline = within(dialog).getByLabelText('Deadline')
    expect(deadline).toBeEnabled()

    await user.type(within(dialog).getByLabelText('Company'), 'Quarry Rail')
    fireEvent.change(deadline, { target: { value: '2026-08-22T17:00' } })
    await user.click(within(dialog).getByRole('button', { name: 'Add application' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const saved = readSavedDocument().applications.find(({ company }) => company === 'Quarry Rail')
    expect(saved).toMatchObject({
      next_action: null,
      next_action_at: null,
      deadline_at: new Date('2026-08-22T17:00').toISOString(),
    })
    expect(readSavedDocument().indexes.by_deadline_at).toContain(saved!.id)
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