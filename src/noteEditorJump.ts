/**
 * Jumping to a heading while a note is being written rather than read. There is no
 * rendered heading to scroll to then — the heading is just the line it was typed on — so
 * the outline moves the caret there and scrolls the box to it instead.
 */

/** Character offset where `line` starts, clamped to the text. Line 0 starts at 0. */
export function lineStartOffset(text: string, line: number): number {
  if (line <= 0) return 0

  let offset = 0
  let seen = 0
  while (seen < line) {
    const next = text.indexOf('\n', offset)
    // Asked for a line past the end: the last line is as far as this can go.
    if (next === -1) return offset
    offset = next + 1
    seen += 1
  }
  return offset
}

/**
 * Which line `offset` falls on. The other way round from `lineStartOffset`, for reading
 * the caret back out of the editor as it is moved and typed in.
 */
export function lineAtOffset(text: string, offset: number): number {
  const end = Math.min(Math.max(offset, 0), text.length)

  let line = 0
  for (let index = 0; index < end; index += 1) {
    if (text[index] === '\n') line += 1
  }
  return line
}

/** Where `line` ends, so the heading can be shown selected rather than as a bare caret. */
export function lineEndOffset(text: string, line: number): number {
  const start = lineStartOffset(text, line)
  const next = text.indexOf('\n', start)
  return next === -1 ? text.length : next
}

/**
 * The properties that decide where the text of a textarea breaks and how tall it stands.
 * Copied onto the measuring element so it wraps the same way the box does.
 */
const METRIC_PROPERTIES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textIndent',
  'textTransform',
  'wordBreak',
  'wordSpacing',
] as const

/**
 * How far down the text each of `offsets` sits, in pixels.
 *
 * Measured against a copy of the box rather than counted as lines times a line height: the
 * editor soft-wraps, so one written line can stand several lines tall, and any note with a
 * paragraph in it would land somewhere short of the heading. One copy answers for every
 * offset asked about, because the fold controls beside the box ask about all of them at
 * once, on every keystroke.
 */
export function offsetTopsWithin(
  textarea: HTMLTextAreaElement,
  text: string,
  offsets: readonly number[],
): number[] {
  if (offsets.length === 0) return []

  const styles = getComputedStyle(textarea)
  const mirror = document.createElement('div')

  for (const property of METRIC_PROPERTIES) mirror.style[property] = styles[property]
  // The box wraps its text and keeps the runs of spaces that indent a note.
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  // Measured off-screen at the width the text actually has to wrap within, with the box's
  // own padding left out so the answer is a distance into the text rather than into the box.
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.left = '-9999px'
  mirror.style.top = '0'
  mirror.style.height = 'auto'
  mirror.style.padding = '0'
  mirror.style.border = '0'
  mirror.style.width = `${
    textarea.clientWidth
    - parseFloat(styles.paddingLeft || '0')
    - parseFloat(styles.paddingRight || '0')
  }px`

  // Asked about in order, so the text between two offsets is written once rather than the
  // whole run before each of them.
  const ordered = [...offsets].map((offset, index) => ({ offset, index }))
  ordered.sort((left, right) => left.offset - right.offset)

  const markers: HTMLSpanElement[] = []
  let written = 0
  for (const entry of ordered) {
    const clamped = Math.min(Math.max(entry.offset, 0), text.length)
    mirror.append(text.slice(written, clamped))
    written = clamped
    // A marker rather than the height of the text before it: a run ending in a newline is
    // not itself any taller, so its height would name the line above the one asked for.
    // Taken out of the flow, so that several of them in one copy cannot themselves change
    // where the text between them wraps — it keeps its static position either way.
    const marker = document.createElement('span')
    marker.style.position = 'absolute'
    marker.textContent = 'x'
    mirror.append(marker)
    markers.push(marker)
  }
  mirror.append(text.slice(written))

  document.body.append(mirror)
  try {
    const tops: number[] = new Array(offsets.length).fill(0)
    ordered.forEach((entry, position) => {
      tops[entry.index] = markers[position].offsetTop
    })
    return tops
  } finally {
    mirror.remove()
  }
}

/**
 * Puts the caret on `line`, shown selected, and scrolls the box so that line is at the top.
 *
 * Scrolling is done by hand because moving the caret does not bring it into view — a
 * textarea only follows a selection the reader made themselves — so the jump would leave
 * the caret on the right line with the box still showing somewhere else entirely.
 */
export function jumpToLine(textarea: HTMLTextAreaElement, text: string, line: number): void {
  const start = lineStartOffset(text, line)
  const end = lineEndOffset(text, line)

  textarea.focus()
  // jsdom implements neither selection nor layout, and the panel still has to render there.
  textarea.setSelectionRange?.(start, end)
  if (typeof getComputedStyle === 'function') {
    textarea.scrollTop = offsetTopsWithin(textarea, text, [start])[0]
  }
}
