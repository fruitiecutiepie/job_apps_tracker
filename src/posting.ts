/**
 * The form's half of a captured job posting: what the editor holds while it is being typed
 * into, and what it hands the document when the form is saved.
 *
 * Pure, and apart from the field component, the way `invites.ts` and `compensation.ts` are:
 * what makes a posting usable is worth checking without rendering a dialog.
 */

import type { Application, PostingDraft } from './domain'
import type { PostingRow } from './PostingField'

export type { PostingRow }

export const emptyPostingRow = (): PostingRow => ({ body: '', sourceUrl: '', capturedAt: null })

/** What the editor opens with for an application that may or may not have a posting. */
export function postingRowFor(application: Application | null): PostingRow {
  const posting = application?.posting
  if (!posting) return emptyPostingRow()
  return {
    body: posting.body,
    sourceUrl: posting.source_url ?? '',
    capturedAt: posting.captured_at,
  }
}

/**
 * The reason this row cannot be saved, or null when it can. The domain would throw on the
 * same input; this mirrors `firstInviteProblem` in preferring a message that names the box.
 */
export function firstPostingProblem(row: PostingRow): string | null {
  const url = row.sourceUrl.trim()
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
  } catch {
    return 'Where you read the posting must be a http or https link.'
  }
  // A link with nothing behind it says where a posting was without saying what it said.
  if (!row.body.trim()) return 'A posting needs its text, not only a link to it.'
  return null
}

/**
 * What the document is asked to store. Null clears it: a posting emptied in the form is a
 * posting forgotten, which is the same thing the domain does with a blank body.
 */
export function postingDraftFrom(row: PostingRow): PostingDraft | null {
  if (!row.body.trim()) return null
  return { body: row.body, source_url: row.sourceUrl.trim() || null }
}
