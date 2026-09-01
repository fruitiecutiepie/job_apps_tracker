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

import type { StateId } from './domain'

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
 * Every open note, in layout order. The find numbers its matches along this sequence, so
 * the order here is the order the find bar steps through the panel.
 */
export function orderedRefs(node: LayoutNode): NoteRef[] {
  return groupsOf(node).flatMap((group) => group.tabs)
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
  const existing = groupHolding(tree, key)
  if (existing) return activateTab(tree, existing.id, key)

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
export function moveTab(
  tree: LayoutNode,
  key: string,
  toGroupId: string,
  index: number,
): LayoutNode {
  const source = groupHolding(tree, key)
  if (!source) return tree
  const ref = source.tabs.find((tab) => noteRefKey(tab) === key)
  if (!ref) return tree

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
): LayoutNode {
  const key = noteRefKey(ref)
  const target = findGroup(tree, targetGroupId)
  if (!target) return tree

  // Splitting a pane off with the only note it holds would close it and reopen it beside
  // itself, which is a no-op with extra steps.
  const source = groupHolding(tree, key)
  if (source && source.id === targetGroupId && source.tabs.length === 1) return tree

  const axis = axisFor(edge)
  const before = isBefore(edge)
  const fresh = makeGroup(makeId(), [ref], key)

  const detached = source ? mapGroups(tree, (group) => withoutTab(group, key)) : tree

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
