/**
 * A log of long emails is unreadable open and useless folded, unless a folded row says what
 * it is hiding. `collapseInitially` closes the records and the preview on each row is what
 * makes that readable rather than merely short.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { MarkdownNotes } from './MarkdownNotes'
import { correspondenceMarkdown } from './correspondence'

const day = (at: string) => at.slice(0, 10)
const time = (at: string) => at.slice(11, 16)

const LONG = [
  'Apologies for the short notice — we need to move the leadership interview to Friday.',
  '',
  'Ravi is still joining, and I have asked Sam to sit in as well.',
  '',
  '> On Tue, you asked what the next loop would look like.',
].join('\n')

const message = (overrides: Record<string, unknown> = {}) => ({
  direction: 'received' as const,
  channel: 'Email',
  who: 'Priya Raman',
  body: LONG,
  at: '2026-08-10T09:14:00.000Z',
  ...overrides,
})

const source = (entries = [message()]) => correspondenceMarkdown(entries, day, time)

describe('a log that starts folded', () => {
  it('shows each message as one row, with a line of what it holds', () => {
    render(<MarkdownNotes collapseInitially="entries" label="Log" source={source()} />)

    // The header is there, and so is the opening of the message — but not the whole thing.
    expect(screen.getByText(/Priya Raman/)).toBeInTheDocument()
    expect(screen.getByText(/Apologies for the short notice/)).toBeInTheDocument()
    expect(screen.queryByText(/Ravi is still joining/)).not.toBeInTheDocument()
  })

  it('leaves the day heading open, so the rows under it are reachable', () => {
    render(<MarkdownNotes collapseInitially="entries" label="Log" source={source()} />)

    expect(screen.getByRole('heading', { name: '2026-08-10' })).toBeInTheDocument()
    expect(screen.getByText(/Priya Raman/)).toBeInTheDocument()
  })

  it('opens a message to its whole text, quoted chain and all', async () => {
    const user = userEvent.setup()
    render(<MarkdownNotes collapseInitially="entries" label="Log" source={source()} />)

    await user.click(screen.getAllByRole('button', { expanded: false })[0]!)

    expect(screen.getByText(/Ravi is still joining/)).toBeInTheDocument()
    // The quoted reply is a fold of its own and stays shut until asked for: in a log holding
    // both sides it is the message above, quoted back.
    const quote = screen.getByRole('button', { name: /^Quote:/ })
    expect(quote).toHaveAttribute('aria-expanded', 'false')

    await user.click(quote)
    expect(screen.getByText(/what the next loop would look like/)).toBeInTheDocument()
  })

  it('opens flat when nothing asks it to fold, which is how a written note reads', () => {
    render(<MarkdownNotes label="Note" source={source()} />)

    expect(screen.getByText(/Ravi is still joining/)).toBeInTheDocument()
  })

  it('keeps what the reader opened open when another message arrives', async () => {
    const user = userEvent.setup()
    const first = message({ body: 'The first message.\n\nWith a second paragraph.' })
    const { rerender } = render(
      <MarkdownNotes collapseInitially="entries" label="Log" source={source([first])} />,
    )

    await user.click(screen.getAllByRole('button', { expanded: false })[0]!)
    expect(screen.getByText(/With a second paragraph/)).toBeInTheDocument()

    // A message logged while the panel is open must not slam shut what is being read, and
    // must itself arrive closed like the rest.
    const second = message({ at: '2026-08-10T17:02:00.000Z', body: 'A later message.\n\nAnd more.' })
    rerender(
      <MarkdownNotes collapseInitially="entries" label="Log" source={source([first, second])} />,
    )

    expect(screen.getByText(/With a second paragraph/)).toBeInTheDocument()
    // Asserted on the fold rather than on the text: a closed row still shows a preview of
    // what it holds, so the words are on screen either way.
    const rows = screen.getAllByRole('button', { name: /sub-points$/ })
    expect(rows[0]).toHaveAttribute('aria-expanded', 'true')
    expect(rows.at(-1)).toHaveAttribute('aria-expanded', 'false')
  })

  it('previews a folded row without repeating it when the row is open', async () => {
    const user = userEvent.setup()
    render(<MarkdownNotes collapseInitially="entries" label="Log" source={source()} />)

    const row = screen.getAllByRole('button', { expanded: false })[0]!.closest('li')!
    expect(within(row).getAllByText(/Apologies for the short notice/)).toHaveLength(1)

    await user.click(within(row).getAllByRole('button')[0]!)
    expect(within(row).getAllByText(/Apologies for the short notice/)).toHaveLength(1)
  })

  it('folds the records when told to fold all, and leaves the days standing', async () => {
    const user = userEvent.setup()
    render(<MarkdownNotes collapseInitially="entries" label="Log" source={source()} />)

    await user.click(screen.getByRole('button', { name: 'Expand all points in Log' }))
    expect(screen.getByText(/Ravi is still joining/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Collapse all points in Log' }))
    expect(screen.queryByText(/Ravi is still joining/)).not.toBeInTheDocument()
    // The day is the log's structure, not its content: folding it away would leave a date
    // and nothing to read or scan under it.
    expect(screen.getByRole('heading', { name: '2026-08-10' })).toBeInTheDocument()
    expect(screen.getByText(/Priya Raman/)).toBeInTheDocument()
  })

  it('counts every fold when the note is one, so the days go with the points', async () => {
    const user = userEvent.setup()
    render(<MarkdownNotes label="Note" source={source()} />)

    await user.click(screen.getByRole('button', { name: 'Collapse all points in Note' }))

    // A written note folds to a bare outline, which is the whole use of the control there.
    expect(screen.getByRole('heading', { name: '2026-08-10' })).toBeInTheDocument()
    expect(screen.queryByText(/Priya Raman/)).not.toBeInTheDocument()
  })
})
