/**
 * Continuing a Markdown list on Enter, so a bullet or a number typed once does not have
 * to be retyped on every line after it.
 *
 * Operates purely on a text string and a caret offset — the same shape the editor's own
 * `edit()` already takes — so it can run against the box's projected (fold-collapsed)
 * text and hand the result straight to `edit()` without knowing folds exist at all.
 */

import { lineAtOffset, lineEndOffset, lineStartOffset } from './noteEditorJump'
import { LIST_ITEM } from './markdown'

export interface ListContinuation {
  text: string
  caret: number
}

/**
 * What pressing Enter at `caret` in `text` should do, or `null` if the current line is
 * not a list item at all — the caller's cue to let Enter insert a plain line break.
 */
export function continueList(text: string, caret: number): ListContinuation | null {
  const line = lineAtOffset(text, caret)
  const start = lineStartOffset(text, line)
  const end = lineEndOffset(text, line)
  const lineText = text.slice(start, end)

  const match = LIST_ITEM.exec(lineText)
  if (!match) return null

  const [, indent, bullet, digits, rest] = match

  // Nothing was typed after the marker: Enter clears it rather than handing back another
  // one, the way GitHub, Notion, and most Markdown editors treat an empty list item —
  // otherwise there would be no way to stop a list without deleting the marker by hand.
  if (rest.trim() === '') {
    return { text: text.slice(0, start) + text.slice(end), caret: start }
  }

  // Where the marker ends and the item's own text begins, so a caret inside the marker
  // itself (or the indent before it) is treated as sitting at the very start of that
  // text rather than splitting the marker in two.
  const restStart = start + (lineText.length - rest.length)
  const splitAt = Math.max(caret, restStart)

  const marker = bullet
    ? `${indent}${bullet} `
    : // The shared regex only captures the digits, not which of `.`/`)` closed them, so
      // it is read directly off the source rather than re-deriving it from a new pattern.
      `${indent}${Number(digits) + 1}${lineText[indent.length + digits.length]} `

  return {
    text: `${text.slice(0, splitAt)}\n${marker}${text.slice(splitAt)}`,
    caret: splitAt + 1 + marker.length,
  }
}
