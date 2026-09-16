/*
 * The message rows behind the editor's correspondence fields: how a stored message becomes an
 * editable row, and how rows become drafts the domain can take. The shape mirrors `invites.ts`,
 * including keeping the `datetime-local` conversion here rather than in the component.
 */
import type { Application, CorrespondenceDirection, CorrespondenceDraft, StateId } from './domain'
import { fromDateTimeInput, toDateTimeInput } from './dateInput'

/** One message as the editor holds it: local wall-time strings, not timestamps. */
export interface CorrespondenceRow {
  id: string
  state: StateId
  direction: CorrespondenceDirection
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
      channel: entry.channel ?? '',
      who: entry.who ?? '',
      body: entry.body,
      at: toDateTimeInput(entry.at),
    }))
    .reverse()
}

export function correspondenceDrafts(rows: CorrespondenceRow[]): CorrespondenceDraft[] {
  return rows
    .filter((row) => row.body.trim() || row.at)
    .map((row) => ({
      id: row.id,
      state: row.state,
      direction: row.direction,
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
