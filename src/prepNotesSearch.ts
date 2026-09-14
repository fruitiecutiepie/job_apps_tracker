/**
 * Finding text across every prep note, written or captured.
 *
 * This is the one collection-wide question the prep notes view can sensibly answer, and it
 * is a different question from the two searches already in the app: the global search asks
 * which *applications* match and hands back rows, while the panel's find steps through the
 * notes already open. This asks which notes hold the words, including ones that are not
 * open, and hands back enough to show a result and to open it.
 *
 * Pure, and separate from the view for the same reason `notesLayout` is separate from the
 * panel: matching and ranking are worth reasoning about without rendering anything.
 */

import type { Application, StateId } from './domain'
import type { NoteRef } from './notesLayout'

/** How much of a note a result shows around the words that matched. */
export const SNIPPET_CHARS = 96

/** Which half of a note the words were found in — what you wrote, or what you were told. */
export type MatchWhere = 'written' | 'captured'

export interface NoteMatch {
  ref: NoteRef
  company: string
  role: string | null
  state: StateId
  /** Hits across the whole note, so a result can say how much is in it. */
  matches: number
  where: MatchWhere
  /** The text around the first hit, elided at either end that runs past it. */
  snippet: string
}

function countMatches(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    count += 1
    at = haystack.indexOf(needle, at + needle.length)
  }
  return count
}

/**
 * A note's source read as the prose it renders to. The markers are how it is written
 * rather than part of what it says, and a result is one line: a snippet still carrying
 * `##` and `-` reads as a fragment of a file instead of as a sentence from a note.
 *
 * Deliberately not the Markdown parser. This throws away structure on purpose, where the
 * parser exists to keep it, and a snippet is the one place in the app that wants the text
 * flattened rather than rendered.
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
 * The text around the first hit. Cut on word-ish boundaries would read better, but a fixed
 * window is what makes the result predictable against the note it came from — and the hit
 * itself is never cut, which is what the reader is looking for.
 */
function snippetAround(text: string, at: number, length: number): string {
  const room = Math.max(0, SNIPPET_CHARS - length)
  const start = Math.max(0, at - Math.floor(room / 2))
  const end = Math.min(text.length, start + SNIPPET_CHARS + length)
  const middle = text.slice(start, end).trim()
  return `${start > 0 ? '…' : ''}${middle}${end < text.length ? '…' : ''}`
}

/**
 * Every note holding the query, most hits first and then company by company so the order
 * does not shuffle under a reader who is comparing two of them.
 */
export function searchPrepNotes(applications: readonly Application[], query: string): NoteMatch[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const found: NoteMatch[] = []
  for (const application of applications) {
    for (const note of application.stage_notes) {
      const captured = note.heard.map((entry) => entry.body).join('\n')
      const written = note.body
      const inWritten = countMatches(written.toLowerCase(), needle)
      const inCaptured = countMatches(captured.toLowerCase(), needle)
      if (inWritten + inCaptured === 0) continue

      // The written note leads when both hold the words: it is the note, and the captures
      // are what was said into it.
      const where: MatchWhere = inWritten > 0 ? 'written' : 'captured'
      const text = asProse(where === 'written' ? written : captured)
      found.push({
        ref: { applicationId: application.id, state: note.state },
        company: application.company,
        role: application.role,
        state: note.state,
        matches: inWritten + inCaptured,
        where,
        snippet: snippetAround(text, text.toLowerCase().indexOf(needle), needle.length),
      })
    }
  }

  return found.sort(
    (left, right) =>
      right.matches - left.matches ||
      left.company.localeCompare(right.company) ||
      left.state.localeCompare(right.state),
  )
}
