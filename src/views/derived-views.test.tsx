import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { COMPENSATION_STAGE_IDS, emptyCompensation } from '../domain'
import type {
  Application,
  Compensation,
  CompensationStageId,
  Rating,
  RatingDimensionId,
  StateEvent,
  StateId,
} from '../domain'
import { CalendarView } from './CalendarView'
import { KanbanView } from './KanbanView'
import { FocusView } from './FocusView'
import { StaleView } from './StaleView'
import { StatisticsView } from './StatisticsView'
import { TableView } from './TableView'
import { formatLongDate, kanbanColumnGroups } from './viewUtils'

const now = new Date(2026, 7, 14, 12)

function localDate(daysFromToday: number): string {
  const date = new Date(now)
  date.setDate(date.getDate() + daysFromToday)
  return date.toISOString()
}

function application(
  company: string,
  overrides: Partial<Application> = {},
): Application {
  const state: StateId = 'applied'
  return {
    id: `00000000-0000-7000-8000-${company.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(12, '0').slice(0, 12)}`,
    company,
    role: 'Software engineer',
    url: null,
    source: null,
    state,
    // Created 40 days ago but moved yesterday, so nothing is silent by default.
    state_history: [{ state, at: localDate(-1) }],
    next_action: null,
    next_action_at: null,
    deadline_at: null,
    notes: null,
    stage_notes: [],
    state_events: [],
    attachments: [],
    ratings: [],
    compensation: emptyCompensation(),
    created_at: localDate(-40),
    updated_at: localDate(-1),
    ...overrides,
  }
}

function stateEvent(overrides: Partial<StateEvent> = {}): StateEvent {
  return {
    id: `00000000-0000-7000-9000-${String(Math.abs(Date.parse(overrides.starts_at ?? localDate(1)))).slice(-12)}`,
    state: 'interview_1',
    summary: 'Interview 1 — panel',
    starts_at: localDate(1),
    ends_at: null,
    location: null,
    url: null,
    ics_uid: null,
    sequence: 0,
    cancelled: false,
    created_at: localDate(-2),
    updated_at: localDate(-2),
    ...overrides,
  }
}

function ratings(scores: Partial<Record<RatingDimensionId, number | null>>): Rating[] {
  return (Object.keys(scores) as RatingDimensionId[]).map((dimension) => ({
    dimension,
    score: scores[dimension] ?? null,
    created_at: localDate(-2),
    updated_at: localDate(-2),
  }))
}

/** Amounts in whole units; a single number is a point value, a pair is a band. */
function compensation(
  currency: string,
  stages: Partial<Record<CompensationStageId, number | readonly [number, number]>>,
): Compensation {
  const record = emptyCompensation()
  for (const stage of COMPENSATION_STAGE_IDS) {
    const amount = stages[stage]
    if (amount === undefined) continue
    record[stage] =
      typeof amount === 'number' ? { min: amount, max: amount } : { min: amount[0], max: amount[1] }
  }
  record.currency = currency
  return record
}

afterEach(() => {
  vi.useRealTimers()
})

describe('FocusView', () => {
  function groupElement(heading: string): HTMLElement {
    return screen.getByRole('heading', { name: heading }).closest('details')!
  }

  function rowsIn(heading: string): string[] {
    const list = groupElement(heading).querySelector('ol, ul')
    // Only the row's own button; each row also carries a prep-notes button.
    return list ? [...list.querySelectorAll('.action-card')].map((row) => row.textContent ?? '') : []
  }

  it('groups live applications by the pressure that ranks them', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const onOpen = vi.fn()
    const applications = [
      application('Later & Co', { next_action: 'Prepare questions', next_action_at: localDate(4) }),
      application('Oldest Follow-up', { next_action: 'Email recruiter', next_action_at: localDate(-5) }),
      application('Today Labs', { next_action: 'Join interview', next_action_at: localDate(0) }),
      application('No Date Studio', { next_action: 'Review portfolio' }),
      application('Gone Quiet', {
        state_history: [{ state: 'applied', at: localDate(-25) }],
      }),
      application('Nothing Planned Inc'),
    ]

    render(
      <FocusView applications={applications} onOpen={onOpen} onOpenStageNotes={vi.fn()} />,
    )

    // Date-driven groups read chronologically, not by score.
    expect(rowsIn('Overdue or due today')).toEqual([
      expect.stringContaining('Oldest Follow-up'),
      expect.stringContaining('Today Labs'),
    ])
    expect(rowsIn('Due in 1 to 7 days')).toEqual([expect.stringContaining('Later & Co')])
    expect(rowsIn('Action with no date')).toEqual([expect.stringContaining('No Date Studio')])
    expect(rowsIn('No stage change in more than 7 days')).toEqual([
      expect.stringContaining('Gone Quiet'),
    ])
    expect(rowsIn('Nothing dated or planned')).toEqual([
      expect.stringContaining('Nothing Planned Inc'),
    ])

    expect(screen.getByText('Action overdue 5 days')).toBeInTheDocument()
    expect(screen.getByText('No stage change for 25 days')).toBeInTheDocument()

    // A schedule is an ordered list; an alphabetical group is not.
    expect(groupElement('Overdue or due today').querySelector('ol')).not.toBeNull()
    expect(groupElement('Action with no date').querySelector('ul')).not.toBeNull()

    fireEvent.click(
      within(groupElement('Action with no date')).getByRole('button', {
        name: /Open No Date Studio/,
      }),
    )
    expect(onOpen).toHaveBeenCalledWith(applications[3].id)
  })

  it('surfaces an invite as the reason and shows it on the row', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const applications = [
      application('Panel Co', {
        state_events: [
          stateEvent({ summary: 'Research panel', starts_at: localDate(2), location: 'Docklands' }),
        ],
      }),
    ]

    render(
      <FocusView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} />,
    )

    // Without invites this row read as "Nothing dated or planned".
    expect(rowsIn('Due in 1 to 7 days')).toEqual([expect.stringContaining('Panel Co')])
    expect(screen.getByText('Invite in 2 days')).toBeInTheDocument()
    expect(screen.getByText(/Research panel/)).toBeInTheDocument()
  })

  it('is unchanged by ratings, which belong to a different axis', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const base = { deadline_at: localDate(0), next_action: 'Prepare', next_action_at: localDate(0) }
    const unrated = application('Same Co', base)
    const loathed = application('Same Co', {
      ...base,
      ratings: ratings({ work: 1, growth: 1, people: 1, company: 1 }),
    })

    const { unmount } = render(
      <FocusView applications={[unrated]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} />,
    )
    const before = rowsIn('Overdue or due today')
    unmount()

    render(<FocusView applications={[loathed]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} />)

    expect(rowsIn('Overdue or due today')).toEqual(before)
  })

  it('offers prep notes on a row, like the Kanban card and the table row', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const onOpenStageNotes = vi.fn()
    const applications = [
      application('Prep Co', {
        next_action: 'Join interview',
        next_action_at: localDate(0),
        stage_notes: [
          {
            state: 'applied',
            body: '## Panel\n\n- Design',
            heard: [],
            created_at: localDate(-2),
            updated_at: localDate(-1),
          },
        ],
      }),
    ]

    render(
      <FocusView applications={applications} onOpen={vi.fn()} onOpenStageNotes={onOpenStageNotes} />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Prep notes for Prep Co, 1 stage' }),
    )
    expect(onOpenStageNotes).toHaveBeenCalledWith(applications[0].id)
  })

  it('includes applications with a deadline and no action at all', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    render(
      <FocusView
        applications={[application('Closing Soon', { deadline_at: localDate(2) })]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    expect(rowsIn('Due in 1 to 7 days')).toEqual([expect.stringContaining('Closing Soon')])
    expect(screen.getByText('Deadline in 2 days')).toBeInTheDocument()
    expect(screen.getByText('No action set')).toBeInTheDocument()
  })

  it('keeps tasks left on finished applications instead of dropping them', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const applications = [
      application('Rejected Co', {
        state: 'interview_1_rejected',
        state_history: [{ state: 'interview_1_rejected', at: localDate(-4) }],
        next_action: 'Thank the hiring manager',
      }),
      application('Accepted Co', {
        state: 'accepted',
        state_history: [{ state: 'accepted', at: localDate(-4) }],
        next_action: 'Prepare for onboarding',
      }),
      application('Rejected And Done', {
        state: 'auto_rejected',
        state_history: [{ state: 'auto_rejected', at: localDate(-4) }],
      }),
    ]

    render(
      <FocusView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} />,
    )

    expect(rowsIn('Finished, action outstanding')).toEqual([
      expect.stringContaining('Accepted Co'),
      expect.stringContaining('Rejected Co'),
    ])
    expect(screen.queryByText(/Rejected And Done/)).not.toBeInTheDocument()
  })

  it('expands only the leading non-empty group', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    render(
      <FocusView
        applications={[
          application('Gone Quiet', {
            state_history: [{ state: 'applied', at: localDate(-25) }],
          }),
          application('Nothing Planned Inc'),
        ]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    expect(groupElement('Overdue or due today')).not.toHaveAttribute('open')
    expect(groupElement('No stage change in more than 7 days')).toHaveAttribute('open')
    expect(groupElement('Nothing dated or planned')).not.toHaveAttribute('open')
    expect(
      within(groupElement('Overdue or due today')).getByText('Nothing is overdue or due today.'),
    ).toBeInTheDocument()
  })

  it('shows a helpful empty state when nothing needs attention', () => {
    render(
      <FocusView
        applications={[
          application('Rejected Co', {
            state: 'auto_rejected',
            state_history: [{ state: 'auto_rejected', at: localDate(-4) }],
          }),
        ]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Nothing needs attention' })).toBeInTheDocument()
  })
})

describe('StaleView', () => {
  it('defaults to 14 days, orders oldest first, and supports the display-only thresholds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const applications = [
      application('Eight Days', { updated_at: localDate(-8) }),
      application('Fourteen Days', { updated_at: localDate(-14) }),
      application('Thirty-one Days', { updated_at: localDate(-31) }),
    ]

    render(<StaleView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onMove={vi.fn()} />)

    expect(screen.getByRole('radio', { name: '14 days' })).toBeChecked()
    expect(screen.queryByText('Eight Days')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((item) => within(item).getByText(/Days$/).textContent)).toEqual([
      'Thirty-one Days',
      'Fourteen Days',
    ])

    fireEvent.click(screen.getByRole('radio', { name: '7 days' }))
    expect(screen.getByText('Eight Days')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: '30 days' }))
    expect(screen.queryByText('Fourteen Days')).not.toBeInTheDocument()
    expect(screen.getByText('Thirty-one Days')).toBeInTheDocument()
  })

  it('offers a Move to Rejected shortcut to the counterpart of the current state', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const onMove = vi.fn()
    const live = application('Live Loop', { state: 'interview_1', updated_at: localDate(-14) })
    const closed = application('Already Closed', { state: 'interview_1_rejected', updated_at: localDate(-20) })

    render(<StaleView applications={[live, closed]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onMove={onMove} />)

    const shortcut = screen.getByRole('button', { name: 'Move Live Loop to Interview 1 — Rejected' })
    expect(shortcut).toHaveTextContent('Move to Rejected')
    fireEvent.click(shortcut)
    expect(onMove).toHaveBeenCalledWith(live.id, 'interview_1_rejected')
    expect(
      screen.queryByRole('button', { name: 'Move Already Closed to Interview 1 — Rejected' }),
    ).not.toBeInTheDocument()
  })

  it('uses Auto-rejected as the counterpart for Applied', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const onMove = vi.fn()
    const record = application('Applied Co', { updated_at: localDate(-14) })

    render(<StaleView applications={[record]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onMove={onMove} />)

    fireEvent.click(screen.getByRole('button', { name: 'Move Applied Co to Auto-rejected' }))
    expect(onMove).toHaveBeenCalledWith(record.id, 'auto_rejected')
  })

  it('omits the Move to Rejected shortcut when the current state has no counterpart', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    render(
      <StaleView
        applications={[application('Offer Taken', { state: 'accepted', updated_at: localDate(-14) })]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onMove={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /Move Offer Taken to / })).not.toBeInTheDocument()
  })
})

describe('CalendarView', () => {
  it('exposes one weekday header row and six week rows in its accessible grid', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    render(<CalendarView applications={[]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} />)

    const rows = within(screen.getByRole('grid')).getAllByRole('row')
    expect(rows).toHaveLength(7)
    expect(within(rows[0]!).getAllByRole('columnheader')).toHaveLength(7)
    for (const row of rows.slice(1)) {
      expect(within(row).getAllByRole('gridcell')).toHaveLength(7)
    }
  })

  it('places only dated next actions on their local day and opens the selected application', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const onOpen = vi.fn()
    const scheduled = application('Calendar Company', {
      next_action: 'Talk with hiring manager',
      next_action_at: new Date(2026, 7, 21, 9, 30).toISOString(),
    })

    render(
      <CalendarView
        applications={[
          scheduled,
          application('Undated Company', { next_action: 'Send a note' }),
          application('Orphaned Date', { next_action_at: new Date(2026, 7, 22, 9).toISOString() }),
        ]}
        onOpen={onOpen} onOpenStageNotes={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument()
    const event = screen.getByRole('button', { name: /Calendar Company.*Talk with hiring manager/ })
    expect(event).toBeInTheDocument()
    expect(screen.queryByText('Undated Company')).not.toBeInTheDocument()
    expect(screen.getByText('Orphaned Date')).toBeInTheDocument()
    expect(screen.getByText('Scheduled action')).toBeInTheDocument()

    fireEvent.click(event)
    expect(onOpen).toHaveBeenCalledWith(scheduled.id)
  })

  it('places invites beside dated next actions in time order', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const onOpen = vi.fn()
    const scheduled = application('Panel Company', {
      next_action: 'Reread the brief',
      next_action_at: new Date(2026, 7, 21, 16).toISOString(),
      state_events: [
        stateEvent({ summary: 'Research panel', starts_at: new Date(2026, 7, 21, 9, 30).toISOString() }),
      ],
    })

    render(<CalendarView applications={[scheduled]} onOpen={onOpen} onOpenStageNotes={vi.fn()} />)

    const day = screen.getByRole('gridcell', {
      name: formatLongDate(new Date(2026, 7, 21)),
    })
    expect(within(day).getAllByRole('button').map((button) => button.textContent)).toEqual([
      expect.stringContaining('Research panel'),
      expect.stringContaining('Reread the brief'),
    ])

    fireEvent.click(within(day).getByRole('button', { name: /Research panel/ }))
    expect(onOpen).toHaveBeenCalledWith(scheduled.id)
  })

  it('marks a cancelled invite as cancelled', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    render(
      <CalendarView
        applications={[
          application('Called Off', {
            state_events: [
              stateEvent({
                summary: 'Leadership interview',
                starts_at: new Date(2026, 7, 25, 10).toISOString(),
                cancelled: true,
              }),
            ],
          }),
        ]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: /Cancelled.*Leadership interview/ }),
    ).toBeInTheDocument()
  })

  it('moves between months and returns to the current month', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    render(<CalendarView applications={[]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument()
  })
})

describe('TableView', () => {
  it('sorts, opens, and moves an application without changing the data', () => {
    const onOpen = vi.fn()
    const onMove = vi.fn()
    const applications = [
      application('Zebra Works', { created_at: localDate(-10), updated_at: localDate(-3) }),
      application('Alpha Labs', {
        state: 'accepted',
        state_history: [{ state: 'accepted', at: localDate(-2) }],
        created_at: localDate(-30),
        updated_at: localDate(-2),
      }),
      application('Middle Studio', { created_at: localDate(-20), updated_at: localDate(-1) }),
    ]

    render(
      <TableView applications={applications} onOpen={onOpen} onOpenStageNotes={vi.fn()} onMove={onMove} />,
    )

    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Middle Studio',
      'Alpha Labs',
      'Zebra Works',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Company' }))
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Alpha Labs',
      'Middle Studio',
      'Zebra Works',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Created' }))
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Zebra Works',
      'Middle Studio',
      'Alpha Labs',
    ])

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Move Alpha Labs to state' }),
      { target: { value: 'offer' } },
    )
    expect(onMove).toHaveBeenCalledWith(applications[1].id, 'offer')

    fireEvent.click(within(screen.getByRole('rowheader', { name: 'Alpha Labs' })).getByRole('button'))
    expect(onOpen).toHaveBeenCalledWith(applications[1].id)
    expect(applications).toHaveLength(3)
  })

  it('narrows rows with column filters without changing the data', () => {
    const applications = [
      application('Alpha Labs', {
        state: 'accepted',
        state_history: [{ state: 'accepted', at: localDate(-2) }],
        source: 'LinkedIn',
        attachments: [{
          id: '018f0000-0000-7000-8000-000000000002',
          filename: 'resume.pdf',
          mime: 'application/pdf',
          size: 900,
          created_at: localDate(-1),
        }],
      }),
      application('Zebra Works', { source: 'Referral', role: 'Designer' }),
    ]

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onMove={vi.fn()} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter Company column' }), {
      target: { value: 'Alpha' },
    })
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Alpha Labs'])

    fireEvent.click(screen.getByRole('button', { name: 'Clear column filters' }))
    expect(screen.getAllByRole('rowheader')).toHaveLength(2)

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter State column' }), {
      target: { value: 'accepted' },
    })
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Alpha Labs'])

    fireEvent.click(screen.getByRole('button', { name: 'Clear column filters' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Attachments column' }), {
      target: { value: 'resume.pdf' },
    })
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Alpha Labs'])
    expect(applications).toHaveLength(2)
  })

  it('lists invites in a column, filters on them, and sorts by what is next', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const applications = [
      application('Later Panel', {
        state_events: [stateEvent({ summary: 'Systems design round', starts_at: localDate(9) })],
      }),
      application('No Invites'),
      application('Sooner Panel', {
        state_events: [
          stateEvent({ summary: 'Called off round', starts_at: localDate(2), cancelled: true }),
          stateEvent({ summary: 'Research panel', starts_at: localDate(4), location: 'Docklands' }),
        ],
      }),
    ]

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onMove={vi.fn()} />)

    const sooner = screen.getByRole('row', { name: /Sooner Panel/ })
    expect(within(sooner).getByText('Called off round')).toBeInTheDocument()
    expect(within(sooner).getByText('Cancelled')).toBeInTheDocument()
    // Both invites show, soonest first, whether or not they are still ahead.
    expect(within(sooner).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Called off round'),
      expect.stringContaining('Research panel'),
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Invites' }))
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Sooner Panel',
      'Later Panel',
      'No Invites',
    ])

    // A cancelled invite is not what is next, so it does not pull the row forward.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Invites column' }), {
      target: { value: 'docklands' },
    })
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Sooner Panel'])

    fireEvent.click(screen.getByRole('button', { name: 'Clear column filters' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Invites column' }), {
      target: { value: 'cancelled' },
    })
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Sooner Panel'])
  })

  it('sorts by deadline with undated applications last', () => {
    const applications = [
      application('Zebra Works', { deadline_at: localDate(9) }),
      application('Alpha Labs', { deadline_at: null }),
      application('Middle Studio', { deadline_at: localDate(2) }),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Deadline' }))
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Middle Studio',
      'Zebra Works',
      'Alpha Labs',
    ])

    // Undated is absent rather than late, so it stays last when the order flips too.
    fireEvent.click(screen.getByRole('button', { name: 'Deadline' }))
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Zebra Works',
      'Middle Studio',
      'Alpha Labs',
    ])
    expect(applications.map(({ deadline_at }) => deadline_at)).toEqual([
      localDate(9),
      null,
      localDate(2),
    ])
  })

  it('filters the deadline column and ignores applications without one', () => {
    const applications = [
      application('Alpha Labs', { deadline_at: new Date(2026, 8, 1, 17).toISOString() }),
      application('Zebra Works', { deadline_at: null }),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Deadline column' }), {
      target: { value: 'Sep' },
    })
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Alpha Labs'])
  })

  it('ranks by urgency, showing the reason and leaving finished applications out', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const applications = [
      application('Quiet Co'),
      application('Rejected Co', {
        state: 'auto_rejected',
        state_history: [{ state: 'auto_rejected', at: localDate(-2) }],
        deadline_at: localDate(1),
      }),
      application('Deadline Co', { deadline_at: localDate(2) }),
      application('Overdue Co', { next_action: 'Follow up', next_action_at: localDate(-3) }),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Urgency' }))
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Overdue Co',
      'Deadline Co',
      'Quiet Co',
      'Rejected Co',
    ])

    expect(screen.getByText('Action overdue 3 days')).toBeInTheDocument()
    expect(screen.getByText('Deadline in 2 days')).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /Rejected Co/ })).getByLabelText('Not ranked'),
    ).toBeInTheDocument()
  })

  it('filters the urgency column by its reason', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const applications = [
      application('Deadline Co', { deadline_at: localDate(2) }),
      application('Overdue Co', { next_action: 'Follow up', next_action_at: localDate(-3) }),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Urgency column' }), {
      target: { value: 'overdue' },
    })
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Overdue Co'])
  })

  it('shows a preference score with what is missing, and a dash when unrated', () => {
    const applications = [
      application('Fully Rated', {
        ratings: ratings({ work: 4, growth: 4, people: 4, company: 4 }),
      }),
      application('Part Rated', { ratings: ratings({ work: 4, growth: 4, people: null }) }),
      application('Not Rated', {}),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    expect(screen.getByText('4.00')).toBeInTheDocument()
    expect(screen.getByText(/People unknown · 1 not rated/)).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /Not Rated/ })).getByLabelText('Not rated'),
    ).toBeInTheDocument()
  })

  it('names the weakest judgement so an even score is distinguishable', () => {
    const applications = [
      application('Dealbreaker Co', {
        ratings: ratings({ work: 5, growth: 5, people: 5, company: 1 }),
      }),
      application('Even Co', { ratings: ratings({ work: 4, growth: 4, people: 4, company: 4 }) }),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    // Both mean 4.00; only one of them has a 1 in it.
    expect(screen.getByText('4.00 · Company & product 1')).toBeInTheDocument()
    expect(screen.getByText('4.00')).toBeInTheDocument()
  })

  it('keeps unrated applications last when sorting preference either way', () => {
    const applications = [
      application('Middle Co', { ratings: ratings({ work: 3, growth: 3, people: 3, company: 3 }) }),
      application('Unrated Co', {}),
      application('Best Co', { ratings: ratings({ work: 5, growth: 5, people: 5, company: 5 }) }),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preference' }))
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Best Co',
      'Middle Co',
      'Unrated Co',
    ])

    // Unrated is absent, not worst, so it stays last when the order flips.
    fireEvent.click(screen.getByRole('button', { name: 'Preference' }))
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Middle Co',
      'Best Co',
      'Unrated Co',
    ])
  })

  it('filters the preference column by its text', () => {
    const applications = [
      application('Unknown Co', { ratings: ratings({ work: 4, people: null }) }),
      application('Solid Co', { ratings: ratings({ work: 4, growth: 4, people: 4, company: 4 }) }),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Preference column' }), {
      target: { value: 'unknown' },
    })
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Unknown Co'])
  })

  it('shows the progression and how far off target it lands', () => {
    const applications = [
      application('Offer Co', {
        compensation: compensation('AUD', {
          advertised: [180_000, 210_000],
          expected: 200_000,
          offered: 215_000,
        }),
      }),
      application('Posting Co', { compensation: compensation('USD', { advertised: [90_000, 110_000] }) }),
      application('Nothing Co'),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    expect(
      screen.getByText('AUD · Advertised 180,000–210,000 · Expected 200,000 · Offered 215,000 · 8% above target'),
    ).toBeInTheDocument()
    // No target recorded, so no gap is claimed — and the currency still leads the cell.
    expect(screen.getByText('USD · Advertised 90,000–110,000')).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /Nothing Co/ })).getByLabelText('Not recorded'),
    ).toBeInTheDocument()
  })

  it('keeps applications with no quoted figure last when sorting compensation either way', () => {
    const applications = [
      application('Middle Co', { compensation: compensation('AUD', { advertised: [130_000, 150_000] }) }),
      // A target of your own is not a figure anyone quoted, so this row is absent from the
      // column even though it holds a number.
      application('Target Only Co', { compensation: compensation('AUD', { expected: 400_000 }) }),
      application('Best Co', { compensation: compensation('AUD', { offered: 220_000 }) }),
      application('Nothing Co'),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Compensation' }))
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Best Co',
      'Middle Co',
      'Target Only Co',
      'Nothing Co',
    ])

    // Absent is not the lowest pay, so both rows without a figure stay last when the order
    // flips. A sentinel number could not do this: it would sort to the wrong end here.
    fireEvent.click(screen.getByRole('button', { name: 'Compensation' }))
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Middle Co',
      'Best Co',
      'Target Only Co',
      'Nothing Co',
    ])
  })

  it('filters the compensation column by its text', () => {
    const applications = [
      application('Short Co', {
        compensation: compensation('AUD', { advertised: [100_000, 115_000], expected: 130_000 }),
      }),
      application('Ample Co', {
        compensation: compensation('AUD', { expected: 150_000, offered: 170_000 }),
      }),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Compensation column' }), {
      target: { value: 'below target' },
    })
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Short Co'])
  })

  it('offers company and source datalist suggestions', () => {
    const applications = [
      application('Alpha Labs', { source: 'Campus fair' }),
      application('Zebra Works', { source: 'LinkedIn' }),
    ]

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onMove={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: 'Filter Company column' })).toHaveAttribute(
      'list',
      'table-filter-company-suggestions',
    )
    expect(
      [...document.querySelectorAll('#table-filter-company-suggestions option')].map((option) => option.getAttribute('value')),
    ).toEqual(['Alpha Labs', 'Zebra Works'])
    expect(
      [...document.querySelectorAll('#table-filter-source-suggestions option')].map((option) => option.getAttribute('value')),
    ).toEqual(['LinkedIn', 'Company site', 'Referral', 'Recruiter', 'Job board', 'Campus fair'])
  })

  it('shows attachment filenames', () => {
    const applications = [
      application('Resume Ready', {
        attachments: [{
          id: '018f0000-0000-7000-8000-000000000002',
          filename: 'resume.pdf',
          mime: 'application/pdf',
          size: 900,
          created_at: localDate(-1),
        }],
      }),
      application('Plain Record'),
    ]

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onMove={vi.fn()} />)

    expect(screen.getByText('resume.pdf')).toBeInTheDocument()
  })
})

describe('StatisticsView', () => {
  it('distinguishes current-state counts from states ever reached', () => {
    const applications = [
      application('Completed Journey', {
        state: 'accepted',
        state_history: [
          { state: 'applied', at: localDate(-20) },
          { state: 'interview_1', at: localDate(-10) },
          { state: 'accepted', at: localDate(-2) },
        ],
      }),
      application('Fresh Application'),
    ]

    render(<StatisticsView applications={applications} />)

    expect(
      within(screen.getByRole('row', { name: /^Applied / })).getAllByRole('cell').map((cell) =>
        cell.textContent,
      ),
    ).toEqual(['1', '2'])
    const interviewOneRow = screen.getByRole('rowheader', { name: 'Interview 1' }).closest('tr')
    expect(interviewOneRow).not.toBeNull()
    expect(
      within(interviewOneRow!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['0', '1'])
    expect(
      within(screen.getByRole('row', { name: /^Accepted / })).getAllByRole('cell').map((cell) =>
        cell.textContent,
      ),
    ).toEqual(['1', '1'])
    expect(screen.getAllByRole('row')).toHaveLength(20)
  })
})

describe('kanbanColumnGroups', () => {
  it('groups live states with their rejected counterparts into 11 columns', () => {
    const groups = kanbanColumnGroups()

    expect(groups).toHaveLength(11)
    expect(groups[2]).toEqual({ lanes: ['applied', 'auto_rejected'] })
    expect(groups.flatMap((group) => group.lanes)).toHaveLength(19)
  })

  it('returns a single unpaired lane when filtering to a rejected state', () => {
    expect(kanbanColumnGroups(['auto_rejected'])).toEqual([{ lanes: ['auto_rejected'] }])
  })
})

describe('KanbanView', () => {
  it('supports opening and moving a card through its accessible controls', () => {
    const onOpen = vi.fn()
    const onMove = vi.fn()
    const record = application('Keyboard Movers')

    render(<KanbanView applications={[record]} onOpen={onOpen} onOpenStageNotes={vi.fn()} onMove={onMove} />)

    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(19)
    fireEvent.click(screen.getByRole('button', { name: /Open Keyboard Movers/ }))
    expect(onOpen).toHaveBeenCalledWith(record.id)

    fireEvent.change(screen.getByRole('combobox', { name: 'Move Keyboard Movers to state' }), {
      target: { value: 'accepted' },
    })
    expect(onMove).toHaveBeenCalledWith(record.id, 'accepted')
    expect(
      screen.queryByRole('button', { name: 'Move Keyboard Movers to Auto-rejected' }),
    ).not.toBeInTheDocument()
  })

  it('shows the soonest invite still ahead and skips cancelled or past ones', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const record = application('Invite Board', {
      state_events: [
        stateEvent({ summary: 'Already happened', starts_at: localDate(-3) }),
        stateEvent({ summary: 'Called off', starts_at: localDate(1), cancelled: true }),
        stateEvent({ summary: 'Research panel', starts_at: localDate(2) }),
        stateEvent({ summary: 'Leadership chat', starts_at: localDate(6) }),
      ],
    })

    render(<KanbanView applications={[record]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onMove={vi.fn()} />)

    const card = screen.getByText('Invite Board').closest('article')
    expect(within(card!).getByText(/Research panel/)).toBeInTheDocument()
    expect(within(card!).queryByText(/Already happened/)).not.toBeInTheDocument()
    expect(within(card!).queryByText(/Called off/)).not.toBeInTheDocument()
    expect(within(card!).queryByText(/Leadership chat/)).not.toBeInTheDocument()
  })

  it('moves a dragged card to any other state', () => {
    const onMove = vi.fn()
    const record = application('Drag & Drop Co')
    const values = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? '',
    }

    render(<KanbanView applications={[record]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onMove={onMove} />)

    const card = screen.getByText('Drag & Drop Co').closest('article')
    const destination = screen.getByRole('heading', { level: 3, name: 'Accepted' }).closest('section')
    expect(card).not.toBeNull()
    expect(destination).not.toBeNull()

    fireEvent.dragStart(card!, { dataTransfer })
    fireEvent.dragOver(destination!, { dataTransfer })
    fireEvent.drop(destination!, { dataTransfer })

    expect(onMove).toHaveBeenCalledWith(record.id, 'accepted')
  })

  it('moves a dragged card onto a nested rejected lane', () => {
    const onMove = vi.fn()
    const record = application('Nested Drop Co')
    const values = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? '',
    }

    render(<KanbanView applications={[record]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onMove={onMove} />)

    const card = screen.getByText('Nested Drop Co').closest('article')
    const destination = screen
      .getByRole('heading', { level: 3, name: 'Auto-rejected' })
      .closest('section')
    expect(card).not.toBeNull()
    expect(destination).not.toBeNull()

    fireEvent.dragStart(card!, { dataTransfer })
    fireEvent.dragOver(destination!, { dataTransfer })
    fireEvent.drop(destination!, { dataTransfer })

    expect(onMove).toHaveBeenCalledWith(record.id, 'auto_rejected')
  })

  it('shows attachment filenames on a card when present', () => {
    const record = application('Paperclip Corp', {
      attachments: [{
        id: '018f0000-0000-7000-8000-000000000001',
        filename: 'resume.pdf',
        mime: 'application/pdf',
        size: 1200,
        created_at: localDate(-1),
      }],
    })

    render(<KanbanView applications={[record]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onMove={vi.fn()} />)

    expect(screen.getByLabelText('Attachments')).toHaveTextContent('resume.pdf')
  })

  it('omits attachment filenames when there are no attachments', () => {
    render(<KanbanView applications={[application('No Files Co')]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onMove={vi.fn()} />)

    expect(screen.queryByLabelText('Attachments')).not.toBeInTheDocument()
  })

  it('greys out cards last updated 14 or more days ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    render(
      <KanbanView
        applications={[
          application('Fresh Co', { updated_at: localDate(-13) }),
          application('Quiet Co', { updated_at: localDate(-14) }),
        ]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onMove={vi.fn()}
      />,
    )

    const fresh = screen.getByText('Fresh Co').closest('article')
    const quiet = screen.getByText('Quiet Co').closest('article')
    expect(fresh).not.toHaveClass('application-card--stale')
    expect(quiet).toHaveClass('application-card--stale')
    expect(screen.getByRole('button', { name: 'Open Fresh Co, Software engineer' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Open Quiet Co, Software engineer, stale, last updated 14 days ago',
      }),
    ).toBeInTheDocument()
    expect(within(quiet!).getByText('Untouched 14 days')).toBeInTheDocument()
    expect(screen.queryByText('Untouched 13 days')).not.toBeInTheDocument()
  })
})
