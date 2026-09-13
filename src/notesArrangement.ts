/**
 * The prep notes arrangement as something that survives the app being closed.
 *
 * What is open, how it is split, and which pane has focus is the reader's workspace, not
 * their data: it belongs to this browser on this machine the way the theme does, so it
 * lives in `localStorage` rather than in the tracker document. Putting it in the document
 * would write the shared file on every tab click and carry one machine's panes into every
 * export.
 *
 * Nothing here is React. Restoring is a pure function of what was stored and which
 * applications still exist, so every way a stored arrangement can have gone stale — an
 * application deleted, a state renamed, a file hand-edited — is answerable in a test
 * without rendering a panel.
 */

import type { Application, StateId } from './domain'
import { isStateId, stateRank } from './domain'
import type { StorageLike } from './domain/storage'
import { trackerProfile } from './domain/trackerProfile'
import {
  FIRST_PANE_ID,
  MIN_PANE_FRACTION,
  groupsOf,
  makeGroup,
  noteRefKey,
  prune,
  type LayoutNode,
  type NoteRef,
  type SplitNode,
  type TabGroup,
} from './notesLayout'

/**
 * Bumped when the stored shape stops being readable by this code. An arrangement from a
 * version this one does not know is dropped rather than guessed at: the cost is one
 * rebuilt workspace, and the alternative is a panel restored into a shape it cannot hold.
 */
export const ARRANGEMENT_VERSION = 1

/** How long the arrangement settles before it is written. */
export const ARRANGEMENT_SAVE_MS = 300

export interface Arrangement {
  layout: LayoutNode
  focusedGroupId: string
}

/**
 * Keyed by profile so a demo session cannot hand its refs to a live one: the two documents
 * share no application ids, and every restored tab would be dropped as deleted.
 */
export function arrangementKey(profile: string = trackerProfile()): string {
  return `job-applications-tracker:notes-arrangement:${profile}`
}

export function serializeArrangement({ layout, focusedGroupId }: Arrangement): string {
  return JSON.stringify({ version: ARRANGEMENT_VERSION, layout, focusedGroupId })
}

/**
 * The arrangement a panel opens with when nothing was stored: the stage it was opened for
 * first, then that application's other noted stages, so the stage you are interviewing
 * for is the one you land on.
 */
export function openingLayout(application: Application, state: StateId): TabGroup {
  const rest = [...new Set(application.stage_notes.map((note) => note.state))]
    .filter((noted) => noted !== state)
    .sort((left, right) => stateRank(left) - stateRank(right))
  const tabs: NoteRef[] = [state, ...rest].map((stage) => ({
    applicationId: application.id,
    state: stage,
  }))
  return makeGroup(FIRST_PANE_ID, tabs, noteRefKey({ applicationId: application.id, state }))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * Sizes no reader could use are the one thing a stored split may not keep: a pane too thin
 * to hold a line of a note is a pane that has to be dragged back open before the note in
 * it can be read. Undersized panes are lifted to the minimum and the rest scaled into what
 * is left, repeatedly, because lifting one can push another under.
 */
function readableSizes(sizes: number[]): number[] {
  const count = sizes.length
  const even = (): number[] => new Array<number>(count).fill(1 / count)
  if (count === 0) return sizes
  // No arrangement of this many panes clears the minimum, so none of them is preferred.
  if (MIN_PANE_FRACTION * count > 1) return even()

  let next = sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0))
  for (let pass = 0; pass <= count; pass += 1) {
    const total = next.reduce((sum, size) => sum + size, 0)
    if (total <= 0) return even()
    next = next.map((size) => size / total)

    const short = next.filter((size) => size < MIN_PANE_FRACTION).length
    if (short === 0) return next
    const room = 1 - MIN_PANE_FRACTION * short
    const spare = next.reduce((sum, size) => (size < MIN_PANE_FRACTION ? sum : sum + size), 0)
    next = next.map((size) =>
      size < MIN_PANE_FRACTION
        ? MIN_PANE_FRACTION
        : spare > 0
          ? (size / spare) * room
          : room / (count - short),
    )
  }
  return even()
}

/**
 * Rebuilds one node from whatever was stored, dropping anything it cannot vouch for. A
 * child it cannot read is dropped rather than defaulted: half a pane restored is harder to
 * recognise as wrong than a pane that is simply not there.
 *
 * `seen` carries the refs already placed, so a note stored in two panes comes back in one.
 * `openInGroup` and `moveTab` keep that invariant while the panel runs; a hand-edited file
 * must not be able to break it, because two copies of a note give one find match two ids.
 */
function readNode(
  value: unknown,
  known: ReadonlySet<string>,
  seen: Set<string>,
): LayoutNode | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null

  if (value.kind === 'group') {
    if (!Array.isArray(value.tabs)) return null
    const tabs: NoteRef[] = []
    for (const tab of value.tabs) {
      if (!isRecord(tab)) continue
      const { applicationId, state } = tab
      if (typeof applicationId !== 'string' || !known.has(applicationId)) continue
      if (!isStateId(state)) continue
      const key = noteRefKey({ applicationId, state })
      if (seen.has(key)) continue
      seen.add(key)
      tabs.push({ applicationId, state })
    }
    const activeKey = typeof value.activeKey === 'string' ? value.activeKey : null
    return makeGroup(value.id, tabs, activeKey)
  }

  if (value.kind !== 'split') return null
  const stored: unknown[] = Array.isArray(value.children) ? value.children : []
  if (stored.length === 0) return null
  if (value.direction !== 'row' && value.direction !== 'column') return null
  const sizes: unknown[] = Array.isArray(value.sizes) ? value.sizes : []

  const children: LayoutNode[] = []
  const kept: number[] = []
  stored.forEach((child, index) => {
    const node = readNode(child, known, seen)
    if (!node) return
    children.push(node)
    const size = sizes[index]
    kept.push(typeof size === 'number' ? size : 1 / stored.length)
  })
  if (children.length === 0) return null

  const split: SplitNode = {
    kind: 'split',
    id: value.id,
    direction: value.direction,
    children,
    sizes: readableSizes(kept),
  }
  return split
}

/**
 * What the panel should open with, given what was stored and which applications still
 * exist. Null means there is nothing left to restore, which is the view's empty state.
 *
 * A tab whose note has been emptied is deliberately kept: the arrangement is the panel's
 * own, not a reading of which notes exist, and clearing a note is not a reason to
 * rearrange the panes around whoever cleared it. A tab whose *application* is gone has
 * nothing left to show and goes.
 */
export function restoreArrangement(
  raw: string | null,
  applications: readonly Application[],
): Arrangement | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.version !== ARRANGEMENT_VERSION) return null

  const known = new Set(applications.map((application) => application.id))
  const read = readNode(parsed.layout, known, new Set())
  if (!read) return null
  const layout = prune(read)
  if (!layout) return null

  const groups = groupsOf(layout)
  const stored = parsed.focusedGroupId
  const focusedGroupId =
    typeof stored === 'string' && groups.some((group) => group.id === stored)
      ? stored
      : groups[0].id
  return { layout, focusedGroupId }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function loadArrangement(
  applications: readonly Application[],
  storage: StorageLike | null = browserStorage(),
): Arrangement | null {
  if (!storage) return null
  try {
    return restoreArrangement(storage.getItem(arrangementKey()), applications)
  } catch {
    return null
  }
}

/**
 * Writes are best-effort in both directions: a full or blocked store must not break the
 * panel, which is still perfectly usable without remembering where its panes were.
 */
export function saveArrangement(
  arrangement: Arrangement,
  storage: StorageLike | null = browserStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(arrangementKey(), serializeArrangement(arrangement))
  } catch {
    // An arrangement is not the reader's data; losing one is not worth an error.
  }
}

export function clearArrangement(storage: StorageLike | null = browserStorage()): void {
  if (!storage) return
  try {
    storage.removeItem(arrangementKey())
  } catch {
    // As above.
  }
}
