import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { COMPENSATION_STAGE_IDS, emptyCompensation } from '../domain'
import stylesheet from '../styles.css?raw'
import type {
  Application,
  Compensation,
  CompensationStageId,
  Rating,
  RatingDimensionId,
  StateEvent,
  StateId,
} from '../domain'
import { KanbanView } from './KanbanView'
import { StatisticsView } from './StatisticsView'
import { TableView } from './TableView'
import { kanbanColumnGroups } from './viewUtils'

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
    completed_actions: [],
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

/**
 * The company cell of each row, in order. A banded table puts its band headings in the
 * same role, so they are filtered out here rather than worked around by every sort test;
 * the tests that are about the bands assert on the headings directly.
 */
function rowCompanies(): (string | null)[] {
  return screen
    .getAllByRole('rowheader')
    .filter((cell) => !cell.closest('.table-view__band'))
    .map((cell) => cell.textContent)
}

describe('TableView', () => {
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent = stylesheet
    document.head.append(style)
  })

  it('filters and sorts the Activity column, sinking rows with no silence to measure', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const state: StateId = 'applied'
    const applications = [
      application('Quiet Co', { state_history: [{ state, at: localDate(-40) }] }),
      application('Busy Co', { state_history: [{ state, at: localDate(-2) }] }),
      application('Silent Co', { state_history: [{ state, at: localDate(-35) }] }),
    ]

    render(
      <TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={vi.fn()} />,
    )

    expect(screen.getByText('Idle 40 days')).toBeInTheDocument()
    expect(screen.getByText('Idle 35 days')).toBeInTheDocument()

    // A row that is not idle has no value here, so it stays last whichever way the
    // column is pointed rather than reading as the freshest or the quietest.
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }))
    expect(rowCompanies()).toEqual([
      'Silent Co',
      'Quiet Co',
      'Busy Co',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Activity' }))
    expect(rowCompanies()).toEqual([
      'Quiet Co',
      'Silent Co',
      'Busy Co',
    ])

    fireEvent.change(screen.getByLabelText('Filter Activity column'), {
      target: { value: '40' },
    })
    expect(rowCompanies()).toEqual(['Quiet Co'])
  })

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
      <TableView applications={applications} onOpen={onOpen} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={onMove} />,
    )

    // The default sort: both live rows tie on score and neither is rated, so the band's
    // last tiebreak decides between them, and the accepted one sits in a later band.
    expect(rowCompanies()).toEqual([
      'Middle Studio',
      'Zebra Works',
      'Alpha Labs',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Company' }))
    expect(rowCompanies()).toEqual([
      'Alpha Labs',
      'Middle Studio',
      'Zebra Works',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Created' }))
    expect(rowCompanies()).toEqual([
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

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={vi.fn()} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter Company column' }), {
      target: { value: 'Alpha' },
    })
    expect(rowCompanies()).toEqual(['Alpha Labs'])

    fireEvent.click(screen.getByRole('button', { name: 'Clear column filters' }))
    expect(rowCompanies()).toHaveLength(2)

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter State column' }), {
      target: { value: 'accepted' },
    })
    expect(rowCompanies()).toEqual(['Alpha Labs'])

    fireEvent.click(screen.getByRole('button', { name: 'Clear column filters' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Attachments column' }), {
      target: { value: 'resume.pdf' },
    })
    expect(rowCompanies()).toEqual(['Alpha Labs'])
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

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={vi.fn()} />)

    const sooner = screen.getByRole('row', { name: /Sooner Panel/ })
    expect(within(sooner).getByText('Called off round')).toBeInTheDocument()
    expect(within(sooner).getByText('Cancelled')).toBeInTheDocument()
    // Both invites show, soonest first, whether or not they are still ahead.
    expect(within(sooner).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Called off round'),
      expect.stringContaining('Research panel'),
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Invites' }))
    expect(rowCompanies()).toEqual([
      'Sooner Panel',
      'Later Panel',
      'No Invites',
    ])

    // A cancelled invite is not what is next, so it does not pull the row forward.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Invites column' }), {
      target: { value: 'docklands' },
    })
    expect(rowCompanies()).toEqual(['Sooner Panel'])

    fireEvent.click(screen.getByRole('button', { name: 'Clear column filters' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Invites column' }), {
      target: { value: 'cancelled' },
    })
    expect(rowCompanies()).toEqual(['Sooner Panel'])
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
        onCompleteAction={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Deadline' }))
    expect(rowCompanies()).toEqual([
      'Middle Studio',
      'Zebra Works',
      'Alpha Labs',
    ])

    // Undated is absent rather than late, so it stays last when the order flips too.
    fireEvent.click(screen.getByRole('button', { name: 'Deadline' }))
    expect(rowCompanies()).toEqual([
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

  it('offers Done in the next action cell, and only where there is an action', () => {
    const onCompleteAction = vi.fn()
    const tasked = application('Task Co', { next_action: 'Chase the recruiter' })

    render(
      <TableView
        applications={[tasked, application('Idle Co')]}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={onCompleteAction}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Mark done for Task Co: Chase the recruiter' }),
    )
    expect(onCompleteAction).toHaveBeenCalledWith(tasked.id)
    expect(screen.queryByRole('button', { name: /^Mark done for Idle Co/ })).not.toBeInTheDocument()
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
        onCompleteAction={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Deadline column' }), {
      target: { value: 'Sep' },
    })
    expect(rowCompanies()).toEqual(['Alpha Labs'])
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
        onCompleteAction={vi.fn()}
      />,
    )

    // The table opens on urgency, which bands the rows; the ranking inside each band is
    // what this asserts.
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Dated, soonest first2',
      'Overdue Co',
      'Deadline Co',
      'Live, nothing dated1',
      'Quiet Co',
      'Finished1',
      'Rejected Co',
    ])

    expect(screen.getByText('Action overdue 3 days')).toBeInTheDocument()
    expect(screen.getByText('Deadline in 2 days')).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /Rejected Co/ })).getByLabelText('Not ranked'),
    ).toBeInTheDocument()
  })

  it('bands the rows under headings when sorted by urgency, and only then', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const applications = [
      application('Quiet Co'),
      application('Loose End Co', {
        state: 'auto_rejected',
        state_history: [{ state: 'auto_rejected', at: localDate(-2) }],
        next_action: 'Ask for feedback',
      }),
      application('Closed Co', {
        state: 'auto_rejected',
        state_history: [{ state: 'auto_rejected', at: localDate(-2) }],
      }),
      application('Overdue Co', { next_action: 'Follow up', next_action_at: localDate(-3) }),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    // The table opens banded, because it opens sorted by urgency.
    expect(
      screen.getAllByRole('rowgroup')
        .flatMap((group) => within(group).queryAllByRole('rowheader'))
        .map((cell) => cell.textContent),
    ).toEqual([
      'Dated, soonest first1',
      'Overdue Co',
      'Live, nothing dated1',
      'Quiet Co',
      'Finished, action outstanding1',
      'Loose End Co',
      'Finished1',
      'Closed Co',
    ])

    // Flipping the direction takes the bands away: the order no longer follows their rule.
    fireEvent.click(screen.getByRole('button', { name: 'Urgency' }))
    expect(screen.queryByText('Dated, soonest first')).not.toBeInTheDocument()
    expect(rowCompanies()).toEqual([
      'Loose End Co',
      'Closed Co',
      'Quiet Co',
      'Overdue Co',
    ])

    // So does sorting on a column the bands say nothing about.
    fireEvent.click(screen.getByRole('button', { name: 'Company' }))
    expect(screen.queryByText('Live, nothing dated')).not.toBeInTheDocument()
  })

  it('prints no heading for a band that holds nothing', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    render(
      <TableView
        applications={[application('Quiet Co')]}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    expect(screen.getByText('Live, nothing dated')).toBeInTheDocument()
    expect(screen.queryByText('Dated, soonest first')).not.toBeInTheDocument()
    expect(screen.queryByText('Finished')).not.toBeInTheDocument()
  })

  it('orders a dated band by its date rather than by the score, as its heading says', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const applications = [
      // An invite decays over 21 days and a self-set action over 7, so at these distances
      // the invite scores higher while the action falls due first.
      application('Invite Co', {
        state_events: [
          {
            id: '00000000-0000-7000-8000-000000000009',
            state: 'recruiter_interview',
            summary: 'Recruiter interview',
            starts_at: localDate(6),
            ends_at: null,
            location: null,
            url: null,
            ics_uid: null,
            sequence: 0,
            cancelled: false,
            created_at: localDate(-1),
            updated_at: localDate(-1),
          },
        ],
      }),
      application('Action Co', { next_action: 'Send the draft', next_action_at: localDate(2) }),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    expect(rowCompanies()).toEqual(['Action Co', 'Invite Co'])
  })

  it('offers a one-click rejection beside the state select, for the counterpart state', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const onMove = vi.fn()
    const waiting = application('Waiting Co', { state: 'recruiter_interview' })

    render(
      <TableView
        applications={[waiting]}
        onOpen={vi.fn()}
        onMove={onMove}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Move Waiting Co to Recruiter interview — Rejected' }),
    )
    expect(onMove).toHaveBeenCalledWith(waiting.id, 'recruiter_interview_rejected')
  })

  it('uses Auto-rejected as the counterpart for Applied', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    render(
      <TableView
        applications={[application('Sent Co')]}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Move Sent Co to Auto-rejected' }),
    ).toBeInTheDocument()
  })

  it('omits the rejection shortcut on a row that is already finished', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    render(
      <TableView
        applications={[
          application('Offer Taken', {
            state: 'accepted',
            state_history: [{ state: 'accepted', at: localDate(-2) }],
          }),
          application('Turned Down', {
            state: 'auto_rejected',
            state_history: [{ state: 'auto_rejected', at: localDate(-2) }],
          }),
        ]}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    // Accepted has no rejected counterpart, and a rejected row has nowhere left to go.
    expect(screen.queryByRole('button', { name: /^Move Offer Taken to / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Move Turned Down to / })).not.toBeInTheDocument()
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
        onCompleteAction={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Urgency column' }), {
      target: { value: 'overdue' },
    })
    expect(rowCompanies()).toEqual(['Overdue Co'])
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
        onCompleteAction={vi.fn()}
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
        onCompleteAction={vi.fn()}
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
        onCompleteAction={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preference' }))
    expect(rowCompanies()).toEqual([
      'Best Co',
      'Middle Co',
      'Unrated Co',
    ])

    // Unrated is absent, not worst, so it stays last when the order flips.
    fireEvent.click(screen.getByRole('button', { name: 'Preference' }))
    expect(rowCompanies()).toEqual([
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
        onCompleteAction={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Preference column' }), {
      target: { value: 'unknown' },
    })
    expect(rowCompanies()).toEqual(['Unknown Co'])
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
        onCompleteAction={vi.fn()}
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
        onCompleteAction={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Compensation' }))
    expect(rowCompanies()).toEqual([
      'Best Co',
      'Middle Co',
      'Target Only Co',
      'Nothing Co',
    ])

    // Absent is not the lowest pay, so both rows without a figure stay last when the order
    // flips. A sentinel number could not do this: it would sort to the wrong end here.
    fireEvent.click(screen.getByRole('button', { name: 'Compensation' }))
    expect(rowCompanies()).toEqual([
      'Middle Co',
      'Best Co',
      'Target Only Co',
      'Nothing Co',
    ])
  })

  it('filters the compensation column to one stage, treating a range as overlap', () => {
    const applications = [
      application('Advertised Co', { compensation: compensation('AUD', { advertised: [100_000, 120_000] }) }),
      application('Wide Advertised Co', { compensation: compensation('AUD', { advertised: [200_000, 250_000] }) }),
      // Only stated as an offer, so a filter scoped to Advertised must exclude it even
      // though the number would otherwise fall inside the range.
      application('Offered Co', { compensation: compensation('AUD', { offered: 115_000 }) }),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter Compensation column by stage' }), {
      target: { value: 'advertised' },
    })
    fireEvent.change(screen.getByLabelText('Filter Compensation column, minimum'), {
      target: { value: '110,000' },
    })
    fireEvent.change(screen.getByLabelText('Filter Compensation column, maximum'), {
      target: { value: '130000' },
    })

    // 100,000-120,000 overlaps 110,000-130,000; 200,000-250,000 does not; the offer is the
    // right number but the wrong stage.
    expect(rowCompanies()).toEqual(['Advertised Co'])
  })

  it('checks every stage when none is picked, and leaves an open bound unbounded', () => {
    const applications = [
      application('Advertised Co', { compensation: compensation('AUD', { advertised: [100_000, 120_000] }) }),
      application('Offered Co', { compensation: compensation('AUD', { offered: 130_000 }) }),
      application('Well Paid Co', { compensation: compensation('AUD', { advertised: [200_000, 250_000] }) }),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    const minimum = screen.getByLabelText('Filter Compensation column, minimum')
    const maximum = screen.getByLabelText('Filter Compensation column, maximum')

    // "Any stage" is the default, so a range can catch an offer without picking it out.
    fireEvent.change(minimum, { target: { value: '125000' } })
    fireEvent.change(maximum, { target: { value: '135000' } })
    expect(rowCompanies()).toEqual(['Offered Co'])

    // A minimum with no maximum reads as "at least", not as a band the row must fit inside.
    fireEvent.change(minimum, { target: { value: '150000' } })
    fireEvent.change(maximum, { target: { value: '' } })
    expect(rowCompanies()).toEqual(['Well Paid Co'])
  })

  it('ignores a range that has not been typed as a number yet, rather than hiding every row', () => {
    const applications = [
      application('Advertised Co', { compensation: compensation('AUD', { advertised: [100_000, 120_000] }) }),
      application('Nothing Co'),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Filter Compensation column, minimum'), {
      target: { value: 'abc' },
    })
    expect(rowCompanies()).toHaveLength(2)

    // Clear column filters resets the stage as well as both bounds.
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter Compensation column by stage' }), {
      target: { value: 'offered' },
    })
    fireEvent.change(screen.getByLabelText('Filter Compensation column, minimum'), {
      target: { value: '500000' },
    })
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Clear column filters' }))
    expect(
      screen.getByRole('combobox', { name: 'Filter Compensation column by stage' }),
    ).toHaveValue('any')
    expect(rowCompanies()).toHaveLength(2)
  })

  it('offers company and source datalist suggestions', () => {
    const applications = [
      application('Alpha Labs', { source: 'Campus fair' }),
      application('Zebra Works', { source: 'LinkedIn' }),
    ]

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={vi.fn()} />)

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

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={vi.fn()} />)

    expect(screen.getByText('resume.pdf')).toBeInTheDocument()
  })

  it('resizes a column via its header handle', () => {
    const applications = [application('Alpha Labs', { role: 'Engineer' })]

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={vi.fn()} />)

    const handle = screen.getByRole('separator', { name: 'Resize Role column' })
    const roleColumn = document.querySelectorAll('col')[1] as HTMLElement

    expect(roleColumn.style.width).toBe('160px')

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(roleColumn.style.width).toBe('184px')

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(roleColumn.style.width).toBe('136px')
  })

  it('clamps resizing at the maximum readable column width', () => {
    const applications = [application('Alpha Labs', { role: 'Engineer' })]

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={vi.fn()} />)

    const handle = screen.getByRole('separator', { name: 'Resize Role column' })
    const roleColumn = document.querySelectorAll('col')[1] as HTMLElement

    for (let step = 0; step < 20; step += 1) {
      fireEvent.keyDown(handle, { key: 'ArrowRight' })
    }

    expect(roleColumn.style.width).toBe('466px')
  })

  it('lets the compensation cell wrap instead of clipping long text', () => {
    const applications = [
      application('Alpha Labs', {
        compensation: compensation('AUD', { advertised: [180_000, 260_000], expected: 220_000, offered: 240_000 }),
      }),
    ]

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={vi.fn()} />)

    const cell = document.querySelector('[data-column="compensation"] .table-view__urgency')!
    expect(getComputedStyle(cell).whiteSpace).not.toBe('nowrap')
  })

  it('double-clicking the resize handle fits the column to its longest cell', () => {
    const applications = [
      application('Alpha Labs', { role: 'Senior Software Engineer' }),
      application('Beta Inc', { role: 'PM' }),
    ]

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={vi.fn()} />)

    const handle = screen.getByRole('separator', { name: 'Resize Role column' })
    const roleColumn = document.querySelectorAll('col')[1] as HTMLElement

    fireEvent.doubleClick(handle)

    expect(roleColumn.style.width).toBe('196px')
  })
})

describe('StatisticsView', () => {
  function stateTable(): HTMLElement {
    return screen.getByRole('table', {
      name: 'Current and ever-reached application counts by state',
    })
  }

  function ratingsTable(): HTMLElement {
    return screen.getByRole('table', {
      name: 'Judgement counts and mean judged score by rating dimension',
    })
  }

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
    // Scoped to the state table, so the ratings table below is free to grow.
    expect(within(stateTable()).getAllByRole('row')).toHaveLength(20)
  })

  it('summarises how the collection was rated, per dimension', () => {
    const applications = [
      application('Even Co', { ratings: ratings({ work: 4, growth: 4, people: 4, company: 4 }) }),
      application('Hidden One Co', {
        ratings: ratings({ work: 5, growth: 5, people: 1, company: 5 }),
      }),
      application('Partly Judged Co', { ratings: ratings({ work: 3, growth: null }) }),
      application('Unrated Co'),
    ]

    render(<StatisticsView applications={applications} />)

    // Three of four carry a judgement; the mean is of their discounted scores.
    expect(screen.getByLabelText('3 of 4 applications rated')).toBeInTheDocument()
    expect(screen.getByLabelText('Mean preference 3.48')).toBeInTheDocument()

    function ratingRow(dimension: string): string[] {
      const row = within(ratingsTable()).getByRole('rowheader', { name: dimension }).closest('tr')!
      return within(row).getAllByRole('cell').map((cell) => cell.textContent ?? '')
    }

    // Rated, Don't know, Not rated, Mean of the judged scores.
    expect(ratingRow('Work')).toEqual(['3', '0', '1', '4.00'])
    expect(ratingRow('Growth')).toEqual(['2', '1', '1', '4.50'])
    // People reads low because it was judged low, not because it went unassessed.
    expect(ratingRow('People')).toEqual(['2', '0', '2', '2.50'])
    expect(ratingRow('Company & product')).toEqual(['2', '0', '2', '4.50'])
  })

  it('says so plainly when nothing has been rated', () => {
    render(<StatisticsView applications={[application('Unrated Co')]} />)

    expect(screen.getByText('No application has been rated yet.')).toBeInTheDocument()
    expect(screen.getByLabelText('0 of 1 applications rated')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Mean preference /)).not.toBeInTheDocument()
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

    render(<KanbanView applications={[record]} onOpen={onOpen} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={onMove} />)

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

    render(<KanbanView applications={[record]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={vi.fn()} />)

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

    render(<KanbanView applications={[record]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={onMove} />)

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

    render(<KanbanView applications={[record]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={onMove} />)

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

    render(<KanbanView applications={[record]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={vi.fn()} />)

    expect(screen.getByLabelText('Attachments')).toHaveTextContent('resume.pdf')
  })

  it('omits attachment filenames when there are no attachments', () => {
    render(<KanbanView applications={[application('No Files Co')]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onCompleteAction={vi.fn()} onMove={vi.fn()} />)

    expect(screen.queryByLabelText('Attachments')).not.toBeInTheDocument()
  })

  it('shows the preference score with its dealbreaker, and nothing when unrated', () => {
    render(
      <KanbanView
        applications={[
          application('Even Co', { ratings: ratings({ work: 4, growth: 4, people: 4, company: 4 }) }),
          application('Hidden One Co', {
            ratings: ratings({ work: 5, growth: 5, people: 1, company: 5 }),
          }),
          application('Half Judged Co', { ratings: ratings({ work: 4, growth: null }) }),
          application('Unrated Co'),
        ]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={vi.fn()}
        onMove={vi.fn()}
      />,
    )

    function card(company: string): HTMLElement {
      return screen.getByText(company).closest('article')!
    }

    // Both average 4.00, and only one of them has a 1 in it.
    expect(within(card('Even Co')).getByText('4.00')).toBeInTheDocument()
    expect(within(card('Hidden One Co')).getByText('4.00 · People 1')).toBeInTheDocument()
    // The card says the same thing the table's column says, from the same helper.
    expect(within(card('Half Judged Co')).getByText('3.44 · Growth unknown · 2 not rated'))
      .toBeInTheDocument()
    expect(within(card('Unrated Co')).queryByText('Preference')).not.toBeInTheDocument()
  })

  it('offers Done on a card carrying an action', () => {
    const onCompleteAction = vi.fn()
    const tasked = application('Task Co', { next_action: 'Send the portfolio' })

    render(
      <KanbanView
        applications={[tasked, application('Idle Co')]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={onCompleteAction}
        onMove={vi.fn()}
      />,
    )

    const done = screen.getByRole('button', { name: 'Mark done for Task Co: Send the portfolio' })
    // Beside the task it resolves, not down in the card's footer row of card-wide controls.
    expect(done.closest('.application-card__action')).not.toBeNull()

    fireEvent.click(done)
    expect(onCompleteAction).toHaveBeenCalledWith(tasked.id)
    expect(screen.queryByRole('button', { name: /^Mark done for Idle Co/ })).not.toBeInTheDocument()
  })

  it('marks a card idle once its stage has not moved for 30 days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const state: StateId = 'applied'
    render(
      <KanbanView
        applications={[
          application('Fresh Co', { state_history: [{ state, at: localDate(-29) }] }),
          application('Quiet Co', { state_history: [{ state, at: localDate(-30) }] }),
        ]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={vi.fn()}
        onMove={vi.fn()}
      />,
    )

    const fresh = screen.getByText('Fresh Co').closest('article')
    const quiet = screen.getByText('Quiet Co').closest('article')
    expect(fresh).not.toHaveClass('application-card--idle')
    expect(quiet).toHaveClass('application-card--idle')
    expect(screen.getByRole('button', { name: 'Open Fresh Co, Software engineer' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open Quiet Co, Software engineer, Idle 30 days' }),
    ).toBeInTheDocument()
    expect(within(quiet!).getByText('Idle 30 days')).toBeInTheDocument()
    expect(screen.queryByText('Idle 29 days')).not.toBeInTheDocument()
  })

  /**
   * The Northstar Labs shape. Reading `updated_at` would call this card fresh, which is
   * the whole reason the card stopped reading it.
   */
  it('marks a card idle even when it was edited today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const state: StateId = 'applied'
    render(
      <KanbanView
        applications={[
          application('Annotated Co', {
            state_history: [{ state, at: localDate(-40) }],
            updated_at: localDate(0),
          }),
        ]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={vi.fn()}
        onMove={vi.fn()}
      />,
    )

    expect(screen.getByText('Annotated Co').closest('article')).toHaveClass('application-card--idle')
    expect(screen.getByText('Idle 40 days')).toBeInTheDocument()
  })

  it('leaves a long-finished card alone rather than calling it idle', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    render(
      <KanbanView
        applications={[
          application('Turned Down Co', {
            state: 'auto_rejected',
            state_history: [{ state: 'auto_rejected', at: localDate(-60) }],
            updated_at: localDate(-60),
          }),
        ]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onCompleteAction={vi.fn()}
        onMove={vi.fn()}
      />,
    )

    const card = screen.getByText('Turned Down Co').closest('article')
    expect(card).not.toHaveClass('application-card--idle')
    expect(within(card!).queryByText(/^Idle /)).not.toBeInTheDocument()
  })
})
