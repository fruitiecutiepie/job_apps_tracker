/**
 * Reading a stage's correspondence back as one Markdown note. Messages are stored as records —
 * who, how, what, and when it was sent — so this is where those records become something the
 * note renderer, the outline, and the find can all work on, exactly as a written note is.
 *
 * Derived on render and never stored, for the reason the capture log gives: the day headings
 * are a reading of the timestamps, so a message cannot drift from the day it was sent, and the
 * grouping never has to be parsed back out of text some earlier version of this code wrote.
 */

import { dayGroups } from './dayLog'

/** The heading a stage's messages are read under, and the toggle that opens them. */
export const CORRESPONDENCE_SECTION = 'Correspondence'

/**
 * The same word inside a sentence, for the labels that put it in one: "Show the correspondence
 * in …". Written out rather than lowercased on the fly, matching `CAPTURE_SECTION_IN_SENTENCE`.
 */
export const CORRESPONDENCE_SECTION_IN_SENTENCE = 'the correspondence'

/** What this needs of a message, which is less than the stored record. */
interface Corresponded {
  direction: 'received' | 'sent'
  channel: string | null
  who: string | null
  body: string
  at: string
}

const DIRECTION_LABELS: Record<Corresponded['direction'], string> = {
  received: 'Received',
  sent: 'Sent',
}

/**
 * Indents a message so it stays inside the bullet it was filed under, as a block of its own
 * beneath the header line. This is deliberately the opposite of `indented` in `capture.ts`,
 * and the difference is the whole reason these are two functions:
 *
 * - Blank lines are **kept**, because they are the paragraph breaks of something someone else
 *   wrote. A capture drops them, which is right for one spoken line and destroys a pasted
 *   email. A blank line between two indented runs does not end a list, so keeping them is safe.
 * - Leading whitespace is **kept** rather than trimmed away, so a quoted reply, a nested bullet
 *   or a signature keeps the shape it arrived in.
 *
 * The payoff beyond fidelity is folding: a list item with children folds, so a long rejection
 * note collapses behind its own header line and the day still reads as a list of messages.
 */
function indentedBody(body: string): string {
  const lines = body.split('\n')
  while (lines.length > 0 && !lines[lines.length - 1]!.trim()) lines.pop()
  while (lines.length > 0 && !lines[0]!.trim()) lines.shift()
  // A leading blank line is what opens a child block under the bullet rather than continuing
  // its first line.
  return ['', ...lines.map((line) => (line.trim() ? `  ${line}` : ''))].join('\n')
}

/** The header line of one message: who it was with and how, after the time it was sent. */
function header(entry: Corresponded, time: (at: string) => string): string {
  // Bold words rather than an arrow: direction is the one field always present, so it earns
  // the emphasis, and an arrow reads as punctuation to a screen reader.
  const said = [entry.who, entry.channel].filter(Boolean).join(' · ')
  const direction = `**${DIRECTION_LABELS[entry.direction]}**`
  return `- \`${time(entry.at)}\` ${said ? `${direction} — ${said}` : direction}`
}

/**
 * Renders messages as Markdown: one `###` heading per day in the order they were sent, with
 * each message a bullet beneath its day — the time it was sent, which way it went, and who it
 * was with — and the message itself as an indented block under that.
 *
 * `day` and `time` are supplied for the reason `capturedMarkdown` gives: the caller owns how a
 * date reads, and the day formatter doubles as what decides where one day ends. The stamp is a
 * code span so it reads as the record it is rather than as something that was written, and it
 * carries no date — the heading above it already says which day this was.
 */
export function correspondenceMarkdown(
  entries: readonly Corresponded[],
  day: (at: string) => string,
  time: (at: string) => string,
): string {
  if (entries.length === 0) return ''

  const lines: string[] = []

  for (const [index, group] of dayGroups(entries, day).entries()) {
    if (index > 0) lines.push('')
    lines.push(`### ${group.label}`, '')
    for (const entry of group.entries) {
      lines.push(header(entry, time), indentedBody(entry.body))
    }
  }

  return lines.join('\n')
}
