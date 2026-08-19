import { createUuidV7 } from './id'
import { isRatingDimension, isRatingScore, ratingRank } from './ratings'
import { isStateId, stateRank } from './states'
import { safeAttachmentFilename } from './attachmentPaths'
import type {
  Application,
  ApplicationEdits,
  ApplicationInput,
  Attachment,
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
    stage_notes: [],
    state_events: [],
    attachments: [],
    ratings: [],
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
    updated_at: timestamp(at),
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
 * Replaces the whole set of stage prep notes with the supplied drafts. Blank bodies drop
 * their note, unchanged bodies keep their timestamps, and the application is returned
 * untouched when nothing changed.
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
    if (!body) continue

    const existing = stageNoteFor(application, draft.state)
    if (existing && existing.body === body) {
      stageNotes.push(existing)
      continue
    }
    stageNotes.push({
      state: draft.state,
      body,
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

export function moveApplicationState(
  application: Application,
  state: StateId,
  at: Date | string = new Date(),
): Application {
  if (!isStateId(state)) throw new TypeError('State is invalid')
  if (application.state === state) return application
  const updatedAt = timestamp(at)
  return {
    ...application,
    state,
    state_history: [...application.state_history, { state, at: updatedAt }],
    updated_at: updatedAt,
  }
}

export function addApplication(
  document: TrackerDocument,
  input: ApplicationInput,
  at: Date | string = new Date(),
): TrackerDocument {
  return { ...document, applications: [...document.applications, createApplication(input, at)] }
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
