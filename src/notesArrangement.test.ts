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
  type LayoutNode,
  type NoteRef,
} from './notesLayout'
import {
  ARRANGEMENT_VERSION,
  openingLayout,
  restoreArrangement,
  serializeArrangement,
} from './notesArrangement'

const ref = (applicationId: string, state: StateId): NoteRef => ({ applicationId, state })

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

  it('keeps a note in one pane when the stored tree had it in two', () => {
    const layout = split(
      [
        makeGroup('pane-1', [ref('acme', 'applied')]),
        makeGroup('pane-2', [ref('acme', 'applied'), ref('globex', 'applied')]),
      ],
      [0.5, 0.5],
    )

    const restored = restoreArrangement(stored(layout, 'pane-1'), [acme, globex])

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
