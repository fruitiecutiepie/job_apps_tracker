/**
 * What the application editor writes back. The form is filled once, when it opens, and
 * another tab can store the same application before Save. A field the form did not change
 * keeps what is stored now; a field it changed writes what the form holds.
 */

import { correspondenceDrafts, correspondenceRowsFor } from './correspondence'
import { compensationFromValues, compensationValuesFor } from './compensation'
import type { CompensationValues } from './compensation'
import { toDateTimeInput } from './dateInput'
import type { Application, ApplicationEdits, ApplicationInput, Attachment, CompletedActionDraft, CorrespondenceDraft, PostingDraft, RatingDimension, StateEventDraft, StateId, TrackerDocument } from './domain'
import { archiveApplication, clearApplicationRating, moveApplication, updateApplication, updateApplicationCompletedActions, updateApplicationCorrespondence, updateApplicationPosting, updateApplicationRatings, updateApplicationStateEvents } from './domain/mutations'
import { inviteDrafts, inviteRowsFor } from './invites'
import { postingDraftFrom, postingRowFor } from './posting'
import { clearedRatingDimensions, ratingDrafts, ratingValuesFor } from './ratings'
import type { RatingValues } from './ratings'

export interface EditorForm {
  input: ApplicationInput
  compensationValues: CompensationValues
  ratingValues: RatingValues
  correspondence: CorrespondenceDraft[]
  invites: StateEventDraft[]
  completedActions: CompletedActionDraft[]
  posting: PostingDraft | null
  state: StateId
  outcome: Application['outcome']
  archived: boolean
  nextActionAt: string
  deadlineAt: string
  attachments: Attachment[]
  removedAttachmentIds: string[]
  stagedCount: number
}

function sameText(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left || null) === (right || null)
}

function sameList<T>(left: T[], right: T[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Attachments the save should store: a form that added or removed nothing keeps the stored list. */
export function attachmentsAfterEdit(
  stored: Attachment[],
  opened: Attachment[],
  uploaded: Attachment[],
  removedIds: string[],
  stagedCount: number,
): Attachment[] {
  if (removedIds.length === 0 && stagedCount === 0) return stored
  const removed = new Set(removedIds)
  const kept = stored.filter((item) => !removed.has(item.id))
  const keptIds = new Set(kept.map((item) => item.id))
  const openedIds = new Set(opened.map((item) => item.id))
  return [...kept, ...uploaded.filter((item) => !openedIds.has(item.id) && !keptIds.has(item.id))]
}

function ratingsToWrite(opened: Application, values: RatingValues) {
  const openedValues = ratingValuesFor(opened)
  const changed = { ...values }
  for (const dimension of Object.keys(openedValues) as RatingDimension[]) {
    if (values[dimension] === openedValues[dimension]) changed[dimension] = ''
  }
  return ratingDrafts(changed)
}

/**
 * Apply an edit opened against `opened` onto `current`, which may be a newer copy of the
 * same application.
 */
export function applyEditorSave(
  current: TrackerDocument,
  opened: Application,
  form: EditorForm,
  at: Date,
): TrackerDocument {
  const stored = current.applications.find((item) => item.id === opened.id)
  if (!stored) return current
  const input = form.input
  const edits: ApplicationEdits = {
    company: sameText(input.company, opened.company) ? stored.company : input.company,
    role: sameText(input.role, opened.role) ? stored.role : input.role,
    source: sameText(input.source, opened.source) ? stored.source : input.source,
    url: sameText(input.url, opened.url) ? stored.url : input.url,
    compensation: sameList([compensationValuesFor(opened)], [form.compensationValues])
      ? stored.compensation
      : compensationFromValues(form.compensationValues),
    deadline_at: form.deadlineAt === toDateTimeInput(opened.deadline_at) ? stored.deadline_at : input.deadline_at,
    next_action: sameText(input.next_action, opened.next_action) ? stored.next_action : input.next_action,
    next_action_at:
      sameText(input.next_action, opened.next_action) && form.nextActionAt === toDateTimeInput(opened.next_action_at)
        ? stored.next_action_at
        : input.next_action_at,
    notes: sameText(input.notes, opened.notes) ? stored.notes : input.notes,
    attachments: attachmentsAfterEdit(
      stored.attachments,
      opened.attachments,
      form.attachments,
      form.removedAttachmentIds,
      form.stagedCount,
    ),
  }
  let document = updateApplication(current, opened.id, edits, at)

  if (!sameList(form.correspondence, correspondenceDrafts(correspondenceRowsFor(opened)))) {
    document = updateApplicationCorrespondence(document, opened.id, form.correspondence, at)
  }
  if (!sameList(form.invites, inviteDrafts(inviteRowsFor(opened)))) {
    document = updateApplicationStateEvents(document, opened.id, form.invites, at)
  }
  if (!sameList(form.completedActions, opened.completed_actions.map(({ id, action, at: when }) => ({ id, action, at: when })))) {
    document = updateApplicationCompletedActions(document, opened.id, form.completedActions, at)
  }
  if (!sameList([form.posting], [postingDraftFrom(postingRowFor(opened))])) {
    document = updateApplicationPosting(document, opened.id, form.posting, at)
  }
  const ratingEdits = ratingsToWrite(opened, form.ratingValues)
  if (ratingEdits.length > 0) {
    document = updateApplicationRatings(document, opened.id, ratingEdits, at)
  }
  for (const dimension of clearedRatingDimensions(opened, form.ratingValues)) {
    document = clearApplicationRating(document, opened.id, dimension, at)
  }

  const state = form.state === opened.state ? stored.state : form.state
  const outcome = form.outcome === opened.outcome ? stored.outcome : form.outcome
  if (state !== stored.state || outcome !== stored.outcome) {
    document = moveApplication(document, opened.id, { state, outcome }, at)
  }
  const archived = form.archived === (opened.archived_at !== null) ? stored.archived_at !== null : form.archived
  if (archived !== (stored.archived_at !== null)) {
    document = archiveApplication(document, opened.id, archived, at)
  }
  return document
}
