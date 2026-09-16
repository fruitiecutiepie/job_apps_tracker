import { describe, expect, it } from 'vitest'

import { createApplication } from './domain/mutations'
import type { Application, StateId } from './domain'
import {
  MIN_PANE_FRACTION,
  highestPaneNumber,
  makeGroup,
  noteRefKey,
  orderedRefs,
  singleGroup,
  stageRef,
  postingRef,
  type LayoutNode,
  type TabGroup,
  type NoteRef,
} from './notesLayout'
import {
  ARRANGEMENT_VERSION,
  MAX_CAPTURE_LOG,
  MAX_SIDEBAR,
  MIN_CAPTURE_LOG,
  MIN_SIDEBAR,
  DEFAULT_OUTLINE_SHARE,
  MAX_OUTLINE_SHARE,
  MIN_OUTLINE_SHARE,
  openingLayout,
  restoreArrangement,
  serializeArrangement,
} from './notesArrangement'

const ref = (applicationId: string, state: StateId): NoteRef => stageRef(applicationId, state)

/** An application the refs below can name, with only the fields the module reads. */
function application(id: string, noted: StateId[] = [], state: StateId = 'applied'): Application {
  const base = createApplication({ company: id, state }, '2026-01-01T00:00:00.000Z', id)
  return {
    ...base,
    stage_notes: noted.map((noteState) => ({
      state: noteState,
      body: '',
      heard: [],
      created_at: base.created_at,
      updated_at: base.created_at,
    })),
  }
}

const acme = application('acme', ['applied', 'interview_1'])
const globex = application('globex', ['applied'])

const split = (children: LayoutNode[], sizes: number[]): LayoutNode => ({
  kind: 'split',
  id: 'split-1',
  direction: 'row',
  children,
  sizes,
})

const stored = (layout: LayoutNode, focusedGroupId: string): string =>
  serializeArrangement({ layout, focusedGroupId })

const keys = (layout: LayoutNode): string[] => orderedRefs(layout).map(noteRefKey)

describe('highestPaneNumber', () => {
  it('reads the largest pane number in the tree', () => {
    const tree = split(
      [makeGroup('pane-1', [ref('acme', 'applied')]), makeGroup('pane-3', [ref('globex', 'applied')])],
      [0.5, 0.5],
    )
    expect(highestPaneNumber(tree)).toBe(3)
  })

  it('ignores ids that are not numbered panes', () => {
    expect(highestPaneNumber(makeGroup('scratch', [ref('acme', 'applied')]))).toBe(0)
  })
})

describe('restoreArrangement', () => {
  it('round-trips a layout, its active tab and the focused pane', () => {
    const layout = split(
      [
        makeGroup('pane-1', [ref('acme', 'applied'), ref('acme', 'interview_1')], noteRefKey(ref('acme', 'applied'))),
        makeGroup('pane-2', [ref('globex', 'applied')]),
      ],
      [0.6, 0.4],
    )

    const restored = restoreArrangement(stored(layout, 'pane-2'), [acme, globex])

    expect(restored).toEqual({ layout, focusedGroupId: 'pane-2' })
  })

  it('returns nothing for an absent, malformed or newer arrangement', () => {
    expect(restoreArrangement(null, [acme])).toBeNull()
    expect(restoreArrangement('{ not json', [acme])).toBeNull()
    expect(
      restoreArrangement(
        JSON.stringify({ version: ARRANGEMENT_VERSION + 1, layout: singleGroup('pane-1', ref('acme', 'applied')), focusedGroupId: 'pane-1' }),
        [acme],
      ),
    ).toBeNull()
  })

  it('drops tabs for applications that are gone and keeps their siblings', () => {
    const layout = makeGroup('pane-1', [ref('acme', 'applied'), ref('ghost', 'applied')])

    const restored = restoreArrangement(stored(layout, 'pane-1'), [acme])

    expect(keys(restored!.layout)).toEqual([noteRefKey(ref('acme', 'applied'))])
  })

  it('keeps a tab whose note has been emptied', () => {
    // The arrangement is the panel's, not a reading of which notes exist.
    const layout = singleGroup('pane-1', ref('globex', 'offer'))

    const restored = restoreArrangement(stored(layout, 'pane-1'), [globex])

    expect(keys(restored!.layout)).toEqual([noteRefKey(ref('globex', 'offer'))])
  })

  it('drops a tab naming a state that is no longer a state', () => {
    const raw = JSON.stringify({
      version: ARRANGEMENT_VERSION,
      layout: {
        kind: 'group',
        id: 'pane-1',
        tabs: [ref('acme', 'applied'), { applicationId: 'acme', state: 'shortlisted' }],
        activeKey: noteRefKey(ref('acme', 'applied')),
      },
      focusedGroupId: 'pane-1',
    })

    expect(keys(restoreArrangement(raw, [acme])!.layout)).toEqual([noteRefKey(ref('acme', 'applied'))])
  })

  /*
   * The stored version deliberately did not move when postings became openable. These pin
   * the two directions that decision has to survive.
   */
  it('stays on the version every stored arrangement was written at', () => {
    expect(ARRANGEMENT_VERSION).toBe(1)
  })

  it('restores an arrangement written before postings existed, untouched', () => {
    // No `kind` anywhere: exactly the shape every arrangement in storage already has.
    const raw = JSON.stringify({
      version: ARRANGEMENT_VERSION,
      layout: {
        kind: 'group',
        id: 'pane-1',
        tabs: [{ applicationId: 'acme', state: 'applied' }, { applicationId: 'acme', state: 'interview_1' }],
        activeKey: 'acme::interview_1',
      },
      focusedGroupId: 'pane-1',
    })
    const restored = restoreArrangement(raw, [acme])

    expect(keys(restored!.layout)).toEqual(['acme::applied', 'acme::interview_1'])
    expect((restored!.layout as TabGroup).activeKey).toBe('acme::interview_1')
    expect(orderedRefs(restored!.layout).every((entry) => entry.kind === 'stage')).toBe(true)
  })

  it('round-trips a posting tab open beside a stage note', () => {
    const layout = makeGroup('pane-1', [postingRef('acme'), ref('acme', 'interview_1')])
    const restored = restoreArrangement(stored(layout, 'pane-1'), [acme])

    expect(keys(restored!.layout)).toEqual(['acme::posting', 'acme::interview_1'])
    expect(orderedRefs(restored!.layout)[0]).toEqual(postingRef('acme'))
  })

  it('drops a posting whose application is gone, and the pane left holding nothing', () => {
    const layout = split(
      [makeGroup('pane-1', [postingRef('ghost')]), makeGroup('pane-2', [ref('acme', 'applied')])],
      [0.5, 0.5],
    )
    const restored = restoreArrangement(stored(layout, 'pane-1'), [acme])

    expect(keys(restored!.layout)).toEqual(['acme::applied'])
  })

  it('drops a tab naming a kind it cannot read', () => {
    const raw = JSON.stringify({
      version: ARRANGEMENT_VERSION,
      layout: {
        kind: 'group',
        id: 'pane-1',
        tabs: [ref('acme', 'applied'), { applicationId: 'acme', kind: 'attachment' }],
        activeKey: 'acme::applied',
      },
      focusedGroupId: 'pane-1',
    })

    expect(keys(restoreArrangement(raw, [acme])!.layout)).toEqual(['acme::applied'])
  })

  it('prunes a group emptied by reconciliation and collapses the split holding it', () => {
    const layout = split(
      [makeGroup('pane-1', [ref('ghost', 'applied')]), makeGroup('pane-2', [ref('acme', 'applied')])],
      [0.5, 0.5],
    )

    const restored = restoreArrangement(stored(layout, 'pane-1'), [acme])

    expect(restored!.layout).toEqual(makeGroup('pane-2', [ref('acme', 'applied')], noteRefKey(ref('acme', 'applied'))))
  })

  it('returns nothing when reconciliation empties the whole tree', () => {
    const layout = singleGroup('pane-1', ref('ghost', 'applied'))

    expect(restoreArrangement(stored(layout, 'pane-1'), [acme])).toBeNull()
  })

  it('keeps a note that was open in two panes open in both', () => {
    const layout = split(
      [
        makeGroup('pane-1', [ref('acme', 'applied')]),
        makeGroup('pane-2', [ref('acme', 'applied'), ref('globex', 'applied')]),
      ],
      [0.5, 0.5],
    )

    const restored = restoreArrangement(stored(layout, 'pane-1'), [acme, globex])

    // Reading one note in two panes is an arrangement like any other, so it survives the
    // app closing like any other.
    expect(keys(restored!.layout)).toEqual([
      noteRefKey(ref('acme', 'applied')),
      noteRefKey(ref('acme', 'applied')),
      noteRefKey(ref('globex', 'applied')),
    ])
  })

  it('keeps a note in one pane when the stored tree had it twice in that pane', () => {
    const layout = makeGroup('pane-1', [
      ref('acme', 'applied'),
      ref('acme', 'applied'),
      ref('globex', 'applied'),
    ])

    const restored = restoreArrangement(stored(layout, 'pane-1'), [acme, globex])

    // Two tabs in one strip showing the same note would be two ways to the same place,
    // and two elements claiming one id.
    expect(keys(restored!.layout)).toEqual([noteRefKey(ref('acme', 'applied')), noteRefKey(ref('globex', 'applied'))])
  })

  it('falls back to the last remaining tab when the active one was dropped', () => {
    const layout = makeGroup(
      'pane-1',
      [ref('acme', 'applied'), ref('ghost', 'applied')],
      noteRefKey(ref('ghost', 'applied')),
    )

    const restored = restoreArrangement(stored(layout, 'pane-1'), [acme])

    expect((restored!.layout as { activeKey: string }).activeKey).toBe(noteRefKey(ref('acme', 'applied')))
  })

  it('falls back to a surviving pane when the focused one was pruned', () => {
    const layout = split(
      [makeGroup('pane-1', [ref('ghost', 'applied')]), makeGroup('pane-2', [ref('acme', 'applied')])],
      [0.5, 0.5],
    )

    expect(restoreArrangement(stored(layout, 'pane-1'), [acme])!.focusedGroupId).toBe('pane-2')
  })

  it('clamps a pane stored below the readable minimum', () => {
    const layout = split(
      [makeGroup('pane-1', [ref('acme', 'applied')]), makeGroup('pane-2', [ref('globex', 'applied')])],
      [0.02, 0.98],
    )

    const restored = restoreArrangement(stored(layout, 'pane-1'), [acme, globex])

    const sizes = (restored!.layout as { sizes: number[] }).sizes
    expect(sizes[0]).toBeGreaterThanOrEqual(MIN_PANE_FRACTION)
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
  })

  it('drops a split that carries no children rather than throwing', () => {
    const raw = JSON.stringify({
      version: ARRANGEMENT_VERSION,
      layout: { kind: 'split', id: 'split-1', direction: 'row', children: [], sizes: [] },
      focusedGroupId: 'pane-1',
    })

    expect(restoreArrangement(raw, [acme])).toBeNull()
  })
})

describe('the captured lines\' height', () => {
  const stored = (captureHeight: unknown): string =>
    JSON.stringify({
      version: ARRANGEMENT_VERSION,
      layout: singleGroup('pane-1', ref('acme', 'applied')),
      focusedGroupId: 'pane-1',
      captureHeight,
    })

  it('comes back as it was left', () => {
    expect(restoreArrangement(stored(240), [acme])!.captureHeight).toBe(240)
  })

  it('is absent when nothing was stored, leaving the stylesheet its own default', () => {
    const layout = singleGroup('pane-1', ref('acme', 'applied'))
    const raw = serializeArrangement({ layout, focusedGroupId: 'pane-1' })

    expect(raw).not.toMatch(/captureHeight/)
    expect(restoreArrangement(raw, [acme])!.captureHeight).toBeUndefined()
  })

  it('is held between a readable floor and a height that leaves room for the note', () => {
    expect(restoreArrangement(stored(2), [acme])!.captureHeight).toBe(MIN_CAPTURE_LOG)
    expect(restoreArrangement(stored(99_999), [acme])!.captureHeight).toBe(MAX_CAPTURE_LOG)
  })

  it('is dropped rather than guessed at when it is not a height', () => {
    for (const nonsense of ['240', null, Number.NaN, Infinity, {}]) {
      expect(restoreArrangement(stored(nonsense), [acme])!.captureHeight).toBeUndefined()
    }
  })

  it('survives a round trip through the arrangement it belongs to', () => {
    const layout = singleGroup('pane-1', ref('acme', 'applied'))
    const raw = serializeArrangement({ layout, focusedGroupId: 'pane-1', captureHeight: 300 })

    expect(restoreArrangement(raw, [acme])).toEqual({ layout, focusedGroupId: 'pane-1', captureHeight: 300 })
  })
})

describe('the sidebar width', () => {
  const stored = (sidebarWidth: unknown): string =>
    JSON.stringify({
      version: ARRANGEMENT_VERSION,
      layout: singleGroup('pane-1', ref('acme', 'applied')),
      focusedGroupId: 'pane-1',
      sidebarWidth,
    })

  it('comes back as it was left', () => {
    expect(restoreArrangement(stored(260), [acme])!.sidebarWidth).toBe(260)
  })

  it('is held between a readable floor and a width that leaves room for the notes', () => {
    expect(restoreArrangement(stored(10), [acme])!.sidebarWidth).toBe(MIN_SIDEBAR)
    expect(restoreArrangement(stored(9_999), [acme])!.sidebarWidth).toBe(MAX_SIDEBAR)
  })

  it('is dropped rather than guessed at when it is not a width', () => {
    for (const nonsense of ['260', null, Number.NaN, {}]) {
      expect(restoreArrangement(stored(nonsense), [acme])!.sidebarWidth).toBeUndefined()
    }
  })
})

describe("the sidebar's own division", () => {
  const stored = (outlineShare: unknown): string =>
    JSON.stringify({
      version: ARRANGEMENT_VERSION,
      layout: singleGroup('pane-1', ref('acme', 'applied')),
      focusedGroupId: 'pane-1',
      outlineShare,
    })

  it('comes back as it was left', () => {
    expect(restoreArrangement(stored(0.7), [acme])!.outlineShare).toBe(0.7)
  })

  it('is a share of the column rather than a height, so it means the same at any size', () => {
    // Half each is what the two halves start on, and half stays half whether the sidebar
    // is as tall as a laptop or as tall as a phone. A stored height could not say that.
    expect(DEFAULT_OUTLINE_SHARE).toBe(0.5)
    expect(MIN_OUTLINE_SHARE).toBeGreaterThan(0)
    expect(MAX_OUTLINE_SHARE).toBeLessThan(1)
  })

  it('leaves each half something to show, however far the handle was pushed', () => {
    expect(restoreArrangement(stored(0), [acme])!.outlineShare).toBe(MIN_OUTLINE_SHARE)
    expect(restoreArrangement(stored(1), [acme])!.outlineShare).toBe(MAX_OUTLINE_SHARE)
  })

  it('is dropped rather than guessed at when it is not a share', () => {
    for (const nonsense of ['0.5', null, Number.NaN, Infinity, {}]) {
      expect(restoreArrangement(stored(nonsense), [acme])!.outlineShare).toBeUndefined()
    }
  })

  it('ignores the height it used to be stored as, rather than reading it as a share', () => {
    // A stored 180 is one hundred and eighty pixels of an older arrangement, and reading
    // it as a share would clamp to "the outline takes everything". The rest of that
    // arrangement — which notes are open, and where — is still good and still restored.
    const raw = JSON.stringify({
      version: ARRANGEMENT_VERSION,
      layout: singleGroup('pane-1', ref('acme', 'applied')),
      focusedGroupId: 'pane-1',
      outlineHeight: 180,
    })
    const restored = restoreArrangement(raw, [acme])!

    expect(restored.outlineShare).toBeUndefined()
    expect(orderedRefs(restored.layout)).toHaveLength(1)
  })

  it('survives a round trip through the arrangement it belongs to', () => {
    const layout = singleGroup('pane-1', ref('acme', 'applied'))
    const raw = serializeArrangement({ layout, focusedGroupId: 'pane-1', outlineShare: 0.35 })

    expect(restoreArrangement(raw, [acme])).toEqual({
      layout,
      focusedGroupId: 'pane-1',
      outlineShare: 0.35,
    })
  })
})

describe('openingLayout', () => {
  it('opens the current stage first, then the stages already noted', () => {
    const layout = openingLayout(acme, 'interview_1')

    expect(keys(layout)).toEqual([
      noteRefKey(ref('acme', 'interview_1')),
      noteRefKey(ref('acme', 'applied')),
    ])
    expect((layout as { activeKey: string }).activeKey).toBe(noteRefKey(ref('acme', 'interview_1')))
  })
})
