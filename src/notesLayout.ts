/**
 * How the prep notes panel is arranged: a tree of tab groups, split rows and columns.
 *
 * This is the panel's layout algebra and holds no React and no DOM. Every operation
 * takes a tree and returns a new one, so the arrangement can be reasoned about — and
 * tested — without rendering anything. What the panel adds on top is which group has
 * focus and how a pointer drag names an edge; the shape itself lives here.
 *
 * A note is identified by the application it belongs to and the state it prepares for.
 * Keying by state alone is what the single-application panel did, and it is exactly what
 * breaks once two applications are open: two notes would claim one tab, one panel id and
 * one set of find ordinals.
 */

import { isStateId, type StateId } from './domain'

export interface NoteRef {
  applicationId: string
  state: StateId
}

/**
 * A note's identity as one string, for keying maps and naming DOM ids. The separator is
 * two colons because neither half can contain one: an application id is a UUID and a
 * state is an identifier from STATE_CONFIG.
 */
export const noteRefKey = (ref: NoteRef): string => `${ref.applicationId}::${ref.state}`

/**
 * A note asked for from somewhere outside the panel — a card, a table row, the editor.
 * The nonce is what tells a second request for the same note from the request already
 * handled: without it, asking twice for the note you are already on is no change at all,
 * and the second ask does nothing.
 */
export interface NoteRequest {
  ref: NoteRef
  nonce: number
}

/**
 * One open copy of a note: the pane it is in and the note it shows.
 *
 * A note may be open in several panes — reading one beside another part of itself, or
 * beside a different company's, is what a split is for — so the note's own key no longer
 * names a tab on its own. It names a note; this names a copy. Within one pane a note is
 * still open at most once, because two tabs in one strip showing the same thing would be
 * two ways to the same place, and that is what makes the pair unique without minting ids.
 *
 * The separator cannot appear in either half: a pane id is `pane-N` and a note key is two
 * identifiers joined by `::`.
 */
export const tabId = (groupId: string, ref: NoteRef): string => `${groupId}@${noteRefKey(ref)}`

export function parseTabId(id: string): { groupId: string; ref: NoteRef } | null {
  const at = id.indexOf('@')
  if (at <= 0) return null
  const ref = parseNoteRefKey(id.slice(at + 1))
  return ref ? { groupId: id.slice(0, at), ref } : null
}

export function sameRef(left: NoteRef, right: NoteRef): boolean {
  return left.applicationId === right.applicationId && left.state === right.state
}

export interface TabGroup {
  kind: 'group'
  id: string
  tabs: NoteRef[]
  /** The tab on show, or null only while the group is empty and about to be pruned. */
  activeKey: string | null
}

export interface SplitNode {
  kind: 'split'
  id: string
  direction: 'row' | 'column'
  children: LayoutNode[]
  /** One fraction per child, summing to 1. */
  sizes: number[]
}

export type LayoutNode = TabGroup | SplitNode

/** Which side of a pane a tab was dropped on, or a move was aimed at. */
export type Edge = 'left' | 'right' | 'top' | 'bottom'

/**
 * The least of a split any one pane may be reduced to. A pane thinner than this holds no
 * readable line of a note, so a drag that would produce one is clamped rather than
 * refused: stopping at the limit is easier to understand mid-drag than nothing happening.
 */
export const MIN_PANE_FRACTION = 0.15

export const isGroup = (node: LayoutNode): node is TabGroup => node.kind === 'group'
export const isSplit = (node: LayoutNode): node is SplitNode => node.kind === 'split'

const axisFor = (edge: Edge): SplitNode['direction'] =>
  edge === 'left' || edge === 'right' ? 'row' : 'column'

const isBefore = (edge: Edge): boolean => edge === 'left' || edge === 'top'

export function makeGroup(id: string, tabs: NoteRef[], activeKey?: string | null): TabGroup {
  const keys = tabs.map(noteRefKey)
  const active = activeKey && keys.includes(activeKey) ? activeKey : (keys.at(-1) ?? null)
  return { kind: 'group', id, tabs, activeKey: active }
}

/** The tree a panel opens with: one group holding one note. */
export function singleGroup(id: string, ref: NoteRef): TabGroup {
  return makeGroup(id, [ref], noteRefKey(ref))
}

/** Every group in the tree, in the order they are laid out. */
export function groupsOf(node: LayoutNode): TabGroup[] {
  return isGroup(node) ? [node] : node.children.flatMap(groupsOf)
}

/**
 * Every open note, in layout order. A note open in two panes appears twice, because that
 * is two notes on screen.
 */
export function orderedRefs(node: LayoutNode): NoteRef[] {
  return groupsOf(node).flatMap((group) => group.tabs)
}

/**
 * The same, as the copies they are: each with the pane it is in. The find numbers its
 * matches along this sequence, so the order here is the order it steps through the panel —
 * and a note open twice contributes its matches twice, once per copy, since each is a
 * place on screen a reader can be sent to.
 */
export function orderedTabs(node: LayoutNode): { groupId: string; ref: NoteRef }[] {
  return groupsOf(node).flatMap((group) => group.tabs.map((ref) => ({ groupId: group.id, ref })))
}

/**
 * The pane a panel opens with. Named here rather than in the panel because restoring an
 * arrangement has to mint pane ids past the ones it read back, and both halves of that
 * have to agree on where the numbering starts.
 */
export const FIRST_PANE_ID = 'pane-1'

/**
 * The largest `pane-N` in the tree, or 0 when none of the ids are numbered panes. A panel
 * handed a restored arrangement counts from here: minting `pane-2` again beside a
 * restored one would give two panes one id, and every operation that names a pane would
 * then act on both.
 */
export function highestPaneNumber(node: LayoutNode): number {
  return groupsOf(node).reduce((highest, group) => {
    const match = /^pane-(\d+)$/.exec(group.id)
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 0)
}

export function findGroup(node: LayoutNode, groupId: string): TabGroup | null {
  return groupsOf(node).find((group) => group.id === groupId) ?? null
}

/** The group holding a note, if any group does. */
export function groupHolding(node: LayoutNode, key: string): TabGroup | null {
  return groupsOf(node).find((group) => group.tabs.some((tab) => noteRefKey(tab) === key)) ?? null
}

/** Evenly-spread fractions for `count` children. */
const evenSizes = (count: number): number[] => new Array(count).fill(1 / count)

/**
 * Rescales sizes to sum to 1 again after a child was added or removed. Proportional
 * rather than reset to even, so panes the reader had already sized keep their relative
 * widths when a neighbour goes.
 */
function normalise(sizes: number[]): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0)
  if (total <= 0) return evenSizes(sizes.length)
  return sizes.map((size) => size / total)
}

/** Replaces one group in the tree, leaving the rest of the shape alone. */
function mapGroup(node: LayoutNode, groupId: string, fn: (group: TabGroup) => TabGroup): LayoutNode {
  if (isGroup(node)) return node.id === groupId ? fn(node) : node
  return { ...node, children: node.children.map((child) => mapGroup(child, groupId, fn)) }
}

/** Applies a transform to every group. */
function mapGroups(node: LayoutNode, fn: (group: TabGroup) => TabGroup): LayoutNode {
  if (isGroup(node)) return fn(node)
  return { ...node, children: node.children.map((child) => mapGroups(child, fn)) }
}

/**
 * Drops a tab from a group, moving the active tab to a neighbour when it was the one
 * removed. The tab before it is preferred: closing a tab you opened last should land you
 * back where you were, not on whatever happened to follow it.
 */
function withoutTab(group: TabGroup, key: string): TabGroup {
  const index = group.tabs.findIndex((tab) => noteRefKey(tab) === key)
  if (index === -1) return group

  const tabs = group.tabs.filter((_, entry) => entry !== index)
  if (group.activeKey !== key) return { ...group, tabs }
  const neighbour = tabs[Math.max(0, index - 1)]
  return { ...group, tabs, activeKey: neighbour ? noteRefKey(neighbour) : null }
}

/**
 * Removes emptied groups and collapses a split left holding one child, so no arrangement
 * ever shows an empty pane or a split that splits nothing. Returns null when the whole
 * tree emptied, which is the panel's cue to close.
 */
export function prune(node: LayoutNode): LayoutNode | null {
  if (isGroup(node)) return node.tabs.length > 0 ? node : null

  const kept: LayoutNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, index) => {
    const pruned = prune(child)
    if (!pruned) return
    kept.push(pruned)
    sizes.push(node.sizes[index] ?? 1 / node.children.length)
  })

  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0]
  return { ...node, children: kept, sizes: normalise(sizes) }
}

/**
 * Opens a note in a group, or moves focus to it when it is already open somewhere. A note
 * lives in at most one group: two copies would give one match two find ordinals and two
 * elements the same id, and the find would step onto whichever the DOM returned first.
 */
export function openInGroup(tree: LayoutNode, groupId: string, ref: NoteRef): LayoutNode {
  const key = noteRefKey(ref)
  // Only this pane's own tabs are consulted: a copy somewhere else is a copy somewhere
  // else, and opening one here is not a request to go there.
  const here = findGroup(tree, groupId)
  if (here?.tabs.some((tab) => noteRefKey(tab) === key)) return activateTab(tree, groupId, key)

  const opened = mapGroup(tree, groupId, (group) => ({
    ...group,
    tabs: [...group.tabs, ref],
    activeKey: key,
  }))
  return prune(opened) ?? opened
}

export function activateTab(tree: LayoutNode, groupId: string, key: string): LayoutNode {
  return mapGroup(tree, groupId, (group) =>
    group.tabs.some((tab) => noteRefKey(tab) === key) ? { ...group, activeKey: key } : group,
  )
}

/**
 * Swaps one tab for a different stage of the same application, in the tab's own place:
 * the position it held and its focus both carry over, rather than the new stage arriving
 * as a fresh tab at the end of the strip. Used for the stage picked from a note's own
 * header, where the reader means "show me this stage instead", not "also open this one".
 *
 * If that stage is already open somewhere else, a note cannot end up open twice: that
 * tab is focused instead, and the one being swapped out closes.
 */
export function replaceTab(tree: LayoutNode, groupId: string, fromKey: string, ref: NoteRef): LayoutNode {
  const toKey = noteRefKey(ref)
  if (fromKey === toKey) return tree

  // Only this pane's own tabs stand in the way. A copy in another pane is somewhere else,
  // and swapping onto a stage here is not a request to go there; but swapping onto one
  // this pane already shows would leave two tabs for it, so that one closes the old tab
  // and moves to the tab already holding it.
  const here = findGroup(tree, groupId)
  if (here?.tabs.some((tab) => noteRefKey(tab) === toKey)) {
    const focused = activateTab(tree, groupId, toKey)
    return closeTab(focused, groupId, fromKey) ?? focused
  }

  return mapGroup(tree, groupId, (group) => ({
    ...group,
    tabs: group.tabs.map((tab) => (noteRefKey(tab) === fromKey ? ref : tab)),
    activeKey: toKey,
  }))
}

/**
 * Closes one tab. Null means the last note in the panel just closed.
 *
 * Unlike the single-application panel, no tab is exempt: with several applications open
 * there is no one stage the panel must always have somewhere to land on, and an
 * undismissable tab per application would only accumulate.
 */
export function closeTab(tree: LayoutNode, groupId: string, key: string): LayoutNode | null {
  return prune(mapGroup(tree, groupId, (group) => withoutTab(group, key)))
}

/** Closes every tab in a group, taking the pane with it. */
export function closeGroup(tree: LayoutNode, groupId: string): LayoutNode | null {
  return prune(mapGroup(tree, groupId, (group) => ({ ...group, tabs: [], activeKey: null })))
}

/**
 * Moves a tab within its group or into another one, landing it at `index`. The removal
 * and the insertion happen in one pass and the tree is pruned only afterwards, so moving
 * the last tab out of a group cannot invalidate the destination mid-move.
 */
/**
 * Puts a note in a pane at a given position, leaving any copy in another pane where it is.
 *
 * This is what a note arriving from the tree of unopened notes does, and what a note being
 * reordered inside its own strip does — one function, because from the reader's side they
 * are one thing: the note lands here. Taking it away from another pane is a different
 * intent with its own function, `moveTab`, which is what dragging a tab means.
 */
export function placeTab(
  tree: LayoutNode,
  ref: NoteRef,
  toGroupId: string,
  index: number,
): LayoutNode {
  const target = findGroup(tree, toGroupId)
  if (!target) return tree
  const key = noteRefKey(ref)

  if (!target.tabs.some((tab) => noteRefKey(tab) === key)) {
    return mapGroup(tree, toGroupId, (group) => {
      const at = Math.max(0, Math.min(index, group.tabs.length))
      return { ...group, tabs: [...group.tabs.slice(0, at), ref, ...group.tabs.slice(at)], activeKey: key }
    })
  }

  // Already here, so this is a reorder within the strip rather than a second copy of it.
  return mapGroup(tree, toGroupId, (group) => {
    const without = group.tabs.filter((tab) => noteRefKey(tab) !== key)
    const at = Math.max(0, Math.min(index, without.length))
    return { ...group, tabs: [...without.slice(0, at), ref, ...without.slice(at)], activeKey: key }
  })
}

/**
 * Moves one open copy from the pane holding it to another, which is what dragging a tab
 * means: the note was there and is now here, rather than being in both.
 */
export function moveTab(
  tree: LayoutNode,
  fromGroupId: string,
  key: string,
  toGroupId: string,
  index: number,
): LayoutNode {
  const source = findGroup(tree, fromGroupId)
  const ref = source?.tabs.find((tab) => noteRefKey(tab) === key)
  if (!source || !ref || !findGroup(tree, toGroupId)) return tree

  const sameGroup = source.id === toGroupId
  const moved = mapGroups(tree, (group) => {
    if (group.id === source.id && group.id === toGroupId) {
      const without = group.tabs.filter((tab) => noteRefKey(tab) !== key)
      const at = Math.max(0, Math.min(index, without.length))
      return { ...group, tabs: [...without.slice(0, at), ref, ...without.slice(at)], activeKey: key }
    }
    if (group.id === source.id) return withoutTab(group, key)
    if (group.id === toGroupId) {
      const at = Math.max(0, Math.min(index, group.tabs.length))
      return { ...group, tabs: [...group.tabs.slice(0, at), ref, ...group.tabs.slice(at)], activeKey: key }
    }
    return group
  })

  // A move within one group can never empty it, so pruning is only needed across groups.
  return sameGroup ? moved : (prune(moved) ?? moved)
}

/**
 * A key read back as the note it names, for a drag that carries one out of the tree of
 * notes the panel does not have open — there is no tab to look the ref up on. Neither half
 * can hold the separator: an application id is a uuid and a state is an identifier from
 * `STATE_CONFIG`, which is also what makes the state worth checking rather than trusting.
 */
export function parseNoteRefKey(key: string): NoteRef | null {
  const [applicationId, state, ...rest] = key.split('::')
  if (!applicationId || rest.length > 0 || !isStateId(state)) return null
  return { applicationId, state }
}

/**
 * Puts a note in a new pane beside an existing one.
 *
 * When the pane's own split already runs along the same axis the new pane joins it as a
 * sibling rather than nesting inside it. Without that, splitting right three times would
 * build three levels of tree to show three panes in a row, and every resize would have to
 * walk them.
 */
export function splitWith(
  tree: LayoutNode,
  targetGroupId: string,
  edge: Edge,
  ref: NoteRef,
  makeId: () => string,
  /**
   * The pane to take this copy out of, for a tab being dragged out of one. Left out by a
   * caller opening a note that is not being moved — one from the tree of unopened notes, or
   * a second copy of one open elsewhere — which leaves every existing copy where it is.
   */
  detachFrom?: string | null,
): LayoutNode {
  const key = noteRefKey(ref)
  const target = findGroup(tree, targetGroupId)
  if (!target) return tree

  // Splitting a pane off with the only note it holds would close it and reopen it beside
  // itself, which is a no-op with extra steps. Only when that note is the one being taken:
  // a pane holding one other note is a pane this can still be split off.
  const source = detachFrom ? findGroup(tree, detachFrom) : null
  if (
    source
    && source.id === targetGroupId
    && source.tabs.length === 1
    && noteRefKey(source.tabs[0]) === key
  ) {
    return tree
  }

  const axis = axisFor(edge)
  const before = isBefore(edge)
  const fresh = makeGroup(makeId(), [ref], key)

  const detached = source
    ? mapGroup(tree, source.id, (group) => withoutTab(group, key))
    : tree

  const inserted = insertBeside(detached, targetGroupId, axis, before, fresh, makeId)
  return prune(inserted) ?? inserted
}

/**
 * Places `fresh` next to the group named, either into the split already running on that
 * axis or into a new one wrapping the target.
 */
function insertBeside(
  node: LayoutNode,
  targetGroupId: string,
  axis: SplitNode['direction'],
  before: boolean,
  fresh: TabGroup,
  makeId: () => string,
): LayoutNode {
  if (isGroup(node)) {
    if (node.id !== targetGroupId) return node
    const children = before ? [fresh, node] : [node, fresh]
    return { kind: 'split', id: makeId(), direction: axis, children, sizes: evenSizes(2) }
  }

  const index = node.children.findIndex(
    (child) => isGroup(child) && child.id === targetGroupId,
  )

  if (index !== -1 && node.direction === axis) {
    const at = before ? index : index + 1
    const children = [...node.children.slice(0, at), fresh, ...node.children.slice(at)]
    // The new pane takes an even share and the rest keep their proportions.
    const share = 1 / children.length
    const scale = 1 - share
    const sizes = [
      ...node.sizes.slice(0, at).map((size) => size * scale),
      share,
      ...node.sizes.slice(at).map((size) => size * scale),
    ]
    return { ...node, children, sizes: normalise(sizes) }
  }

  return {
    ...node,
    children: node.children.map((child) =>
      insertBeside(child, targetGroupId, axis, before, fresh, makeId),
    ),
  }
}

/**
 * The pane on a given side of another, or null when nothing is over there.
 *
 * Walks up from the pane rather than measuring the screen: the nearest ancestor split
 * running along that axis is the one that decides what is beside it, and the answer holds
 * however the tree is nested. Reaching for the pane physically nearest would mean
 * measuring layout, which is both harder to reason about and unavailable before a render.
 */
export function neighbourGroup(tree: LayoutNode, groupId: string, edge: Edge): string | null {
  const axis = axisFor(edge)
  const back = isBefore(edge)

  /** The chain of splits from the root down to the group, nearest last. */
  const trail: { split: SplitNode; index: number }[] = []
  const walk = (node: LayoutNode): boolean => {
    if (isGroup(node)) return node.id === groupId
    for (const [index, child] of node.children.entries()) {
      if (!walk(child)) continue
      trail.push({ split: node, index })
      return true
    }
    return false
  }
  if (!walk(tree)) return null

  for (const { split, index } of trail) {
    if (split.direction !== axis) continue
    const sibling = split.children[back ? index - 1 : index + 1]
    if (!sibling) continue
    // The nearest pane inside that sibling, which is its last one coming from the right
    // and its first one coming from the left.
    const panes = groupsOf(sibling)
    return (back ? panes.at(-1) : panes[0])?.id ?? null
  }
  return null
}

/**
 * Moves one divider of a split. `delta` is a fraction of the whole split, positive
 * towards the later child. Both neighbours are held at `MIN_PANE_FRACTION`, so a drag
 * past the limit stops there rather than collapsing a pane out of sight.
 */
export function resizeSplit(
  tree: LayoutNode,
  splitId: string,
  dividerIndex: number,
  delta: number,
): LayoutNode {
  if (isGroup(tree)) return tree

  if (tree.id === splitId) {
    const before = tree.sizes[dividerIndex]
    const after = tree.sizes[dividerIndex + 1]
    if (before === undefined || after === undefined) return tree

    const room = before + after
    const next = Math.max(MIN_PANE_FRACTION, Math.min(room - MIN_PANE_FRACTION, before + delta))
    // A pair with no room for two minimums cannot be divided; leave it as it is.
    if (room < MIN_PANE_FRACTION * 2) return tree

    const sizes = [...tree.sizes]
    sizes[dividerIndex] = next
    sizes[dividerIndex + 1] = room - next
    return { ...tree, sizes }
  }

  return {
    ...tree,
    children: tree.children.map((child) => resizeSplit(child, splitId, dividerIndex, delta)),
  }
}
