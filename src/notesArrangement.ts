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
  POSTING_SEGMENT,
  noteRefKey,
  postingRef,
  prune,
  stageRef,
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

/**
 * What the captured lines may be resized between, in pixels. The floor is a couple of
 * lines — below that the log says nothing and the collapse toggle is the way to put it
 * away entirely — and the ceiling leaves the note it is docked under something to show.
 */
export const MIN_CAPTURE_LOG = 48
export const MAX_CAPTURE_LOG = 640

/**
 * What the log stands at before anyone drags it: eleven lines of it, the height the dock
 * has always had. The stylesheet carries the same figure as the fallback on
 * `var(--capture-log)`, for a render that has not been given one yet; this is the source
 * of truth, because the control needs a number to report and to count from.
 */
export const DEFAULT_CAPTURE_LOG = 154

/** How far one arrow key moves the dock's edge. */
export const CAPTURE_STEP = 24

/**
 * What the sidebar may be resized between, in pixels. `MIN_SIDEBAR` is both the narrowest
 * it goes and the point past which it closes: a column too thin to read its own rows is
 * not a narrower sidebar, it is a sidebar in the way, so asking for one closes it instead.
 * One rule rather than a floor and a separate collapse point below it — with both, the
 * clamp held the width above the threshold and the collapse could never be reached. The
 * edge stays either way, so the way back is where the way out was, and the width is kept.
 *
 * The floor is what the sidebar's own contents can be squeezed into, not a guess: the
 * search box gives up the `9rem` the context bar's copy holds, and a stage heading
 * truncates, so what has to fit is a handful of characters and the padding around them.
 */
export const MIN_SIDEBAR = 96
export const MAX_SIDEBAR = 420

/** How far one arrow key moves the sidebar's edge. */
export const SIDEBAR_STEP = 16

/** The width the stylesheet gives it before anyone drags it, matching `--sidebar`. */
export const DEFAULT_SIDEBAR = 208

/**
 * How the sidebar's two halves share it: a share of the column rather than a height for
 * the outline, so the handle means the same thing in a tall window and a short one, and so
 * what one half gives up the other takes. Half each to begin with, neither being the more
 * important — the outline is where you are, the tree is everywhere else.
 *
 * The floor and the ceiling leave whichever half is losing a heading and a row or two;
 * below that the heading's own fold is the way to put a half away, one control per
 * outcome. A folded half is not a share at all: the one still open takes the column.
 */
export const MIN_OUTLINE_SHARE = 0.15
export const MAX_OUTLINE_SHARE = 0.85
export const OUTLINE_SHARE_STEP = 0.05
export const DEFAULT_OUTLINE_SHARE = 0.5

export function outlineShareWithin(share: number): number {
  const held = Math.min(MAX_OUTLINE_SHARE, Math.max(MIN_OUTLINE_SHARE, share))
  // To the hundredth, so a drag stores a number that reads as a share rather than as the
  // pixel arithmetic it came out of.
  return Math.round(held * 100) / 100
}

export interface Arrangement {
  layout: LayoutNode
  focusedGroupId: string
  /**
   * How tall the captured lines are, for every pane at once: the dock's height is the
   * reader's own preference rather than anything about a note, so it does not change as
   * tabs do. Absent until one is dragged, which leaves the stylesheet its own default.
   */
  captureHeight?: number
  /**
   * How wide the sidebar stands. Absent until one is dragged, which leaves the stylesheet
   * its own width.
   */
  sidebarWidth?: number
  /** How much of the sidebar the outline takes, the notes tree taking the rest. */
  outlineShare?: number
}

/**
 * Keyed by profile so a demo session cannot hand its refs to a live one: the two documents
 * share no application ids, and every restored tab would be dropped as deleted.
 */
export function arrangementKey(profile: string = trackerProfile()): string {
  return `job-applications-tracker:notes-arrangement:${profile}`
}

export function serializeArrangement(
  { layout, focusedGroupId, captureHeight, sidebarWidth, outlineShare }: Arrangement,
): string {
  return JSON.stringify({
    version: ARRANGEMENT_VERSION,
    layout,
    focusedGroupId,
    captureHeight,
    sidebarWidth,
    outlineShare,
  })
}

/** A stored dock height, or nothing at all when it is not one. */
function readCaptureHeight(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.round(Math.min(MAX_CAPTURE_LOG, Math.max(MIN_CAPTURE_LOG, value)))
}

/** The same clamp, for a drag or an arrow key moving the edge. */
export function captureHeightWithin(height: number): number {
  return Math.round(Math.min(MAX_CAPTURE_LOG, Math.max(MIN_CAPTURE_LOG, height)))
}

function readSidebarWidth(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return sidebarWidthWithin(value)
}

export function sidebarWidthWithin(width: number): number {
  return Math.round(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, width)))
}

/**
 * The arrangement a panel opens with when nothing was stored: the application's job posting,
 * then the stage it was opened for, then that application's other noted stages.
 *
 * One strip holding everything written for one application is where this app says "these
 * belong together" — the notes tree is grouped by stage on purpose, to answer what a stage
 * looks like across every application, so a posting has no home there that reads as its
 * application's. The posting leads because it is what every note behind it was written
 * against, and because it belongs to no stage that would place it anywhere in the fan.
 *
 * You still land on the stage you are interviewing for. The posting is context for the note
 * being written, not the thing you came to write.
 */
export function openingLayout(application: Application, state: StateId): TabGroup {
  const rest = [...new Set(application.stage_notes.map((note) => note.state))]
    .filter((noted) => noted !== state)
    .sort((left, right) => stateRank(left) - stateRank(right))
  const stages = [state, ...rest].map((stage) => stageRef(application.id, stage))
  const tabs: NoteRef[] = application.posting
    ? [postingRef(application.id), ...stages]
    : stages
  return makeGroup(FIRST_PANE_ID, tabs, noteRefKey(stageRef(application.id, state)))
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
 * Duplicates are dropped within a pane and only within one. A note open in two panes is an
 * arrangement a reader can make and so is one they can get back; a note twice in one strip
 * is two tabs to the same place and two elements claiming one id, which is why the tab's
 * own id is the pane and the note together.
 */
function readNode(value: unknown, known: ReadonlySet<string>): LayoutNode | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null

  if (value.kind === 'group') {
    if (!Array.isArray(value.tabs)) return null
    const tabs: NoteRef[] = []
    const seen = new Set<string>()
    for (const tab of value.tabs) {
      if (!isRecord(tab)) continue
      const { applicationId, kind, state } = tab
      if (typeof applicationId !== 'string' || !known.has(applicationId)) continue
      /*
       * A tab with no `kind` is a stage note: that is every tab written before postings
       * could be opened in a pane, and reading them as they are is why the stored version
       * did not have to move. A tab naming a kind this build does not know is skipped, the
       * way an unreadable one always was.
       */
      const ref = kind === POSTING_SEGMENT
        ? postingRef(applicationId)
        : kind === undefined || kind === 'stage'
          ? isStateId(state) ? stageRef(applicationId, state) : null
          : null
      if (!ref) continue
      const key = noteRefKey(ref)
      if (seen.has(key)) continue
      seen.add(key)
      tabs.push(ref)
    }
    const activeKey = typeof value.activeKey === 'string' ? value.activeKey : null
    /*
     * A pane stored empty is one the reader opened and has not filled yet, and it comes
     * back as it was. A pane that held notes and holds none now lost them to an
     * application that is gone, which is a pane with nothing left to be — the difference
     * is only visible here, while the stored tabs are still in hand.
     */
    if (tabs.length === 0 && value.tabs.length > 0) return null
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
    const node = readNode(child, known)
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
  const read = readNode(parsed.layout, known)
  if (!read) return null
  const layout = prune(read)
  // Panes may be empty; a panel may not. With no note anywhere there is nothing to restore
  // into, and the view's own empty state is what the reader should see.
  if (!layout || groupsOf(layout).every((group) => group.tabs.length === 0)) return null

  const groups = groupsOf(layout)
  const stored = parsed.focusedGroupId
  const focusedGroupId =
    typeof stored === 'string' && groups.some((group) => group.id === stored)
      ? stored
      : groups[0].id

  const restored: Arrangement = { layout, focusedGroupId }
  const captureHeight = readCaptureHeight(parsed.captureHeight)
  if (captureHeight !== undefined) restored.captureHeight = captureHeight
  const sidebarWidth = readSidebarWidth(parsed.sidebarWidth)
  if (sidebarWidth !== undefined) restored.sidebarWidth = sidebarWidth
  /*
   * Only `outlineShare` is read. An arrangement stored before the handle was a share holds
   * `outlineHeight`, a number of pixels, and reading that as a share would clamp to the
   * ceiling and hand the outline the whole column. Nothing else in that arrangement is
   * stale, so it restores as it always did and the division goes back to half each.
   */
  const outlineShare = typeof parsed.outlineShare === 'number' && Number.isFinite(parsed.outlineShare)
    ? outlineShareWithin(parsed.outlineShare)
    : undefined
  if (outlineShare !== undefined) restored.outlineShare = outlineShare
  return restored
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
