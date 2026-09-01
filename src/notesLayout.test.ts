import { describe, expect, it } from 'vitest'

import {
  MIN_PANE_FRACTION,
  closeGroup,
  closeTab,
  findGroup,
  groupHolding,
  groupsOf,
  isSplit,
  makeGroup,
  moveTab,
  noteRefKey,
  openInGroup,
  orderedRefs,
  prune,
  resizeSplit,
  singleGroup,
  splitWith,
  type LayoutNode,
  type NoteRef,
  type SplitNode,
} from './notesLayout'

const acme = (state: NoteRef['state']): NoteRef => ({ applicationId: 'acme', state })
const globex = (state: NoteRef['state']): NoteRef => ({ applicationId: 'globex', state })

/** Ids the assertions can name, rather than whatever a counter happened to reach. */
function ids(...names: string[]): () => string {
  let index = 0
  return () => names[index++] ?? `extra-${index}`
}

const paneNames = (tree: LayoutNode): string[] => groupsOf(tree).map((group) => group.id)

const refKeys = (tree: LayoutNode): string[] => orderedRefs(tree).map(noteRefKey)

describe('noteRefKey', () => {
  it('tells two applications apart at the same stage', () => {
    expect(noteRefKey(acme('interview_1'))).not.toBe(noteRefKey(globex('interview_1')))
  })

  it('tells two stages of one application apart', () => {
    expect(noteRefKey(acme('interview_1'))).not.toBe(noteRefKey(acme('interview_2')))
  })
})

describe('makeGroup', () => {
  it('activates the last tab when no active key is given', () => {
    const group = makeGroup('g1', [acme('applied'), acme('offer')])
    expect(group.activeKey).toBe(noteRefKey(acme('offer')))
  })

  it('ignores an active key naming a tab it does not hold', () => {
    const group = makeGroup('g1', [acme('applied')], noteRefKey(globex('offer')))
    expect(group.activeKey).toBe(noteRefKey(acme('applied')))
  })

  it('leaves an empty group with nothing active', () => {
    expect(makeGroup('g1', []).activeKey).toBeNull()
  })
})

describe('openInGroup', () => {
  it('adds a note from another application beside the first', () => {
    const tree = openInGroup(singleGroup('g1', acme('interview_1')), 'g1', globex('interview_1'))
    expect(refKeys(tree)).toEqual([
      noteRefKey(acme('interview_1')),
      noteRefKey(globex('interview_1')),
    ])
  })

  it('activates what it opened', () => {
    const tree = openInGroup(singleGroup('g1', acme('interview_1')), 'g1', globex('offer'))
    expect(findGroup(tree, 'g1')!.activeKey).toBe(noteRefKey(globex('offer')))
  })

  it('activates a note already open rather than opening a second copy of it', () => {
    const split = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'right',
      globex('offer'),
      ids('g2', 's1'),
    )
    const reopened = openInGroup(split, 'g1', globex('offer'))

    expect(refKeys(reopened)).toEqual([noteRefKey(acme('applied')), noteRefKey(globex('offer'))])
    expect(findGroup(reopened, 'g2')!.activeKey).toBe(noteRefKey(globex('offer')))
  })
})

describe('closeTab', () => {
  it('drops the tab and leaves the rest alone', () => {
    const tree = openInGroup(singleGroup('g1', acme('applied')), 'g1', acme('offer'))
    const closed = closeTab(tree, 'g1', noteRefKey(acme('offer')))!
    expect(refKeys(closed)).toEqual([noteRefKey(acme('applied'))])
  })

  it('falls back to the tab before the one closed', () => {
    let tree: LayoutNode = singleGroup('g1', acme('applied'))
    tree = openInGroup(tree, 'g1', acme('interview_1'))
    tree = openInGroup(tree, 'g1', acme('offer'))

    const closed = closeTab(tree, 'g1', noteRefKey(acme('offer')))!
    expect(findGroup(closed, 'g1')!.activeKey).toBe(noteRefKey(acme('interview_1')))
  })

  it('keeps the active tab when a different one closes', () => {
    let tree: LayoutNode = singleGroup('g1', acme('applied'))
    tree = openInGroup(tree, 'g1', acme('offer'))
    const closed = closeTab(tree, 'g1', noteRefKey(acme('applied')))!
    expect(findGroup(closed, 'g1')!.activeKey).toBe(noteRefKey(acme('offer')))
  })

  it('takes the pane with the last tab in it, collapsing the split', () => {
    const split = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'right',
      globex('offer'),
      ids('g2', 's1'),
    )
    const closed = closeTab(split, 'g2', noteRefKey(globex('offer')))!

    expect(isSplit(closed)).toBe(false)
    expect(paneNames(closed)).toEqual(['g1'])
  })

  it('reports the panel empty when the last note anywhere closes', () => {
    const tree = singleGroup('g1', acme('applied'))
    expect(closeTab(tree, 'g1', noteRefKey(acme('applied')))).toBeNull()
  })
})

describe('closeGroup', () => {
  it('closes every tab in the pane and collapses the split', () => {
    let tree: LayoutNode = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'right',
      globex('offer'),
      ids('g2', 's1'),
    )
    tree = openInGroup(tree, 'g2', globex('interview_1'))

    const closed = closeGroup(tree, 'g2')!
    expect(paneNames(closed)).toEqual(['g1'])
    expect(refKeys(closed)).toEqual([noteRefKey(acme('applied'))])
  })
})

describe('splitWith', () => {
  it('puts the new pane after the target when splitting right', () => {
    const tree = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'right',
      globex('offer'),
      ids('g2', 's1'),
    )
    expect(paneNames(tree)).toEqual(['g1', 'g2'])
    expect((tree as SplitNode).direction).toBe('row')
  })

  it('puts the new pane before the target when splitting left', () => {
    const tree = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'left',
      globex('offer'),
      ids('g2', 's1'),
    )
    expect(paneNames(tree)).toEqual(['g2', 'g1'])
  })

  it('splits into a column for a top or bottom edge', () => {
    const tree = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'bottom',
      globex('offer'),
      ids('g2', 's1'),
    )
    expect((tree as SplitNode).direction).toBe('column')
    expect(paneNames(tree)).toEqual(['g1', 'g2'])
  })

  it('joins an existing row as a sibling rather than nesting a second split', () => {
    let tree: LayoutNode = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'right',
      globex('offer'),
      ids('g2', 's1'),
    )
    tree = splitWith(tree, 'g2', 'right', globex('interview_1'), ids('g3', 's2'))

    expect(isSplit(tree)).toBe(true)
    const split = tree as SplitNode
    expect(split.id).toBe('s1')
    expect(split.children).toHaveLength(3)
    expect(split.children.every((child) => child.kind === 'group')).toBe(true)
    expect(paneNames(tree)).toEqual(['g1', 'g2', 'g3'])
  })

  it('nests when the new split runs across the one already there', () => {
    let tree: LayoutNode = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'right',
      globex('offer'),
      ids('g2', 's1'),
    )
    tree = splitWith(tree, 'g2', 'bottom', globex('interview_1'), ids('g3', 's2'))

    const split = tree as SplitNode
    expect(split.direction).toBe('row')
    expect(split.children[0].kind).toBe('group')
    expect(split.children[1].kind).toBe('split')
    expect((split.children[1] as SplitNode).direction).toBe('column')
    expect(paneNames(tree)).toEqual(['g1', 'g2', 'g3'])
  })

  it('gives the panes of a fresh split an equal share', () => {
    const tree = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'right',
      globex('offer'),
      ids('g2', 's1'),
    ) as SplitNode
    expect(tree.sizes).toEqual([0.5, 0.5])
  })

  it('keeps sizes summing to one when a third pane joins a row', () => {
    let tree: LayoutNode = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'right',
      globex('offer'),
      ids('g2', 's1'),
    )
    tree = splitWith(tree, 'g2', 'right', globex('interview_1'), ids('g3', 's2'))

    const { sizes } = tree as SplitNode
    expect(sizes).toHaveLength(3)
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
  })

  it('moves a note out of the pane it was in rather than copying it', () => {
    let tree: LayoutNode = singleGroup('g1', acme('applied'))
    tree = openInGroup(tree, 'g1', globex('offer'))
    tree = splitWith(tree, 'g1', 'right', globex('offer'), ids('g2', 's1'))

    expect(refKeys(tree)).toEqual([noteRefKey(acme('applied')), noteRefKey(globex('offer'))])
    expect(findGroup(tree, 'g1')!.tabs.map(noteRefKey)).toEqual([noteRefKey(acme('applied'))])
    expect(findGroup(tree, 'g2')!.tabs.map(noteRefKey)).toEqual([noteRefKey(globex('offer'))])
  })

  it('refuses to split a pane off with the only note it holds', () => {
    const tree = singleGroup('g1', acme('applied'))
    expect(splitWith(tree, 'g1', 'right', acme('applied'), ids('g2', 's1'))).toBe(tree)
  })

  it('leaves the tree alone when the target pane is gone', () => {
    const tree = singleGroup('g1', acme('applied'))
    expect(splitWith(tree, 'nowhere', 'right', globex('offer'), ids('g2', 's1'))).toBe(tree)
  })
})

describe('moveTab', () => {
  it('reorders a tab within its own pane', () => {
    let tree: LayoutNode = singleGroup('g1', acme('applied'))
    tree = openInGroup(tree, 'g1', acme('interview_1'))
    tree = openInGroup(tree, 'g1', acme('offer'))

    const moved = moveTab(tree, noteRefKey(acme('offer')), 'g1', 0)
    expect(findGroup(moved, 'g1')!.tabs.map(noteRefKey)).toEqual([
      noteRefKey(acme('offer')),
      noteRefKey(acme('applied')),
      noteRefKey(acme('interview_1')),
    ])
  })

  it('swaps two panes over by moving the tab across', () => {
    let tree: LayoutNode = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'right',
      globex('offer'),
      ids('g2', 's1'),
    )
    tree = openInGroup(tree, 'g1', acme('interview_1'))

    const moved = moveTab(tree, noteRefKey(acme('interview_1')), 'g2', 0)
    expect(findGroup(moved, 'g1')!.tabs.map(noteRefKey)).toEqual([noteRefKey(acme('applied'))])
    expect(findGroup(moved, 'g2')!.tabs.map(noteRefKey)).toEqual([
      noteRefKey(acme('interview_1')),
      noteRefKey(globex('offer')),
    ])
  })

  it('activates the tab in the pane it lands in', () => {
    let tree: LayoutNode = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'right',
      globex('offer'),
      ids('g2', 's1'),
    )
    tree = openInGroup(tree, 'g1', acme('interview_1'))

    const moved = moveTab(tree, noteRefKey(acme('interview_1')), 'g2', 0)
    expect(findGroup(moved, 'g2')!.activeKey).toBe(noteRefKey(acme('interview_1')))
  })

  it('collapses the split when the tab moved was the last one in its pane', () => {
    const tree = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'right',
      globex('offer'),
      ids('g2', 's1'),
    )
    const moved = moveTab(tree, noteRefKey(globex('offer')), 'g1', 1)

    expect(isSplit(moved)).toBe(false)
    expect(refKeys(moved)).toEqual([noteRefKey(acme('applied')), noteRefKey(globex('offer'))])
  })

  it('clamps an index past the end of the destination', () => {
    let tree: LayoutNode = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'right',
      globex('offer'),
      ids('g2', 's1'),
    )
    tree = openInGroup(tree, 'g1', acme('interview_1'))

    const moved = moveTab(tree, noteRefKey(acme('interview_1')), 'g2', 99)
    expect(findGroup(moved, 'g2')!.tabs.map(noteRefKey)).toEqual([
      noteRefKey(globex('offer')),
      noteRefKey(acme('interview_1')),
    ])
  })

  it('leaves the tree alone when the tab is not open', () => {
    const tree = singleGroup('g1', acme('applied'))
    expect(moveTab(tree, noteRefKey(globex('offer')), 'g1', 0)).toBe(tree)
  })
})

describe('resizeSplit', () => {
  const twoPanes = (): SplitNode =>
    splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'right',
      globex('offer'),
      ids('g2', 's1'),
    ) as SplitNode

  it('moves the divider towards the later pane', () => {
    const resized = resizeSplit(twoPanes(), 's1', 0, 0.1) as SplitNode
    expect(resized.sizes[0]).toBeCloseTo(0.6)
    expect(resized.sizes[1]).toBeCloseTo(0.4)
  })

  it('moves the divider back the other way', () => {
    const resized = resizeSplit(twoPanes(), 's1', 0, -0.2) as SplitNode
    expect(resized.sizes[0]).toBeCloseTo(0.3)
    expect(resized.sizes[1]).toBeCloseTo(0.7)
  })

  it('holds a pane at the minimum rather than collapsing it', () => {
    const resized = resizeSplit(twoPanes(), 's1', 0, -5) as SplitNode
    expect(resized.sizes[0]).toBeCloseTo(MIN_PANE_FRACTION)
    expect(resized.sizes[1]).toBeCloseTo(1 - MIN_PANE_FRACTION)
  })

  it('holds the far pane at the minimum too', () => {
    const resized = resizeSplit(twoPanes(), 's1', 0, 5) as SplitNode
    expect(resized.sizes[1]).toBeCloseTo(MIN_PANE_FRACTION)
  })

  it('keeps the sizes summing to one', () => {
    const resized = resizeSplit(twoPanes(), 's1', 0, 0.17) as SplitNode
    expect(resized.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
  })

  it('leaves panes either side of other dividers untouched', () => {
    let tree: LayoutNode = twoPanes()
    tree = splitWith(tree, 'g2', 'right', globex('interview_1'), ids('g3', 's2'))
    const before = (tree as SplitNode).sizes[2]

    const resized = resizeSplit(tree, 's1', 0, 0.1) as SplitNode
    expect(resized.sizes[2]).toBeCloseTo(before)
  })

  it('reaches a divider nested inside another split', () => {
    let tree: LayoutNode = twoPanes()
    tree = splitWith(tree, 'g2', 'bottom', globex('interview_1'), ids('g3', 's2'))

    const resized = resizeSplit(tree, 's2', 0, 0.1) as SplitNode
    const nested = resized.children[1] as SplitNode
    expect(nested.sizes[0]).toBeCloseTo(0.6)
    expect(nested.sizes[1]).toBeCloseTo(0.4)
  })

  it('ignores a divider that is not there', () => {
    const tree = twoPanes()
    expect(resizeSplit(tree, 's1', 7, 0.1)).toBe(tree)
  })
})

describe('prune', () => {
  it('collapses a split down to its one remaining child', () => {
    const split: SplitNode = {
      kind: 'split',
      id: 's1',
      direction: 'row',
      children: [makeGroup('g1', [acme('applied')]), makeGroup('g2', [])],
      sizes: [0.5, 0.5],
    }
    const pruned = prune(split)!
    expect(pruned.kind).toBe('group')
    expect((pruned as { id: string }).id).toBe('g1')
  })

  it('spreads a removed pane’s share over the panes that remain', () => {
    const split: SplitNode = {
      kind: 'split',
      id: 's1',
      direction: 'row',
      children: [
        makeGroup('g1', [acme('applied')]),
        makeGroup('g2', []),
        makeGroup('g3', [globex('offer')]),
      ],
      sizes: [0.2, 0.6, 0.2],
    }
    const pruned = prune(split) as SplitNode
    expect(pruned.sizes).toEqual([0.5, 0.5])
  })

  it('returns nothing for a tree with no notes left in it', () => {
    expect(prune(makeGroup('g1', []))).toBeNull()
  })
})

describe('orderedRefs', () => {
  it('reads panes left to right, and their tabs in order', () => {
    let tree: LayoutNode = singleGroup('g1', acme('applied'))
    tree = openInGroup(tree, 'g1', acme('interview_1'))
    tree = splitWith(tree, 'g1', 'right', globex('offer'), ids('g2', 's1'))
    tree = openInGroup(tree, 'g2', globex('interview_2'))

    expect(refKeys(tree)).toEqual([
      noteRefKey(acme('applied')),
      noteRefKey(acme('interview_1')),
      noteRefKey(globex('offer')),
      noteRefKey(globex('interview_2')),
    ])
  })

  it('never lists one note twice, however it was arranged', () => {
    let tree: LayoutNode = singleGroup('g1', acme('applied'))
    tree = openInGroup(tree, 'g1', globex('offer'))
    tree = splitWith(tree, 'g1', 'right', globex('offer'), ids('g2', 's1'))
    tree = openInGroup(tree, 'g2', acme('applied'))
    tree = moveTab(tree, noteRefKey(acme('applied')), 'g2', 0)

    const keys = refKeys(tree)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('groupHolding', () => {
  it('names the pane a note is open in', () => {
    const tree = splitWith(
      singleGroup('g1', acme('applied')),
      'g1',
      'right',
      globex('offer'),
      ids('g2', 's1'),
    )
    expect(groupHolding(tree, noteRefKey(globex('offer')))!.id).toBe('g2')
  })

  it('finds nothing for a note that is not open', () => {
    const tree = singleGroup('g1', acme('applied'))
    expect(groupHolding(tree, noteRefKey(globex('offer')))).toBeNull()
  })
})
