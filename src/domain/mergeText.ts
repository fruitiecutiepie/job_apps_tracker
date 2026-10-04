/**
 * Three-way merging for a note written in two places at once.
 *
 * A note autosaves its whole body, so two tabs holding one note each save "the note is now
 * this", and the later save replaces the earlier one entirely. Knowing the text both
 * started from turns the two saves back into two edits, which can then both be kept.
 *
 * Deliberately small: each side's change is taken as one contiguous region — the span
 * between the longest common prefix and suffix it shares with the base. What is merged is
 * a few seconds of typing on each side, which is almost always one region, and a single
 * region per side is something a reader can predict. Where the two regions overlap, both
 * replacements are kept, the other side's first: text in a note is never dropped to settle
 * a conflict, because a duplicated sentence is a nuisance and a lost one is not noticed.
 */

interface Change {
  /** Where in the base the changed region starts and ends. */
  start: number
  end: number
}

function commonPrefix(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

/** The suffix shared beyond `from`, never reaching back past it on either side. */
function commonSuffix(left: string, right: string, from: number): number {
  const limit = Math.min(left.length, right.length) - from
  let length = 0
  while (length < limit && left[left.length - 1 - length] === right[right.length - 1 - length]) {
    length += 1
  }
  return length
}

function changeBetween(base: string, edited: string): Change {
  const start = commonPrefix(base, edited)
  const suffix = commonSuffix(base, edited, start)
  return { start, end: base.length - suffix }
}

/** What `edited` puts in place of `base[start, end)`, given it matches base outside it. */
function replacement(base: string, edited: string, start: number, end: number): string {
  return edited.slice(start, edited.length - (base.length - end))
}

export function mergeText(base: string, ours: string, theirs: string): string {
  if (ours === theirs || theirs === base) return ours
  if (ours === base) return theirs

  const mine = changeBetween(base, ours)
  const other = changeBetween(base, theirs)

  /*
   * Changes that only touch are apart, ordered by where they sit — an insertion at the edge
   * of a replacement goes beside it rather than bringing back the text it replaced. Two
   * insertions at one point overlap, since nothing orders them; so does an insertion at the
   * edge of a deletion, which keeps the deleted text the insertion was continuing.
   */
  const inserts = (change: Change) => change.start === change.end
  const deletes = (change: Change, text: string) =>
    change.start < change.end && replacement(base, text, change.start, change.end) === ''
  const touching = mine.end === other.start || other.end === mine.start
  const apart = mine.end < other.start
    || other.end < mine.start
    || (touching
      && !(inserts(mine) && inserts(other))
      && !(inserts(mine) && deletes(other, theirs))
      && !(inserts(other) && deletes(mine, ours)))
  if (apart) {
    // On a shared start the insertion goes first: it sits before what the other replaced.
    const mineFirst = mine.start < other.start || (mine.start === other.start && mine.end <= other.end)
    const [first, second] = mineFirst
      ? [{ change: mine, text: ours }, { change: other, text: theirs }]
      : [{ change: other, text: theirs }, { change: mine, text: ours }]
    return base.slice(0, first.change.start)
      + replacement(base, first.text, first.change.start, first.change.end)
      + base.slice(first.change.end, second.change.start)
      + replacement(base, second.text, second.change.start, second.change.end)
      + base.slice(second.change.end)
  }

  const start = Math.min(mine.start, other.start)
  const end = Math.max(mine.end, other.end)
  const fromThem = replacement(base, theirs, start, end)
  const fromMe = replacement(base, ours, start, end)
  const middle = fromThem === fromMe ? fromMe : fromThem + fromMe
  return base.slice(0, start) + middle + base.slice(end)
}

/**
 * Where an offset into `before` lands in `after`, for a caret that should stay with the
 * text it was in rather than jump when the text around it is replaced from elsewhere.
 * Before the changed region it stays; after it, it moves by the change in length; inside
 * it, it goes to the end of what replaced the region.
 */
export function mapOffset(before: string, after: string, offset: number): number {
  const { start, end } = changeBetween(before, after)
  if (offset <= start) return offset
  const delta = after.length - before.length
  if (offset >= end) return offset + delta
  return end + delta
}

/**
 * The text to keep for a draft begun from `startedFrom` when `stored` is what the note
 * holds now. Unchanged since the draft began, the draft is the answer; changed — another
 * tab wrote it — the two edits are merged.
 *
 * A stored body is trimmed, so what the draft began from is compared trimmed too: this
 * tab's own last write, coming back without its trailing space, is not somebody else's
 * edit.
 */
export function rebaseDraft(startedFrom: string, draft: string, stored: string): string {
  const base = startedFrom.trim()
  if (stored === base || stored === startedFrom) return draft
  return mergeText(base, draft, stored)
}
