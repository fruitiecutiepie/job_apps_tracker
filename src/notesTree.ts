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
import { postingRef, stageRef, type NoteRef } from './notesLayout'

/** How much of a note a hit shows around the words that matched. */
export const SNIPPET_CHARS = 96

/**
 * How many hits a row lists. A row is a way into a note rather than the note itself, and a
 * search for a common word would otherwise put a whole note in the sidebar.
 */
export const MATCHES_SHOWN = 5

/** Which half of a note a hit is in — what you wrote, or what you were told. */
export type MatchWhere = 'written' | 'captured'

export interface NotesTreeMatch {
  where: MatchWhere
  /** The words around the hit, read as the prose the note renders to. */
  snippet: string
}

export interface NotesTreeEntry {
  ref: NoteRef
  company: string
  role: string | null
  /** Whether a note was written here, as against only lines captured under it. */
  written: boolean
  /** How many lines were captured, so a row can say what is in it before it is opened. */
  captured: number
  /**
   * The hits in this note's own words, up to `MATCHES_SHOWN`, for the rows that sit under
   * it while a search is running. Empty without a query, and empty for a row that matched
   * on its company or its stage rather than on anything written in it.
   */
  matches: NotesTreeMatch[]
  /** Every hit, including the ones not listed, so a row can say there are more. */
  hits: number
}

/**
 * A heading in the tree and the rows under it.
 *
 * Discriminated because a posting prepares for no stage: it cannot be folded into one of
 * the stage groups without claiming a state it has not got, so it gets a group of its own.
 */
export type NotesTreeGroup =
  | { kind: 'posting'; label: string; notes: NotesTreeEntry[] }
  | { kind: 'stage'; state: StateId; label: string; notes: NotesTreeEntry[] }

/** What the postings group is called, and what a posting is searched by. */
export const POSTING_LABEL = 'Job postings'

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

/**
 * A note's source read as the prose it renders to. The markers are how it is written
 * rather than part of what it says, and a hit is one line: a snippet still carrying `##`
 * and `-` reads as a fragment of a file instead of a sentence from a note.
 *
 * Deliberately not the Markdown parser. This throws structure away on purpose, where the
 * parser exists to keep it, and a snippet is the one place that wants the text flattened.
 */
function asProse(text: string): string {
  return text
    .replace(/```+/g, ' ')
    .replace(/^[\s>]*(?:#{1,6}|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The text around one hit. A fixed window rather than a cut on word boundaries, which is
 * what makes a snippet predictable against the note it came from — and the hit itself is
 * never cut, that being what the reader is looking for.
 */
function snippetAround(text: string, at: number, length: number): string {
  const room = Math.max(0, SNIPPET_CHARS - length)
  const start = Math.max(0, at - Math.floor(room / 2))
  const end = Math.min(text.length, start + SNIPPET_CHARS + length)
  const middle = text.slice(start, end).trim()
  return `${start > 0 ? '…' : ''}${middle}${end < text.length ? '…' : ''}`
}

/** Every hit in one piece of text, as the snippets a row lists. */
function hitsIn(source: string, needle: string, where: MatchWhere): NotesTreeMatch[] {
  const text = asProse(source)
  const hay = text.toLowerCase()
  const found: NotesTreeMatch[] = []
  let at = hay.indexOf(needle)
  while (at !== -1) {
    found.push({ where, snippet: snippetAround(text, at, needle.length) })
    at = hay.indexOf(needle, at + needle.length)
  }
  return found
}

export function buildNotesTree(
  applications: readonly Application[],
  query: string,
): NotesTreeGroup[] {
  const needle = query.trim().toLowerCase()
  const byState = new Map<StateId, NotesTreeEntry[]>()
  const postings: NotesTreeEntry[] = []

  for (const application of applications) {
    const posting = application.posting
    if (posting) {
      const hay = [application.company, application.role ?? '', POSTING_LABEL, posting.body]
        .join('\n')
        .toLowerCase()
      if (!needle || hay.includes(needle)) {
        const found = needle ? hitsIn(posting.body, needle, 'written') : []
        postings.push({
          ref: postingRef(application.id),
          company: application.company,
          role: application.role,
          // A posting is always something written, and never something captured: nobody
          // said it to you, and there is no dock under it to say it into.
          written: true,
          captured: 0,
          matches: found.slice(0, MATCHES_SHOWN),
          hits: found.length,
        })
      }
    }

    for (const note of application.stage_notes) {
      const written = note.body.trim().length > 0
      if (!written && note.heard.length === 0) continue
      const captured = note.heard.map((entry) => entry.body).join('\n')
      if (needle && !haystack(application, note.state, note.body, captured).includes(needle)) continue

      // What the note itself says, which is not the same question as whether the row
      // matched: a row found by its company has nothing to show under it.
      const found = needle
        ? [...hitsIn(note.body, needle, 'written'), ...hitsIn(captured, needle, 'captured')]
        : []

      const entries = byState.get(note.state) ?? []
      entries.push({
        ref: stageRef(application.id, note.state),
        company: application.company,
        role: application.role,
        written,
        captured: note.heard.length,
        matches: found.slice(0, MATCHES_SHOWN),
        hits: found.length,
      })
      byState.set(note.state, entries)
    }
  }

  const byName = (left: NotesTreeEntry, right: NotesTreeEntry) =>
    left.company.localeCompare(right.company) || (left.role ?? '').localeCompare(right.role ?? '')

  // Postings lead: they are what the prep below them was written against, and they belong
  // to no stage, so there is no rank that would put them anywhere in the walk.
  const postingGroup: NotesTreeGroup[] = postings.length > 0
    ? [{ kind: 'posting', label: POSTING_LABEL, notes: [...postings].sort(byName) }]
    : []

  // Walked in `STATE_CONFIG` order rather than sorted after the fact, so the tree reads
  // down the pipeline the way every other list of stages in the app does.
  return postingGroup.concat(STATE_CONFIG.flatMap(({ id }) => {
    const notes = byState.get(id)
    if (!notes || notes.length === 0) return []
    notes.sort(byName)
    return [{ kind: 'stage' as const, state: id, label: stateLabel(id), notes }]
  }))
}

/** Every note in the tree, for a count that does not have to walk it twice. */
export const notesInTree = (tree: readonly NotesTreeGroup[]): number =>
  tree.reduce((total, group) => total + group.notes.length, 0)
