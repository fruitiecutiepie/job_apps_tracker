/**
 * Reading captured lines back as one Markdown note. What someone told you is stored as
 * records rather than text — a line and the moment it was captured — so this is where
 * those records become something the note renderer, the outline, and the find can all
 * work on, exactly as they do for a written note.
 *
 * Derived on render and never stored: the day headings are a reading of the timestamps,
 * so a captured line cannot drift from the day it was captured on, and grouping never
 * has to be parsed back out of text that some earlier version of this code wrote.
 */

/** The heading a stage's captured lines are read under. */
export const CAPTURE_SECTION = 'Heard'

/** What `capturedMarkdown` needs of a captured line, which is less than the stored record. */
interface Captured {
  body: string
  at: string
}

/**
 * Renders captured lines as Markdown: one `###` heading per day, in the order they were
 * captured, with each line a bullet beneath its day. A line is emitted as it was typed,
 * so emphasis and links written into it read the way the rest of a note does.
 *
 * `day` formats a timestamp as the heading it is grouped under, which is also what
 * decides where one day ends: the caller owns how a date reads, and two lines share a
 * heading exactly when they read as the same date to whoever is looking at them.
 */
export function capturedMarkdown(
  entries: readonly Captured[],
  day: (at: string) => string,
): string {
  if (entries.length === 0) return ''

  const ordered = [...entries].sort((left, right) => left.at.localeCompare(right.at))
  const lines: string[] = []
  let heading: string | null = null

  for (const entry of ordered) {
    const label = day(entry.at)
    if (label !== heading) {
      if (heading !== null) lines.push('')
      lines.push(`### ${label}`, '')
      heading = label
    }
    lines.push(`- ${entry.body}`)
  }

  return lines.join('\n')
}
