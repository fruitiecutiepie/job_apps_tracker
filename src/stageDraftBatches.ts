import { rebaseDraft } from './domain/mergeText'
import { reviseApplicationPosting, updateApplicationStageNotes } from './domain/mutations'
import type { StateId, TrackerDocument } from './domain/types'
import type { StageNoteDraftBatch } from './StageNotesPanel'

/**
 * The mutation the prep notes panel's autosave runs: every batch folded into one document,
 * so a panel holding two companies' notes still writes once.
 *
 * Each draft is the note's whole body, begun from `base`. Where the stored note has moved
 * on since — another tab holding this tracker wrote it — the two edits are merged rather
 * than the draft written over it. This runs inside `commit`'s mutation, so it is applied to
 * the newest stored document and under the cross-tab lock, not to whatever copy one tab
 * happened to have. Its own module, out of `App.tsx`, so that merge can be tested as the
 * pure function it is.
 */
/**
 * One stage note saved from somewhere other than the panel's batch: Compare, or a scratch
 * file coming back from an external editor. `base` is the text that save started from, so
 * a note another tab stored in the meantime is merged rather than replaced.
 */
export function saveStageNoteDraft(
  current: TrackerDocument,
  applicationId: string,
  state: StateId,
  base: string,
  body: string,
  at: Date,
): TrackerDocument {
  const stored = current.applications
    .find((item) => item.id === applicationId)
    ?.stage_notes.find((note) => note.state === state)?.body ?? ''
  return updateApplicationStageNotes(
    current,
    applicationId,
    [{ state, body: rebaseDraft(base, body, stored) }],
    at,
  )
}

export function applyStageDraftBatches(
  current: TrackerDocument,
  batches: StageNoteDraftBatch[],
  at: Date,
): TrackerDocument {
  return batches.reduce((document, batch) => {
    const application = document.applications.find((item) => item.id === batch.applicationId)
    const drafts = batch.drafts.map(({ state, body, base }) => ({
      state,
      body: rebaseDraft(
        base,
        body,
        application?.stage_notes.find((note) => note.state === state)?.body ?? '',
      ),
    }))
    const next = updateApplicationStageNotes(document, batch.applicationId, drafts, at)
    // `revise` rather than `set`: typing in the pane corrects the posting you captured, it
    // does not capture it again, so `captured_at` stays where it was.
    return batch.posting === undefined
      ? next
      : reviseApplicationPosting(
        next,
        batch.applicationId,
        rebaseDraft(batch.postingBase ?? '', batch.posting, application?.posting?.body ?? ''),
        at,
      )
  }, current)
}
