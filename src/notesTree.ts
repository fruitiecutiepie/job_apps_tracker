/**
 * Every prep note worth going back to, as a tree grouped by the stage it prepares for.
 *
 * Grouped by stage rather than by company because that is the question a reader browses
 * with: what does my Interview 2 prep look like across everything, not what have I written
 * about one company — the tabs and the picker already answer the second. Empty stages are
 * left out: the tree is a list of places to go, and a stage with nothing in it is not one.
 *
 * Pure, like `notesLayout` and `notesArrangement`. What the tree holds and how it is
 * filtered is worth reasoning about without rendering a sidebar.
 */

import type { Application, StateId } from './domain'
import { STATE_CONFIG, stateLabel } from './domain'
import type { NoteRef } from './notesLayout'

export interface NotesTreeEntry {
  ref: NoteRef
  company: string
  role: string | null
  /** Whether a note was written here, as against only lines captured under it. */
  written: boolean
  /** How many lines were captured, so a row can say what is in it before it is opened. */
  captured: number
}

export interface NotesTreeGroup {
  state: StateId
  label: string
  notes: NotesTreeEntry[]
}

/**
 * What a row can be found by. The words of the note are the point, but a reader looking
 * for "Halcyon" means the company and would be puzzled to be told there is no such note,
 * so the name of the thing the note belongs to counts too.
 */
function haystack(application: Application, state: StateId, body: string, captured: string): string {
  return [application.company, application.role ?? '', stateLabel(state), body, captured]
    .join('\n')
    .toLowerCase()
}

export function buildNotesTree(
  applications: readonly Application[],
  query: string,
): NotesTreeGroup[] {
  const needle = query.trim().toLowerCase()
  const byState = new Map<StateId, NotesTreeEntry[]>()

  for (const application of applications) {
    for (const note of application.stage_notes) {
      const written = note.body.trim().length > 0
      if (!written && note.heard.length === 0) continue
      const captured = note.heard.map((entry) => entry.body).join('\n')
      if (needle && !haystack(application, note.state, note.body, captured).includes(needle)) continue

      const entries = byState.get(note.state) ?? []
      entries.push({
        ref: { applicationId: application.id, state: note.state },
        company: application.company,
        role: application.role,
        written,
        captured: note.heard.length,
      })
      byState.set(note.state, entries)
    }
  }

  // Walked in `STATE_CONFIG` order rather than sorted after the fact, so the tree reads
  // down the pipeline the way every other list of stages in the app does.
  return STATE_CONFIG.flatMap(({ id }) => {
    const notes = byState.get(id)
    if (!notes || notes.length === 0) return []
    notes.sort(
      (left, right) =>
        left.company.localeCompare(right.company) || (left.role ?? '').localeCompare(right.role ?? ''),
    )
    return [{ state: id, label: stateLabel(id), notes }]
  })
}

/** Every note in the tree, for a count that does not have to walk it twice. */
export const notesInTree = (tree: readonly NotesTreeGroup[]): number =>
  tree.reduce((total, group) => total + group.notes.length, 0)
