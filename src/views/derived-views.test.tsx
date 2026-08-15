import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Application, StateId } from '../domain'
import { CalendarView } from './CalendarView'
import { KanbanView } from './KanbanView'
import { NextActionsView } from './NextActionsView'
import { StaleView } from './StaleView'
import { StatisticsView } from './StatisticsView'
import { TableView } from './TableView'

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
    state,
    state_history: [{ state, at: localDate(-40) }],
    next_action: null,
    next_action_at: null,
    notes: null,
    attachments: [],
    created_at: localDate(-40),
    updated_at: localDate(-1),
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('NextActionsView', () => {
  it('groups dated and undated actions and sorts dated actions chronologically', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const onOpen = vi.fn()
    const applications = [
      application('Later & Co', {
        next_action: 'Prepare questions',
        next_action_at: localDate(4),
      }),
      application('Oldest Follow-up', {
        next_action: 'Email recruiter',
        next_action_at: localDate(-5),
      }),
      application('Recent Follow-up', {
        next_action: 'Share references',
        next_action_at: localDate(-1),
      }),
      application('Today Labs', {
        next_action: 'Join interview',
        next_action_at: localDate(0),
      }),
      application('No Date Studio', { next_action: 'Review portfolio' }),
      application('No Action Inc'),
    ]

    render(<NextActionsView applications={applications} onOpen={onOpen} />)

    const overdue = screen.getByRole('region', { name: 'Overdue' })
    const upcoming = screen.getByRole('region', { name: 'Upcoming' })
    const unscheduled = screen.getByRole('region', { name: 'Unscheduled' })

    expect(within(overdue).getAllByRole('button')).toHaveLength(2)
    expect(within(overdue).getAllByRole('button').map((button) => button.textContent)).toEqual([
      expect.stringContaining('Oldest Follow-up'),
      expect.stringContaining('Recent Follow-up'),
    ])
    expect(within(upcoming).getAllByRole('button').map((button) => button.textContent)).toEqual([
      expect.stringContaining('Today Labs'),
      expect.stringContaining('Later & Co'),
    ])
    expect(within(unscheduled).getByText(/No Date Studio/)).toBeInTheDocument()
    expect(screen.queryByText('No Action Inc')).not.toBeInTheDocument()

    fireEvent.click(within(unscheduled).getByRole('button'))
    expect(onOpen).toHaveBeenCalledWith(applications[4].id)
  })

  it('shows a helpful empty state when no application has an action', () => {
    render(<NextActionsView applications={[application('Quiet Company')]} onOpen={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'No next actions yet' })).toBeInTheDocument()
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

    render(<StaleView applications={applications} onOpen={vi.fn()} />)

    expect(screen.getByRole('radio', { name: '14 days' })).toBeChecked()
    expect(screen.queryByText('Eight Days')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      expect.stringContaining('Thirty-one Days'),
      expect.stringContaining('Fourteen Days'),
    ])

    fireEvent.click(screen.getByRole('radio', { name: '7 days' }))
    expect(screen.getByText('Eight Days')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: '30 days' }))
    expect(screen.queryByText('Fourteen Days')).not.toBeInTheDocument()
    expect(screen.getByText('Thirty-one Days')).toBeInTheDocument()
  })
})

describe('CalendarView', () => {
  it('exposes one weekday header row and six week rows in its accessible grid', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    render(<CalendarView applications={[]} onOpen={vi.fn()} />)

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
        onOpen={onOpen}
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

  it('moves between months and returns to the current month', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    render(<CalendarView applications={[]} onOpen={vi.fn()} />)

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
  it('sorts, filters, opens, and moves an application without changing the data', () => {
    const onOpen = vi.fn()
    const onMove = vi.fn()
    const applications = [
      application('Zebra Works', { updated_at: localDate(-3) }),
      application('Alpha Labs', {
        state: 'accepted',
        state_history: [{ state: 'accepted', at: localDate(-2) }],
        updated_at: localDate(-2),
      }),
      application('Middle Studio', { updated_at: localDate(-1) }),
    ]

    render(
      <TableView applications={applications} onOpen={onOpen} onMove={onMove} />,
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

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter table' }), {
      target: { value: 'Accepted' },
    })
    expect(screen.getByText('1 shown')).toBeInTheDocument()
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Alpha Labs'])

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Move Alpha Labs to state' }),
      { target: { value: 'offer' } },
    )
    expect(onMove).toHaveBeenCalledWith(applications[1].id, 'offer')

    fireEvent.click(within(screen.getByRole('rowheader')).getByRole('button'))
    expect(onOpen).toHaveBeenCalledWith(applications[1].id)
    expect(applications).toHaveLength(3)
  })

  it('shows attachment filenames and filters rows by filename', () => {
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

    render(<TableView applications={applications} onOpen={vi.fn()} onMove={vi.fn()} />)

    expect(screen.getByText('resume.pdf')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter table' }), {
      target: { value: 'resume.pdf' },
    })
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Resume Ready'])
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

describe('KanbanView', () => {
  it('supports opening and moving a card through its accessible controls', () => {
    const onOpen = vi.fn()
    const onMove = vi.fn()
    const record = application('Keyboard Movers')

    render(<KanbanView applications={[record]} onOpen={onOpen} onMove={onMove} />)

    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(19)
    fireEvent.click(screen.getByRole('button', { name: /Open Keyboard Movers/ }))
    expect(onOpen).toHaveBeenCalledWith(record.id)

    fireEvent.change(screen.getByRole('combobox', { name: 'Move Keyboard Movers to state' }), {
      target: { value: 'accepted' },
    })
    expect(onMove).toHaveBeenCalledWith(record.id, 'accepted')
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

    render(<KanbanView applications={[record]} onOpen={vi.fn()} onMove={onMove} />)

    const card = screen.getByText('Drag & Drop Co').closest('article')
    const destination = screen.getByRole('heading', { level: 3, name: 'Accepted' }).closest('section')
    expect(card).not.toBeNull()
    expect(destination).not.toBeNull()

    fireEvent.dragStart(card!, { dataTransfer })
    fireEvent.dragOver(destination!, { dataTransfer })
    fireEvent.drop(destination!, { dataTransfer })

    expect(onMove).toHaveBeenCalledWith(record.id, 'accepted')
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

    render(<KanbanView applications={[record]} onOpen={vi.fn()} onMove={vi.fn()} />)

    expect(screen.getByLabelText('Attachments')).toHaveTextContent('resume.pdf')
  })

  it('omits attachment filenames when there are no attachments', () => {
    render(<KanbanView applications={[application('No Files Co')]} onOpen={vi.fn()} onMove={vi.fn()} />)

    expect(screen.queryByLabelText('Attachments')).not.toBeInTheDocument()
  })
})
