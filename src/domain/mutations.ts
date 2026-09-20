import {
  COMPENSATION_CONFIG,
  currencyCode,
  emptyCompensation,
  isCompensationAmount,
} from './compensation'
import { isCorrespondenceDirection } from './correspondence'
import { createUuidV7 } from './id'
import { isRatingDimension, isRatingScore, ratingRank } from './ratings'
import { isRejectedState, isStateId, stateRank } from './states'
import { safeAttachmentFilename } from './attachmentPaths'
import type {
  Application,
  ApplicationEdits,
  ApplicationInput,
  Attachment,
  Compensation,
  CompensationBand,
  CompletedAction,
  CompletedActionDraft,
  CorrespondenceDraft,
  CorrespondenceEntry,
  HeardEntry,
  Rating,
  RatingDimensionId,
  RatingDraft,
  StageNote,
  StageNoteDraft,
  StateEvent,
  StateEventDraft,
  StateId,
  TrackerDocument,
} from './types'

function timestamp(at: Date | string): string {
  const date = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(date.getTime())) throw new TypeError('A valid timestamp is required')
  return date.toISOString()
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function companyName(value: string): string {
  const company = value.trim()
  if (!company) throw new TypeError('Company is required')
  return company
}

function checkedUrl(value: string | null | undefined): string | null {
  const url = optionalText(value)
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
  } catch {
    throw new TypeError('URL must be a valid http or https URL')
  }
  return url
}

function optionalTimestamp(value: string | null | undefined): string | null {
  const candidate = optionalText(value)
  if (!candidate) return null
  return timestamp(candidate)
}

function compensationBand(
  value: CompensationBand | null | undefined,
  label: string,
): CompensationBand | null {
  if (value === null || value === undefined) return null
  if (!isCompensationAmount(value.min) || !isCompensationAmount(value.max)) {
    throw new TypeError(`${label} pay must be whole positive amounts`)
  }
  if (value.max < value.min) throw new TypeError(`${label} pay must not end below its start`)
  return { min: value.min, max: value.max }
}

/**
 * Canonicalizes a whole compensation record. Unlike ratings and prep notes there are no
 * per-record timestamps to preserve, so the record is simply rebuilt: that is what makes it
 * safe in `ApplicationEdits` where those are not.
 *
 * A currency may not survive without an amount, the same rule as a next-action date and a
 * blank action: a bare "AUD" says nothing. The reverse is an error rather than a silent drop,
 * because a number whose unit is unknown is worse than no number at all.
 */
export function canonicalCompensation(value: Compensation | null | undefined): Compensation {
  const record = emptyCompensation()
  for (const { id, label } of COMPENSATION_CONFIG) {
    record[id] = compensationBand(value?.[id], label)
  }
  const currency = currencyCode(value?.currency)
  const hasAmount = COMPENSATION_CONFIG.some(({ id }) => record[id] !== null)
  if (hasAmount && !currency) {
    throw new TypeError('A currency is required when an amount is set')
  }
  record.currency = hasAmount ? currency : null
  return record
}

export function createAttachmentMetadata(
  filename: string,
  mime: string | null,
  size: number,
  at: Date | string = new Date(),
  id: string = createUuidV7(at instanceof Date ? at : new Date(at)),
): Attachment {
  if (!Number.isInteger(size) || size < 1) throw new TypeError('Attachment size must be a positive integer')
  const createdAt = timestamp(at)
  return {
    id,
    filename: safeAttachmentFilename(filename),
    mime: optionalText(mime),
    size,
    created_at: createdAt,
  }
}

export function createApplication(
  input: ApplicationInput,
  at: Date | string = new Date(),
  id: string = createUuidV7(at instanceof Date ? at : new Date(at)),
): Application {
  const createdAt = timestamp(at)
  const state = input.state ?? 'applied'
  if (!isStateId(state)) throw new TypeError('State is invalid')
  const nextAction = optionalText(input.next_action)

  return {
    id,
    company: companyName(input.company),
    role: optionalText(input.role),
    url: checkedUrl(input.url),
    source: optionalText(input.source),
    state,
    state_history: [{ state, at: createdAt }],
    next_action: nextAction,
    next_action_at: nextAction ? optionalTimestamp(input.next_action_at) : null,
    deadline_at: optionalTimestamp(input.deadline_at),
    notes: optionalText(input.notes),
    completed_actions: [],
    stage_notes: [],
    state_events: [],
    correspondence: [],
    attachments: [],
    ratings: [],
    compensation: canonicalCompensation(input.compensation),
    created_at: createdAt,
    updated_at: createdAt,
  }
}

export function editApplication(
  application: Application,
  edits: ApplicationEdits,
  at: Date | string = new Date(),
): Application {
  const nextAction =
    'next_action' in edits ? optionalText(edits.next_action) : application.next_action
  const nextActionAt = nextAction
    ? 'next_action_at' in edits
      ? optionalTimestamp(edits.next_action_at)
      : application.next_action_at
    : null

  return {
    ...application,
    company: 'company' in edits ? companyName(edits.company ?? '') : application.company,
    role: 'role' in edits ? optionalText(edits.role) : application.role,
    url: 'url' in edits ? checkedUrl(edits.url) : application.url,
    source: 'source' in edits ? optionalText(edits.source) : application.source,
    next_action: nextAction,
    next_action_at: nextActionAt,
    deadline_at:
      'deadline_at' in edits ? optionalTimestamp(edits.deadline_at) : application.deadline_at,
    notes: 'notes' in edits ? optionalText(edits.notes) : application.notes,
    attachments: 'attachments' in edits ? edits.attachments ?? [] : application.attachments,
    compensation:
      'compensation' in edits
        ? canonicalCompensation(edits.compensation)
        : application.compensation,
    updated_at: timestamp(at),
  }
}

/** Completed actions read oldest first, so the list is a record of what happened in order. */
function sortedCompletedActions(entries: CompletedAction[]): CompletedAction[] {
  return [...entries].sort((left, right) => left.at.localeCompare(right.at))
}

/**
 * Replaces the completed actions with a canonicalized list. Like invites, a draft carrying an
 * existing id keeps that record's timestamp while a new one is stamped now, so re-saving the
 * editor cannot restate when a task was finished. A blank action drops the entry, which is how
 * the editor removes a Done pressed by mistake — the one recovery that appending to `notes`
 * used to give for free, and the reason removal exists at all.
 *
 * An unchanged list returns the same object so a pointless save cannot refresh `updated_at`.
 */
export function applyCompletedActions(
  application: Application,
  drafts: CompletedActionDraft[],
  at: Date | string = new Date(),
): Application {
  const updatedAt = timestamp(at)
  const existing = new Map(application.completed_actions.map((entry) => [entry.id, entry]))
  const seen = new Set<string>()
  const entries: CompletedAction[] = []

  for (const draft of drafts) {
    const action = optionalText(draft.action)
    if (!action) continue

    const current = draft.id ? existing.get(draft.id) ?? null : null
    const id = current?.id ?? draft.id ?? createUuidV7(new Date(updatedAt))
    if (seen.has(id)) throw new TypeError('A completed action may not appear twice')
    seen.add(id)

    entries.push({
      id,
      action,
      at: current?.at ?? optionalTimestamp(draft.at) ?? updatedAt,
    })
  }

  const completed = sortedCompletedActions(entries)
  const unchanged =
    completed.length === application.completed_actions.length
    && completed.every((entry, index) => {
      const before = application.completed_actions[index]!
      return before.id === entry.id && before.action === entry.action && before.at === entry.at
    })
  if (unchanged) return application

  return { ...application, completed_actions: completed, updated_at: updatedAt }
}

/**
 * Records a next action as done: the plan is cleared and the task joins `completed_actions`,
 * so finishing a task leaves a record rather than deleting the only evidence it was planned.
 * It is deliberately not appended to `notes`: prose you revise and a line the app writes are
 * different things, and mixing them means neither can be edited without disturbing the other.
 *
 * A blank action returns the same object — there is nothing to resolve. `deadline_at` is
 * untouched because an external closing date is not a task, and completing an action never
 * appends state history because finishing a task is not a stage change.
 */
export function completeNextAction(
  application: Application,
  at: Date | string = new Date(),
): Application {
  const action = optionalText(application.next_action)
  if (!action) return application

  const updatedAt = timestamp(at)
  const entry: CompletedAction = {
    id: createUuidV7(new Date(updatedAt)),
    action,
    at: updatedAt,
  }

  return {
    ...application,
    next_action: null,
    next_action_at: null,
    completed_actions: sortedCompletedActions([...application.completed_actions, entry]),
    updated_at: updatedAt,
  }
}

/** The prep note recorded for one stage of an application, when there is one. */
export function stageNoteFor(application: Application, state: StateId): StageNote | null {
  return application.stage_notes.find((note) => note.state === state) ?? null
}

function sortedStageNotes(notes: StageNote[]): StageNote[] {
  return [...notes].sort((left, right) => stateRank(left.state) - stateRank(right.state))
}

/**
 * Replaces the prepared body of every stage named in the drafts. A blank body drops its
 * note unless the note holds captured lines, which are never a draft and survive being
 * saved over: clearing what you wrote for a stage does not unsay what you were told in it.
 * Unchanged bodies keep their timestamps, and the application is returned untouched when
 * nothing changed.
 */
export function applyStageNotes(
  application: Application,
  drafts: StageNoteDraft[],
  at: Date | string = new Date(),
): Application {
  const seen = new Set<StateId>()
  const updatedAt = timestamp(at)
  const stageNotes: StageNote[] = []

  for (const draft of drafts) {
    if (!isStateId(draft.state)) throw new TypeError('State is invalid')
    if (seen.has(draft.state)) throw new TypeError('Each stage may hold only one prep note')
    seen.add(draft.state)

    const body = draft.body.trim()
    const existing = stageNoteFor(application, draft.state)
    const heard = existing?.heard ?? []
    if (!body && heard.length === 0) continue

    if (existing && existing.body === body) {
      stageNotes.push(existing)
      continue
    }
    stageNotes.push({
      state: draft.state,
      body,
      heard,
      created_at: existing?.created_at ?? updatedAt,
      updated_at: updatedAt,
    })
  }

  const kept = application.stage_notes.filter((note) => !seen.has(note.state))
  const next = sortedStageNotes([...kept, ...stageNotes])
  const unchanged =
    next.length === application.stage_notes.length
    && next.every((note, index) => note === application.stage_notes[index])
  if (unchanged) return application

  return { ...application, stage_notes: next, updated_at: updatedAt }
}

/** Records, replaces, or (with a blank body) clears the prep note for one stage. */
export function setStageNote(
  application: Application,
  state: StateId,
  body: string,
  at: Date | string = new Date(),
): Application {
  return applyStageNotes(application, [{ state, body }], at)
}

/**
 * Files one captured line against a stage, opening a note for that stage if it has none.
 * A line is stored as it is entered rather than drafted, and its id and `at` are minted
 * here rather than supplied, so two lines can never claim the same identity or the same
 * moment's ordering. Rewriting one afterwards goes through `reviseStageNoteCapture`.
 *
 * A blank line is not a capture and returns the application untouched.
 */
export function captureStageNote(
  application: Application,
  state: StateId,
  line: string,
  at: Date | string = new Date(),
): Application {
  if (!isStateId(state)) throw new TypeError('State is invalid')
  const body = line.trim()
  if (!body) return application

  const updatedAt = timestamp(at)
  const entry: HeardEntry = { id: createUuidV7(new Date(updatedAt)), body, at: updatedAt }
  const existing = stageNoteFor(application, state)
  const note: StageNote = {
    state,
    body: existing?.body ?? '',
    heard: [...(existing?.heard ?? []), entry],
    created_at: existing?.created_at ?? updatedAt,
    updated_at: updatedAt,
  }

  const kept = application.stage_notes.filter((current) => current.state !== state)
  return {
    ...application,
    stage_notes: sortedStageNotes([...kept, note]),
    updated_at: updatedAt,
  }
}

/**
 * Rewrites one captured line, or removes it when the new text is blank.
 *
 * `at` is the moment the line was captured and does not move: an edit is a correction to
 * what was written down, not a claim that it was said later, and the day a line reads
 * under is a reading of that timestamp. The id does not move either, so a line being
 * edited stays the same line to anything holding a reference to it.
 *
 * Removing the last captured line from a stage that has nothing written for it drops the
 * note, which is the same rule a blank body follows: an empty note is not a record of
 * anything. Text that matches what is already there, or an id the stage does not hold,
 * returns the application untouched.
 */
export function reviseStageNoteCapture(
  application: Application,
  state: StateId,
  entryId: string,
  line: string,
  at: Date | string = new Date(),
): Application {
  if (!isStateId(state)) throw new TypeError('State is invalid')
  const note = stageNoteFor(application, state)
  const existing = note?.heard.find((entry) => entry.id === entryId)
  if (!note || !existing) return application

  const body = line.trim()
  if (body === existing.body) return application

  const updatedAt = timestamp(at)
  const heard = body
    ? note.heard.map((entry) => (entry.id === entryId ? { ...entry, body } : entry))
    : note.heard.filter((entry) => entry.id !== entryId)

  const kept = application.stage_notes.filter((current) => current.state !== state)
  const remaining: StageNote[] = heard.length === 0 && !note.body
    ? []
    : [{ ...note, heard, updated_at: updatedAt }]

  return {
    ...application,
    stage_notes: sortedStageNotes([...kept, ...remaining]),
    updated_at: updatedAt,
  }
}

/** The judgement recorded for one dimension of an application, when there is one. */
export function ratingFor(application: Application, dimension: RatingDimensionId): Rating | null {
  return application.ratings.find((rating) => rating.dimension === dimension) ?? null
}

function sortedRatings(ratings: Rating[]): Rating[] {
  return [...ratings].sort((left, right) => ratingRank(left.dimension) - ratingRank(right.dimension))
}

/**
 * Records the supplied judgements, leaving every dimension not named in the drafts alone.
 * Unlike a stage prep note, a rating has no blank form that could mean "remove this", so
 * removal is an explicit `clearRating` and an absent draft is simply untouched. A draft with
 * `score: null` is a real judgement of a different kind: asked, and genuinely cannot tell.
 */
export function applyRatings(
  application: Application,
  drafts: RatingDraft[],
  at: Date | string = new Date(),
): Application {
  const seen = new Set<RatingDimensionId>()
  const updatedAt = timestamp(at)
  const ratings: Rating[] = []

  for (const draft of drafts) {
    if (!isRatingDimension(draft.dimension)) throw new TypeError('Rating dimension is invalid')
    if (seen.has(draft.dimension)) throw new TypeError('Each dimension may hold only one rating')
    if (draft.score !== null && !isRatingScore(draft.score)) {
      throw new TypeError('Rating score must be null or an integer from 1 to 5')
    }
    seen.add(draft.dimension)

    const existing = ratingFor(application, draft.dimension)
    if (existing && existing.score === draft.score) {
      ratings.push(existing)
      continue
    }
    ratings.push({
      dimension: draft.dimension,
      score: draft.score,
      created_at: existing?.created_at ?? updatedAt,
      updated_at: updatedAt,
    })
  }

  const kept = application.ratings.filter((rating) => !seen.has(rating.dimension))
  const next = sortedRatings([...kept, ...ratings])
  const unchanged =
    next.length === application.ratings.length
    && next.every((rating, index) => rating === application.ratings[index])
  if (unchanged) return application

  return { ...application, ratings: next, updated_at: updatedAt }
}

/** Removes the judgement for one dimension, returning it to never-assessed. */
export function clearRating(
  application: Application,
  dimension: RatingDimensionId,
  at: Date | string = new Date(),
): Application {
  if (!isRatingDimension(dimension)) throw new TypeError('Rating dimension is invalid')
  if (!ratingFor(application, dimension)) return application

  return {
    ...application,
    ratings: application.ratings.filter((rating) => rating.dimension !== dimension),
    updated_at: timestamp(at),
  }
}

/** The invites filed against one state of an application, soonest first. */
export function stateEventsFor(application: Application, state: StateId): StateEvent[] {
  return application.state_events.filter((event) => event.state === state)
}

function sortedStateEvents(events: StateEvent[]): StateEvent[] {
  return [...events].sort(
    (left, right) =>
      stateRank(left.state) - stateRank(right.state)
      || Date.parse(left.starts_at) - Date.parse(right.starts_at)
      || left.id.localeCompare(right.id),
  )
}

function sameStateEvent(event: StateEvent, other: StateEvent): boolean {
  return (
    event.state === other.state
    && event.summary === other.summary
    && event.starts_at === other.starts_at
    && event.ends_at === other.ends_at
    && event.location === other.location
    && event.url === other.url
    && event.ics_uid === other.ics_uid
    && event.sequence === other.sequence
    && event.cancelled === other.cancelled
  )
}

/** Canonicalizes one invite draft. Throws on anything a stored invite may not hold. */
function canonicalStateEvent(
  draft: StateEventDraft,
  id: string,
  createdAt: string,
  updatedAt: string,
): StateEvent {
  if (!isStateId(draft.state)) throw new TypeError('State is invalid')
  const startsAt = timestamp(draft.starts_at)
  const endsAt = optionalTimestamp(draft.ends_at)
  if (endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
    throw new TypeError('An invite may not end before it starts')
  }
  const sequence = draft.sequence ?? 0
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new TypeError('Invite sequence must be a non-negative integer')
  }

  return {
    id,
    state: draft.state,
    summary: draft.summary.trim(),
    starts_at: startsAt,
    ends_at: endsAt,
    location: optionalText(draft.location),
    url: checkedUrl(draft.url),
    ics_uid: optionalText(draft.ics_uid),
    sequence,
    cancelled: draft.cancelled ?? false,
    created_at: createdAt,
    updated_at: updatedAt,
  }
}

/**
 * Replaces the whole set of invites with the supplied drafts. A draft keeps its
 * timestamps when nothing about it changed, a blank summary drops that invite the
 * way a blank body drops a prep note, and the application is returned untouched
 * when nothing changed at all.
 */
export function applyStateEvents(
  application: Application,
  drafts: StateEventDraft[],
  at: Date | string = new Date(),
): Application {
  const updatedAt = timestamp(at)
  const existingById = new Map(application.state_events.map((event) => [event.id, event]))
  const events: StateEvent[] = []
  const seenIds = new Set<string>()
  const seenUids = new Set<string>()

  for (const draft of drafts) {
    if (!draft.summary.trim()) continue

    const existing = draft.id ? existingById.get(draft.id) : undefined
    const id = existing?.id ?? draft.id ?? createUuidV7(at instanceof Date ? at : new Date(at))
    if (seenIds.has(id)) throw new TypeError('Invite id already exists on this application')
    seenIds.add(id)

    const candidate = canonicalStateEvent(draft, id, existing?.created_at ?? updatedAt, updatedAt)
    if (candidate.ics_uid) {
      if (seenUids.has(candidate.ics_uid)) {
        throw new TypeError('Each calendar UID may appear once on an application')
      }
      seenUids.add(candidate.ics_uid)
    }

    events.push(existing && sameStateEvent(existing, candidate) ? existing : candidate)
  }

  const next = sortedStateEvents(events)
  const unchanged =
    next.length === application.state_events.length
    && next.every((event, index) => event === application.state_events[index])
  if (unchanged) return application

  return { ...application, state_events: next, updated_at: updatedAt }
}

/**
 * Files one invite against a state. An invite carrying a calendar UID already on
 * the application replaces that one rather than joining it, which is how a
 * reschedule lands: the stored `state` survives, because which stage an invite
 * belongs to is the reader's filing decision and not something the invite says.
 * An invite whose `sequence` is behind the stored one is ignored as stale.
 */
export function addStateEvent(
  application: Application,
  draft: StateEventDraft,
  at: Date | string = new Date(),
): Application {
  const updatedAt = timestamp(at)
  const uid = optionalText(draft.ics_uid)
  const superseded = uid
    ? application.state_events.find((event) => event.ics_uid === uid)
    : undefined

  if (superseded && (draft.sequence ?? 0) < superseded.sequence) return application

  const id = superseded?.id ?? createUuidV7(at instanceof Date ? at : new Date(at))
  const candidate = canonicalStateEvent(
    superseded ? { ...draft, state: superseded.state } : draft,
    id,
    superseded?.created_at ?? updatedAt,
    updatedAt,
  )
  if (superseded && sameStateEvent(superseded, candidate)) return application

  const kept = application.state_events.filter((event) => event.id !== id)
  return {
    ...application,
    state_events: sortedStateEvents([...kept, candidate]),
    updated_at: updatedAt,
  }
}

export function removeStateEvent(
  application: Application,
  eventId: string,
  at: Date | string = new Date(),
): Application {
  if (!application.state_events.some((event) => event.id === eventId)) return application
  return {
    ...application,
    state_events: application.state_events.filter((event) => event.id !== eventId),
    updated_at: timestamp(at),
  }
}

/**
 * Correspondence is stored in send order rather than in configured state order the way
 * invites are. Invites are read one stage at a time and their times and their stages agree
 * by construction; a log is read as a timeline, and the stage a message is filed under does
 * not predict when it was sent — a coordinator apologising for the delay on Interview 1
 * arrives after the Interview 2 invite, and filing-first order would read backwards at
 * exactly the moment that matters.
 *
 * Compare parsed instants rather than strings, unlike `heard` and `completed_actions`: those
 * are only chronological because their `at` is always written by `timestamp()`, while this is
 * the first `at` a person supplies and one written with an offset does not sort lexically.
 * The id tiebreak is not optional — the import validator rebuilds the array in file order, so
 * without it two messages sharing an instant can come back in an order they were not written
 * in, and every no-op-by-identity check downstream reports a change that did not happen. This
 * rule and `correspondenceValue`'s must stay the same rule.
 */
function sortedCorrespondence(entries: CorrespondenceEntry[]): CorrespondenceEntry[] {
  return [...entries].sort(
    (left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id),
  )
}

function sameCorrespondence(entry: CorrespondenceEntry, other: CorrespondenceEntry): boolean {
  return (
    entry.state === other.state
    && entry.direction === other.direction
    && entry.channel === other.channel
    && entry.who === other.who
    && entry.body === other.body
    && entry.at === other.at
  )
}

/** Canonicalizes one message draft. Throws on anything a stored message may not hold. */
function canonicalCorrespondence(
  draft: CorrespondenceDraft,
  id: string,
  createdAt: string,
  updatedAt: string,
): CorrespondenceEntry {
  if (!isStateId(draft.state)) throw new TypeError('State is invalid')
  if (!isCorrespondenceDirection(draft.direction)) {
    throw new TypeError('Message direction is invalid')
  }
  // Refused rather than stamped now. A draft with no send time that fell back to the clock
  // would record when you did the filing, which is the dishonest timestamp this field exists
  // to end — and it would do it silently.
  if (!optionalText(draft.at)) throw new TypeError('A message needs the time it was sent')

  return {
    id,
    state: draft.state,
    direction: draft.direction,
    channel: optionalText(draft.channel),
    who: optionalText(draft.who),
    body: draft.body.trim(),
    at: timestamp(draft.at),
    created_at: createdAt,
    updated_at: updatedAt,
  }
}

/**
 * Replaces the whole log with the supplied drafts. A draft carrying an existing id keeps that
 * record's `created_at`; everything else about it, `at` included, is rewritten from the draft,
 * because when a message was sent is a fact you can have got wrong rather than a record of a
 * keystroke. A blank body drops the message the way a blank summary drops an invite, and an
 * unchanged list returns the same object.
 *
 * There is deliberately no append-one mutation beside this. Unlike a capture, a message is
 * composed after the fact with a date and a direction to choose, so it is a form with a Save;
 * and unlike an invite it carries no calendar UID forcing a replace-or-append decision. Add
 * one only alongside a control that logs a message from outside the editor, since that caller
 * would have no draft list to extend.
 */
export function applyCorrespondence(
  application: Application,
  drafts: CorrespondenceDraft[],
  at: Date | string = new Date(),
): Application {
  const updatedAt = timestamp(at)
  const existingById = new Map(application.correspondence.map((entry) => [entry.id, entry]))
  const entries: CorrespondenceEntry[] = []
  const seenIds = new Set<string>()

  for (const draft of drafts) {
    if (!draft.body.trim()) continue

    const existing = draft.id ? existingById.get(draft.id) : undefined
    // Minted from the write moment, not from `draft.at`: an id is generated when a record is
    // created, and a UUIDv7 whose time bits were a claim about the message would disagree
    // with the write order it is the sort's tiebreak for.
    const id = existing?.id ?? draft.id ?? createUuidV7(new Date(updatedAt))
    if (seenIds.has(id)) throw new TypeError('Message id already exists on this application')
    seenIds.add(id)

    const candidate = canonicalCorrespondence(
      draft,
      id,
      existing?.created_at ?? updatedAt,
      updatedAt,
    )
    entries.push(existing && sameCorrespondence(existing, candidate) ? existing : candidate)
  }

  const next = sortedCorrespondence(entries)
  const unchanged =
    next.length === application.correspondence.length
    && next.every((entry, index) => entry === application.correspondence[index])
  if (unchanged) return application

  return { ...application, correspondence: next, updated_at: updatedAt }
}

export function addAttachment(
  application: Application,
  attachment: Attachment,
  at: Date | string = new Date(),
): Application {
  if (application.attachments.some((item) => item.id === attachment.id)) {
    throw new TypeError('Attachment id already exists on this application')
  }
  return {
    ...application,
    attachments: [...application.attachments, attachment],
    updated_at: timestamp(at),
  }
}

export function removeAttachment(
  application: Application,
  attachmentId: string,
  at: Date | string = new Date(),
): Application {
  if (!application.attachments.some((item) => item.id === attachmentId)) {
    return application
  }
  return {
    ...application,
    attachments: application.attachments.filter((item) => item.id !== attachmentId),
    updated_at: timestamp(at),
  }
}

/**
 * A rejection ends the application, so a task still sitting on it is work that will not
 * happen. The move drops it rather than leaving it to be cleared by hand, which is what
 * otherwise accumulates: the rejection arrives, the stage moves, and the follow-up stays
 * on the plan forever because nothing ever asks about it again.
 *
 * It is dropped, never recorded through `completeNextAction`. An abandoned task was not
 * carried out, and `completed_actions` means carried out. The history entry for the move
 * is the record of why it went, and `deadline_at` is untouched for the same reason it
 * survives a completion: an external closing date is not the task.
 *
 * Only rejected states, not every ending. `accepted` is an outcome you act on — sign the
 * contract, give notice — so a task there is live work, and `no_openings` is close enough
 * to a rejection to be tempting but is a state you may still be working, since nothing was
 * turned down. Widening this would mean guessing, and guessing wrong deletes a task.
 */
export function moveApplicationState(
  application: Application,
  state: StateId,
  at: Date | string = new Date(),
): Application {
  if (!isStateId(state)) throw new TypeError('State is invalid')
  if (application.state === state) return application
  const updatedAt = timestamp(at)
  const abandonsNextAction = isRejectedState(state) && Boolean(optionalText(application.next_action))
  return {
    ...application,
    state,
    ...(abandonsNextAction ? { next_action: null, next_action_at: null } : null),
    state_history: [...application.state_history, { state, at: updatedAt }],
    updated_at: updatedAt,
  }
}

/**
 * Adds one application, optionally under an id the caller has already minted. Naming it
 * up front is what lets work keyed by that id — an attachment folder — happen before the
 * document is written, so the write itself stays a single derivation from the current
 * document rather than something that has to be built from a snapshot first.
 */
export function addApplication(
  document: TrackerDocument,
  input: ApplicationInput,
  at: Date | string = new Date(),
  id?: string,
): TrackerDocument {
  const created = id === undefined
    ? createApplication(input, at)
    : createApplication(input, at, id)
  return { ...document, applications: [...document.applications, created] }
}

export function updateApplication(
  document: TrackerDocument,
  id: string,
  edits: ApplicationEdits,
  at: Date | string = new Date(),
): TrackerDocument {
  return {
    ...document,
    applications: document.applications.map((application) =>
      application.id === id ? editApplication(application, edits, at) : application,
    ),
  }
}

export function updateApplicationStageNotes(
  document: TrackerDocument,
  id: string,
  drafts: StageNoteDraft[],
  at: Date | string = new Date(),
): TrackerDocument {
  const application = document.applications.find((item) => item.id === id)
  if (!application) return document
  const updated = applyStageNotes(application, drafts, at)
  if (updated === application) return document

  return {
    ...document,
    applications: document.applications.map((item) => (item.id === id ? updated : item)),
  }
}

/** Marks one application's next action done, leaving the rest of the document alone. */
export function completeApplicationNextAction(
  document: TrackerDocument,
  id: string,
  at: Date | string = new Date(),
): TrackerDocument {
  const application = document.applications.find((item) => item.id === id)
  if (!application) return document
  const updated = completeNextAction(application, at)
  if (updated === application) return document

  return {
    ...document,
    applications: document.applications.map((item) => (item.id === id ? updated : item)),
  }
}

/** Replaces one application's completed actions, leaving the rest of the document alone. */
export function updateApplicationCompletedActions(
  document: TrackerDocument,
  id: string,
  drafts: CompletedActionDraft[],
  at: Date | string = new Date(),
): TrackerDocument {
  const application = document.applications.find((item) => item.id === id)
  if (!application) return document
  const updated = applyCompletedActions(application, drafts, at)
  if (updated === application) return document

  return {
    ...document,
    applications: document.applications.map((item) => (item.id === id ? updated : item)),
  }
}

/** Files a captured line against one stage of one application. */
export function updateApplicationStageCapture(
  document: TrackerDocument,
  id: string,
  state: StateId,
  line: string,
  at: Date | string = new Date(),
): TrackerDocument {
  const application = document.applications.find((item) => item.id === id)
  if (!application) return document
  const updated = captureStageNote(application, state, line, at)
  if (updated === application) return document

  return {
    ...document,
    applications: document.applications.map((item) => (item.id === id ? updated : item)),
  }
}

/** Rewrites or removes one captured line on one stage of one application. */
export function reviseApplicationStageCapture(
  document: TrackerDocument,
  id: string,
  state: StateId,
  entryId: string,
  line: string,
  at: Date | string = new Date(),
): TrackerDocument {
  const application = document.applications.find((item) => item.id === id)
  if (!application) return document
  const updated = reviseStageNoteCapture(application, state, entryId, line, at)
  if (updated === application) return document

  return {
    ...document,
    applications: document.applications.map((item) => (item.id === id ? updated : item)),
  }
}

/** Records judgements on one application, leaving the rest of the document alone. */
export function updateApplicationRatings(
  document: TrackerDocument,
  id: string,
  drafts: RatingDraft[],
  at: Date | string = new Date(),
): TrackerDocument {
  const application = document.applications.find((item) => item.id === id)
  if (!application) return document
  const updated = applyRatings(application, drafts, at)
  if (updated === application) return document

  return {
    ...document,
    applications: document.applications.map((item) => (item.id === id ? updated : item)),
  }
}

/** Returns one dimension of one application to never-assessed. */
export function clearApplicationRating(
  document: TrackerDocument,
  id: string,
  dimension: RatingDimensionId,
  at: Date | string = new Date(),
): TrackerDocument {
  const application = document.applications.find((item) => item.id === id)
  if (!application) return document
  const updated = clearRating(application, dimension, at)
  if (updated === application) return document

  return {
    ...document,
    applications: document.applications.map((item) => (item.id === id ? updated : item)),
  }
}

export function updateApplicationStateEvents(
  document: TrackerDocument,
  id: string,
  drafts: StateEventDraft[],
  at: Date | string = new Date(),
): TrackerDocument {
  const application = document.applications.find((item) => item.id === id)
  if (!application) return document
  const updated = applyStateEvents(application, drafts, at)
  if (updated === application) return document

  return {
    ...document,
    applications: document.applications.map((item) => (item.id === id ? updated : item)),
  }
}

/** Replaces one application's correspondence, leaving the rest of the document alone. */
export function updateApplicationCorrespondence(
  document: TrackerDocument,
  id: string,
  drafts: CorrespondenceDraft[],
  at: Date | string = new Date(),
): TrackerDocument {
  const application = document.applications.find((item) => item.id === id)
  if (!application) return document
  const updated = applyCorrespondence(application, drafts, at)
  if (updated === application) return document

  return {
    ...document,
    applications: document.applications.map((item) => (item.id === id ? updated : item)),
  }
}

export function addApplicationStateEvent(
  document: TrackerDocument,
  id: string,
  draft: StateEventDraft,
  at: Date | string = new Date(),
): TrackerDocument {
  const application = document.applications.find((item) => item.id === id)
  if (!application) return document
  const updated = addStateEvent(application, draft, at)
  if (updated === application) return document

  return {
    ...document,
    applications: document.applications.map((item) => (item.id === id ? updated : item)),
  }
}

export function moveApplication(
  document: TrackerDocument,
  id: string,
  state: StateId,
  at: Date | string = new Date(),
): TrackerDocument {
  if (!isStateId(state)) throw new TypeError('State is invalid')
  const application = document.applications.find((item) => item.id === id)
  if (!application || application.state === state) return document

  return {
    ...document,
    applications: document.applications.map((application) =>
      application.id === id ? moveApplicationState(application, state, at) : application,
    ),
  }
}

export function deleteApplication(document: TrackerDocument, id: string): TrackerDocument {
  return {
    ...document,
    applications: document.applications.filter((application) => application.id !== id),
  }
}
