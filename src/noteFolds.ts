/**
 * Folding a note while it is being written rather than read.
 *
 * The reading view can simply not render what is folded. A textarea has no such choice:
 * it holds one string and shows all of it. So the box is given the note with the folded
 * lines taken out — a projection of the source — and every position that crosses between
 * the two is mapped here. The note itself is never the projection: what is stored, saved,
 * and searched is always the whole source, folded or not.
 */

import { lineAtOffset, lineStartOffset } from './noteEditorJump'
import type { FoldRegion } from './markdown'

/** Lines the box is not showing, inclusive of both ends, sorted and non-overlapping. */
export interface HiddenRange {
  start: number
  end: number
}

/**
 * The lines the folds hide, merged. Folds nest — a point inside a folded heading is
 * folded too — so the ranges are merged rather than kept one per fold: everything that
 * maps between source and box counts hidden lines, and counting an overlap twice would
 * put every line after it in the wrong place.
 */
export function hiddenRanges(
  regions: readonly FoldRegion[],
  folded: ReadonlySet<number>,
): HiddenRange[] {
  const ranges = regions
    .filter((region) => folded.has(region.line))
    .map((region) => ({ start: region.start, end: region.end }))
    .sort((left, right) => left.start - right.start)

  const merged: HiddenRange[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    // Adjacent as well as overlapping: two runs with no visible line between them are one
    // run as far as the box is concerned.
    if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

/** The note as the box holds it: the source with the folded lines left out. */
export function projectText(lines: readonly string[], ranges: readonly HiddenRange[]): string {
  if (ranges.length === 0) return lines.join('\n')
  return lines.filter((_, line) => !isHidden(line, ranges)).join('\n')
}

export function isHidden(line: number, ranges: readonly HiddenRange[]): boolean {
  return ranges.some((range) => line >= range.start && line <= range.end)
}

/**
 * Which source line a line of the box is. A line inside a fold has none of its own, so
 * one is reported as the last visible line at or before it — which is the fold's own
 * header, the line the reader is looking at instead.
 */
export function toSourceLine(line: number, ranges: readonly HiddenRange[]): number {
  let source = line
  for (const range of ranges) {
    if (range.start > source) break
    source += range.end - range.start + 1
  }
  return source
}

/** Which line of the box a source line is shown on. */
export function toProjectedLine(line: number, ranges: readonly HiddenRange[]): number {
  let hidden = 0
  for (const range of ranges) {
    if (range.start > line) break
    hidden += Math.min(range.end, line) - range.start + 1
  }
  return line - hidden
}

/** Where a position in the box sits in the source. */
export function toSourceOffset(
  projected: string,
  source: string,
  ranges: readonly HiddenRange[],
  offset: number,
): number {
  const line = lineAtOffset(projected, offset)
  const column = offset - lineStartOffset(projected, line)
  return lineStartOffset(source, toSourceLine(line, ranges)) + column
}

/** Where a position in the source sits in the box, for putting a caret back afterwards. */
export function toProjectedOffset(
  projected: string,
  source: string,
  ranges: readonly HiddenRange[],
  offset: number,
): number {
  const line = lineAtOffset(source, offset)
  const column = offset - lineStartOffset(source, line)
  const projectedLine = toProjectedLine(line, ranges)
  const start = lineStartOffset(projected, projectedLine)
  // A position inside a fold has nowhere of its own to be: it lands at the end of the
  // fold's header line rather than somewhere arbitrary further down the box.
  if (isHidden(line, ranges)) {
    const next = projected.indexOf('\n', start)
    return next === -1 ? projected.length : next
  }
  return Math.min(start + column, projected.length)
}

export interface ProjectedEdit {
  /** The whole note after the edit, folds and all. */
  text: string
  /** Folds the edit reached into, which are opened rather than written through. */
  blocked: number[]
  /** Fold anchors moved along by however many lines the edit added or removed. */
  anchors: Set<number>
}

/** How many source lines a fold's own header line has moved, or `null` if it was edited away. */
function movedAnchor(anchor: number, from: number, to: number, delta: number): number | null {
  if (anchor <= from) return anchor
  if (anchor <= to) return null
  return anchor + delta
}

/**
 * Applies to the source what was typed into the box.
 *
 * The box only ever holds the visible lines, so an edit is found by comparing the two
 * projections — what the box had and what it has now — and then written to the source at
 * the same place. An edit that reaches across a fold, which is what a backspace at the end
 * of a folded heading does, opens the folds it reached into and changes nothing: silently
 * swallowing the lines the reader cannot see is the one outcome worth ruling out.
 *
 * Folds are anchored to the line their header is written on, so they are moved by whatever
 * the edit added or removed above them rather than left pointing at lines that have since
 * shifted. One whose header was edited away stops being a fold.
 */
export function applyProjectedEdit(
  source: string,
  previous: string,
  next: string,
  ranges: readonly HiddenRange[],
  folded: ReadonlySet<number>,
  regions: readonly FoldRegion[],
  caret?: number,
): ProjectedEdit {
  const anchors = new Set(folded)
  if (previous === next) return { text: source, blocked: [], anchors }

  /*
   * Where the edit was is read from the caret rather than guessed at, because comparing
   * the two strings alone cannot say. Backspacing the line break at the end of a folded
   * heading leaves a box whose text is equally well explained by deleting the break after
   * the blank line below it — and those are different edits to the note, one of them
   * reaching through the fold. The caret sits at the end of what was just typed, so the
   * text after it is known to be untouched.
   */
  const limit = Math.min(previous.length, next.length)
  const end = caret === undefined ? null : Math.min(Math.max(caret, 0), next.length)
  const untouched = end === null ? limit : Math.min(limit, next.length - end)
  let suffix = 0
  while (
    suffix < untouched
    && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1
  }
  let prefix = 0
  const front = Math.min(limit - suffix, end ?? limit)
  while (prefix < front && previous[prefix] === next[prefix]) prefix += 1

  const startLine = lineAtOffset(previous, prefix)
  const endLine = lineAtOffset(previous, previous.length - suffix)
  const sourceStartLine = toSourceLine(startLine, ranges)
  const sourceEndLine = toSourceLine(endLine, ranges)

  // The two ends are both on visible lines, so the only way folded lines are caught
  // between them is if the source spans more lines than the box did.
  if (sourceEndLine - sourceStartLine !== endLine - startLine) {
    const blocked = regions
      .filter(
        (region) =>
          folded.has(region.line) && region.start <= sourceEndLine && region.end >= sourceStartLine,
      )
      .map((region) => region.line)
    for (const line of blocked) anchors.delete(line)
    return { text: source, blocked, anchors }
  }

  const from = toSourceOffset(previous, source, ranges, prefix)
  const to = toSourceOffset(previous, source, ranges, previous.length - suffix)
  const inserted = next.slice(prefix, next.length - suffix)
  const removed = source.slice(from, to)
  const delta = inserted.split('\n').length - removed.split('\n').length

  const moved = new Set<number>()
  for (const anchor of anchors) {
    const line = movedAnchor(anchor, sourceStartLine, sourceEndLine, delta)
    if (line !== null) moved.add(line)
  }

  return {
    text: `${source.slice(0, from)}${inserted}${source.slice(to)}`,
    blocked: [],
    anchors: moved,
  }
}

/**
 * The hidden lines written onto the box itself, so the panel around it can read a caret
 * or a jump back in source lines without having to hold the folds it does not own. The
 * outline and the breadcrumbs both work in source lines; the box works in its own.
 */
export const FOLD_DATA = 'data-fold-hidden'

export function readHiddenRanges(element: Element | null | undefined): HiddenRange[] {
  const raw = element?.getAttribute(FOLD_DATA)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is HiddenRange =>
        typeof entry === 'object'
        && entry !== null
        && typeof (entry as HiddenRange).start === 'number'
        && typeof (entry as HiddenRange).end === 'number',
    )
  } catch {
    return []
  }
}
