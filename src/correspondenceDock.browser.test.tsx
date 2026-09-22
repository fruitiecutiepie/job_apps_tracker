/**
 * What only a browser can answer about a message in the prep notes dock.
 *
 * The jsdom suite already proves the right Markdown comes out of `correspondenceMarkdown`
 * and that the parser keeps a pasted email inside one bullet. What it cannot say is whether
 * any of that survives as layout — jsdom has no layout at all, every box measures zero, and
 * it drops a shorthand carrying a `var()`, which is most of this stylesheet. So "the
 * paragraphs of a pasted email are separated and indented under their bullet", "a long
 * message folds away behind its header line", and "two open dock sections scroll inside
 * their caps instead of pushing the note off the top of the pane" are all unanswerable
 * there, and they are the whole reason the record renders the way it does.
 *
 * Mounted through the shared harness with stub callbacks, like the rest of this suite:
 * nothing here loads or stores a note.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'

import type { Application, CorrespondenceEntry } from './domain'
import { WIDE, fixtureApplications, renderPanel } from './test/panelHarness'

/** A real rejection note's shape: paragraphs, a quoted reply, and a signature. */
const PASTED = [
  'Thanks for making the time on Thursday, and apologies for the slow reply.',
  '',
  'The panel was consistent that your systems work was the strongest they had seen this',
  'round. Where they landed was on scale — the other candidate had run a similar programme',
  'across three business units.',
  '',
  '> On Tue, you asked what the next loop would look like.',
  '> It would have been two more conversations.',
  '',
  'Please do stay in touch.',
  '',
  'Priya',
].join('\n')

const message = (overrides: Partial<CorrespondenceEntry> = {}): CorrespondenceEntry => ({
  id: '018f0000-0000-7001-8000-000000000001',
  state: 'interview_2',
  direction: 'received',
  subject: 'After Thursday — next steps',
  channel: 'Email',
  who: 'Priya Raman',
  body: PASTED,
  at: '2026-08-12T08:00:00.000Z',
  created_at: '2026-08-13T02:00:00.000Z',
  updated_at: '2026-08-13T02:00:00.000Z',
  ...overrides,
})

/** Halcyon Maps is the fixture's Interview 2 application, which is the pane that opens. */
function withMessages(entries: CorrespondenceEntry[]): Application[] {
  return fixtureApplications().map((application) =>
    application.company === 'Halcyon Maps'
      ? { ...application, correspondence: entries }
      : application,
  )
}

const DOCK_LABEL = 'Halcyon Maps · Interview 2'

async function openCorrespondence() {
  await userEvent.click(
    screen.getByRole('button', { name: `Show the correspondence in ${DOCK_LABEL}` }),
  )
}

const messagesLog = () =>
  document.querySelector<HTMLElement>('.stage-note__log--messages')!

const box = (element: Element) => element.getBoundingClientRect()

describe('a message in the dock, in a real browser', () => {
  beforeEach(async () => {
    // Explicit per test: `page.viewport` outlives the test that called it.
    await page.viewport(WIDE.width, WIDE.height)
  })

  it('starts as one folded row saying what it holds, and opens to the whole message', async () => {
    renderPanel(withMessages([message()]))
    await openCorrespondence()

    const item = messagesLog().querySelector('li')!
    const folded = box(item).height

    // Folded, the row carries the header and a line of the message — enough to decide
    // whether to open it, which a bare "9:14 am Priya Raman" would not be.
    expect(within(item).getByText(/Priya Raman/)).toBeInTheDocument()
    expect(within(item).getByText(/Thanks for making the time/)).toBeInTheDocument()
    expect(within(item).queryByText(/stay in touch/)).not.toBeInTheDocument()

    await userEvent.click(within(item).getAllByRole('button')[0]!)

    expect(box(item).height).toBeGreaterThan(folded * 2)
    expect(within(item).getByText(/stay in touch/)).toBeInTheDocument()
  })

  it('keeps a pasted email as separate paragraphs, indented under its own bullet', async () => {
    renderPanel(withMessages([message()]))
    await openCorrespondence()

    const log = messagesLog()
    const item = log.querySelector('li')!
    await userEvent.click(within(item).getAllByRole('button')[0]!)
    const paragraphs = [...item.querySelectorAll('p')]

    // Three paragraphs and a signature, not one run-on block: the blank lines a person
    // typed are paragraph breaks, and `capturedMarkdown`'s rule would have dropped them.
    expect(paragraphs.length).toBeGreaterThanOrEqual(3)
    expect(within(item).getByText(/stay in touch/)).toBeInTheDocument()
    // The quoted reply is still a quote rather than a line beginning with a chevron.
    expect(item.querySelector('blockquote')).not.toBeNull()

    // Stacked down the page, each below the last, rather than collapsed onto one line.
    const tops = paragraphs.map((paragraph) => box(paragraph).top)
    expect([...tops].sort((left, right) => left - right)).toEqual(tops)
    expect(box(paragraphs[1]!).top).toBeGreaterThan(box(paragraphs[0]!).bottom - 1)

    // Indented past both the bullet it hangs under and the day heading above it, which is
    // what says the block belongs to this message rather than to the day. Measured against
    // those two rather than against the stamp: a code span carries its own padding, so
    // lining up with its box would be measuring the span and not the indent.
    const heading = log.querySelector('.markdown__heading')!
    expect(box(paragraphs[0]!).left).toBeGreaterThan(box(item).left)
    expect(box(paragraphs[0]!).left).toBeGreaterThan(box(heading).left)
  })

  it('gives the messages the whole pane to be read in, and hands it back', async () => {
    renderPanel(withMessages([message()]))
    await openCorrespondence()

    const note = document.querySelector<HTMLElement>('.stage-note__body')!
    const strip = box(messagesLog()).height
    expect(box(note).height).toBeGreaterThan(100)

    await userEvent.click(
      screen.getByRole('button', { name: `Read the correspondence in ${DOCK_LABEL}` }),
    )

    // The note is out of the way rather than squeezed, and the log has what it was using.
    expect(note).not.toBeVisible()
    expect(box(messagesLog()).height).toBeGreaterThan(strip * 2)
    // The dock takes the card rather than the 70% the strip is capped at. Measured on the
    // dock against its card, because that is what the cap is expressed against — and the two
    // dock selectors carry the same specificity, so this is really asserting their order.
    const card = box(document.querySelector('.stage-note')!)
    const dock = box(document.querySelector('.stage-note__dock')!)
    expect(dock.height).toBeGreaterThan(card.height * 0.8)
    expect(dock.bottom).toBeLessThanOrEqual(card.bottom + 1)

    // Reading them opens them, so a whole email reads down the column straight away rather
    // than through a window, and without a second press per message.
    const item = messagesLog().querySelector('li')!
    expect(box(item).height).toBeLessThanOrEqual(box(messagesLog()).height + 1)
    expect(within(item).getByText(/stay in touch/)).toBeInTheDocument()
    // Quoted chains open with everything else. Read reaches exactly as far as Expand all,
    // so there is one rule for what a bulk open means rather than two.
    expect(within(item).getByRole('button', { name: /^Quote:/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(within(item).getByText(/It would have been two more conversations/)).toBeVisible()

    await userEvent.click(
      screen.getByRole('button', { name: `Show the prep note in ${DOCK_LABEL}` }),
    )
    expect(note).toBeVisible()
    expect(box(note).height).toBeGreaterThan(100)
  })

  it('offers nothing to read when a stage holds no messages', async () => {
    renderPanel(withMessages([]))
    await openCorrespondence()

    expect(
      screen.queryByRole('button', { name: `Read the correspondence in ${DOCK_LABEL}` }),
    ).not.toBeInTheDocument()
  })

  it('leaves the quoted chain shut when one message is opened by its own chevron', async () => {
    renderPanel(withMessages([message()]))
    await openCorrespondence()

    const item = messagesLog().querySelector('li')!
    await userEvent.click(within(item).getAllByRole('button')[0]!)

    // In a log that keeps both sides, the quoted chain is the message above, quoted back —
    // so opening a message must not unroll the whole thread underneath it.
    const quote = within(item).getByRole('button', { name: /^Quote:/ })
    expect(quote).toHaveAttribute('aria-expanded', 'false')
    expect(within(item).queryByText(/It would have been two more conversations/)).not.toBeInTheDocument()
  })

  it('scrolls inside its own cap rather than pushing the note off the pane', async () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      message({
        id: `018f0000-0000-7001-8000-${String(index + 1).padStart(12, '0')}`,
        at: `2026-08-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`,
      }),
    )
    renderPanel(withMessages(many))

    const noteBefore = box(document.querySelector('.stage-note__body')!)
    await openCorrespondence()

    const log = messagesLog()
    // Capped and scrollable, not as tall as its content.
    expect(log.scrollHeight).toBeGreaterThan(log.clientHeight + 10)
    expect(box(log).height).toBeLessThan(WIDE.height / 2)

    // The note above it is shorter for sharing the pane, but still on screen and readable
    // rather than squeezed to nothing — which is what `min-height: 0` on both logs buys.
    const noteAfter = box(document.querySelector('.stage-note__body')!)
    expect(noteAfter.height).toBeLessThan(noteBefore.height)
    expect(noteAfter.height).toBeGreaterThan(100)
  })

  it('stacks both dock sections inside the pane when each is open', async () => {
    renderPanel(withMessages([message()]))
    await openCorrespondence()
    await userEvent.click(
      screen.getByRole('button', { name: `Show what they said in ${DOCK_LABEL}` }),
    )

    const pane = box(document.querySelector('.panel__group')!)
    const messages = box(messagesLog())
    const captures = box(document.querySelector('[role="log"]')!)

    // Correspondence above captures, which is the order the find numbers them in.
    expect(messages.top).toBeLessThan(captures.top)
    // Both inside the pane: the dock's own cap holds the pair.
    expect(messages.top).toBeGreaterThanOrEqual(pane.top - 1)
    expect(captures.bottom).toBeLessThanOrEqual(pane.bottom + 1)
  })
})
