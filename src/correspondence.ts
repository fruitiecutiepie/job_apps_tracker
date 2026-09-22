/*
 * The message rows behind the editor's correspondence fields: how a stored message becomes an
 * editable row, and how rows become drafts the domain can take. The shape mirrors `invites.ts`,
 * including keeping the `datetime-local` conversion here rather than in the component.
 */
import type { Application, CorrespondenceDirection, CorrespondenceDraft, StateId } from './domain'
import { fromDateTimeInput, toDateTimeInput } from './dateInput'
import { correspondenceSender, preview } from './markdown'
import { formatShortDate, formatTimeOfDay } from './views/viewUtils'

/** One message as the editor holds it: local wall-time strings, not timestamps. */
export interface CorrespondenceRow {
  id: string
  state: StateId
  direction: CorrespondenceDirection
  subject: string
  channel: string
  who: string
  body: string
  /** When the message was sent, as local wall time. */
  at: string
}

/**
 * Newest first, which is the reverse of how the domain stores them. What arrived last is what
 * you are most likely to be checking, and it is what you are about to file beside — the same
 * reading the completed actions section takes. Because display order and stored order differ,
 * every update here is keyed by row id rather than by position.
 */
export function correspondenceRowsFor(application: Application | null): CorrespondenceRow[] {
  return (application?.correspondence ?? [])
    .map((entry) => ({
      id: entry.id,
      state: entry.state,
      direction: entry.direction,
      subject: entry.subject ?? '',
      channel: entry.channel ?? '',
      who: entry.who ?? '',
      body: entry.body,
      at: toDateTimeInput(entry.at),
    }))
    .reverse()
}

/**
 * Whether a row opens a thread rather than continuing the one above it. A thread is a subject
 * shared inside a stage, so a run breaks when either changes — two conversations that happen
 * to share a subject in different stages are not the same conversation.
 *
 * Read off neighbours rather than by collecting groups, so the rows stay one flat list: their
 * numbering is their position in it, and a message's name should not move because the
 * message above it was given a subject.
 */
export function opensThread(rows: CorrespondenceRow[], index: number): boolean {
  const subject = rows[index]?.subject.trim()
  if (!subject) return false
  const previous = rows[index - 1]
  return !previous || previous.subject.trim() !== subject || previous.state !== rows[index]!.state
}

/**
 * A row to add to a thread, taking everything that makes it that thread: the subject, the
 * stage it is filed against, and who it is with. Unlike the generic new row it files against
 * the **thread's** stage rather than the application's current one — a message in a
 * conversation belongs where that conversation is, and a shared subject in a different stage
 * is a different thread by the rule the grouping already keeps.
 *
 * The direction does not come across, for the reason it never does: a reply follows a
 * message, and which way the next one goes is a guess either way. It is one press.
 */
export function newThreadRow(source: CorrespondenceRow, id: string): CorrespondenceRow {
  return {
    id,
    state: source.state,
    direction: 'received',
    subject: source.subject,
    channel: source.channel,
    who: source.who,
    body: '',
    at: '',
  }
}

/**
 * A row to start filing the next message into, carrying forward who it is with and how it
 * arrived. A hiring conversation is one recruiter on one channel far more often than not, so
 * re-typing both for every message is asking the reader to restate what the row above already
 * says. Both remain editable and neither is required, so a thread that does change hands
 * costs one correction rather than being fought.
 *
 * Read off the rows rather than off the stored log, because a message just typed and not yet
 * saved is the likeliest thing the next one follows.
 */
export function newCorrespondenceRow(
  rows: CorrespondenceRow[],
  defaultState: StateId,
  id: string,
): CorrespondenceRow {
  const recent = rows.find((row) => row.who.trim() || row.channel.trim() || row.subject.trim())
  return {
    id,
    state: defaultState,
    // Received far more often than sent, and the row above is no guide: a reply follows a
    // message rather than another reply.
    direction: 'received',
    // The subject comes forward with the correspondent: the next message in a thread is a
    // reply to it, and a thread is what a shared subject means.
    subject: recent?.subject ?? '',
    channel: recent?.channel ?? '',
    who: recent?.who ?? '',
    body: '',
    at: '',
  }
}

/**
 * What a message's row reads as while its fields are folded away: when it was sent, who it
 * was with, and a line of what it says. The same three things the log's folded row shows, cut
 * at the same length by the same `preview`, because a row that summarised a message one way
 * in the editor and another way in the panel would read as two different messages.
 *
 * A row with nothing in it yet says so rather than rendering as a stack of separators — it is
 * the row you just added and are about to fill in.
 */
export function correspondenceRowSummary(row: CorrespondenceRow): string {
  const sent = fromDateTimeInput(row.at)
  if (!sent && !row.body.trim() && !row.who.trim()) return 'New message'

  const when = sent ? `${formatShortDate(sent)}, ${formatTimeOfDay(sent)}` : 'No date'
  const parts = [when, correspondenceSender({ direction: row.direction, who: row.who || null })]
  if (row.channel.trim()) parts.push(row.channel.trim())

  /*
   * The body, not the subject — the heading above a thread carries that, the same split the
   * log makes. A row leading with its own subject under a heading saying the same words
   * would be three rows reading "Next steps" and telling you nothing about which is which.
   */
  const gist = preview(row.body)
  return gist ? `${parts.join(' · ')} — ${gist}` : parts.join(' · ')
}

export function correspondenceDrafts(rows: CorrespondenceRow[]): CorrespondenceDraft[] {
  return rows
    .filter((row) => row.body.trim() || row.at)
    .map((row) => ({
      id: row.id,
      state: row.state,
      direction: row.direction,
      subject: row.subject || null,
      channel: row.channel || null,
      who: row.who || null,
      body: row.body,
      at: fromDateTimeInput(row.at) ?? '',
    }))
}

/**
 * The first thing wrong with the messages, phrased for the person editing them. The domain
 * throws on the same cases, but its messages name fields rather than rows, and a reader with
 * four messages on screen needs to know which one.
 *
 * A row with neither text nor a time is skipped rather than reported: that is a blank row
 * someone added and then thought better of, and it is dropped on save.
 */
export function firstCorrespondenceProblem(rows: CorrespondenceRow[]): string | null {
  for (const [index, row] of rows.entries()) {
    const position = `Message ${index + 1}`
    if (!row.body.trim() && !row.at) continue
    if (!row.body.trim()) return `${position} needs its text.`
    if (!row.at) return `${position} needs the date and time it was sent.`
  }
  return null
}
