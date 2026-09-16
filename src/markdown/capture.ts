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

import { dayGroups } from './dayLog'

/**
 * The heading a stage's captured lines are read under. It names the contrast the dock
 * exists for — the note above it is what you wrote before, this is what you were told
 * during — rather than the act of writing it down, which the Capture button already has.
 */
export const CAPTURE_SECTION = 'What they said'

/**
 * The same words inside a sentence, for the labels that put them in one: "Show what they
 * said in …" rather than a capital landing mid-phrase. Written out rather than lowercased
 * on the fly so a label that needs different words can have them.
 */
export const CAPTURE_SECTION_IN_SENTENCE = 'what they said'

/** What `capturedMarkdown` needs of a captured line, which is less than the stored record. */
interface Captured {
  body: string
  at: string
}

/**
 * Renders captured lines as Markdown: one `###` heading per day, in the order they were
 * captured, with each line a bullet beneath its day, stamped with the moment it was
 * captured. A line is emitted as it was typed after that stamp, so emphasis and links
 * written into it read the way the rest of a note does.
 *
 * `day` formats a timestamp as the heading it is grouped under, which is also what
 * decides where one day ends: the caller owns how a date reads, and two lines share a
 * heading exactly when they read as the same date to whoever is looking at them. That
 * grouping is `dayGroups`, shared with the correspondence log so the two cannot drift. `time`
 * formats the stamp on the line itself, which carries no date of its own — the heading
 * above it already says which day this was, and an interview is read a line at a time.
 *
 * The stamp is a code span, so it reads as the record it is rather than as something
 * that was said, and stays legible against lines of any length.
 */
/**
 * Indents everything after a captured line's first line, so a capture of any shape stays
 * inside the bullet it was filed under. Without this an unindented second line ends the
 * list and reads as a note of its own, a line starting with `-` becomes a second capture
 * that nobody made, and a `#` or `>` line opens a block in the middle of the log.
 *
 * A blank line is dropped rather than indented: kept, it would close the list whatever
 * the indent, and it carries nothing a reader of a capture log would miss.
 */
function indented(body: string): string {
  const [first, ...rest] = body.split('\n')
  if (rest.length === 0) return first
  return [first, ...rest.filter((line) => line.trim()).map((line) => `  ${line.trim()}`)].join('\n')
}

export function capturedMarkdown(
  entries: readonly Captured[],
  day: (at: string) => string,
  time: (at: string) => string,
): string {
  if (entries.length === 0) return ''

  const lines: string[] = []

  for (const [index, group] of dayGroups(entries, day).entries()) {
    if (index > 0) lines.push('')
    lines.push(`### ${group.label}`, '')
    for (const entry of group.entries) {
      lines.push(`- \`${time(entry.at)}\` ${indented(entry.body)}`)
    }
  }

  return lines.join('\n')
}
