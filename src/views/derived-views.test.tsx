import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { COMPENSATION_STAGE_IDS, STAGE_IDS, emptyCompensation } from '../domain'
import stylesheet from '../styles.css?raw'
import type {
  Application,
  Compensation,
  CompensationStageId,
  Rating,
  RatingDimensionId,
  StageEvent,
  StageId,
} from '../domain'
import { KanbanView } from './KanbanView'
import { StatisticsView } from './StatisticsView'
import { DEFAULT_STATS_SETTINGS } from '../statsSettings'
import type { StatsSettingId, StatsSettings } from '../statsSettings'
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
  const stage: StageId = 'applied'
  return {
    id: `00000000-0000-7000-8000-${company.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(12, '0').slice(0, 12)}`,
    company,
    role: 'Software engineer',
    url: null,
    source: null,
    stage,
    outcome: 'active',
    // Created 40 days ago but moved yesterday, so nothing is silent by default.
    stage_history: [{ stage, outcome: 'active', at: localDate(-1) }],
    archived_at: null,
    next_action: null,
    next_action_at: null,
    deadline_at: null,
    notes: null,
    completed_actions: [],
    stage_notes: [],
    stage_events: [],
    correspondence: [],
    attachments: [],
    posting: null,
    ratings: [],
    compensation: emptyCompensation(),
    created_at: localDate(-40),
    updated_at: localDate(-1),
    ...overrides,
  }
}

function stageEvent(overrides: Partial<StageEvent> = {}): StageEvent {
  return {
    id: `00000000-0000-7000-9000-${String(Math.abs(Date.parse(overrides.starts_at ?? localDate(1)))).slice(-12)}`,
    stage: 'round_1',
    summary: 'Round 1 — panel',
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
  it('reads Idle at the threshold the reader set on Statistics', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const stage: StageId = 'applied'
    render(
      <TableView
        applications={[application('Twenty Co', { stage_history: [{ stage, outcome: 'active', at: localDate(-20) }] })]}
        onArchive={vi.fn()}
        onCompleteAction={vi.fn()}
        onMove={vi.fn()}
        onOpen={vi.fn()}
        onOpenMessages={vi.fn()}
        onOpenPosting={vi.fn()}
        onOpenStageNotes={vi.fn()}
        quietDays={15}
      />,
    )

    // Twenty days is not idle at the default thirty, and is at fifteen.
    expect(screen.getByText('Idle 20 days')).toBeInTheDocument()
  })

  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent = stylesheet
    document.head.append(style)
  })

  it('filters and sorts the Activity column, sinking rows with no silence to measure', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const stage: StageId = 'applied'
    const applications = [
      application('Quiet Co', { stage_history: [{ stage, outcome: 'active', at: localDate(-40) }] }),
      application('Busy Co', { stage_history: [{ stage, outcome: 'active', at: localDate(-2) }] }),
      application('Silent Co', { stage_history: [{ stage, outcome: 'active', at: localDate(-35) }] }),
    ]

    render(
      <TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={vi.fn()} />,
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
        stage: 'accepted', outcome: 'active',
        stage_history: [{ stage: 'accepted', outcome: 'active', at: localDate(-2) }],
        created_at: localDate(-30),
        updated_at: localDate(-2),
      }),
      application('Middle Studio', { created_at: localDate(-20), updated_at: localDate(-1) }),
    ]

    render(
      <TableView applications={applications} onOpen={onOpen} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={onMove} />,
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
      screen.getByRole('combobox', { name: 'Move Alpha Labs to stage' }),
      { target: { value: 'offer' } },
    )
    expect(onMove).toHaveBeenCalledWith(applications[1].id, { stage: 'offer' })

    fireEvent.click(within(screen.getByRole('rowheader', { name: 'Alpha Labs' })).getByRole('button'))
    expect(onOpen).toHaveBeenCalledWith(applications[1].id)
    expect(applications).toHaveLength(3)
  })

  it('narrows rows with column filters without changing the data', () => {
    const applications = [
      application('Alpha Labs', {
        stage: 'accepted', outcome: 'active',
        stage_history: [{ stage: 'accepted', outcome: 'active', at: localDate(-2) }],
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

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={vi.fn()} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter Company column' }), {
      target: { value: 'Alpha' },
    })
    expect(rowCompanies()).toEqual(['Alpha Labs'])

    fireEvent.click(screen.getByRole('button', { name: 'Clear column filters' }))
    expect(rowCompanies()).toHaveLength(2)

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter Stage column' }), {
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
        stage_events: [stageEvent({ summary: 'Systems design round', starts_at: localDate(9) })],
      }),
      application('No Invites'),
      application('Sooner Panel', {
        stage_events: [
          stageEvent({ summary: 'Called off round', starts_at: localDate(2), cancelled: true }),
          stageEvent({ summary: 'Research panel', starts_at: localDate(4), location: 'Docklands' }),
        ],
      }),
    ]

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={vi.fn()} />)

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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        stage: 'applied', outcome: 'rejected',
        stage_history: [{ stage: 'applied', outcome: 'rejected', at: localDate(-2) }],
        deadline_at: localDate(1),
      }),
      application('Deadline Co', { deadline_at: localDate(2) }),
      application('Overdue Co', { next_action: 'Follow up', next_action_at: localDate(-3) }),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        stage: 'applied', outcome: 'rejected',
        stage_history: [{ stage: 'applied', outcome: 'rejected', at: localDate(-2) }],
        next_action: 'Ask for feedback',
      }),
      application('Closed Co', {
        stage: 'applied', outcome: 'rejected',
        stage_history: [{ stage: 'applied', outcome: 'rejected', at: localDate(-2) }],
      }),
      application('Overdue Co', { next_action: 'Follow up', next_action_at: localDate(-3) }),
    ]

    render(
      <TableView
        applications={applications}
        onOpen={vi.fn()}
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        stage_events: [
          {
            id: '00000000-0000-7000-8000-000000000009',
            stage: 'screening',
            summary: 'Screening call',
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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    expect(rowCompanies()).toEqual(['Action Co', 'Invite Co'])
  })

  it('steps a running row on or back a stage, one press each', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const onMove = vi.fn()
    const waiting = application('Waiting Co', { stage: 'screening' })

    render(
      <TableView
        applications={[waiting]}
        onOpen={vi.fn()}
        onArchive={vi.fn()} onMove={onMove}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    // The name says where the press goes, so a column of them is not a column of "Next";
    // the face is the arrow alone.
    const next = screen.getByRole('button', { name: 'Move Waiting Co to Take-home assessment' })
    expect(next).toHaveTextContent(/^$/)
    expect(next).toHaveAttribute('title', 'Next: Take-home assessment')
    fireEvent.click(next)
    expect(onMove).toHaveBeenLastCalledWith(waiting.id, { stage: 'take_home_assessment' })
    fireEvent.click(screen.getByRole('button', { name: 'Move Waiting Co back to Online assessment' }))
    expect(onMove).toHaveBeenLastCalledWith(waiting.id, { stage: 'online_assessment' })
  })

  it('archives a running row as it is, without ending it first', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const onArchive = vi.fn()
    const onMove = vi.fn()
    const running = application('Paused Co', { stage: 'round_1' })

    render(
      <TableView
        applications={[running]}
        onOpen={vi.fn()}
        onArchive={onArchive} onMove={onMove}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Archive Paused Co' }))
    expect(onArchive).toHaveBeenCalledWith(running.id, true)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('ends a running row where it stands, by whichever way it ended', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const onMove = vi.fn()
    const waiting = application('Waiting Co', { stage: 'round_1' })

    render(
      <TableView
        applications={[waiting]}
        onOpen={vi.fn()}
        onArchive={vi.fn()} onMove={onMove}
        onOpenPosting={vi.fn()} onOpenStageNotes={vi.fn()} onOpenMessages={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    const end = screen.getByRole('button', { name: 'End Waiting Co' })
    expect(end).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(end)
    expect(end).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Move Waiting Co to Round 1 — Withdrawn' }))
    expect(onMove).toHaveBeenLastCalledWith(waiting.id, { outcome: 'withdrawn' })
    // Choosing closes the menu and hands focus back to what opened it.
    expect(end).toHaveAttribute('aria-expanded', 'false')
    expect(end).toHaveFocus()

    fireEvent.click(end)
    expect(screen.getByRole('button', { name: 'Move Waiting Co to Round 1 — Rejected' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move Waiting Co to Round 1 — Closed' })).toBeInTheDocument()
  })

  it('uses Auto-rejected for a rejection at Applied, and makes Accepted the ordinary step on from an offer', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const onMove = vi.fn()
    const offer = application('Offer Co', { stage: 'offer' })

    render(
      <TableView
        applications={[application('Sent Co'), offer]}
        onOpen={vi.fn()}
        onArchive={vi.fn()} onMove={onMove}
        onOpenPosting={vi.fn()} onOpenStageNotes={vi.fn()} onOpenMessages={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'End Sent Co' }))
    expect(screen.getByRole('button', { name: 'Move Sent Co to Auto-rejected' })).toBeInTheDocument()

    // The same arrow every other stage has, going to the next stage like every other one.
    fireEvent.click(screen.getByRole('button', { name: 'Move Offer Co to Accepted' }))
    expect(onMove).toHaveBeenLastCalledWith(offer.id, { stage: 'accepted' })
  })

  it('offers an ended row its way back and its way out, and says how it ended', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const onMove = vi.fn()
    const onArchive = vi.fn()
    const turnedDown = application('Turned Down', {
      stage: 'round_1', outcome: 'rejected',
      stage_history: [{ stage: 'round_1', outcome: 'rejected', at: localDate(-2) }],
    })

    render(
      <TableView
        applications={[
          application('Offer Taken', {
            stage: 'accepted', outcome: 'active',
            stage_history: [{ stage: 'accepted', outcome: 'active', at: localDate(-2) }],
          }),
          turnedDown,
        ]}
        onOpen={vi.fn()}
        onArchive={onArchive} onMove={onMove}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    // Nothing to step on to or end: both have ended.
    expect(screen.queryByRole('button', { name: /^Move Offer Taken to / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^End Turned Down/ })).not.toBeInTheDocument()

    const row = screen.getByRole('rowheader', { name: 'Turned Down' }).closest('tr')!
    expect(within(row).getByText('Rejected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reopen Turned Down at Round 1' }))
    expect(onMove).toHaveBeenLastCalledWith(turnedDown.id, { outcome: 'active' })
    fireEvent.click(screen.getByRole('button', { name: 'Archive Turned Down' }))
    expect(onArchive).toHaveBeenLastCalledWith(turnedDown.id, true)
  })

  it('offers an archived row only its way back into the current search', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const onArchive = vi.fn()
    const archived = application('Put Away Co', {
      outcome: 'rejected',
      archived_at: localDate(-1),
      stage_history: [{ stage: 'applied', outcome: 'rejected', at: localDate(-2) }],
    })

    render(
      <TableView
        applications={[archived]}
        onOpen={vi.fn()}
        onArchive={onArchive} onMove={vi.fn()}
        onOpenPosting={vi.fn()} onOpenStageNotes={vi.fn()} onOpenMessages={vi.fn()}
        onCompleteAction={vi.fn()}
      />,
    )

    expect(screen.getByText('Archived')).toBeInTheDocument()
    // Told apart from the rows around it at a glance, not only by the badge in one cell.
    expect(screen.getByRole('rowheader', { name: 'Put Away Co' }).closest('tr')).toHaveClass('table-row--archived')
    expect(screen.queryByRole('button', { name: /^Reopen/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive Put Away Co' }))
    expect(onArchive).toHaveBeenLastCalledWith(archived.id, false)
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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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
        onArchive={vi.fn()} onMove={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
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

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={vi.fn()} />)

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

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={vi.fn()} />)

    expect(screen.getByText('resume.pdf')).toBeInTheDocument()
  })

  it('resizes a column via its header handle', () => {
    const applications = [application('Alpha Labs', { role: 'Engineer' })]

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={vi.fn()} />)

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

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={vi.fn()} />)

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

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={vi.fn()} />)

    const cell = document.querySelector('[data-column="compensation"] .table-view__urgency')!
    expect(getComputedStyle(cell).whiteSpace).not.toBe('nowrap')
  })

  it('double-clicking the resize handle fits the column to its longest cell', () => {
    const applications = [
      application('Alpha Labs', { role: 'Senior Software Engineer' }),
      application('Beta Inc', { role: 'PM' }),
    ]

    render(<TableView applications={applications} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={vi.fn()} />)

    const handle = screen.getByRole('separator', { name: 'Resize Role column' })
    const roleColumn = document.querySelectorAll('col')[1] as HTMLElement

    fireEvent.doubleClick(handle)

    expect(roleColumn.style.width).toBe('196px')
  })
})

describe('StatisticsView', () => {
  function tableNamed(name: string): HTMLElement {
    return screen.getByRole('table', { name })
  }

  const passTable = () => tableNamed('How many applications got past each live stage')
  const sourcesTable = () =>
    tableNamed('Applications, replies, and progress by where the role came from')
  const ratingsTable = () =>
    tableNamed('Judgement counts and mean judged score by rating dimension')

  function rowCells(table: HTMLElement, rowHeader: string): string[] {
    const row = within(table).getByRole('rowheader', { name: rowHeader }).closest('tr')!
    return within(row).getAllByRole('cell').map((cell) => cell.textContent ?? '')
  }

  /** The card answering one question, found by the question it is named for. */
  function card(question: string): HTMLElement {
    return screen.getByRole('region', { name: question })
  }

  function answerOf(question: string): string {
    return card(question).querySelector('.question-card__answer')?.textContent ?? ''
  }

  function renderStats(
    applications: Application[],
    overrides: Partial<StatsSettings> = {},
    handlers: { onOpen?: (id: string) => void; onSettingChange?: (id: StatsSettingId, value: number) => void } = {},
  ) {
    return render(
      <StatisticsView
        applications={applications}
        onOpen={handlers.onOpen ?? vi.fn()}
        onSettingChange={handlers.onSettingChange ?? vi.fn()}
        settings={{ ...DEFAULT_STATS_SETTINGS, ...overrides }}
        today={now}
      />,
    )
  }

  /** Two rejected, one live and talking, one live and silent. */
  const searched = [
    application('Bounced Co', {
      stage: 'applied', outcome: 'rejected',
      stage_history: [
        { stage: 'applied', outcome: 'active', at: localDate(-30) },
        { stage: 'applied', outcome: 'rejected', at: localDate(-28) },
      ],
      source: 'LinkedIn',
    }),
    application('Nearly Co', {
      stage: 'screening', outcome: 'rejected',
      stage_history: [
        { stage: 'applied', outcome: 'active', at: localDate(-40) },
        { stage: 'screening', outcome: 'active', at: localDate(-30) },
        { stage: 'screening', outcome: 'rejected', at: localDate(-20) },
      ],
      source: 'LinkedIn',
    }),
    application('Talking Co', {
      stage: 'screening',
      stage_history: [
        { stage: 'applied', outcome: 'active', at: localDate(-25) },
        { stage: 'screening', outcome: 'active', at: localDate(-12) },
      ],
      source: 'Referral',
    }),
    application('Silent Co', {
      stage_history: [{ stage: 'applied', outcome: 'active', at: localDate(-20) }],
      source: 'Referral',
    }),
  ]

  it('asks the questions a search asks, most actionable first', () => {
    renderStats(searched)

    const questions = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(questions).toEqual([
      'Am I being ghosted?',
      'Where am I losing?',
      'Where do applications go?',
      'Am I keeping momentum?',
      'Is anyone answering?',
      'Which channels are worth my time?',
      'How long does it take?',
      'Is the money there?',
      'How do I judge roles?',
    ])
  })

  it('answers whether anyone is answering, leaving the silent out of the wait', () => {
    renderStats(searched)

    // Replies came after 2, 10 and 13 days. Silent Co has none and is left out rather
    // than counted as zero, which would drag the figure to 2.
    expect(answerOf('Is anyone answering?')).toBe('3 of 4 heard back. Half of them within 10 days.')
    expect(card('Is anyone answering?')).toHaveTextContent(
      '1 live application is still waiting for a first reply.',
    )
  })

  it('lists the applications that have gone quiet, at the threshold the reader set', async () => {
    const onOpen = vi.fn()
    const { unmount } = renderStats(searched)
    // Silent Co has been quiet 20 days, Talking Co 12: neither reaches the default 30.
    expect(answerOf('Am I being ghosted?')).toBe('Nothing live has gone 30 days without a stage change.')
    unmount()

    renderStats(searched, { quietDays: 15 }, { onOpen })
    expect(answerOf('Am I being ghosted?')).toBe(
      '1 live application has had no stage change for 15 days or more.',
    )
    const item = within(card('Am I being ghosted?')).getByRole('button', { name: /Silent Co · Applied/ })
    expect(item).toHaveTextContent('20 days')
    fireEvent.click(item)
    expect(onOpen).toHaveBeenCalledWith(searched[3]!.id)
  })

  it('stages each threshold on the card it changes, and edits it there', () => {
    const onSettingChange = vi.fn()
    const { unmount } = renderStats(searched, {}, { onSettingChange })

    const quiet = within(card('Am I being ghosted?')).getByRole('spinbutton', {
      name: 'Days without a stage change before an application counts as quiet',
    })
    expect(quiet).toHaveValue(30)
    // At the default there is nothing to reset to.
    expect(within(card('Am I being ghosted?')).queryByRole('button', { name: /Reset/ })).not.toBeInTheDocument()

    fireEvent.change(quiet, { target: { value: '21' } })
    expect(onSettingChange).toHaveBeenCalledWith('quietDays', 21)
    // A half-typed or out-of-range value never reaches the answers.
    onSettingChange.mockClear()
    fireEvent.change(quiet, { target: { value: '0' } })
    fireEvent.change(quiet, { target: { value: '' } })
    expect(onSettingChange).not.toHaveBeenCalled()
    unmount()

    renderStats(searched, { minSourceApplications: 2 }, { onSettingChange })
    const reset = within(card('Which channels are worth my time?')).getByRole('button', {
      name: 'Reset applications a source needs before it is compared to 3',
    })
    expect(reset).toHaveTextContent('Reset to 3')
    fireEvent.click(reset)
    expect(onSettingChange).toHaveBeenCalledWith('minSourceApplications', 3)
  })

  it('names where you lose the most only once a stage has enough decided to compare', () => {
    const { unmount } = renderStats(searched)
    expect(answerOf('Where am I losing?')).toBe(
      'Too few decided applications to say where you lose the most yet. A stage needs 5 before it\'s compared.',
    )
    // Silent Co is still at Applied and Talking Co at the screening call: neither is a
    // loss yet, so both are left out of the stage they sit in.
    expect(rowCells(passTable(), 'Applied')).toEqual(['3', '2', '1'])
    expect(rowCells(passTable(), 'Screening call')).toEqual(['1', '0', '1'])
    unmount()

    const { container } = renderStats(searched, { minStageDecided: 1 })
    expect(answerOf('Where am I losing?')).toBe(
      'You lose the most at Screening call: 1 of 1 went no further.',
    )
    // The row the answer names is the one marked in the chart.
    expect(container.querySelector('[data-bar="screening"]')).toHaveClass(
      'outcome-bars__row--emphasis',
    )
    expect(container.querySelector('[data-bar="applied"]')).not.toHaveClass(
      'outcome-bars__row--emphasis',
    )
  })

  it('draws each count as a bar whose parts add up to it', () => {
    const { container } = renderStats(searched)

    function segments(key: string): Record<string, string> {
      const bars = container.querySelectorAll(`[data-bar="${key}"] [data-segment]`)
      return Object.fromEntries(
        [...bars].map((bar) => [bar.getAttribute('data-segment'), (bar as HTMLElement).style.flexGrow]),
      )
    }
    const row = (key: string) => container.querySelector(`[data-bar="${key}"]`)!

    // Of Applied's three decided, two got past it; the one still there is not drawn.
    expect(segments('applied')).toEqual({ passed: '2', lost: '1' })
    expect(row('applied')).toHaveTextContent('1 went no further · 1 still in it')
    // Nested, not side by side: LinkedIn's two both heard back and one got further.
    expect(segments('LinkedIn')).toEqual({ advanced: '1', replied: '1' })

    // Shares, not volume: every source's bar is the full width, so rates compare by eye.
    for (const source of ['LinkedIn', 'Referral']) {
      const bar = row(source).querySelector<HTMLElement>('.outcome-bars__bar')!
      expect(bar.style.width).toBe('calc(1 * (100% - var(--chart-value)))')
    }

    // The chart and the table say the same thing, so only one of them may be read out.
    expect(container.querySelector('.outcome-bars__chart')).toHaveAttribute('aria-hidden', 'true')
  })

  it('draws every recorded move between where it left and where it landed', () => {
    const { container } = renderStats(searched)

    const moves = [...container.querySelectorAll('[data-move]')].map((path) => [
      path.getAttribute('data-move'),
      path.getAttribute('class'),
    ])
    expect(moves).toEqual([
      // A move is between a stage-and-outcome pair on each end, so a rejection lands on the
      // stage it happened at.
      ['applied:active>applied:rejected', 'stage-flow__link stage-flow__link--rest'],
      ['applied:active>screening:active', 'stage-flow__link stage-flow__link--strong'],
      [
        'screening:active>screening:rejected',
        'stage-flow__link stage-flow__link--rest',
      ],
    ])

    expect(answerOf('Where do applications go?')).toBe(
      'Of 4 recorded moves, 2 went to a later stage and 2 to a rejection.',
    )
    const table = tableNamed('Every recorded move, from the stage it left to the stage it reached')
    expect(rowCells(table, 'Screening call')).toEqual(['Screening call — Rejected', '1'])
  })

  it('compares sources only once each has enough applications, and ranks by progress', () => {
    const { unmount, container } = renderStats(searched)
    expect(answerOf('Which channels are worth my time?')).toBe(
      'No source has 3 applications yet, too few to compare.',
    )
    // Too few is drawn back and said, not dropped.
    expect(container.querySelector('[data-bar="LinkedIn"]')).toHaveClass('outcome-bars__row--quiet')
    expect(rowCells(sourcesTable(), 'LinkedIn')).toEqual(['2', '2 100%', '1 50%'])
    expect(rowCells(sourcesTable(), 'Referral')).toEqual(['2', '1 50%', '1 50%'])
    unmount()

    renderStats(searched, { minSourceApplications: 2 })
    // One past the first stage each: a tie, said as one.
    expect(answerOf('Which channels are worth my time?')).toBe(
      'LinkedIn and Referral tie for furthest, with 50% of each past the first stage.',
    )
  })

  it('names an unrecorded source rather than dropping those applications', () => {
    renderStats([
      ...searched,
      application('Nowhere Co', { stage_history: [{ stage: 'applied', outcome: 'active', at: localDate(-5) }] }),
    ])

    const row = within(sourcesTable()).getByLabelText('Not recorded').closest('tr')!
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      '1',
      '0 0%',
      '0 0%',
    ])
  })

  it('lists how long things took while there are too few for a median', () => {
    renderStats(searched)

    expect(answerOf('How long does it take?')).toBe('Your 2 rejections took 2 and 20 days.')
  })

  it('reads the money from offers, and says when there is nothing to read', () => {
    const { unmount } = renderStats(searched)
    expect(answerOf('Is the money there?')).toBe(
      'No offers yet, and no advertised pay with a target to compare it against.',
    )
    unmount()

    renderStats([
      application('Short Co', {
        stage: 'offer',
        stage_history: [{ stage: 'offer', outcome: 'active', at: localDate(-3) }],
        compensation: {
          currency: 'EUR',
          advertised: null,
          expected: { min: 100000, max: 100000 },
          offered: { min: 90000, max: 90000 },
        },
      }),
    ])
    expect(answerOf('Is the money there?')).toBe('1 offer: 1 below target.')
    expect(card('Is the money there?')).toHaveTextContent('Short CoEUR 90,00010% below target')
  })

  it('draws the scores themselves, so a mean cannot hide a dealbreaker', () => {
    const { container } = renderStats([
      application('Even Co', { ratings: ratings({ people: 4 }) }),
      application('Hidden One Co', { ratings: ratings({ people: 1 }) }),
    ])

    const people = container.querySelector('[data-scale="people"]')!
    const columns = [...people.querySelectorAll('[data-score]')].map((column) => [
      column.getAttribute('data-score'),
      column.textContent,
    ])
    expect(columns).toEqual([
      ['1', '1'],
      ['4', '1'],
    ])
    expect(people.querySelector('[data-mean]')).toHaveAttribute('data-mean', '2.5')
  })

  it('summarises how the collection was rated, per dimension', () => {
    renderStats([
      application('Even Co', { ratings: ratings({ work: 4, growth: 4, people: 4, company: 4 }) }),
      application('Hidden One Co', {
        ratings: ratings({ work: 5, growth: 5, people: 1, company: 5 }),
      }),
      application('Partly Judged Co', { ratings: ratings({ work: 3, growth: null }) }),
      application('Unrated Co'),
    ])

    // Rated, Don't know, Not rated, how many scored 1 to 5, Mean of the judged scores.
    expect(rowCells(ratingsTable(), 'Work')).toEqual(['3', '0', '1', '0', '0', '1', '1', '1', '4.00'])
    expect(rowCells(ratingsTable(), 'Growth')).toEqual(['2', '1', '1', '0', '0', '0', '1', '1', '4.50'])
    // People reads low because it was judged low, not because it went unassessed — and
    // the scores say it is one 1 dragging a 4 down, which the mean alone cannot.
    expect(rowCells(ratingsTable(), 'People')).toEqual(['2', '0', '2', '1', '0', '0', '1', '0', '2.50'])
    expect(rowCells(ratingsTable(), 'Company & product')).toEqual(['2', '0', '2', '0', '0', '0', '1', '1', '4.50'])
    expect(answerOf('How do I judge roles?')).toBe(
      '3 of 4 rated, mean preference 3.48. People scores lowest.',
    )
  })

  it('says so plainly when nothing has been rated', () => {
    renderStats([application('Unrated Co')])

    expect(answerOf('How do I judge roles?')).toBe('No application has been rated yet.')
    expect(screen.queryByText(/mean preference/)).not.toBeInTheDocument()
  })

  it('offers an empty state rather than a page of dashes when there is nothing yet', () => {
    renderStats([])

    expect(screen.getByRole('heading', { name: 'Nothing to summarise yet' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('kanbanColumnGroups', () => {
  it('draws a running lane for every stage, and an ending lane only once something ended there', () => {
    const groups = kanbanColumnGroups([
      application('Live Co'),
      application('Bounced Co', { outcome: 'rejected' }),
      application('Signed Co', { stage: 'accepted', outcome: 'active' }),
    ])

    expect(groups).toHaveLength(10)
    expect(groups.map(({ stage }) => stage)).toEqual([...STAGE_IDS])
    expect(groups[1]).toEqual({
      stage: 'applied',
      lanes: [
        { stage: 'applied', outcome: 'active' },
        { stage: 'applied', outcome: 'rejected' },
      ],
    })
    // Accepted is a column like any other, its job in the running lane.
    expect(groups[9]).toEqual({ stage: 'accepted', lanes: [{ stage: 'accepted', outcome: 'active' }] })
    expect(groups.flatMap((group) => group.lanes)).toHaveLength(11)
  })

  it('draws the one lane a filter names at every stage it admits, empty or not', () => {
    expect(kanbanColumnGroups([], ['round_1'], ['withdrawn'])).toEqual([
      { stage: 'round_1', lanes: [{ stage: 'round_1', outcome: 'withdrawn' }] },
    ])
  })

  it('leaves out a stage with nothing to show under a filter that hides its running lane', () => {
    const groups = kanbanColumnGroups(
      [application('Bounced Co', { outcome: 'rejected' })],
      undefined,
      ['rejected', 'withdrawn', 'closed'],
    )

    expect(groups).toEqual([
      { stage: 'applied', lanes: [{ stage: 'applied', outcome: 'rejected' }] },
    ])
  })
})

describe('TableView job posting', () => {
  it('offers the posting beside the prep notes on the row that has one', () => {
    const onOpenPosting = vi.fn()
    const posted = application('Marble & Finch', {
      posting: { body: '## Product Manager', captured_at: localDate(-5), source_url: null },
    })
    const bare = application('Echo Robotics')

    render(
      <TableView
        applications={[posted, bare]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onOpenPosting={onOpenPosting}
        onOpenMessages={vi.fn()}
        onCompleteAction={vi.fn()}
        onArchive={vi.fn()} onMove={vi.fn()}
      />,
    )

    // The column is the way into Prep, and Prep holds more than notes, so it is not headed
    // as notes — the same reason the sidebar stopped filing postings under prep notes.
    expect(screen.getByRole('columnheader', { name: /^Prep/ })).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Job posting for Echo Robotics' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Job posting for Marble & Finch' }))

    expect(onOpenPosting).toHaveBeenCalledWith(posted.id)
  })
})

describe('KanbanView', () => {
  it('offers the job posting from the card that has one, and not from one that has not', () => {
    const onOpenPosting = vi.fn()
    const posted = application('Marble & Finch', {
      posting: {
        body: '## Product Manager',
        captured_at: localDate(-5),
        source_url: null,
      },
    })
    const bare = application('Echo Robotics')

    render(
      <KanbanView
        applications={[posted, bare]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onOpenPosting={onOpenPosting}
        onOpenMessages={vi.fn()}
        onCompleteAction={vi.fn()}
        onArchive={vi.fn()} onMove={vi.fn()}
      />,
    )

    // Only where there is one to open. A control that opened an empty pane would be
    // offering something that is not there.
    expect(screen.queryByRole('button', { name: 'Job posting for Echo Robotics' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Job posting for Marble & Finch' }))

    expect(onOpenPosting).toHaveBeenCalledWith(posted.id)
  })

  it('opens a card\'s messages on the stage the card is in', () => {
    const onOpenMessages = vi.fn()
    const record = application('Mailbox Co', {
      stage: 'round_1',
      correspondence: [
        {
          id: 'm1',
          stage: 'round_1',
          direction: 'received',
          subject: 'Next steps',
          channel: 'Email',
          who: 'Dana Okafor',
          body: 'Could you send me some windows?',
          at: '2026-08-10T09:00:00.000Z',
          created_at: '2026-08-11T09:00:00.000Z',
          updated_at: '2026-08-11T09:00:00.000Z',
        },
      ],
    })

    render(
      <KanbanView
        applications={[record]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onOpenPosting={vi.fn()}
        onOpenMessages={onOpenMessages}
        onCompleteAction={vi.fn()}
        onArchive={vi.fn()} onMove={vi.fn()}
      />,
    )

    // The count is on the button, so a card says whether there is anything to open.
    const button = screen.getByRole('button', { name: 'Messages for Mailbox Co, 1 message' })
    expect(button).toHaveTextContent('Messages · 1')

    fireEvent.click(button)
    // The card's own stage: that is the conversation most likely to be live.
    expect(onOpenMessages).toHaveBeenCalledWith(record.id, 'round_1')
  })

  it('offers to log the first message on a card that has none', () => {
    render(
      <KanbanView
        applications={[application('Quiet Co')]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()}
        onOpenPosting={vi.fn()}
        onOpenMessages={vi.fn()}
        onCompleteAction={vi.fn()}
        onArchive={vi.fn()} onMove={vi.fn()}
      />,
    )

    const button = screen.getByRole('button', { name: 'Log a message for Quiet Co' })
    expect(button).toHaveTextContent('Messages')
    expect(button).not.toHaveTextContent('·')
  })

  it('supports opening and moving a card through its accessible controls', () => {
    const onOpen = vi.fn()
    const onMove = vi.fn()
    const record = application('Keyboard Movers')

    render(<KanbanView applications={[record]} onOpen={onOpen} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={onMove} />)

    // One running lane per stage; nothing has ended, so no ending lane is drawn.
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(10)
    fireEvent.click(screen.getByRole('button', { name: /Open Keyboard Movers/ }))
    expect(onOpen).toHaveBeenCalledWith(record.id)

    // The select lists stages only, so an ending is not one of its options.
    const select = screen.getByRole('combobox', { name: 'Move Keyboard Movers to stage' })
    expect(within(select).queryByRole('option', { name: /Rejected/ })).not.toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'offer' } })
    expect(onMove).toHaveBeenCalledWith(record.id, { stage: 'offer' })
  })

  it('shows the soonest invite still ahead and skips cancelled or past ones', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const record = application('Invite Board', {
      stage_events: [
        stageEvent({ summary: 'Already happened', starts_at: localDate(-3) }),
        stageEvent({ summary: 'Called off', starts_at: localDate(1), cancelled: true }),
        stageEvent({ summary: 'Research panel', starts_at: localDate(2) }),
        stageEvent({ summary: 'Leadership chat', starts_at: localDate(6) }),
      ],
    })

    render(<KanbanView applications={[record]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={vi.fn()} />)

    const card = screen.getByText('Invite Board').closest('article')
    expect(within(card!).getByText(/Research panel/)).toBeInTheDocument()
    expect(within(card!).queryByText(/Already happened/)).not.toBeInTheDocument()
    expect(within(card!).queryByText(/Called off/)).not.toBeInTheDocument()
    expect(within(card!).queryByText(/Leadership chat/)).not.toBeInTheDocument()
  })

  it('moves a dragged card to another stage, still running', () => {
    const onMove = vi.fn()
    const record = application('Drag & Drop Co')
    const values = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? '',
    }

    render(<KanbanView applications={[record]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={onMove} />)

    const card = screen.getByText('Drag & Drop Co').closest('article')
    const destination = screen.getByRole('heading', { level: 3, name: 'Offer' }).closest('section')
    expect(card).not.toBeNull()
    expect(destination).not.toBeNull()

    fireEvent.dragStart(card!, { dataTransfer })
    fireEvent.dragOver(destination!, { dataTransfer })
    fireEvent.drop(destination!, { dataTransfer })

    expect(onMove).toHaveBeenCalledWith(record.id, { stage: 'offer', outcome: 'active' })
  })

  it('moves a dragged card onto an ending lane, which is the move End makes', () => {
    const onMove = vi.fn()
    const record = application('Nested Drop Co')
    const bounced = application('Already Bounced Co', { outcome: 'rejected' })
    const values = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? '',
    }

    render(<KanbanView applications={[record, bounced]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={onMove} />)

    const card = screen.getByText('Nested Drop Co').closest('article')
    const destination = screen
      .getByRole('heading', { level: 3, name: 'Auto-rejected' })
      .closest('section')
    expect(card).not.toBeNull()
    expect(destination).not.toBeNull()

    fireEvent.dragStart(card!, { dataTransfer })
    fireEvent.dragOver(destination!, { dataTransfer })
    fireEvent.drop(destination!, { dataTransfer })

    expect(onMove).toHaveBeenCalledWith(record.id, { stage: 'applied', outcome: 'rejected' })
  })

  it('reacts to a move by how it went, however the card was moved', () => {
    vi.useFakeTimers()
    const values = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? '',
    }
    const props = {
      onOpen: vi.fn(), onOpenStageNotes: vi.fn(), onOpenPosting: vi.fn(), onOpenMessages: vi.fn(),
      onCompleteAction: vi.fn(), onArchive: vi.fn(), onMove: vi.fn(),
    }
    const card = () => screen.getByText('Feedback Co').closest('article')!
    const toast = () => document.querySelector('.move-toast-region')!
    const settle = () => act(() => vi.advanceTimersByTime(5000))

    let record = application('Feedback Co', { stage: 'round_1' })
    const { rerender } = render(<KanbanView applications={[record]} {...props} />)
    const show = (change: Partial<Application>) => {
      record = { ...record, ...change }
      rerender(<KanbanView applications={[record]} {...props} />)
    }

    // On by the arrow: a quick pop and a cheer.
    fireEvent.click(screen.getByRole('button', { name: 'Move Feedback Co to Round 2' }))
    show({ stage: 'round_2' })
    expect(card()).toHaveClass('application-card--landed')
    expect(toast()).toHaveTextContent('Keep it up!')
    // Gone on its own, not left as a state the card sits in.
    settle()
    expect(card()).not.toHaveClass('application-card--landed')
    expect(toast()).toBeEmptyDOMElement()

    // Back is most often a correction: it moves and says nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Move Feedback Co back to Round 1' }))
    show({ stage: 'round_1' })
    expect(card()).not.toHaveClass('application-card--landed')
    expect(toast()).toBeEmptyDOMElement()

    // The stage select is a move like any other.
    fireEvent.change(screen.getByRole('combobox', { name: 'Move Feedback Co to stage' }), {
      target: { value: 'offer' },
    })
    show({ stage: 'offer' })
    expect(toast()).not.toBeEmptyDOMElement()
    settle()

    // Dropped on Accepted: confetti, the lane lit, and congratulations.
    fireEvent.dragStart(card(), { dataTransfer })
    const accepted = screen.getByRole('heading', { level: 3, name: 'Accepted' }).closest('section')!
    fireEvent.drop(accepted, { dataTransfer })
    show({ stage: 'accepted' })
    expect(card().querySelector('.confetti')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('heading', { level: 3, name: 'Accepted' }).closest('section'))
      .toHaveClass('kanban-lane--celebrate')
    expect(toast()).toHaveTextContent('Congratulations')
    settle()
    expect(card().querySelector('.confetti')).toBeNull()

    // Ended from the End menu: no fanfare on the card, and a word of encouragement.
    show({ stage: 'round_1' })
    fireEvent.click(screen.getByRole('button', { name: /^End Feedback Co/ }))
    fireEvent.click(screen.getByRole('button', { name: /Move Feedback Co to Round 1 — Rejected/ }))
    show({ outcome: 'rejected' })
    expect(card()).not.toHaveClass('application-card--landed')
    expect(toast().querySelector('.move-toast--ended')).not.toBeNull()
    expect(toast()).toHaveTextContent('Sorry, that one stings.')

    vi.useRealTimers()
  })

  it('marks an archived card apart from the ones beside it', () => {
    const archived = application('Put Away Co', { outcome: 'rejected', archived_at: localDate(-1) })
    const current = application('Current Co', { outcome: 'rejected' })

    render(<KanbanView applications={[archived, current]} onOpen={vi.fn()} onOpenPosting={vi.fn()} onOpenStageNotes={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={vi.fn()} />)

    const card = (company: string) => screen.getByText(company).closest('article')!
    expect(card('Put Away Co')).toHaveClass('application-card--archived')
    expect(within(card('Put Away Co')).getByText('Archived')).toBeInTheDocument()
    expect(card('Current Co')).not.toHaveClass('application-card--archived')
    expect(within(card('Current Co')).queryByText('Archived')).not.toBeInTheDocument()
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

    render(<KanbanView applications={[record]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={vi.fn()} />)

    expect(screen.getByLabelText('Attachments')).toHaveTextContent('resume.pdf')
  })

  it('omits attachment filenames when there are no attachments', () => {
    render(<KanbanView applications={[application('No Files Co')]} onOpen={vi.fn()} onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()} onCompleteAction={vi.fn()} onArchive={vi.fn()} onMove={vi.fn()} />)

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
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
        onCompleteAction={vi.fn()}
        onArchive={vi.fn()} onMove={vi.fn()}
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
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
        onCompleteAction={onCompleteAction}
        onArchive={vi.fn()} onMove={vi.fn()}
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

    const stage: StageId = 'applied'
    render(
      <KanbanView
        applications={[
          application('Fresh Co', { stage_history: [{ stage, outcome: 'active', at: localDate(-29) }] }),
          application('Quiet Co', { stage_history: [{ stage, outcome: 'active', at: localDate(-30) }] }),
        ]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
        onCompleteAction={vi.fn()}
        onArchive={vi.fn()} onMove={vi.fn()}
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

    const stage: StageId = 'applied'
    render(
      <KanbanView
        applications={[
          application('Annotated Co', {
            stage_history: [{ stage, outcome: 'active', at: localDate(-40) }],
            updated_at: localDate(0),
          }),
        ]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
        onCompleteAction={vi.fn()}
        onArchive={vi.fn()} onMove={vi.fn()}
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
            stage: 'applied', outcome: 'rejected',
            stage_history: [{ stage: 'applied', outcome: 'rejected', at: localDate(-60) }],
            updated_at: localDate(-60),
          }),
        ]}
        onOpen={vi.fn()}
        onOpenStageNotes={vi.fn()} onOpenPosting={vi.fn()} onOpenMessages={vi.fn()}
        onCompleteAction={vi.fn()}
        onArchive={vi.fn()} onMove={vi.fn()}
      />,
    )

    const card = screen.getByText('Turned Down Co').closest('article')
    expect(card).not.toHaveClass('application-card--idle')
    expect(within(card!).queryByText(/^Idle /)).not.toBeInTheDocument()
  })
})
