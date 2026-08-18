/*
 * The invite rows behind the editor's invite fields: how a stored invite becomes
 * an editable row, how rows become drafts the domain can take, and how an
 * imported `.ics` folds into the rows already on screen.
 */
import { createUuidV7, stateLabel } from './domain'
import type { Application, StateEventDraft, StateId } from './domain'
import type { IcsEvent } from './calendar'
import { fromDateTimeInput, toDateTimeInput } from './dateInput'

/** One invite as the editor holds it: local wall-time strings, not timestamps. */
export interface InviteRow {
  id: string
  state: StateId
  summary: string
  startsAt: string
  endsAt: string
  location: string
  url: string
  icsUid: string | null
  sequence: number
  cancelled: boolean
}

export function inviteRowsFor(application: Application | null): InviteRow[] {
  return (application?.state_events ?? []).map((event) => ({
    id: event.id,
    state: event.state,
    summary: event.summary,
    startsAt: toDateTimeInput(event.starts_at),
    endsAt: toDateTimeInput(event.ends_at),
    location: event.location ?? '',
    url: event.url ?? '',
    icsUid: event.ics_uid,
    sequence: event.sequence,
    cancelled: event.cancelled,
  }))
}

export function inviteDrafts(rows: InviteRow[]): StateEventDraft[] {
  return rows
    .filter((row) => row.summary.trim() || row.startsAt)
    .map((row) => ({
      id: row.id,
      state: row.state,
      summary: row.summary,
      starts_at: fromDateTimeInput(row.startsAt) ?? '',
      ends_at: fromDateTimeInput(row.endsAt),
      location: row.location || null,
      url: row.url || null,
      ics_uid: row.icsUid,
      sequence: row.sequence,
      cancelled: row.cancelled,
    }))
}

/**
 * The first thing wrong with the invites, phrased for the person editing them.
 * The domain throws on the same cases, but its messages name fields rather than
 * rows, and a reader with four invites on screen needs to know which one.
 */
export function firstInviteProblem(rows: InviteRow[]): string | null {
  for (const [index, row] of rows.entries()) {
    const position = `Invite ${index + 1}`
    if (!row.summary.trim() && !row.startsAt) continue
    if (!row.summary.trim()) return `${position} needs a description.`
    if (!row.startsAt) return `${position} needs a start date and time.`
    if (row.endsAt && new Date(row.endsAt) < new Date(row.startsAt)) {
      return `${position} ends before it starts.`
    }
  }
  return null
}

export function rowFromIcsEvent(event: IcsEvent, state: StateId): InviteRow {
  return {
    id: createUuidV7(),
    state,
    summary: event.summary ?? stateLabel(state),
    startsAt: toDateTimeInput(event.starts_at),
    endsAt: toDateTimeInput(event.ends_at),
    location: event.location ?? '',
    url: event.url ?? '',
    icsUid: event.uid,
    sequence: event.sequence,
    cancelled: event.cancelled,
  }
}

/**
 * Folds the events of an `.ics` file into the rows on screen. An invite whose
 * calendar UID is already here replaces that row and keeps the stage it was
 * filed under, matching what `addStateEvent` does on save: a reschedule changes
 * the time, not the reader's decision about which stage it belongs to.
 */
export function mergeIcsEvents(
  rows: InviteRow[],
  events: IcsEvent[],
  defaultState: StateId,
): { rows: InviteRow[]; added: number; replaced: number; stale: number } {
  const next = [...rows]
  let added = 0
  let replaced = 0
  let stale = 0

  for (const event of events) {
    if (!event.starts_at) continue
    const existingIndex = event.uid ? next.findIndex((row) => row.icsUid === event.uid) : -1
    if (existingIndex < 0) {
      next.push(rowFromIcsEvent(event, defaultState))
      added += 1
      continue
    }

    const existing = next[existingIndex]!
    if (event.sequence < existing.sequence) {
      stale += 1
      continue
    }
    next[existingIndex] = {
      ...rowFromIcsEvent(event, existing.state),
      id: existing.id,
      summary: event.summary ?? existing.summary,
    }
    replaced += 1
  }

  return { rows: next, added, replaced, stale }
}

export function importSummary(result: ReturnType<typeof mergeIcsEvents>): string | null {
  const parts = [
    result.added > 0 ? `${result.added} added` : null,
    result.replaced > 0 ? `${result.replaced} updated` : null,
    result.stale > 0 ? `${result.stale} ignored as older than what you already have` : null,
  ].filter(Boolean)
  return parts.length > 0 ? `Invites: ${parts.join(', ')}.` : null
}
