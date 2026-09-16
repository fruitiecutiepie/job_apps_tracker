import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_DEMO_REFERENCE } from '../domain/demo'
import { loadTrackerDocument } from '../domain/storage'
import { formatShortDate, formatTimeOfDay } from '../views/viewUtils'
import App from '../App'
import { seedFullDemo } from './fixture'
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

/**
 * What a tab shows, rather than everything written on it. A tab carries its whole name for
 * a screen reader as well as the distinguishing part of it on screen, so `textContent` is
 * both at once; these assertions are about the strip as it is read.
 */
/**
 * Opens another pane. Split asks where it goes, so a test that wants one says — Right
 * being the direction the old single-press control always took.
 */
async function splitPane(
  user: ReturnType<typeof userEvent.setup>,
  within_: HTMLElement,
  where = 'Right',
) {
  await user.click(within(within_).getByRole('button', { name: 'Split' }))
  await user.click(within(within_).getByRole('button', { name: where }))

  /*
   * A pane opens empty, so this then puts a note in it — the tab beside the one being
   * read, sent over with the keyboard, which is what Split used to do on its own. Tests
   * that are about the empty pane itself do not come through here.
   */
  const chord: Record<string, string> = {
    Right: '{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}',
    Left: '{Control>}{Shift>}{ArrowLeft}{/Shift}{/Control}',
    Below: '{Control>}{Shift>}{ArrowDown}{/Shift}{/Control}',
    Above: '{Control>}{Shift>}{ArrowUp}{/Shift}{/Control}',
  }
  const strip = () => within(within_).getAllByRole('tablist')[0]
  const spare = within(strip()).getAllByRole('tab')[1]
  if (!spare) return
  // Selected first, because what the chord moves is the tab the pane is showing.
  await user.click(spare)
  await user.keyboard(chord[where])
  // The moved tab takes focus with it, so this hands it back to the pane split from —
  // which is where Split used to leave it, and what the tests after this assume.
  const reading = within(strip())
    .getAllByRole('tab')
    .find((tab) => tab.getAttribute('aria-selected') === 'true')
  if (reading) await user.click(reading)
}

function tabText(tab: HTMLElement): string {
  return tab.querySelector('.panel__tab-label')?.textContent ?? ''
}

function readSavedDocument() {
  return loadTrackerDocument(testTrackerStore)
}

/**
 * Renders the app and waits for its first load.
 *
 * The wait carries its own budget because the default is one second, and one second is not
 * a measurement of this app — it is a measurement of the machine. The first render walks a
 * thousand nodes and reads the document behind a stubbed fetch, and on a loaded laptop that
 * takes longer than a second often enough to be the single largest source of failures that
 * say nothing about the code. Bounded by the test's own timeout either way, so a genuine
 * hang still fails; what this stops is a slow start reading as a broken one.
 */
async function renderLoadedApp() {
  const view = render(<App />)
  await waitFor(
    () => expect(screen.queryByText('Loading tracker data…')).not.toBeInTheDocument(),
    { timeout: 15_000 },
  )
  return view
}

/** Opens a stage's capture dock, collapsed by default, before a test reaches into it. */
async function openCapture(user: ReturnType<typeof userEvent.setup>, container: HTMLElement, label: string) {
  await user.click(within(container).getByRole('button', { name: `Show what they said in ${label}` }))
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
   * Only Date is faked by default. Faking the timers as well used to hang every waitFor in
   * this file, because Testing Library's fake-timer support is gated on a global `jest`
   * that vitest does not define and its polling would sit on an interval nothing advanced.
   * The setup file now points that name at `vi`, so a test can take the whole clock if
   * waiting in real time is the slow part of it — see the one below that does. It has to
   * re-pin the system time when it does, and hand user-event the same clock to wind on.
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
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
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

  it('offers all seven views and keeps the shared collection available while navigating', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    // Scoped to the nav rather than searched for across the page, per AGENTS.md: a role
    // query walks the tree computing an accessible name per candidate, which costs far
    // more over a thousand-node app than over the seven buttons in this one landmark.
    const views = within(screen.getByRole('navigation', { name: 'Tracker views' }))

    for (const view of ['Table', 'Focus', 'Calendar', 'Stale', 'Statistics', 'Compare'] as const) {
      const viewButton = views.getByRole('button', { name: view })
      await user.click(viewButton)
      expect(viewButton).toHaveAttribute('aria-current', 'page')
    }

    await user.click(views.getByRole('button', { name: 'Kanban' }))
    expect(screen.getByRole('heading', { name: 'Applied' })).toBeInTheDocument()
  }, 30_000)

  it('creates an application through the accessible form and can find it globally', async () => {
    // Counts the whole corpus after adding to it, so it takes the demo entire.
    seedFullDemo()
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
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.selectOptions(screen.getByLabelText('Filter by state'), 'accepted')

    expect(screen.getByRole('heading', { name: 'Accepted' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Applied' })).not.toBeInTheDocument()

    const savedDocument = readSavedDocument()
    expect(savedDocument.applications).toHaveLength(19)
  })

  it('filters to every rejection at once, and to everything that is not one', async () => {
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
    const user = userEvent.setup()
    await renderLoadedApp()

    const stateFilter = screen.getByLabelText('Filter by state')

    await user.selectOptions(stateFilter, 'rejected')
    // Eight states record a rejection, one application in each.
    expect(screen.getByText('8 of 19 applications shown')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Offer — Rejected' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Offer' })).not.toBeInTheDocument()

    await user.selectOptions(stateFilter, 'not_rejected')
    expect(screen.getByText('11 of 19 applications shown')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Offer' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Offer — Rejected' })).not.toBeInTheDocument()
    // Neither is a rejection, so both survive a filter that only removes them.
    expect(screen.getByRole('heading', { name: 'Accepted' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No openings' })).toBeInTheDocument()

    expect(readSavedDocument().applications).toHaveLength(19)
  })

  it('filters to the applications that have gone quiet, whatever stage they sit at', async () => {
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
    const user = userEvent.setup()
    await renderLoadedApp()

    const activityFilter = screen.getByLabelText('Filter by activity')

    await user.selectOptions(activityFilter, 'idle')
    // Northstar Labs was edited yesterday but has not moved stage in 34 days, which is
    // exactly the case reading `updated_at` would miss.
    expect(screen.getByText('1 of 19 applications shown')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Open Northstar Labs/ })).toBeInTheDocument()
    // The stage is untouched: it is still in its own lane, not moved somewhere new.
    expect(screen.getByRole('heading', { name: 'Headhunted' })).toBeInTheDocument()

    await user.selectOptions(activityFilter, 'not_idle')
    expect(screen.getByText('18 of 19 applications shown')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Open Northstar Labs/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('19 of 19 applications shown')).toBeInTheDocument()

    // Filtering is a view: nothing about the application was written.
    const saved = readSavedDocument().applications.find((a) => a.company === 'Northstar Labs')!
    expect(saved.state).toBe('headhunted')
  })

  it('copies the roles of a whole outcome, not just one state', async () => {
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.selectOptions(screen.getByLabelText('Filter by state'), 'rejected')
    await user.selectOptions(screen.getByLabelText('Filter by source'), 'LinkedIn')
    await user.click(screen.getByRole('button', { name: 'Copy roles' }))

    expect((await navigator.clipboard.readText()).split('\n').sort()).toEqual([
      'Platform Engineer',
      'Product Designer',
      'Senior Data Scientist',
    ])
  })

  it('filters views by company without changing saved applications', async () => {
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.selectOptions(screen.getByLabelText('Filter by company'), 'Saffron Systems')

    expect(screen.getByRole('button', { name: /^Open Saffron Systems, Product Operations Manager/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open Marble & Finch/ })).not.toBeInTheDocument()
    expect(readSavedDocument().applications).toHaveLength(19)
  })

  it('filters views by source without changing saved applications', async () => {
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.selectOptions(screen.getByLabelText('Filter by source'), 'LinkedIn')

    expect(screen.getByRole('button', { name: 'Open Marble & Finch, Product Manager' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open Orbit & Oak/ })).not.toBeInTheDocument()
    expect(readSavedDocument().applications).toHaveLength(19)
  })

  it('puts search on the count row, not among the filters', async () => {
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
    await renderLoadedApp()

    const count = screen.getByText('19 of 19 applications shown')
    const search = screen.getByRole('searchbox', { name: 'Search applications' })

    expect(count.nextElementSibling).toBe(search.parentElement)
    expect(search.closest('.context-bar__filters')).toBeNull()
  })

  it('keeps Copy roles beside the source filter rather than below the filter row', async () => {
    await renderLoadedApp()

    const source = screen.getByLabelText('Filter by source')
    const copy = screen.getByRole('button', { name: 'Copy roles' })

    // jsdom has no layout, so this pins the pairing that keeps the two on one line —
    // where they actually land is a browser check.
    expect(source.nextElementSibling).toBe(copy)
    expect(copy.parentElement).toBe(source.parentElement)
  })

  it('copies the roles of exactly what the filters are showing', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.selectOptions(screen.getByLabelText('Filter by source'), 'LinkedIn')
    await user.selectOptions(screen.getByLabelText('Filter by state'), 'applied')
    await user.click(screen.getByRole('button', { name: 'Copy roles' }))

    expect(await navigator.clipboard.readText()).toBe('Product Manager')
    expect(screen.getByRole('status')).toHaveTextContent('Copied 1 role')
  })

  it('copies one line per showing application, newest filter state included', async () => {
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.selectOptions(screen.getByLabelText('Filter by source'), 'LinkedIn')
    await user.click(screen.getByRole('button', { name: 'Copy roles' }))

    expect((await navigator.clipboard.readText()).split('\n').sort()).toEqual([
      'Platform Engineer',
      'Product Designer',
      'Product Manager',
      'Product Operations Manager',
      'Senior Data Scientist',
    ])
    expect(screen.getByRole('status')).toHaveTextContent('Copied 5 roles')
  })

  it('persists edits across reloads and appends history only when state changes', async () => {
    // Counts the whole corpus, so it takes the demo entire.
    seedFullDemo()
    const user = userEvent.setup()
    const { unmount } = await renderLoadedApp()
    const before = readSavedDocument().applications.find(
      (application) => application.company === 'Saffron Systems',
    )!

    await user.click(
      screen.getByRole('button', {
        name: /^Open Saffron Systems, Product Operations Manager/,
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

  it('marks a next action done from the board, recording it apart from the notes', async () => {
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
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
    // A record of its own, not a line appended to the prose.
    expect(after.notes).toBe(before.notes)
    expect(after.completed_actions.map((entry) => entry.action)).toEqual([
      ...before.completed_actions.map((entry) => entry.action),
      'Prepare questions for onboarding',
    ])
    expect(after.completed_actions.at(-1)!.at).toBe(DEFAULT_DEMO_REFERENCE)
    // Resolving a task is not a stage change, and a closing date is not a task.
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

  it('marks an action done from the editor and lists it apart from the notes', async () => {
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
    const user = userEvent.setup()
    await renderLoadedApp()
    const before = readSavedDocument().applications.find(
      (application) => application.company === 'Atlas Thread',
    )!

    await user.click(screen.getByRole('button', { name: /^Open Atlas Thread/ }))
    const dialog = screen.getByRole('dialog', { name: 'Edit application' })

    // What is already recorded is listed, separately from the Notes textarea.
    for (const entry of before.completed_actions) {
      expect(within(dialog).getByText(entry.action)).toBeInTheDocument()
    }
    expect(within(dialog).getByLabelText('Notes')).toHaveValue(before.notes)

    const done = within(dialog).getByRole('button', { name: 'Mark next action done' })
    // One row: the action, its date, then Done — the control follows the fields it acts on.
    const row = done.closest('.next-action-field') as HTMLElement | null
    expect(row).not.toBeNull()
    const action = within(row!).getByLabelText('Next action')
    const date = within(row!).getByLabelText('Next action date')
    expect(action.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(date.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(done)

    // Draft only until the dialog is saved: the field clears, the record does not exist yet.
    expect(within(dialog).getByLabelText('Next action')).toHaveValue('')
    // Nothing left to resolve, so the control cannot record an empty entry.
    expect(done).toBeDisabled()
    expect(
      readSavedDocument().applications.find((item) => item.id === before.id)!.completed_actions,
    ).toHaveLength(before.completed_actions.length)

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    const after = readSavedDocument().applications.find((item) => item.id === before.id)!
    expect(after.next_action).toBeNull()
    expect(after.notes).toBe(before.notes)
    expect(after.completed_actions.map((entry) => entry.action)).toEqual([
      ...before.completed_actions.map((entry) => entry.action),
      'Prepare examples of system governance',
    ])
  })

  it('removes a completed action recorded by mistake', async () => {
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
    const user = userEvent.setup()
    await renderLoadedApp()
    const before = readSavedDocument().applications.find(
      (application) => application.company === 'Atlas Thread',
    )!
    const mistake = before.completed_actions[0]!

    await user.click(screen.getByRole('button', { name: /^Open Atlas Thread/ }))
    const dialog = screen.getByRole('dialog', { name: 'Edit application' })
    await user.click(
      within(dialog).getByRole('button', { name: `Remove completed action ${mistake.action}` }),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    const after = readSavedDocument().applications.find((item) => item.id === before.id)!
    expect(after.completed_actions.map((entry) => entry.id)).toEqual(
      before.completed_actions.slice(1).map((entry) => entry.id),
    )
    // Undoing the record does not put the task back on the plan.
    expect(after.next_action).toBe(before.next_action)
  })

  it('reaches prep notes from the header rather than from the view strip', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    // Seven views of the collection, and prep notes is not one of them: it is a workspace
    // that ignores every filter the strip's views share.
    const views = within(screen.getByRole('navigation', { name: 'Tracker views' }))
    expect(views.queryByRole('button', { name: 'Prep notes' })).not.toBeInTheDocument()

    // Beside the strip rather than among the actions: it says where you are, and the
    // cluster on the other side says what can be done to the collection.
    const notes = screen.getByRole('button', { name: 'Prep notes' })
    expect(notes.closest('.topbar__places')).not.toBeNull()
    expect(notes.closest('.topbar__actions')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Prep notes' }))
    expect(screen.getByRole('region', { name: 'Stage prep notes' })).toBeInTheDocument()
    /*
     * The page still says what it is, but it says it to a screen reader rather than in a
     * strip of its own: the header button naming this layer is lit while it is up, and a
     * row carrying a word already on screen costs a line of notes on every window.
     */
    const heading = screen.getByRole('heading', { level: 1, name: 'Prep notes' })
    expect(heading).toHaveClass('sr-only')
    expect(screen.queryByRole('region', { name: 'View context and filters' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prep notes' })).toHaveAttribute('aria-pressed', 'true')
    // And no view tab claims to be the page while it is showing.
    expect(views.queryByRole('button', { current: 'page' })).not.toBeInTheDocument()
  })

  it('closes the note being read with the panel\'s own close binding', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(within(panel).getAllByRole('tab')).toHaveLength(3)
    expect(within(panel).getByRole('tab', { selected: true })).toHaveTextContent('Interview 2')

    await user.keyboard('{Control>}{Shift>}X{/Shift}{/Control}')

    expect(within(panel).getAllByRole('tab')).toHaveLength(2)
    expect(within(panel).queryByRole('tab', { name: /Interview 2/ })).not.toBeInTheDocument()
  })

  it('closes the note whichever case the key arrives in', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(within(panel).getAllByRole('tab')).toHaveLength(3)

    /*
     * Shift is not a layout modifier, so the key is the key — it just arrives capitalised.
     * This binding carried Alt to dodge the browser's own `Ctrl/Cmd+W`, and Alt on macOS
     * rewrote it into `∑`, which took a match on `code` to read back and then took the
     * binding away from anyone whose W is not where QWERTY keeps it.
     */
    fireEvent.keyDown(document, { key: 'X', code: 'KeyX', metaKey: true, shiftKey: true })

    expect(within(panel).getAllByRole('tab')).toHaveLength(2)
    expect(within(panel).queryByRole('tab', { name: /Interview 2/ })).not.toBeInTheDocument()
  })

  it('leaves a bare close binding to the browser, whose own it is', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })

    // Ctrl/Cmd+W closes the browser's own tab and cannot be taken from it, so answering it
    // here would close a note on the way out of the page — losing the tab and the note.
    await user.keyboard('{Control>}w{/Control}')
    expect(within(panel).getAllByRole('tab')).toHaveLength(3)
  })

  it('browses every written note from the sidebar, grouped by stage', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })

    // The rail carries both panels, so the outline is not what has to be given up to
    // browse the rest.
    const tree = within(panel).getByRole('list', { name: 'Prep notes by stage' })

    // Grouped by the stage they prepare for, down the pipeline rather than by company.
    const groups = within(tree).getAllByRole('listitem', { name: /^Stage / })
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Stage Interview 1',
      'Stage Interview 2',
      'Stage Offer',
    ])

    // A note that was never written is not a place to go back to.
    expect(within(tree).queryByRole('button', { name: /Saffron Systems/ })).not.toBeInTheDocument()

    // And picking one opens it, whether or not it was already a tab.
    await user.click(within(tree).getByRole('button', { name: /^Echo Robotics/ }))
    expect(within(panel).getByRole('tab', { selected: true })).toHaveTextContent('Echo Robotics')
  })

  it('filters the tree from the sidebar rather than from the view bar', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })

    // The search belongs with the notes it searches, not with the collection's filters.
    expect(screen.queryByRole('searchbox', { name: 'Search applications' })).not.toBeInTheDocument()
    await user.type(within(panel).getByRole('searchbox', { name: 'Search prep notes' }), 'teleoperation')

    const tree = within(panel).getByRole('list', { name: 'Prep notes by stage' })
    expect(within(tree).getByRole('button', { name: /Echo Robotics/ })).toBeInTheDocument()
    expect(within(tree).getAllByRole('listitem', { name: /^Stage / })).toHaveLength(1)

    // And the words that matched, under the note holding them: a search that only said
    // which notes matched left the reader opening each one to find out why.
    const hits = within(tree).getByRole('list', { name: /^Matches in Echo Robotics/ })
    expect(within(hits).getAllByRole('button')[0]).toHaveTextContent(/teleoperation study/i)
  })

  it('resizes the sidebar, and closes it rather than narrowing past reading', async () => {
    const user = userEvent.setup()
    const { unmount } = await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })

    const edge = () => within(panel).getByRole('separator', { name: 'Resize the sidebar' })
    const width = () => Number(edge().getAttribute('aria-valuenow'))
    const started = width()

    edge().focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    const wider = width()
    expect(wider).toBeGreaterThan(started)

    // Wide enough to survive the app closing, like the panes and the dock.
    unmount()
    await renderLoadedApp()
    await user.click(screen.getByRole('button', { name: 'Prep notes' }))
    const restored = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(
      Number(
        within(restored).getByRole('separator', { name: 'Resize the sidebar' })
          .getAttribute('aria-valuenow'),
      ),
    ).toBe(wider)

    // Dragged past the point of being readable it closes, rather than leaving a column
    // nobody could use. The title bar's control is still there to bring it back.
    within(restored).getByRole('separator', { name: 'Resize the sidebar' }).focus()
    await user.keyboard('{ArrowLeft>40/}')
    expect(within(restored).queryByText('Outline')).not.toBeInTheDocument()
    expect(within(restored).getByRole('button', { name: 'Sidebar' })).toBeInTheDocument()
  })

  it('marks the searched words in a hit, and lands on them when it is picked', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    await user.type(within(panel).getByRole('searchbox', { name: 'Search prep notes' }), 'teleoperation')

    const hits = within(panel).getByRole('list', { name: /^Matches in Echo Robotics/ })
    const hit = within(hits).getAllByRole('button')[0]
    // The words that matched are marked in the snippet, not left for the eye to find.
    expect(hit.querySelector('.markdown__match')).toHaveTextContent('teleoperation')

    await user.click(hit)

    // Landed in the note, with the panel's own find running on the same words — which is
    // what opens a fold holding a match and paints the highlight.
    const shown = within(panel).getByRole('tab', { selected: true })
    expect(shown).toHaveTextContent('Echo Robotics')
    expect(within(panel).getByLabelText('Find in notes')).toHaveValue('teleoperation')
    await waitFor(() =>
      expect(
        within(panel).getByRole('tabpanel').querySelector('.markdown__match--current'),
      ).not.toBeNull(),
    )
  })

  it('opens the sidebar again by pulling its edge back out', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })

    const edge = () => within(panel).getByRole('separator', { name: 'Resize the sidebar' })
    edge().focus()
    await user.keyboard('{ArrowLeft>40/}')
    expect(within(panel).queryByRole('list', { name: 'Prep notes by stage' })).not.toBeInTheDocument()

    // The edge is still there with the sidebar shut, because it is how the sidebar comes
    // back as well as how it goes: a width is something to drag to, not only from. And it
    // is the first thing in the body, the column having nothing else left to hold.
    expect(edge().previousElementSibling).toBeNull()
    edge().focus()
    await user.keyboard('{ArrowRight}')

    // And it comes back showing what it was showing, not a default.
    expect(within(panel).getByRole('list', { name: 'Prep notes by stage' })).toBeInTheDocument()
    expect(Number(edge().getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(96)
  })

  it('collapses each half of the sidebar on its own, and sizes the two', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })

    // Each section folds away from its own heading, leaving the heading to bring it back.
    await user.click(within(panel).getByRole('button', { name: 'Hide the outline' }))
    expect(within(panel).queryByRole('list', { name: 'Outline' })).not.toBeInTheDocument()
    expect(within(panel).getByRole('list', { name: 'Prep notes by stage' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Show the outline' })).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Show the outline' }))
    expect(within(panel).getByRole('list', { name: 'Outline' })).toBeInTheDocument()

    // And the two share the column on a handle, like the panes do.
    const edge = within(panel).getByRole('separator', { name: 'Resize the outline' })
    const height = () => Number(edge.getAttribute('aria-valuenow'))
    const before = height()
    edge.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(height()).toBeGreaterThan(before)
  })

  it('shows and hides the whole sidebar from the title bar', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })

    // In the title bar rather than in a rail of its own — a column kept permanently to hold
    // one button costs more than the button is worth — and at its left end, over the column
    // it opens and closes.
    const toggle = within(panel).getByRole('button', { name: 'Sidebar' })
    expect(toggle.closest('.panel__titlebar')).not.toBeNull()
    expect(panel.querySelector('.panel__rail')).toBeNull()

    await user.click(toggle)
    expect(within(panel).queryByRole('list', { name: 'Prep notes by stage' })).not.toBeInTheDocument()
    await user.click(toggle)
    expect(within(panel).getByRole('list', { name: 'Prep notes by stage' })).toBeInTheDocument()
  })

  it('keeps the sidebar reachable when it is closed', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })

    await user.click(within(panel).getByRole('button', { name: 'Sidebar' }))
    // Everything it held goes together, being one panel rather than two.
    expect(within(panel).queryByRole('list', { name: 'Prep notes by stage' })).not.toBeInTheDocument()
    expect(within(panel).queryByText('Outline')).not.toBeInTheDocument()
    // The picker is in the title bar now, so closing the sidebar does not take it away.
    expect(within(panel).getByRole('button', { name: 'Open' })).toBeInTheDocument()

    // The control that brings the sidebar back is in the title bar, where it was when it
    // sent it away — and the edge is still there to pull it out by.
    expect(within(panel).getByRole('button', { name: 'Sidebar' })).toBeInTheDocument()
    expect(within(panel).getByRole('separator', { name: 'Resize the sidebar' })).toBeInTheDocument()
  })

  it('leaves the notes when a view is picked from the strip', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()
    const views = within(screen.getByRole('navigation', { name: 'Tracker views' }))

    await user.click(screen.getByRole('button', { name: 'Prep notes' }))
    expect(screen.getByRole('region', { name: 'Stage prep notes' })).toBeInTheDocument()

    // A tab that changed only what was underneath would look like a button doing nothing.
    await user.click(views.getByRole('button', { name: 'Calendar' }))
    expect(screen.queryByRole('region', { name: 'Stage prep notes' })).not.toBeInTheDocument()
    expect(views.getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Prep notes' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows and hides prep notes over whichever view you were on', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()
    const views = within(screen.getByRole('navigation', { name: 'Tracker views' }))
    const notesButton = () => screen.getByRole('button', { name: 'Prep notes' })

    await user.click(views.getByRole('button', { name: 'Table' }))
    expect(notesButton()).toHaveAttribute('aria-pressed', 'false')

    await user.click(notesButton())
    expect(screen.getByRole('region', { name: 'Stage prep notes' })).toBeInTheDocument()

    // Pressed again it goes, and what was underneath comes back — not a default view.
    await user.click(notesButton())
    expect(screen.queryByRole('region', { name: 'Stage prep notes' })).not.toBeInTheDocument()
    expect(views.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-current', 'page')
    expect(notesButton()).toHaveAttribute('aria-pressed', 'false')

    // Including when a card put you there rather than the header button.
    await user.click(views.getByRole('button', { name: 'Focus' }))
    await user.click(screen.getAllByRole('button', { name: /prep notes for/i })[0])
    expect(screen.getByRole('region', { name: 'Stage prep notes' })).toBeInTheDocument()

    await user.click(notesButton())
    expect(views.getByRole('button', { name: 'Focus' })).toHaveAttribute('aria-current', 'page')
  })

  it('offers no collection filters on the prep notes view', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes' }))

    // Every one of these acts on the collection, which this view deliberately ignores —
    // a count of what is "shown" here would be saying something untrue.
    expect(screen.queryByRole('searchbox', { name: 'Search applications' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Filter by company' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Filter by state' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copy roles/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/applications shown/)).not.toBeInTheDocument()
  })

  it('hosts the prep notes panel in the view surface rather than over it', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes' }))

    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(screen.getByRole('heading', { level: 1, name: 'Prep notes' })).toBeInTheDocument()
    // A view, not a modal: nothing is covered, so nothing claims to be.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(panel).not.toHaveAttribute('aria-modal')
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('opens prep notes from a card by going to the Prep notes view', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))

    expect(screen.getByRole('button', { name: 'Prep notes' })).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(screen.getByRole('region', { name: 'Stage prep notes' })).getByRole('heading', {
        name: 'Marble & Finch · Product Manager',
      }),
    ).toBeInTheDocument()
  })

  it('hands the caret to the panel when the application editor opens prep notes', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    // An application whose notes are already written, so the pane opens as an outline to
    // read: an empty one would put the caret in its editor and answer this on its own.
    await user.click(screen.getByRole('button', { name: /^Open Halcyon Maps/ }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Edit application' })).getByRole('button', {
        name: /prep notes for Halcyon Maps/i,
      }),
    )

    // The editor is handing over rather than closing back to where it was opened from, so
    // focus goes to the panel and not to the topbar the dialog would otherwise restore to.
    expect(screen.getByRole('region', { name: 'Stage prep notes' })).toContainElement(
      document.activeElement as HTMLElement,
    )
  })

  it('opens empty until a note is opened into it', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes' }))

    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(within(panel).queryByRole('tablist')).not.toBeInTheDocument()
    expect(within(panel).getByText(/Prep notes/)).toBeInTheDocument()
  })

  it('keeps the panel and the tab strip when Escape is pressed', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    await user.keyboard('{Escape}')

    // Nothing to close to: the way out is the tab strip, which Escape must not take away.
    expect(screen.getByRole('region', { name: 'Stage prep notes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kanban' })).toBeInTheDocument()
  })

  it('keeps what is open when another view is visited and come back from', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    await user.click(screen.getByRole('button', { name: 'Kanban' }))
    expect(screen.queryByRole('region', { name: 'Stage prep notes' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Prep notes' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(within(panel).getAllByRole('tab')).toHaveLength(3)
    expect(within(panel).getByRole('tab', { selected: true })).toHaveTextContent('Interview 2')
  })

  it('restores what was open, and how it was split, after the app is closed', async () => {
    const user = userEvent.setup()
    const { unmount } = await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const opened = screen.getByRole('region', { name: 'Stage prep notes' })
    await user.click(within(opened).getByRole('button', { name: 'Open' }))
    await user.click(
      within(within(opened).getByRole('list', { name: 'Applications' })).getByRole('button', {
        name: /^Human Factors Researcher/,
      }),
    )
    await splitPane(user, opened)
    expect(within(opened).getAllByRole('tabpanel')).toHaveLength(2)

    unmount()
    await renderLoadedApp()
    await user.click(screen.getByRole('button', { name: 'Prep notes' }))

    const restored = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(within(restored).getAllByRole('tabpanel')).toHaveLength(2)
    expect(
      within(restored).getAllByRole('tab').map(tabText),
    ).toEqual(expect.arrayContaining([expect.stringContaining('Echo Robotics')]))
  })

  it('leaves the view open and empty when the last tab is closed', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    await user.click(within(panel).getByRole('button', { name: 'Close the Marble & Finch · Applied tab' }))

    expect(screen.getByRole('region', { name: 'Stage prep notes' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('keeps open notes when a company filter hides their application', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))

    // The filter lives on the collection's own views, so it is set from one of them —
    // which is the point: the panel's tabs are its own arrangement, and a filter over the
    // board is not a reason to take a note being written away.
    await user.click(screen.getByRole('button', { name: 'Kanban' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by company' }), 'Paper Kite')
    await user.click(screen.getByRole('button', { name: 'Prep notes' }))

    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(within(panel).getAllByRole('tab')).toHaveLength(3)
  })

  it('records stage prep notes from the board and finds them again with search', async () => {
    const user = userEvent.setup()
    const { unmount } = await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))

    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(
      within(dialog).getByRole('heading', { name: 'Marble & Finch · Product Manager' }),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Current')).toBeInTheDocument()

    await user.type(
      within(dialog).getByLabelText('Marble & Finch · Applied prep notes'),
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
    expect(screen.getByRole('region', { name: 'Stage prep notes' })).toBeInTheDocument()
    expect(savedNotes().state_history).toHaveLength(1)

    // A write per pause in typing would put a toast permanently over the note it names.
    expect(screen.queryByText('Prep notes saved.')).not.toBeInTheDocument()
    expect(within(dialog).getByText(/^Saved/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Kanban' }))
    expect(screen.queryByRole('region', { name: 'Stage prep notes' })).not.toBeInTheDocument()

    unmount()
    await renderLoadedApp()
    await user.type(screen.getByRole('searchbox', { name: 'Search applications' }), 'rebrand project')
    expect(screen.getByRole('button', { name: /Open Marble & Finch/ })).toBeInTheDocument()
  })

  it('keeps the last keystrokes when the panel is closed before they were written', async () => {
    /*
     * The one test on a fake clock, as a trial of it. The panel's autosave is the thing
     * being waited for, so waiting for it in real time is time spent proving nothing.
     * user-event schedules its own delays between keystrokes and needs the same clock
     * wound on, or the typing never finishes.
     */
    vi.useFakeTimers()
    // Re-pinned: installing the timers afresh drops the system time the beforeEach set,
    // and the demo's stale, overdue and calendar dates are all read off that.
    vi.setSystemTime(new Date(DEFAULT_DEMO_REFERENCE))
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await user.type(within(dialog).getByLabelText('Marble & Finch · Applied prep notes'), 'Salary band question')

    // Left straight away, well inside the wait: the keystrokes just before the panel goes
    // are the ones the wait has not run out on, and the ones worth keeping.
    await user.click(screen.getByRole('button', { name: 'Kanban' }))
    expect(screen.queryByRole('region', { name: 'Stage prep notes' })).not.toBeInTheDocument()

    await waitFor(() =>
      expect(
        readSavedDocument()
          .applications.find((application) => application.company === 'Marble & Finch')!
          .stage_notes,
      ).toEqual([expect.objectContaining({ state: 'applied', body: 'Salary band question' })]),
    )
    vi.useRealTimers()
  })

  it('writes only the stage that changed, leaving the other stages as they were', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    const notes = () =>
      readSavedDocument().applications.find(
        (application) => application.company === 'Halcyon Maps',
      )!.stage_notes
    const stamps = new Map(notes().map((note) => [note.state, note.updated_at]))

    await user.click(within(dialog).getByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Offer' }))
    await user.click(within(dialog).getByRole('button', { name: 'Edit Halcyon Maps · Offer' }))
    await user.type(within(dialog).getByLabelText('Halcyon Maps · Offer prep notes'), ' and the review cycle')

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

  it('swaps a pane’s own tab for a different stage from its stage dropdown', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    const select = () =>
      within(dialog).getByRole('combobox', {
        name: 'Go to a different stage for Halcyon Maps',
      }) as HTMLSelectElement

    // Reads as the tab open in front of you, not as wherever the application actually
    // stands — an older or a not-yet-reached stage can be open without being where the
    // application is, and the control names the one you are looking at.
    expect(select().value).toBe('interview_2')
    expect(within(dialog).getAllByRole('tab')).toHaveLength(3)

    // A stage already open as a tab: picking it focuses that tab rather than opening a
    // second copy of it, and closes the tab it was picked from — the reader asked to see
    // a different stage, not to have both open. Leaves the application's own state
    // untouched either way, since this is not the same action as moving it on the board.
    await user.selectOptions(select(), 'Offer')

    expect(within(dialog).getAllByRole('tab')).toHaveLength(2)
    expect(within(dialog).getByRole('tab', { selected: true })).toHaveTextContent('Offer')
    expect(
      within(dialog).queryByRole('tab', { name: /^Halcyon Maps · Engineering Manager · Interview 2/ }),
    ).not.toBeInTheDocument()
    expect(
      readSavedDocument().applications.find((application) => application.company === 'Halcyon Maps')!
        .state,
    ).toBe('interview_2')
    expect(select().value).toBe('offer')

    // A stage with no tab yet: picking it swaps the current tab for it in place, the tab
    // count unchanged, rather than adding a fresh one alongside it.
    await user.selectOptions(select(), 'Applied')

    expect(within(dialog).getAllByRole('tab')).toHaveLength(2)
    expect(within(dialog).getByRole('tab', { selected: true })).toHaveTextContent('Applied')
  })

  it('takes a stage off the tab bar without deleting the note behind it', async () => {
    const user = userEvent.setup()
    const { unmount } = await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    // Every tab closes, the current stage's included: with notes from several
    // applications in one panel there is no single stage it must always keep.
    expect(within(dialog).getByRole('button', { name: 'Close the Halcyon Maps · Interview 2 tab' }))
      .toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Close the Halcyon Maps · Offer tab' }))
    expect(within(dialog).getAllByRole('tab').map(tabText))
      .toEqual(['Interview 2', 'Interview 1'])

    // Off screen, not deleted: the note itself is untouched.
    expect(
      readSavedDocument()
        .applications.find((application) => application.company === 'Halcyon Maps')!
        .stage_notes.map((note) => note.state),
    ).toEqual(['interview_1', 'interview_2', 'offer'])

    // And it stays closed next time. Closing a tab is the reader arranging their
    // workspace, and an arrangement that survives the app closing has to survive this too;
    // the picker is how a stage put away comes back.
    unmount()
    await renderLoadedApp()
    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const reopened = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(within(reopened).queryByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Offer' })).not.toBeInTheDocument()

    await user.click(within(reopened).getByRole('button', { name: 'Open' }))
    await user.selectOptions(
      within(reopened).getByRole('combobox', {
        name: 'Other stages for Halcyon Maps, Engineering Manager',
      }),
      'Offer',
    )
    expect(within(reopened).getByRole('tab', { name: /Halcyon Maps · Engineering Manager · Offer/ })).toBeInTheDocument()
  })

  it('captures a line into the note being read and stores it without Save', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    // Reading the prep note for the current stage, not editing it.
    const notes = within(dialog).getByRole('tabpanel')
    expect(within(notes).getByText('Cutting cycle time')).toBeInTheDocument()

    // Collapsed by default: what you were told is not on screen until it is opened.
    await openCapture(user, notes, 'Halcyon Maps · Interview 2')
    await user.type(
      within(notes).getByLabelText('Capture a line in Halcyon Maps · Interview 2'),
      'Two more rounds after this{Enter}',
    )

    // Enter files the line rather than submitting the panel around it, so the note is
    // still open to be read from and captured into again.
    expect(within(dialog).getByRole('tabpanel')).toBeInTheDocument()
    expect(within(notes).getByLabelText('Capture a line in Halcyon Maps · Interview 2')).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('Note captured.')

    // It reads in the docked log, under today, and only there: the prep note above is
    // a different field and does not gain a copy of it.
    const log = within(notes).getByRole('log', { name: 'What they said in Halcyon Maps · Interview 2' })
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
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    // Captures are their own field, so writing the prep note cannot race them: the log
    // and its capture line stay put rather than being replaced by the editor.
    await openCapture(user, dialog, 'Halcyon Maps · Interview 2')
    await user.click(within(dialog).getByRole('button', { name: 'Edit Halcyon Maps · Interview 2' }))
    expect(within(dialog).getByLabelText('Halcyon Maps · Interview 2 prep notes')).toBeInTheDocument()

    const log = within(dialog).getByRole('log', { name: 'What they said in Halcyon Maps · Interview 2' })
    expect(within(log).getByText('Team is 40 engineers across four squads')).toBeInTheDocument()

    await user.type(
      within(dialog).getByLabelText('Capture a line in Halcyon Maps · Interview 2'),
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
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByRole('button', { name: 'Edit Halcyon Maps · Interview 2' }))
    await user.clear(within(dialog).getByLabelText('Halcyon Maps · Interview 2 prep notes'))

    // A blank body drops a note that holds nothing else. This one was told things.
    const captured = () =>
      readSavedDocument()
        .applications.find((application) => application.company === 'Halcyon Maps')!
        .stage_notes.find((note) => note.state === 'interview_2')!
    await waitFor(() => expect(captured().body).toBe(''), { timeout: 4000 })
    expect(captured().heard).toHaveLength(3)
  })

  it('corrects a captured line in place, keeping the moment it was captured', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    const before = readSavedDocument().applications.find(
      (application) => application.company === 'Halcyon Maps',
    )!
    const [first] = before.stage_notes.find((note) => note.state === 'interview_2')!.heard

    await openCapture(user, dialog, 'Halcyon Maps · Interview 2')
    await user.click(within(dialog).getByRole('button', { name: 'Correct the captured lines in Halcyon Maps · Interview 2' }))

    const rows = within(dialog).getByRole('list', { name: 'Captured lines in Halcyon Maps · Interview 2' })
    const box = within(rows).getByLabelText(
      `Captured at ${formatTimeOfDay(first.at)} in Halcyon Maps · Interview 2`,
    )
    expect(box).toHaveValue('Team is 40 engineers across four squads')

    await user.clear(box)
    await user.type(box, 'Team is 42 engineers across four squads{Enter}')
    expect(screen.getByRole('status')).toHaveTextContent('Note updated.')

    const stored = readSavedDocument().applications.find(
      (application) => application.company === 'Halcyon Maps',
    )!
    const line = stored.stage_notes.find((note) => note.state === 'interview_2')!.heard[0]
    expect(line.body).toBe('Team is 42 engineers across four squads')
    // A correction fixes what was written down; it does not claim the line was said later.
    expect(line.id).toBe(first.id)
    expect(line.at).toBe(first.at)

    // Read it back: the log shows the corrected line, under the day it was captured on.
    await user.click(within(dialog).getByRole('button', { name: 'Read the captured lines in Halcyon Maps · Interview 2' }))
    const log = within(dialog).getByRole('log', { name: 'What they said in Halcyon Maps · Interview 2' })
    expect(within(log).getByText('Team is 42 engineers across four squads')).toBeInTheDocument()
  })

  it('removes a captured line, and the note with it when nothing else is left', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    const before = readSavedDocument().applications.find(
      (application) => application.company === 'Halcyon Maps',
    )!
    const heard = before.stage_notes.find((note) => note.state === 'interview_2')!.heard
    expect(heard).toHaveLength(3)

    await openCapture(user, dialog, 'Halcyon Maps · Interview 2')
    await user.click(within(dialog).getByRole('button', { name: 'Correct the captured lines in Halcyon Maps · Interview 2' }))
    await user.click(within(dialog).getByRole('button', {
      name: `Remove the line captured at ${formatTimeOfDay(heard[1].at)} in Halcyon Maps · Interview 2`,
    }))

    expect(screen.getByRole('status')).toHaveTextContent('Note removed.')
    const stored = readSavedDocument().applications.find(
      (application) => application.company === 'Halcyon Maps',
    )!
    const note = stored.stage_notes.find((entry) => entry.state === 'interview_2')!
    expect(note.heard.map((entry) => entry.id)).toEqual([heard[0].id, heard[2].id])
    // What was prepared for the stage is untouched by a line being taken out of it.
    expect(note.body).toContain('Cutting cycle time')
  })

  it('keeps a capture made while an earlier write is still in flight', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    // Hold the first write open, so the capture below is made while the autosave's write
    // is still unfinished — which is what happens whenever someone is told something while
    // the note being read is also being written. Both writes store the whole document, so
    // one built from the document the other started from would silently undo it.
    const store = globalThis.fetch as typeof fetch
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let holding = true
    let inFlight = false
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (holding && init?.method === 'PUT') {
        holding = false
        inFlight = true
        await held
      }
      return store(input, init)
    }))

    await openCapture(user, dialog, 'Halcyon Maps · Interview 2')
    await user.click(within(dialog).getByRole('button', { name: 'Edit Halcyon Maps · Interview 2' }))
    await user.type(within(dialog).getByLabelText('Halcyon Maps · Interview 2 prep notes'), ' Ask about on-call.')
    await waitFor(() => expect(inFlight).toBe(true), { timeout: 3000 })

    await user.type(
      within(dialog).getByLabelText('Capture a line in Halcyon Maps · Interview 2'),
      'Decision comes back Friday{Enter}',
    )
    release()

    // Neither write may be the one that survives: the note keeps what was typed into it,
    // and the line keeps what was said.
    await waitFor(() => {
      const stored = readSavedDocument().applications.find(
        (application) => application.company === 'Halcyon Maps',
      )!
      const note = stored.stage_notes.find((entry) => entry.state === 'interview_2')!
      expect(note.heard.at(-1)?.body).toBe('Decision comes back Friday')
      expect(note.body).toContain('Ask about on-call.')
    }, { timeout: 3000 })
  })

  it('reaches the capture line of whichever pane is focused from the keyboard', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    await user.keyboard('{Control>}k{/Control}')
    expect(within(dialog).getByLabelText('Capture a line in Halcyon Maps · Interview 2')).toHaveFocus()

    // Split, then read the second pane: capture follows the pane being read rather than
    // the one that was open first. Both panes now show the same "Company · Role" heading
    // once the state is dropped from it, so scope to the pane holding Interview 1.
    await splitPane(user, dialog)
    const interview1Pane = within(dialog)
      .getAllByRole('tabpanel')
      .find((pane) => pane.id.endsWith('--interview_1'))!
    await user.click(within(interview1Pane).getByRole('heading', { name: 'Halcyon Maps · Engineering Manager' }))
    await user.keyboard('{Control>}k{/Control}')
    expect(within(dialog).getByLabelText('Capture a line in Halcyon Maps · Interview 1')).toHaveFocus()
  })

  it('names its shortcuts on the controls that share them and in a list of their own', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    // A control that duplicates a shortcut says so where it is, to a pointer and to a
    // screen reader both — jsdom reports no platform, so the labels read as Ctrl.
    const find = within(dialog).getByRole('button', { name: 'Find' })
    expect(find).toHaveAttribute('aria-keyshortcuts', 'Meta+F Control+F')
    expect(find).toHaveAttribute('title', 'Open the find bar (Ctrl+F)')
    // The rest of this bar is icons that name themselves on hover, but Open keeps its word
    // and its key on its face: it is the way to a note that is not on screen yet, which is
    // when a reader can least guess at an icon, and the only visible place Ctrl+P is written.
    const picker = within(dialog).getByRole('button', { name: 'Open' })
    expect(picker).toHaveAttribute('aria-keyshortcuts', 'Meta+P Control+P')
    expect(picker).toHaveAttribute('title', 'Open a note or a stage (Ctrl+P)')
    expect(picker).toHaveTextContent('Ctrl+P')
    expect(within(dialog).getByRole('button', { name: 'Sidebar' })).toHaveAttribute(
      'title',
      'Hide the sidebar (Ctrl+B)',
    )
    expect(within(dialog).getByRole('button', { name: 'Split' })).toHaveAttribute(
      'title',
      'Open another pane (Ctrl+\\, then an arrow)',
    )
    // Ctrl+K has no button in the title bar, so the box it lands in carries it instead.
    await openCapture(user, dialog, 'Halcyon Maps · Interview 2')
    expect(within(dialog).getByLabelText('Capture a line in Halcyon Maps · Interview 2')).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+K Control+K',
    )

    // All of them are listed together, reachable from the keyboard rather than on hover.
    const trigger = within(dialog).getByRole('button', { name: 'Keyboard shortcuts' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    const list = screen.getByRole('group', { name: 'Keyboard shortcuts' })
    expect(
      within(list).getAllByText(/^Ctrl\+/).map((key) => key.textContent),
    ).toEqual([
      'Ctrl+\\',
      'Ctrl+F',
      'Ctrl+P',
      'Ctrl+B',
      'Ctrl+K',
      // Closing carries Alt because a bare Ctrl/Cmd+W belongs to the browser.
      'Ctrl+Shift+X',
      // The two that arrange the panes carry a second modifier, and each covers the pair
      // of arrows as one row rather than two that would have to be worded twice.
      'Ctrl+Shift+←/→',
      'Ctrl+Shift+,/.',
    ])
    expect(within(list).getByText('Put the caret in the capture box')).toBeInTheDocument()
    expect(
      within(list).getByText('Move the tab you are reading to the pane beside it'),
    ).toBeInTheDocument()

    // Escape closes the list before it closes the panel, the debt every overlay in here
    // owes the dialog's own Escape handler, and focus goes back to what opened it.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Stage prep notes' })).toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('opens a tab per stage with the current one first, and can clear a stage', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))

    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    const tabs = within(dialog).getAllByRole('tab').map(tabText)
    expect(tabs).toEqual([
      'Interview 2',
      'Interview 1',
      'Offer',
    ])

    // The current stage is the tab on show, and its saved notes render rather than
    // opening in a textarea.
    const notes = within(dialog).getByRole('tabpanel')
    expect(within(dialog).getByRole('tab', { selected: true })).toHaveTextContent('Interview 2')
    expect(within(notes).queryByLabelText('Halcyon Maps · Interview 2 prep notes')).not.toBeInTheDocument()
    expect(within(notes).getByText('Cutting cycle time')).toBeInTheDocument()

    // Another stage's note is one tab away, and clearing it drops the note on its own.
    await user.click(within(dialog).getByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Interview 1' }))
    await user.click(within(dialog).getByRole('button', { name: 'Edit Halcyon Maps · Interview 1' }))
    await user.clear(within(dialog).getByLabelText('Halcyon Maps · Interview 1 prep notes'))

    const savedStates = () =>
      readSavedDocument()
        .applications.find((application) => application.company === 'Halcyon Maps')!
        .stage_notes.map((note) => note.state)
    await waitFor(() => expect(savedStates()).toEqual(['interview_2', 'offer']), { timeout: 4000 })

    // The stage keeps its tab and its pane: the note went, but the caret that emptied it
    // is still in the box, and a stage typed into must not vanish from under it.
    expect(within(dialog).getByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Interview 1' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Halcyon Maps · Interview 1 prep notes')).toBeInTheDocument()
  })

  it('finds text across every stage and follows the matches from tab to tab', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

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

  it('finds text in a stage being written, and selects the match in the box', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByRole('button', { name: 'Edit Halcyon Maps · Interview 2' }))
    const box = within(dialog).getByLabelText('Halcyon Maps · Interview 2 prep notes') as HTMLTextAreaElement
    expect(box.dataset.noteSource).toMatch(/::interview_2$/)

    // The note is source now, not an outline, but it is still searched.
    await user.keyboard('{Control>}f{/Control}')
    await user.type(within(dialog).getByLabelText('Find in notes'), 'leads')
    expect(within(dialog).getByText('1 of 1')).toBeInTheDocument()

    // Typing must not take the caret out of the find box and into the note.
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Find in notes'))

    // Stepping marks the match on the layer behind the box, and leaves the caret in the
    // find bar so Enter keeps stepping.
    const find = within(dialog).getByLabelText('Find in notes')
    await user.click(within(dialog).getByRole('button', { name: 'Next match' }))
    expect(within(dialog).getByText('leads', { selector: 'mark' })).toBeInTheDocument()
    // Selected all the same, so clicking into the box lands on the hit. Set a frame later
    // than the mark, because the step may have just moved this stage into a pane.
    await waitFor(() => expect(box.value.slice(box.selectionStart, box.selectionEnd)).toBe('leads'))
    // And the caret never left the find bar, so Enter goes on stepping.
    expect(document.activeElement).toBe(find)
  })

  it('reads a stage\'s messages in the dock, under the day they were sent', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    const toggle = within(dialog).getByRole('button', {
      name: 'Show the correspondence in Halcyon Maps · Interview 2',
    })
    // Collapsed by default, but the count says there is something behind it.
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('1')
    expect(within(dialog).queryByText(/short notice/)).not.toBeInTheDocument()

    await user.click(toggle)

    expect(within(dialog).getByText(/short notice/)).toBeInTheDocument()
    // Which way it went and how it arrived head the message; the day heads the group.
    expect(within(dialog).getByText('Received')).toBeInTheDocument()
    expect(within(dialog).getByText(/LinkedIn/)).toBeInTheDocument()
    expect(
      within(dialog).getByRole('heading', { name: formatShortDate('2026-08-12T08:00') }),
    ).toBeInTheDocument()
  })

  it('shows a stage only the messages filed against it', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByRole('tab', { name: /Interview 1/ }))
    const toggle = within(dialog).getByRole('button', {
      name: 'Show the correspondence in Halcyon Maps · Interview 1',
    })

    // Filing is the reader's decision, so the panel honours it rather than showing the lot.
    expect(toggle).not.toHaveTextContent('1')
    await user.click(toggle)
    expect(within(dialog).queryByText(/short notice/)).not.toBeInTheDocument()
  })

  it('numbers a note, its messages and its captures as one list down the pane', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    // A capture holding the word the note and the seeded message already share.
    await openCapture(user, dialog, 'Halcyon Maps · Interview 2')
    await user.type(
      within(dialog).getByLabelText('Capture a line in Halcyon Maps · Interview 2'),
      'Leadership rounds run long',
    )
    await user.keyboard('{Enter}')

    await user.keyboard('{Control>}f{/Control}')
    await user.type(within(dialog).getByLabelText('Find in notes'), 'leadership')

    // Written note, then messages, then captures — the order they read in down the pane.
    expect(within(dialog).getByText('1 of 3')).toBeInTheDocument()

    // The second is in the correspondence section, which is still collapsed: stepping onto
    // a match opens the section holding it, or the count would move and nothing would.
    expect(
      within(dialog).getByRole('button', {
        name: 'Show the correspondence in Halcyon Maps · Interview 2',
      }),
    ).toHaveAttribute('aria-expanded', 'false')

    await user.click(within(dialog).getByRole('button', { name: 'Next match' }))
    expect(within(dialog).getByText('2 of 3')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', {
        name: 'Hide the correspondence in Halcyon Maps · Interview 2',
      }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getByText(/short notice/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Next match' }))
    expect(within(dialog).getByText('3 of 3')).toBeInTheDocument()
    expect(
      within(dialog).getAllByText('Leadership').some((node) => node.tagName === 'MARK'),
    ).toBe(true)
  })

  it('numbers a written note and its captured lines as one list while it is being edited', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    // A capture holding the same word as the note being written.
    await openCapture(user, dialog, 'Halcyon Maps · Interview 2')
    await user.type(within(dialog).getByLabelText('Capture a line in Halcyon Maps · Interview 2'), 'More on leads')
    await user.keyboard('{Enter}')
    await user.click(within(dialog).getByRole('button', { name: 'Edit Halcyon Maps · Interview 2' }))

    await user.keyboard('{Control>}f{/Control}')
    await user.type(within(dialog).getByLabelText('Find in notes'), 'leads')

    // One in the source, one in the log: counted together, with the source first.
    expect(within(dialog).getByText('1 of 2')).toBeInTheDocument()

    // Second is the captured line, which does carry a highlight of its own.
    await user.click(within(dialog).getByRole('button', { name: 'Next match' }))
    expect(within(dialog).getByText('2 of 2')).toBeInTheDocument()
    expect(within(dialog).getAllByText('leads').some((node) => node.tagName === 'MARK')).toBe(true)

    // Wrapping back reaches the source match, marked on the layer behind the box.
    const box = within(dialog).getByLabelText('Halcyon Maps · Interview 2 prep notes') as HTMLTextAreaElement
    await user.click(within(dialog).getByRole('button', { name: 'Next match' }))
    expect(within(dialog).getByText('1 of 2')).toBeInTheDocument()
    await waitFor(() =>
      expect(box.value.slice(box.selectionStart, box.selectionEnd)).toBe('leads'),
    )
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Find in notes'))
  })

  it('reveals a match inside a folded section, and refolds it when the find closes', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

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
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

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
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    await user.keyboard('{Control>}f{/Control}')
    await user.type(within(dialog).getByLabelText('Find in notes'), 'they')

    // Escape belongs to the find while it is open, the way it does in an editor.
    await user.keyboard('{Escape}')
    expect(within(dialog).queryByLabelText('Find in notes')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Stage prep notes' })).toBeInTheDocument()

    // And once the find is closed Escape has nothing left to act on: a view is not
    // dismissable, and the tab strip is how a reader leaves it.
    await user.keyboard('{Escape}')
    expect(screen.getByRole('region', { name: 'Stage prep notes' })).toBeInTheDocument()
  })

  it('moves between stage tabs with the arrow keys and renames the breadcrumb trail', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    const active = () => within(dialog).getByRole('tab', { selected: true })
    expect(active()).toHaveTextContent('Interview 2')

    active().focus()
    await user.keyboard('{ArrowRight}')
    expect(active()).toHaveTextContent('Interview 1')

    // The breadcrumbs name the stage on show, so switching tabs re-labels them.
    expect(within(dialog).getByText('Halcyon Maps · Interview 1', { selector: '.panel__crumb' })).toBeInTheDocument()

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
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

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
    await user.click(within(dialog).getByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Interview 1' }))
    expect(
      within(dialog).queryByRole('button', { name: 'Go to Leadership themes' }),
    ).not.toBeInTheDocument()
    expect(within(dialog).getByText('This note has no headings to outline.')).toBeInTheDocument()
  })

  it('takes the caret to a heading picked from the outline while the note is being written', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    // Writing rather than reading: there is no rendered heading to scroll to, only the
    // line the heading was typed on.
    await user.click(within(dialog).getByRole('button', { name: 'Edit Halcyon Maps · Interview 2' }))
    const editor = within(dialog).getByRole('textbox', {
      name: 'Halcyon Maps · Interview 2 prep notes',
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
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    // Read partway down, then reach for the editor: it should open where reading left off.
    await user.click(within(dialog).getByRole('button', { name: 'Go to Questions to ask' }))
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Go to Questions to ask' })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })

    await user.click(within(dialog).getByRole('button', { name: 'Edit Halcyon Maps · Interview 2' }))
    const editor = within(dialog).getByRole('textbox', {
      name: 'Halcyon Maps · Interview 2 prep notes',
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
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await user.click(within(dialog).getByRole('button', { name: 'Edit Halcyon Maps · Interview 2' }))
    const editor = within(dialog).getByRole('textbox', {
      name: 'Halcyon Maps · Interview 2 prep notes',
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

  it('keeps a pane open when its note is emptied from an external editor', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    const target = readSavedDocument().applications.find(
      (application) => application.company === 'Halcyon Maps',
    )!

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    await splitPane(user, dialog)
    expect(within(dialog).getAllByRole('tabpanel')[1]).toHaveAccessibleName('Halcyon Maps · Interview 1')

    // Emptying the note in an external editor commits straight away, with the panel still
    // up. What is open is the panel's own arrangement rather than a reading of which notes
    // exist, so the tab stays where it was: clearing a note is not a reason to rearrange
    // the panes around whoever cleared it.
    await user.click(within(dialog).getByRole('button', { name: 'Open Halcyon Maps · Interview 1 in an editor' }))
    writeTestEditorNote(target.id, 'interview_1', '')

    await waitFor(
      () => {
        expect(
          readSavedDocument()
            .applications.find((application) => application.id === target.id)!
            .stage_notes.map((note) => note.state),
        ).toEqual(['interview_2', 'offer'])
      },
      // The scratch file is re-read once a second, so this cannot land any sooner.
      { timeout: 4000 },
    )

    const panes = within(dialog).getAllByRole('tabpanel')
    expect(panes).toHaveLength(2)
    expect(panes[1]).toHaveAccessibleName('Halcyon Maps · Interview 1')
    expect(within(dialog).getAllByRole('tab')).toHaveLength(3)
  })

  it('splits into two panes, each reading a different stage, and unsplits again', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    expect(within(dialog).getAllByRole('tabpanel')).toHaveLength(1)

    await splitPane(user, dialog)
    const panes = within(dialog).getAllByRole('tabpanel')
    expect(panes).toHaveLength(2)

    // The second pane opens on a different stage, and each names the tab it is showing.
    expect(panes[0]).toHaveAccessibleName('Halcyon Maps · Interview 2')
    expect(panes[1]).toHaveAccessibleName('Halcyon Maps · Interview 1')
    expect(within(panes[0]).getByText('Leadership themes')).toBeInTheDocument()
    expect(within(panes[1]).getByText('incident response', { exact: false })).toBeInTheDocument()

    // Both tabs read as open; the focused one is the pane the sidebar describes.
    expect(within(dialog).getAllByRole('tab', { selected: true })).toHaveLength(2)

    await user.click(within(dialog).getByRole('button', { name: 'Split' }))
    await user.click(within(dialog).getByRole('button', { name: 'Collapse to one pane' }))
    expect(within(dialog).getAllByRole('tabpanel')).toHaveLength(1)
  })

  it('opens a copy in the pane you are reading, whatever another pane holds', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await splitPane(user, dialog)

    const strip = (paneNumber: number) =>
      within(dialog).getByRole('tablist', { name: `Prep note tabs, pane ${paneNumber}` })
    // Panes hold Interview 2 and Interview 1. Reading the first, ask for the note the
    // second is showing: that is a request to have it here, not to be sent over there.
    await user.click(within(strip(1)).getByRole('tab', { name: /Interview 2/ }))
    const tree = within(within(dialog).getByRole('list', { name: 'Prep notes by stage' }))
    await user.click(
      within(tree.getByRole('listitem', { name: 'Stage Interview 1' }))
        .getByRole('button', { name: /^Halcyon Maps/ }),
    )

    expect(within(strip(1)).getByRole('tab', { name: /Interview 1/ })).toBeInTheDocument()
    expect(within(strip(2)).getByRole('tab', { name: /Interview 1/ })).toBeInTheDocument()
  })

  it('does nothing but show it when the pane you are reading already has it', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    const tabs = () => within(dialog).getAllByRole('tab').map(tabText)
    const before = tabs()

    await user.click(within(dialog).getByRole('tab', { name: /Offer/ }))
    const tree = within(within(dialog).getByRole('list', { name: 'Prep notes by stage' }))
    await user.click(
      within(tree.getByRole('listitem', { name: 'Stage Interview 2' }))
        .getByRole('button', { name: /^Halcyon Maps/ }),
    )

    // One strip holds one tab per note, so asking for one it already has just shows it.
    expect(tabs()).toEqual(before)
    expect(within(dialog).getByRole('tab', { selected: true })).toHaveTextContent('Interview 2')
  })

  it('closes one pane of a split without touching the other', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    // Nothing to close while a single pane is the whole panel.
    expect(within(dialog).queryByRole('button', { name: /pane$/ })).not.toBeInTheDocument()

    await splitPane(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Close the Halcyon Maps · Interview 1 pane' }))

    const panes = within(dialog).getAllByRole('tabpanel')
    expect(panes).toHaveLength(1)
    expect(panes[0]).toHaveAccessibleName('Halcyon Maps · Interview 2')
  })

  it('takes the find into a pane and hides the outline on request', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    await splitPane(user, dialog)
    await user.keyboard('{Control>}f{/Control}')
    await user.type(within(dialog).getByLabelText('Find in notes'), 'equity refresh')

    // Offer is in neither pane, so the find puts it in the focused one.
    expect(within(dialog).getByText('1 of 1')).toBeInTheDocument()
    const panes = within(dialog).getAllByRole('tabpanel')
    expect(panes[0]).toHaveAccessibleName('Halcyon Maps · Offer')
    expect(panes[1]).toHaveAccessibleName('Halcyon Maps · Interview 1')

    // The sidebar goes away to give the notes the full width, and comes back. The control
    // is in the title bar and stays there either way, so it never moves when it is pressed
    // — a column kept permanently to hold one button costs more than the button is worth.
    expect(within(dialog).getByText('Outline')).toBeInTheDocument()
    const toggle = within(dialog).getByRole('button', { name: 'Sidebar' })
    expect(toggle.closest('.panel__titlebar')).not.toBeNull()

    await user.click(toggle)
    expect(within(dialog).queryByText('Outline')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Sidebar' })).toBe(toggle)

    await user.click(toggle)
    expect(within(dialog).getByText('Outline')).toBeInTheDocument()
  })

  it('nests the outline under the headings the note nests them under', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByLabelText('Marble & Finch · Applied prep notes'))
    await user.paste('# Panel\n\n## Case study\n\n### The numbers\n\n# Questions')
    await user.click(within(dialog).getByRole('button', { name: 'Read Marble & Finch · Applied' }))

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

  it('resizes what you were told, and remembers the height', async () => {
    const user = userEvent.setup()
    const { unmount } = await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    await user.click(within(panel).getByRole('button', { name: 'Show what they said in Halcyon Maps · Interview 2' }))

    const edge = () => within(panel).getByRole('separator', { name: 'Resize what they said in Halcyon Maps · Interview 2' })
    const height = () => Number(edge().getAttribute('aria-valuenow'))
    const started = height()

    // Up is taller, because the dock grows against the note above it.
    edge().focus()
    await user.keyboard('{ArrowUp}{ArrowUp}')
    const taller = height()
    expect(taller).toBeGreaterThan(started)

    await user.keyboard('{ArrowDown}')
    expect(height()).toBeLessThan(taller)
    const shared = height()

    // One height for the panel, not one per note: the dock is the reader's own workspace,
    // and a height that reset with every tab switch would have to be dragged again.
    await user.click(within(panel).getByRole('tab', { name: /Interview 1/ }))
    await user.click(within(panel).getByRole('button', { name: 'Show what they said in Halcyon Maps · Interview 1' }))
    expect(
      Number(
        within(panel)
          .getByRole('separator', { name: 'Resize what they said in Halcyon Maps · Interview 1' })
          .getAttribute('aria-valuenow'),
      ),
    ).toBe(shared)

    unmount()
    await renderLoadedApp()
    await user.click(screen.getByRole('button', { name: 'Prep notes' }))
    const restored = screen.getByRole('region', { name: 'Stage prep notes' })
    await user.click(within(restored).getByRole('button', { name: /^Show what they said in/ }))
    expect(Number(within(restored).getByRole('separator', { name: /^Resize what they said in/ }).getAttribute('aria-valuenow')))
      .toBe(shared)
  })

  it('holds the dock at a readable height rather than closing it', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    await user.click(within(panel).getByRole('button', { name: 'Show what they said in Halcyon Maps · Interview 2' }))

    const edge = () => within(panel).getByRole('separator', { name: /^Resize what they said/ })
    edge().focus()
    // Well past the floor: the toggle is what puts the log away, so a drag that overshoots
    // must not do it instead.
    await user.keyboard('{ArrowDown>20/}')

    expect(Number(edge().getAttribute('aria-valuenow'))).toBe(Number(edge().getAttribute('aria-valuemin')))
    expect(within(panel).getByRole('button', { name: 'Hide what they said in Halcyon Maps · Interview 2' })).toBeInTheDocument()
  })

  it('opens a picked note into the pane being read, there being one picker now', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    await splitPane(user, panel)

    const strip = (paneNumber: number) =>
      within(panel).getByRole('tablist', { name: `Prep note tabs, pane ${paneNumber}` })
    const choices = () => within(within(panel).getByRole('list', { name: 'Applications' }))

    // Reading the second pane, so that is where a picked note belongs: the picker is one
    // control in the sidebar now rather than one per strip, and the pane being read is
    // what says where a note lands — the same rule every other way of opening one keeps.
    await user.click(within(strip(2)).getAllByRole('tab')[0])
    await user.click(within(panel).getByRole('button', { name: 'Open' }))
    await user.click(choices().getByRole('button', { name: /^Human Factors Researcher/ }))

    expect(within(strip(2)).getByRole('tab', { name: /Echo Robotics/ })).toBeInTheDocument()
    expect(within(strip(1)).queryByRole('tab', { name: /Echo Robotics/ })).not.toBeInTheDocument()
  })

  it('opens any stage from the quick open picker, and closes it with Escape', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByRole('button', { name: 'Open' }))
    const picker = within(dialog).getByRole('textbox', { name: 'Go to stage' })
    const choices = () => within(within(dialog).getByRole('list', { name: 'Applications' }))

    // One row per application, grouped under its company rather than repeating it, and
    // labelled by role rather than by stage — the stage is what its own menu is for.
    // Clicking the row opens its current stage directly, said so on the row when that
    // stage is already open. The application being worked on can reach every stage; the
    // other seeded applications only offer their own current one, since the picker is how
    // a second company's notes get into the panel.
    expect(choices().getByText('Halcyon Maps')).toBeInTheDocument()
    const halcyonRole = choices().getByRole('button', { name: 'Engineering ManagerOpen' })
    expect(halcyonRole).toBeInTheDocument()
    const halcyonOtherStages = () =>
      choices().getByRole('combobox', { name: 'Other stages for Halcyon Maps, Engineering Manager' })
    expect(within(halcyonOtherStages()).getAllByRole('option')).toHaveLength(20) // + placeholder
    expect(
      choices().getByRole('combobox', {
        name: 'Other stages for Echo Robotics, Human Factors Researcher',
      }),
    ).toBeInTheDocument()

    await user.type(picker, 'Echo Robotics')
    expect(choices().getByText('Echo Robotics')).toBeInTheDocument()
    expect(choices().queryByText('Halcyon Maps')).not.toBeInTheDocument()
    await user.clear(picker)

    // Escape leaves the picker without opening anything.
    await user.keyboard('{Escape}')
    expect(within(dialog).queryByRole('textbox', { name: 'Go to stage' })).not.toBeInTheDocument()
    expect(within(dialog).getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('region', { name: 'Stage prep notes' })).toBeInTheDocument()

    // Picking a stage from a row's menu opens it as a tab, ready to type into.
    await user.click(within(dialog).getByRole('button', { name: 'Open' }))
    await user.selectOptions(
      choices().getByRole('combobox', { name: 'Other stages for Halcyon Maps, Engineering Manager' }),
      'Take-home assessment',
    )

    expect(within(dialog).getAllByRole('tab')).toHaveLength(4)
    expect(within(dialog).getByRole('tab', { selected: true })).toHaveTextContent('Take-home assessment')
    expect(
      within(dialog).getByLabelText('Halcyon Maps · Take-home assessment prep notes'),
    ).toBeInTheDocument()
  })

  it('adds a pane every time, in the direction that was asked for', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    const panes = () => within(panel).getAllByRole('tabpanel')

    /*
     * Split used to be a toggle: pressed once it opened a second pane, pressed again it
     * gathered every pane back into one. Two panes is where a reader most wants a third,
     * which is exactly where the control took them to one.
     */
    await splitPane(user, panel, 'Right')
    expect(panes()).toHaveLength(2)
    await splitPane(user, panel, 'Below')
    expect(panes()).toHaveLength(3)

    // Where it goes is asked rather than assumed. Below puts the new pane under the one it
    // came from, so the two sit in a column: same left edge, one after the other.
    const [, second, third] = panes().map((pane) => pane.closest('.panel__split-child') ?? pane)
    expect(second).not.toBe(third)

    // A pane holding one note can still be split: nothing has to move for a pane to open,
    // which is what an empty one is for.
    await user.click(within(panel).getByRole('button', { name: 'Split' }))
    await user.click(within(panel).getByRole('button', { name: 'Collapse to one pane' }))
    for (const tab of within(panel).getAllByRole('tab').slice(1)) {
      await user.click(within(tab.parentElement!).getByRole('button', { name: /^Close the / }))
    }
    expect(within(panel).getAllByRole('tab')).toHaveLength(1)
    await user.click(within(panel).getByRole('button', { name: 'Split' }))
    await user.click(within(panel).getByRole('button', { name: 'Right' }))
    expect(within(panel).getAllByRole('tablist')).toHaveLength(2)
    expect(within(panel).getByText('This pane is empty.')).toBeInTheDocument()

    // And the panel still comes back to one pane, by saying so rather than by pressing
    // the same control that has been adding them.
    await user.click(within(panel).getByRole('button', { name: 'Split' }))
    await user.click(within(panel).getByRole('button', { name: 'Collapse to one pane' }))
    expect(panes()).toHaveLength(1)
  })

  it('leaves the arrows to the note being written in', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    await splitPane(user, panel)
    const tabsIn = (pane: number) =>
      within(within(panel).getAllByRole('tablist')[pane]).queryAllByRole('tab').length
    const before = [tabsIn(0), tabsIn(1)]

    // In a box being typed into, ⌘⇧← selects to the start of the line. That is what the
    // reader means there, and taking it cost them the selection and moved a tab they were
    // not thinking about.
    await user.click(within(panel).getAllByRole('button', { name: /^Edit / })[0])
    const box = within(panel).getAllByRole('textbox')[0]
    await user.click(box)
    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')

    expect([tabsIn(0), tabsIn(1)]).toEqual(before)

    // Out of the box, the same keys move the tab: the panel has the keyboard back.
    await user.click(within(panel).getAllByRole('tab')[0])
    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')
    expect([tabsIn(0), tabsIn(1)]).not.toEqual(before)
  })

  it('opens a pane with the shortcut and an arrow, without reaching for the menu', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })

    /*
     * The pair, not four chords: every arrow with a modifier already means something in
     * this panel — Shift sends the tab being read to an edge, Alt walks it along the strip
     * — so the direction is typed into the menu the shortcut opens. Focus lands in there,
     * which is what makes the arrow reach it.
     */
    await user.keyboard('{Control>}\\{/Control}')
    expect(within(panel).getByRole('button', { name: 'Above' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')

    // A pane, empty and waiting: two strips, one note. The note stays where it was — the
    // reader asked for room, not for this note to be somewhere else.
    expect(within(panel).getAllByRole('tablist')).toHaveLength(2)
    expect(within(panel).getAllByRole('tabpanel')).toHaveLength(1)
    expect(within(panel).getByText('This pane is empty.')).toBeInTheDocument()
    // The menu closes behind it and hands focus back to the control that opened it.
    expect(within(panel).queryByRole('button', { name: 'Above' })).not.toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Split' })).toHaveFocus()

    // Each direction says its own key, the way every other control in this bar does.
    await user.click(within(panel).getByRole('button', { name: 'Split' }))
    expect(within(panel).getByRole('button', { name: 'Left' })).toHaveAttribute(
      'aria-keyshortcuts',
      'ArrowLeft',
    )
  })

  it('puts folding and formatting in the note\'s own first row', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    const header = () => panel.querySelector('.stage-note__header')!

    /*
     * The row that used to print the note's name has the width for these, and they are
     * what the reader reaches for while reading: folding was a button inside the column
     * that scrolled away with it, and formatting was a row of its own over the box.
     */
    const foldAll = within(panel).getByRole('button', { name: /^Collapse all points in/ })
    expect(header().contains(foldAll)).toBe(true)
    expect(foldAll.closest('.stage-note__body')).toBeNull()

    await user.click(foldAll)
    expect(within(panel).getByRole('button', { name: /^Expand all points in/ })).toBeInTheDocument()

    await user.click(within(panel).getAllByRole('button', { name: /^Edit / })[0])
    const bold = within(panel).getByRole('button', { name: /^Bold in / })
    expect(header().contains(bold)).toBe(true)

    // And it still writes into the note it belongs to.
    const box = within(panel).getByRole('textbox', { name: /Halcyon Maps · Interview 2/ })
    await user.click(box)
    await user.click(bold)
    // Nothing selected, so bold writes the placeholder it always does — the point here is
    // that a button drawn a row away still reaches this box's own caret.
    expect((box as HTMLTextAreaElement).value).toContain('**text**')
  })

  it('says on a tab only what tells it from the tabs beside it', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    const strip = () => within(panel).getAllByRole('tab')

    // One application's stages: the company and the role are on every tab and so on none
    // of them, leaving the stages — the part that actually differs — room to be read.
    expect(strip().map(tabText)).toEqual(['Interview 2', 'Interview 1', 'Offer'])

    // The whole name is still what the tab is called, so a screen reader hears it and a
    // query for it finds it.
    expect(
      within(panel).getByRole('tab', { name: /^Halcyon Maps · Engineering Manager · Offer/ }),
    ).toBeInTheDocument()
    expect(strip()[2]).toHaveAttribute('title', 'Halcyon Maps · Engineering Manager · Offer')

    // A second company arrives and the company comes back on every tab, because now it is
    // what separates them. The role stays off: neither company has two roles open here.
    await user.click(within(panel).getByRole('button', { name: 'Open' }))
    await user.click(
      within(within(panel).getByRole('list', { name: 'Applications' }))
        .getByRole('button', { name: /^Human Factors Researcher/ }),
    )

    expect(strip().map(tabText)).toEqual([
      'Halcyon Maps · Interview 2',
      'Halcyon Maps · Interview 1',
      'Halcyon Maps · Offer',
      'Echo Robotics · Interview 1',
    ])

    /*
     * And a pane is not an island. Dragged into a pane of its own, the second company's
     * tab is the only one in that strip — but it is still on screen beside three tabs of
     * another company, and a strip reading "Interview 1" next to one reading "Offer" says
     * nothing about whose. Every tab open in the panel is what a tab is told apart from.
     */
    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')
    const strips = within(panel).getAllByRole('tablist')
    expect(strips).toHaveLength(2)
    expect(within(strips[1]).getAllByRole('tab').map(tabText)).toEqual(['Echo Robotics · Interview 1'])
    expect(within(strips[0]).getAllByRole('tab').map(tabText)).toEqual([
      'Halcyon Maps · Interview 2',
      'Halcyon Maps · Interview 1',
      'Halcyon Maps · Offer',
    ])
  })

  it('does not print the note\'s name under the tab that already carries it', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })

    /*
     * Every pane has its own tab strip and brings the tab it is showing into view, so the
     * words under it were the words above it, a row apart, in every pane and at every
     * width. The heading stays for anyone reading the panel through its structure — it is
     * what a screen reader is given for the note — but it is not printed twice.
     */
    const heading = within(panel).getByRole('heading', {
      level: 3,
      name: 'Halcyon Maps · Engineering Manager',
    })
    expect(heading).toHaveClass('sr-only')
    expect(within(panel).getByRole('tab', { selected: true }))
      .toHaveTextContent('Halcyon Maps · Engineering Manager')
  })

  it('closes the picker from its own button, and by pressing outside it', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    const picker = () => within(dialog).queryByRole('textbox', { name: 'Go to stage' })

    // A visible way out, because Escape is not one to a reader who does not know it is
    // there. The picker is a palette over the panel rather than a dialog, so nothing
    // else on screen says how to dismiss it.
    await user.click(within(dialog).getByRole('button', { name: 'Open' }))
    expect(picker()).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close the picker' }))
    expect(picker()).not.toBeInTheDocument()

    // And pressing anywhere else puts it away, which is what a palette over a page is
    // expected to do and the first thing a reader tries.
    await user.click(within(dialog).getByRole('button', { name: 'Open' }))
    expect(picker()).toBeInTheDocument()
    await user.click(within(dialog).getAllByRole('tab')[0])
    expect(picker()).not.toBeInTheDocument()
  })

  it('folds headings and sub-points in the reading view without changing saved notes', async () => {
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

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

    await user.click(within(dialog).getByRole('button', { name: 'Collapse all points in Halcyon Maps · Interview 2' }))
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
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    const textarea = within(dialog).getByLabelText('Marble & Finch · Applied prep notes')
    await user.type(textarea, 'Rehearse the rebrand story')
    await user.click(within(dialog).getByRole('button', { name: 'Bullet point in Marble & Finch · Applied' }))

    expect(textarea).toHaveValue('- Rehearse the rebrand story')

    await user.click(within(dialog).getByRole('button', { name: 'Read Marble & Finch · Applied' }))
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

    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    // Quick open reaches every stage, not only the ones already on screen.
    await user.keyboard('{Control>}p{/Control}')
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Other stages for Orbit & Oak, Operations Lead' }),
      'Interview 1',
    )

    expect(within(dialog).getByRole('tab', { selected: true })).toHaveTextContent('Interview 1')
    await user.type(
      within(dialog).getByLabelText('Orbit & Oak · Interview 1 prep notes'),
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
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByLabelText('Marble & Finch · Applied prep notes'))
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
    await user.click(within(dialog).getByRole('button', { name: 'Read Marble & Finch · Applied' }))

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
    await user.click(within(dialog).getByRole('button', { name: 'Collapse all points in Marble & Finch · Applied' }))
    for (const text of [...detail, 'Base', 'Timeline']) expect(shows(text), text).toBe(false)
    expect(within(dialog).getByRole('button', { name: 'Compensation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    await user.click(within(dialog).getByRole('button', { name: 'Expand all points in Marble & Finch · Applied' }))
    for (const text of [...detail, 'Base', 'Timeline']) expect(shows(text), text).toBe(true)
  })

  it('folds from the text of a point, not just its chevron', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
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
    await user.click(within(dialog).getByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Offer' }))
    await user.click(notes().getByText('Remote expectations'))
    expect(shows('Remote expectations')).toBe(true)
  })

  it('leaves links and text selection alone inside a foldable point', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    const shows = (text: string) => within(dialog).queryAllByText(text, { exact: false }).length > 0

    await user.click(within(dialog).getByLabelText('Marble & Finch · Applied prep notes'))
    await user.paste('- See the [job ad](https://example.com/ad)\n  - Salary band is listed')
    await user.click(within(dialog).getByRole('button', { name: 'Read Marble & Finch · Applied' }))

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
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByLabelText('Marble & Finch · Applied prep notes'))
    await user.paste('Draft from the app')
    await user.click(within(dialog).getByRole('button', { name: 'Open Marble & Finch · Applied in an editor' }))

    // The current draft is what gets handed over, not the last saved value.
    expect(readTestEditorNote(target.id, 'applied')).toBe('Draft from the app')
    expect(within(dialog).getByRole('status')).toHaveTextContent('test-editor')
    expect(within(dialog).getByText('data/editing/', { exact: false })).toBeInTheDocument()

    // While the editor owns the stage, the in-app textarea steps aside.
    expect(within(dialog).queryByLabelText('Marble & Finch · Applied prep notes')).not.toBeInTheDocument()

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

    await user.click(within(dialog).getByRole('button', { name: 'Stop editing Marble & Finch · Applied externally' }))
    expect(testEditorSessionCount()).toBe(0)
    expect(within(dialog).getByRole('button', { name: 'Edit Marble & Finch · Applied' })).toBeInTheDocument()
  })

  it('ends every editing session when the prep notes dialog closes', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    await user.click(within(dialog).getByRole('button', { name: 'Open Halcyon Maps · Interview 2 in an editor' }))
    // A session outlives the tab that started it, so both are still open at the end.
    await user.click(within(dialog).getByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Offer' }))
    await user.click(within(dialog).getByRole('button', { name: 'Open Halcyon Maps · Offer in an editor' }))
    expect(testEditorSessionCount()).toBe(2)

    await user.click(screen.getByRole('button', { name: 'Kanban' }))
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
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await user.click(within(dialog).getByRole('button', { name: 'Open Marble & Finch · Applied in an editor' }))

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
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await user.click(within(dialog).getByRole('button', { name: 'Open Marble & Finch · Applied in an editor' }))

    const banner = within(dialog).getByRole('status')
    expect(banner).toHaveTextContent('on devbox')
    expect(banner).toHaveTextContent('TRACKER_EDITOR_URL')
  })

  it('honors deletion cancellation before deleting and saving an application', async () => {
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await renderLoadedApp()

    await user.click(
      screen.getByRole('button', {
        name: /^Open Saffron Systems, Product Operations Manager/,
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
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
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
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
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
    // Reads the whole corpus rather than a member of it, so it takes the demo entire.
    seedFullDemo()
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
    // Reads the shown-of-total count, so it takes the demo entire.
    seedFullDemo()
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(
      screen.getByRole('button', { name: /^Open Paper Kite, Senior UX Researcher/ }),
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
      screen.getByRole('button', { name: /^Open Paper Kite, Senior UX Researcher/ }),
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
      screen.getByRole('button', { name: /^Open Paper Kite, Senior UX Researcher/ }),
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

  it('logs a message against a stage and keeps the time it was sent', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(
      screen.getByRole('button', { name: /^Open Paper Kite, Senior UX Researcher/ }),
    )
    let dialog = screen.getByRole('dialog', { name: 'Edit application' })
    await user.click(within(dialog).getByRole('button', { name: 'Add message' }))

    const message = within(dialog).getByRole('group', { name: 'Message 1' })
    await user.selectOptions(within(message).getByLabelText('Direction'), 'received')
    await user.type(within(message).getByLabelText('Who'), 'Dana Okafor')
    await user.type(within(message).getByLabelText('Channel'), 'Email')
    await user.type(within(message).getByLabelText('Sent'), '2026-08-10T09:30')
    await user.type(within(message).getByLabelText('Message'), 'Could you send me some windows?')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    const logged = () =>
      readSavedDocument().applications.find(({ company }) => company === 'Paper Kite')
        ?.correspondence ?? []

    expect(logged()).toHaveLength(1)
    expect(logged()[0]).toMatchObject({
      state: 'recruiter_messaged',
      direction: 'received',
      who: 'Dana Okafor',
      channel: 'Email',
      body: 'Could you send me some windows?',
    })
    // Sent on the 10th and logged on the 14th: the record keeps both, and `at` is the one
    // the reader typed rather than the clock the save ran against.
    expect(logged()[0]!.at).toBe(new Date('2026-08-10T09:30').toISOString())
    expect(Date.parse(logged()[0]!.at)).toBeLessThan(Date.parse(logged()[0]!.created_at))

    // And it reads back into its boxes.
    await user.click(screen.getByRole('button', { name: /^Open Paper Kite/ }))
    dialog = screen.getByRole('dialog', { name: 'Edit application' })
    expect(
      within(within(dialog).getByRole('group', { name: 'Message 1' })).getByLabelText('Sent'),
    ).toHaveValue('2026-08-10T09:30')
  })

  it('corrects the time a message was sent and removes one logged by mistake', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(
      screen.getByRole('button', { name: /^Open Paper Kite, Senior UX Researcher/ }),
    )
    let dialog = screen.getByRole('dialog', { name: 'Edit application' })
    await user.click(within(dialog).getByRole('button', { name: 'Add message' }))
    let message = within(dialog).getByRole('group', { name: 'Message 1' })
    await user.type(within(message).getByLabelText('Sent'), '2026-08-10T09:30')
    await user.type(within(message).getByLabelText('Message'), 'Windows please')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    const logged = () =>
      readSavedDocument().applications.find(({ company }) => company === 'Paper Kite')
        ?.correspondence ?? []
    const [first] = logged()

    await user.click(screen.getByRole('button', { name: /^Open Paper Kite/ }))
    dialog = screen.getByRole('dialog', { name: 'Edit application' })
    message = within(dialog).getByRole('group', { name: 'Message 1' })
    const sent = within(message).getByLabelText('Sent')
    await user.clear(sent)
    await user.type(sent, '2026-08-11T14:00')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    // Unlike a captured line, a send time moves: it is a fact about the world, not a record
    // of a keystroke. The id and the moment it was written down do not move with it.
    expect(logged()[0]!.at).toBe(new Date('2026-08-11T14:00').toISOString())
    expect(logged()[0]!.id).toBe(first!.id)
    expect(logged()[0]!.created_at).toBe(first!.created_at)

    await user.click(screen.getByRole('button', { name: /^Open Paper Kite/ }))
    dialog = screen.getByRole('dialog', { name: 'Edit application' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove message 1' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(logged()).toEqual([])
  })

  it('refuses to save a message with no text or no time', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(
      screen.getByRole('button', { name: /^Open Paper Kite, Senior UX Researcher/ }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Edit application' })
    await user.click(within(dialog).getByRole('button', { name: 'Add message' }))
    const message = within(dialog).getByRole('group', { name: 'Message 1' })

    await user.type(within(message).getByLabelText('Sent'), '2026-08-10T09:30')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Message 1 needs its text.')

    await user.clear(within(message).getByLabelText('Sent'))
    await user.type(within(message).getByLabelText('Message'), 'Windows please')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Message 1 needs the date and time it was sent.',
    )

    expect(
      readSavedDocument().applications.find(({ company }) => company === 'Paper Kite')
        ?.correspondence,
    ).toEqual([])
  })

  it('writes nothing for a message drafted in a dialog that was cancelled', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(
      screen.getByRole('button', { name: /^Open Paper Kite, Senior UX Researcher/ }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Edit application' })
    await user.click(within(dialog).getByRole('button', { name: 'Add message' }))
    const message = within(dialog).getByRole('group', { name: 'Message 1' })
    await user.type(within(message).getByLabelText('Sent'), '2026-08-10T09:30')
    await user.type(within(message).getByLabelText('Message'), 'Never saved')
    // Draft only, like every other control in this form: nothing is written until Save.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(
      readSavedDocument().applications.find(({ company }) => company === 'Paper Kite')
        ?.correspondence,
    ).toEqual([])
  })

  it('finds an application by a word only a message holds', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    // Halcyon Maps carries a seeded message, and nothing else in the fixture mentions this.
    await user.type(
      screen.getByRole('searchbox', { name: 'Search applications' }),
      'short notice',
    )

    expect(await screen.findByRole('button', { name: /^Open Halcyon Maps/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Open Paper Kite/ })).not.toBeInTheDocument()
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
    await user.selectOptions(within(dialog).getByLabelText('Currency'), 'AUD')
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

  it('nudges an amount with the arrow keys and saves the stepped figure', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: /Open Halcyon Maps/ }))
    const dialog = screen.getByRole('dialog', { name: 'Edit application' })
    const offered = within(dialog).getByLabelText('Offered from')

    await user.click(offered)
    await user.keyboard('{ArrowUp}')
    expect(offered).toHaveValue('220,000')

    // Shift is the coarse step, and a stepped amount reads back as money.
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(offered).toHaveValue('210,000')

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(
      readSavedDocument().applications.find(({ company }) => company === 'Halcyon Maps')
        ?.compensation.offered,
    ).toEqual({ min: 210_000, max: 210_000 })
  })

  it('keeps a stored currency selectable even when it is not a suggestion', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    // A picker that dropped an unrecognised code would rewrite the amounts' unit on save.
    await user.click(screen.getByRole('button', { name: /Open Marble & Finch/ }))
    let dialog = screen.getByRole('dialog', { name: 'Edit application' })
    const currency = within(dialog).getByLabelText('Currency')
    await user.selectOptions(currency, 'USD')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await user.click(screen.getByRole('button', { name: /Open Marble & Finch/ }))
    dialog = screen.getByRole('dialog', { name: 'Edit application' })
    expect(within(dialog).getByLabelText('Currency')).toHaveValue('USD')

    // Clearing every amount drops the currency, so the picker returns to Not set.
    const from = within(dialog).getByLabelText('Advertised from')
    await user.clear(from)
    await user.clear(within(dialog).getByLabelText('Advertised to'))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(
      readSavedDocument().applications.find(({ company }) => company === 'Marble & Finch')
        ?.compensation.currency,
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
        name: /^Open Saffron Systems, Product Operations Manager/,
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
        name: /^Open Saffron Systems, Product Operations Manager/,
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

  /**
   * Drags a tab with a pointer, the way the panel's own drag works.
   *
   * The one thing supplied rather than driven is what the pointer is over: the drag asks
   * `document.elementsFromPoint`, and jsdom has no layout to answer with. Everything else is
   * the real path — the movement threshold that tells a drag from a click, the pointer
   * capture, and the commit read at the release. The hit testing is covered for real in
   * `panelLayout.browser.test.tsx`, which is the half of this jsdom cannot do at all.
   */
  function pointerDrag(source: Element, over: Element) {
    const found = document.elementsFromPoint
    document.elementsFromPoint = () => [over as Element]
    try {
      const pointer = { pointerId: 1, pointerType: 'mouse', button: 0 }
      fireEvent.pointerDown(source, { ...pointer, clientX: 0, clientY: 0 })
      // Past MOUSE_THRESHOLD_PX, which is what makes this a drag rather than a click.
      fireEvent.pointerMove(window, { ...pointer, clientX: 40, clientY: 0 })
      fireEvent.pointerUp(window, { ...pointer, clientX: 40, clientY: 0 })
    } finally {
      document.elementsFromPoint = found
    }
  }

  const slotOf = (tab: HTMLElement) => tab.closest('.panel__tab-slot')!

  /** The same, but landing on one of the pane edges that a drag raises. */
  function pointerDragToEdge(source: Element, edge: 'left' | 'right' | 'top' | 'bottom') {
    const found = document.elementsFromPoint
    // Resolved on each ask rather than captured once: the zones are not in the document
    // until the drag has taken hold, which happens partway through this gesture.
    document.elementsFromPoint = () =>
      [document.querySelector(`[data-drop-edge="${edge}"]`)].filter(Boolean) as Element[]
    try {
      const pointer = { pointerId: 1, pointerType: 'mouse', button: 0 }
      fireEvent.pointerDown(source, { ...pointer, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(window, { ...pointer, clientX: 40, clientY: 0 })
      fireEvent.pointerMove(window, { ...pointer, clientX: 80, clientY: 0 })
      fireEvent.pointerUp(window, { ...pointer, clientX: 80, clientY: 0 })
    } finally {
      document.elementsFromPoint = found
    }
  }

  const tabNames = (dialog: HTMLElement) =>
    within(dialog).getAllByRole('tab').map(tabText)

  it('drags a note out of the tree onto a pane that is not the focused one', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    await splitPane(user, panel)

    const strip = (paneNumber: number) =>
      within(panel).getByRole('tablist', { name: `Prep note tabs, pane ${paneNumber}` })
    const row = within(panel).getByRole('button', { name: /^Echo Robotics/ })
    expect(within(strip(2)).queryByRole('tab', { name: /Echo Robotics/ })).not.toBeInTheDocument()

    // Dropped among the second pane's tabs, not opened into whichever pane was focused:
    // a drag says where it lands, which is the whole of why it is a drag.
    pointerDrag(row, slotOf(within(strip(2)).getAllByRole('tab')[0]))

    expect(within(strip(2)).getByRole('tab', { name: /Echo Robotics/ })).toBeInTheDocument()
    expect(within(strip(1)).queryByRole('tab', { name: /Echo Robotics/ })).not.toBeInTheDocument()
  })

  it('splits a pane open by dragging a note from the tree onto its edge', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(within(panel).getAllByRole('tabpanel')).toHaveLength(1)

    pointerDragToEdge(within(panel).getByRole('button', { name: /^Echo Robotics/ }), 'right')

    const panes = within(panel).getAllByRole('tabpanel')
    expect(panes).toHaveLength(2)
    expect(panes[1]).toHaveAccessibleName(expect.stringContaining('Echo Robotics'))
  })

  it('does not open a note into the focused pane when the drag landed elsewhere', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const panel = screen.getByRole('region', { name: 'Stage prep notes' })
    await splitPane(user, panel)

    const strip = (paneNumber: number) =>
      within(panel).getByRole('tablist', { name: `Prep note tabs, pane ${paneNumber}` })
    pointerDrag(
      within(panel).getByRole('button', { name: /^Echo Robotics/ }),
      slotOf(within(strip(2)).getAllByRole('tab')[0]),
    )

    // The click a browser sends after a pointer sequence must not also open it where a
    // plain click would have — dropping a note somewhere is not also asking to read it here.
    expect(within(panel).getAllByRole('tab', { name: /Echo Robotics/ })).toHaveLength(1)
  })

  it('scrolls a strip to the tab it just opened, however far along it is', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    // jsdom lays nothing out, so whether a tab is off the end of its strip is a question
    // it cannot answer. What it can answer is whether the panel asked for the tab it just
    // opened to be brought into view — the browser suite measures the rest.
    const scrolled: HTMLElement[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function scrollIntoViewStub(this: HTMLElement) {
      scrolled.push(this)
    }

    try {
      await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
      const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

      scrolled.length = 0
      await user.click(
        within(within(dialog).getByRole('list', { name: 'Prep notes by stage' }))
          .getByRole('button', { name: /^Echo Robotics/ }),
      )

      const opened = within(dialog).getByRole('tab', { name: /Echo Robotics/ })
      expect(scrolled).toContain(opened)
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('opens a second copy of a note by dragging it into another pane', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await splitPane(user, dialog)

    const strip = (paneNumber: number) =>
      within(dialog).getByRole('tablist', { name: `Prep note tabs, pane ${paneNumber}` })
    const row = within(within(dialog).getByRole('list', { name: 'Prep notes by stage' }))
      .getByRole('listitem', { name: 'Stage Interview 2' })
    pointerDrag(
      within(row).getByRole('button', { name: /^Halcyon Maps/ }),
      slotOf(within(strip(2)).getAllByRole('tab')[0]),
    )

    // One note, read in two panes — the point of a split when the note is long.
    expect(within(strip(1)).getByRole('tab', { name: /Interview 2/ })).toBeInTheDocument()
    expect(within(strip(2)).getByRole('tab', { name: /Interview 2/ })).toBeInTheDocument()

    // Each copy is its own tab and its own pane, with ids to match: two elements claiming
    // one id is the failure this pairing exists to prevent.
    const ids = within(dialog).getAllByRole('tabpanel').map((pane) => pane.id)
    expect(new Set(ids).size).toBe(ids.length)
    const tabIds = within(dialog).getAllByRole('tab').map((tab) => tab.id)
    expect(new Set(tabIds).size).toBe(tabIds.length)
  })

  it('writes into both copies of a note at once, being one note', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Marble & Finch' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await user.type(
      within(dialog).getByLabelText('Marble & Finch · Applied prep notes'),
      'Ask about the rebrand',
    )

    // The tree reads the stored notes, so it lists this one once the autosave has landed.
    const row = await waitFor(
      () =>
        within(within(dialog).getByRole('list', { name: 'Prep notes by stage' }))
          .getByRole('button', { name: /^Marble & Finch/ }),
      { timeout: 4000 },
    )
    pointerDragToEdge(row, 'right')

    // The text is the note's, not the tab's, so both copies show what was typed into one.
    const panes = within(dialog).getAllByRole('tabpanel')
    expect(panes).toHaveLength(2)
    for (const pane of panes) expect(pane).toHaveTextContent('Ask about the rebrand')
  })

  it('counts the matches in every copy, each being somewhere to be sent', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await user.keyboard('{Control>}f{/Control}')
    await user.type(within(dialog).getByLabelText('Find in notes'), 'the')
    const before = within(dialog).getByText(/of \d+/).textContent

    const row = within(within(dialog).getByRole('list', { name: 'Prep notes by stage' }))
      .getByRole('listitem', { name: 'Stage Interview 2' })
    pointerDragToEdge(within(row).getByRole('button', { name: /^Halcyon Maps/ }), 'right')

    // A copy is a place on screen the find can send you, so its matches are its own.
    const after = within(dialog).getByText(/of \d+/).textContent
    expect(after).not.toBe(before)
  })

  it('reorders a tab within its pane by dragging it', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(tabNames(dialog)).toEqual([
      'Interview 2',
      'Interview 1',
      'Offer',
    ])

    const offer = within(dialog).getByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Offer' })
    pointerDrag(offer, slotOf(within(dialog).getAllByRole('tab')[0]))

    expect(tabNames(dialog)).toEqual([
      'Offer',
      'Interview 2',
      'Interview 1',
    ])
    // Moving a tab is an arrangement, not an edit: the notes are untouched.
    expect(
      readSavedDocument()
        .applications.find((application) => application.company === 'Halcyon Maps')!
        .stage_notes.map((note) => note.state),
    ).toEqual(['interview_1', 'interview_2', 'offer'])
  })

  it('moves a tab into the other pane by dragging it onto that pane’s strip', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await splitPane(user, dialog)

    const strips = within(dialog).getAllByRole('tablist')
    expect(strips).toHaveLength(2)
    expect(within(strips[0]).getAllByRole('tab')).toHaveLength(2)
    expect(within(strips[1]).getAllByRole('tab')).toHaveLength(1)

    const offer = within(strips[0]).getByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Offer' })
    // Onto the bare end of the other pane's strip, which is its last drop place.
    pointerDrag(offer, strips[1])

    const after = within(dialog).getAllByRole('tablist')
    expect(within(after[0]).getAllByRole('tab')).toHaveLength(1)
    expect(within(after[1]).getAllByRole('tab').map(tabText)).toEqual([
      'Interview 1',
      'Offer',
    ])
  })

  it('moves a tab between panes with the keyboard, so a drag is not the only way', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await splitPane(user, dialog)

    // The first pane is focused and reading Interview 2; send that tab to the pane beside it.
    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')

    const strips = within(dialog).getAllByRole('tablist')
    expect(within(strips[0]).getAllByRole('tab').map(tabText)).toEqual([
      'Offer',
    ])
    expect(within(strips[1]).getAllByRole('tab').map(tabText)).toEqual([
      'Interview 2',
      'Interview 1',
    ])
  })

  it('reorders a tab within its pane with the keyboard', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    await user.keyboard('{Control>}{Shift>}>{/Shift}{/Control}')
    expect(tabNames(dialog)).toEqual([
      'Interview 1',
      'Interview 2',
      'Offer',
    ])

    // Wraps rather than stopping, so the tab can reach either end from either end.
    await user.keyboard('{Control>}{Shift>}<{/Shift}{/Control}')
    expect(tabNames(dialog)).toEqual([
      'Interview 2',
      'Interview 1',
      'Offer',
    ])
  })

  it('collapses the split when the last tab is dragged out of a pane', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await splitPane(user, dialog)
    expect(within(dialog).getAllByRole('tablist')).toHaveLength(2)

    // Splitting leaves the first pane focused, so reach for the second one before moving
    // its tab: the arrow acts on the pane being read, like every other panel binding.
    // Both panes now show the same "Company · Role" heading once the state is dropped
    // from it, so scope to the pane holding Interview 1.
    const interview1Pane = within(dialog)
      .getAllByRole('tabpanel')
      .find((pane) => pane.id.endsWith('--interview_1'))!
    await user.click(within(interview1Pane).getByRole('heading', { name: 'Halcyon Maps · Engineering Manager' }))

    // That pane holds one tab; moving it out leaves nothing to show there.
    await user.keyboard('{Control>}{Shift>}{ArrowLeft}{/Shift}{/Control}')

    const strips = within(dialog).getAllByRole('tablist')
    expect(strips).toHaveLength(1)
    expect(within(strips[0]).getAllByRole('tab')).toHaveLength(3)
  })

  it('names the ways a tab can be moved, for a reader who cannot drag one', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    const strip = within(dialog).getAllByRole('tablist')[0]
    const hint = document.getElementById(strip.getAttribute('aria-describedby')!)
    expect(hint).toHaveTextContent(/Drag a tab to reorder it or move it to another pane/)
    expect(hint).toHaveTextContent(/to move it between panes/)

    // And the tab itself carries both bindings, so they are not only in the hint.
    const tab = within(strip).getByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Offer' })
    expect(tab.getAttribute('aria-keyshortcuts')).toContain('Shift+ArrowRight')
    expect(tab.getAttribute('aria-keyshortcuts')).toContain('Meta+Shift+.')
  })

  it('resizes a split from the keyboard, since jsdom has no layout to drag against', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await splitPane(user, dialog)

    const handle = within(dialog).getByRole('separator', { name: 'Resize pane 1 and pane 2' })
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuenow', '50')

    const panes = () => within(dialog).getAllByRole('tabpanel')
    const widthOf = (index: number) =>
      (panes()[index].closest('.panel__split-child') as HTMLElement).style.flexBasis

    expect(widthOf(0)).toBe('50%')

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(widthOf(0)).toBe('52%')
    expect(widthOf(1)).toBe('48%')

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(widthOf(0)).toBe('48%')
    expect(widthOf(1)).toBe('52%')
  })

  it('holds a pane at its minimum rather than letting a resize collapse it', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await splitPane(user, dialog)

    const handle = within(dialog).getByRole('separator', { name: 'Resize pane 1 and pane 2' })
    // Far more presses than it takes to cross the split, so the clamp is what stops it.
    for (let press = 0; press < 40; press += 1) fireEvent.keyDown(handle, { key: 'ArrowLeft' })

    const first = within(dialog).getAllByRole('tabpanel')[0].closest('.panel__split-child')
    expect((first as HTMLElement).style.flexBasis).toBe('15%')
    // Still a pane, not a sliver: both notes are on screen.
    expect(within(dialog).getAllByRole('tabpanel')).toHaveLength(2)
  })

  it('keeps a resized pane’s width when a tab moves between panes', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await splitPane(user, dialog)

    const handle = within(dialog).getByRole('separator', { name: 'Resize pane 1 and pane 2' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })

    const widthOf = (index: number) =>
      (within(dialog).getAllByRole('tabpanel')[index].closest('.panel__split-child') as HTMLElement)
        .style.flexBasis
    expect(widthOf(0)).toBe('54%')

    // Moving a tab across rearranges what is in the panes, not how wide they are.
    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')
    expect(widthOf(0)).toBe('54%')
  })

  it('splits a new pane open by dragging a tab onto the edge of one', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(within(dialog).getAllByRole('tablist')).toHaveLength(1)

    const offer = within(dialog).getByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Offer' })
    // The zones only exist while a drag is running, so the drop place is named by where
    // the pointer ends up rather than found before the gesture starts.
    pointerDragToEdge(offer, 'right')

    const strips = within(dialog).getAllByRole('tablist')
    expect(strips).toHaveLength(2)
    expect(within(strips[1]).getAllByRole('tab').map(tabText)).toEqual([
      'Offer',
    ])
    expect(within(dialog).getByRole('separator', { name: 'Resize pane 1 and pane 2' }))
      .toHaveAttribute('aria-orientation', 'vertical')
  })

  it('stacks the new pane when the tab is dropped on a top or bottom edge', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    pointerDragToEdge(within(dialog).getByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Offer' }), 'bottom')

    // A column split, so its divider runs the other way.
    expect(within(dialog).getByRole('separator', { name: 'Resize pane 1 and pane 2' }))
      .toHaveAttribute('aria-orientation', 'horizontal')
    expect(within(dialog).getAllByRole('tabpanel')).toHaveLength(2)
  })

  it('raises no drop zones until a tab is actually being dragged', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    expect(dialog.querySelectorAll('[data-drop-edge]')).toHaveLength(0)

    const offer = within(dialog).getByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Offer' })
    const pointer = { pointerId: 1, pointerType: 'mouse', button: 0 }

    // A press on its own is not a drag: it is how a tab is selected, and raising the zones
    // under every click would put them over the note the reader is trying to read.
    fireEvent.pointerDown(offer, { ...pointer, clientX: 0, clientY: 0 })
    expect(dialog.querySelectorAll('[data-drop-edge]')).toHaveLength(0)

    // Moving past the threshold is what takes hold of the tab.
    fireEvent.pointerMove(window, { ...pointer, clientX: 40, clientY: 0 })
    expect(dialog.querySelectorAll('[data-drop-edge]')).toHaveLength(4)

    // Abandoning the drag puts them away again rather than leaving them over the note.
    fireEvent.pointerCancel(window, pointer)
    expect(dialog.querySelectorAll('[data-drop-edge]')).toHaveLength(0)
  })

  it('leaves a short press as a click, so selecting a tab still selects it', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    // A mouse commits to a drag on distance, so a press that does not travel is a click.
    await user.click(within(dialog).getByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Offer' }))

    expect(within(dialog).getByRole('tab', { selected: true })).toHaveTextContent('Offer')
    expect(within(dialog).getByRole('tabpanel')).toHaveAccessibleName('Halcyon Maps · Offer')
    // And no drag was ever in progress, so nothing was left over the note.
    expect(dialog.querySelectorAll('[data-drop-edge]')).toHaveLength(0)
  })

  it('picks a tab up on a long touch, and leaves a short one to the scroller', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    const offer = within(dialog).getByRole('tab', { name: 'Halcyon Maps · Engineering Manager · Offer' })
    const touch = { pointerId: 2, pointerType: 'touch' }
    const zones = () => dialog.querySelectorAll('[data-drop-edge]')

    // A finger that moves straight away is scrolling the strip, not carrying a tab.
    fireEvent.pointerDown(offer, { ...touch, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { ...touch, clientX: 60, clientY: 0 })
    expect(zones()).toHaveLength(0)
    fireEvent.pointerUp(window, { ...touch, clientX: 60, clientY: 0 })

    /*
     * Held still, it takes hold: the gesture every native list-reorder uses, and the only
     * one a strip that scrolls sideways can also be rearranged by.
     *
     * Waited out for real, though it no longer has to be: the setup file points the global
     * `jest` that Testing Library looks for at `vi`, so a test here can take the whole
     * clock. This one does not, because what that buys is the wait and the wait is not what
     * costs — the hold is a third of a second against a render measured in seconds — and
     * taking the clock would mean re-pinning the system time and handing user-event a clock
     * to wind on for that third of a second back.
     */
    fireEvent.pointerDown(offer, { ...touch, clientX: 0, clientY: 0 })
    expect(zones()).toHaveLength(0)
    await waitFor(() => expect(zones()).toHaveLength(4), { timeout: 4000 })

    fireEvent.pointerCancel(window, touch)
    expect(zones()).toHaveLength(0)
  })

  it('splits from the keyboard when there is no pane in that direction yet', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(within(dialog).getAllByRole('tablist')).toHaveLength(1)

    // Nothing below to move into, so the same binding opens a pane there.
    await user.keyboard('{Control>}{Shift>}{ArrowDown}{/Shift}{/Control}')

    expect(within(dialog).getAllByRole('tablist')).toHaveLength(2)
    expect(within(dialog).getByRole('separator', { name: 'Resize pane 1 and pane 2' }))
      .toHaveAttribute('aria-orientation', 'horizontal')

    // And with a pane there now, the same binding moves into it rather than splitting again.
    await user.keyboard('{Control>}{Shift>}{ArrowDown}{/Shift}{/Control}')
    expect(within(dialog).getAllByRole('tablist')).toHaveLength(2)
  })

  it('splits to any edge of a pane, nesting only where the axis changes', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })

    // Split a pane off to the right, which leaves two.
    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')
    expect(within(dialog).getAllByRole('tablist')).toHaveLength(2)

    // The same binding now moves into the pane that is there rather than splitting again —
    // one intent, put this note over there, whichever case the tree happens to be in.
    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')
    expect(within(dialog).getAllByRole('tablist')).toHaveLength(2)

    // From the far pane there is nothing to the right, so this one splits, and the new
    // pane joins the row it is already in rather than nesting a second split inside it.
    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')

    expect(within(dialog).getAllByRole('tablist')).toHaveLength(3)
    expect(
      within(dialog).getAllByRole('separator')
        .map((handle) => handle.getAttribute('aria-label'))
        .filter((label) => label?.startsWith('Resize pane')),
    ).toEqual(['Resize pane 1 and pane 2', 'Resize pane 2 and pane 3'])
    expect(dialog.querySelectorAll('.panel__split')).toHaveLength(1)
  })

  /**
   * The keyboard tests above drive `onResize` directly; this drives the pointer path that
   * reaches it, which is the half a real mouse uses. jsdom has no layout, so the split's
   * box is stubbed — without a width the handler's own guard returns early and the
   * arithmetic under test never runs.
   */
  it('resizes by dragging the handle, against a stubbed box jsdom cannot measure', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Prep notes for Halcyon Maps, 3 stages' }))
    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    await splitPane(user, dialog)

    const handle = within(dialog).getByRole('separator', { name: 'Resize pane 1 and pane 2' })
    const split = handle.parentElement as HTMLElement
    split.getBoundingClientRect = () => ({ width: 1000, height: 600, top: 0, left: 0, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) })

    const widthOf = (index: number) =>
      (within(dialog).getAllByRole('tabpanel')[index].closest('.panel__split-child') as HTMLElement)
        .style.flexBasis

    expect(widthOf(0)).toBe('50%')

    // A tenth of the split to the right is a tenth of its width, not a tenth of a pane.
    fireEvent.mouseDown(handle, { clientX: 500 })
    fireEvent.mouseMove(window, { clientX: 600 })
    expect(widthOf(0)).toBe('60%')
    expect(widthOf(1)).toBe('40%')

    // Measured from where the pointer last was, so a continued drag tracks it rather than
    // accelerating away — two more steps of 50px move it 5% each, not 15% and 20%.
    fireEvent.mouseMove(window, { clientX: 650 })
    expect(widthOf(0)).toBe('65%')
    fireEvent.mouseMove(window, { clientX: 700 })
    expect(widthOf(0)).toBe('70%')

    // Letting go stops it following the pointer.
    fireEvent.mouseUp(window)
    fireEvent.mouseMove(window, { clientX: 900 })
    expect(widthOf(0)).toBe('70%')
  })

  it('groups existing prep notes from several applications under the stage they share', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Compare' }))

    const group = screen.getByRole('region', { name: 'Interview 1' })
    expect(within(group).getByRole('heading', { level: 4, name: /Halcyon Maps/ })).toBeInTheDocument()
    expect(within(group).getByRole('heading', { level: 4, name: /Echo Robotics/ })).toBeInTheDocument()
    expect(within(group).getByText(/pushed hard on incident response/)).toBeInTheDocument()
  })

  it('edits an existing note inline and writes only that application and stage', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    const before = readSavedDocument().applications.find((application) => application.company === 'Halcyon Maps')!

    await user.click(screen.getByRole('button', { name: 'Compare' }))
    const group = screen.getByRole('region', { name: 'Interview 2' })
    await user.click(within(group).getByRole('button', { name: 'Edit Halcyon Maps · Interview 2' }))
    const editor = within(group).getByLabelText('Halcyon Maps · Interview 2 prep notes')
    await user.type(editor, ' Ask about the platform roadmap.')

    await waitFor(
      () => {
        const after = readSavedDocument().applications.find((application) => application.id === before.id)!
        expect(after.stage_notes.find((note) => note.state === 'interview_2')?.body).toContain(
          'Ask about the platform roadmap.',
        )
        // The card only ever holds one draft, so the other two stages this application
        // already had notes for are untouched — same guarantee the dialog gives, checked
        // here for the comparison view's own, narrower write.
        expect(after.stage_notes).toHaveLength(3)
        expect(after.stage_notes.find((note) => note.state === 'interview_1')?.body).toBe(
          before.stage_notes.find((note) => note.state === 'interview_1')?.body,
        )
        expect(after.stage_notes.find((note) => note.state === 'offer')?.body).toBe(
          before.stage_notes.find((note) => note.state === 'offer')?.body,
        )
      },
      { timeout: 4000 },
    )
  })

  it('shows a gap as a ready editor for one stage, and writing into it does not touch other applications', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    const halcyonBefore = readSavedDocument().applications.find(
      (application) => application.company === 'Halcyon Maps',
    )!
    const echoBefore = readSavedDocument().applications.find(
      (application) => application.company === 'Echo Robotics',
    )!
    expect(echoBefore.stage_notes.map((note) => note.state)).toEqual(['interview_1'])

    await user.click(screen.getByRole('button', { name: 'Compare' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Stage' }), 'Interview 2')

    const group = screen.getByRole('region', { name: 'Interview 2' })
    // Halcyon Maps already has a note for this stage, so it opens read-only.
    expect(within(group).getByRole('heading', { level: 4, name: /Halcyon Maps/ })).toBeInTheDocument()
    // Echo Robotics has none, so its card is the gap: an editor, open by default.
    const gapEditor = within(group).getByLabelText('Echo Robotics · Interview 2 prep notes')
    await user.type(gapEditor, 'Ask about the roadmap for the safety review.')

    await waitFor(
      () => {
        const echoAfter = readSavedDocument().applications.find((application) => application.id === echoBefore.id)!
        expect(echoAfter.stage_notes.find((note) => note.state === 'interview_2')?.body).toBe(
          'Ask about the roadmap for the safety review.',
        )
        expect(echoAfter.stage_notes.find((note) => note.state === 'interview_1')?.body).toBe(
          echoBefore.stage_notes[0]!.body,
        )
      },
      { timeout: 4000 },
    )

    const halcyonAfter = readSavedDocument().applications.find(
      (application) => application.id === halcyonBefore.id,
    )!
    expect(halcyonAfter.stage_notes).toEqual(halcyonBefore.stage_notes)
  })

  it('drops an application from the board when its chip is unchecked, and shows the empty state when none remain', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Compare' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Stage' }), 'Interview 2')
    expect(
      within(screen.getByRole('region', { name: 'Interview 2' })).getByRole('heading', {
        level: 4,
        name: /Halcyon Maps/,
      }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Halcyon Maps' }))
    expect(
      within(screen.getByRole('region', { name: 'Interview 2' })).queryByRole('heading', {
        level: 4,
        name: /Halcyon Maps/,
      }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select none' }))
    expect(screen.getByText('Select at least one application to compare.')).toBeInTheDocument()
  })

  it('opens the full editor from a comparison card', async () => {
    const user = userEvent.setup()
    await renderLoadedApp()

    await user.click(screen.getByRole('button', { name: 'Compare' }))
    const group = screen.getByRole('region', { name: 'Interview 2' })
    await user.click(
      within(group).getByRole('button', { name: 'Open Halcyon Maps · Interview 2 in the full editor' }),
    )

    const dialog = screen.getByRole('region', { name: 'Stage prep notes' })
    expect(
      within(dialog).getByRole('heading', { name: 'Halcyon Maps · Engineering Manager' }),
    ).toBeInTheDocument()
  })
})