/**
 * Dragging a prep note tab. The gesture itself — how a press becomes a drag for a mouse and
 * for a finger, and why it is pointer events rather than HTML5 drag-and-drop — is
 * `usePointerDrag`'s, shared with the Kanban card; what is here is where a tab can land.
 */

import { useCallback } from 'react'
import type { Edge } from './notesLayout'
import { usePointerDrag, type PointerDrag } from './usePointerDrag'

/** Where a dragged tab would land. */
export type TabDropTarget =
  | { kind: 'slot'; groupId: string; index: number }
  | { kind: 'edge'; groupId: string; edge: Edge }

/** Attributes the drop places carry, so the pointer can find them by hit test. */
export const DROP_SLOT_GROUP = 'data-drop-slot-group'
export const DROP_SLOT_INDEX = 'data-drop-slot-index'
export const DROP_EDGE = 'data-drop-edge'
export const DROP_EDGE_PANE = 'data-drop-pane'

interface TabDragHandlers {
  /** Lands a tab among another's, or among its own. */
  onDropInSlot: (key: string, groupId: string, index: number) => void
  /** Opens a new pane on one side of an existing one. */
  onDropOnEdge: (key: string, groupId: string, edge: Edge) => void
}

export type TabDrag = PointerDrag<TabDropTarget>

/**
 * What the pointer is over, read from the document rather than from React. A drop place is
 * found by hit test because that is the question being asked — what is under the finger —
 * and because the alternative, an `onPointerEnter` per zone, does not fire for a captured
 * pointer, which is exactly what a drag has.
 */
function targetAt(x: number, y: number): TabDropTarget | null {
  /*
   * The whole stack under the point rather than only the topmost element, so which kind of
   * drop place wins is decided here instead of by CSS stacking order.
   *
   * That is not an academic difference. The edge zones are laid over a pane, and while they
   * were measured from the whole group they covered its tab strip too — the topmost element
   * over a tab was an edge, so a drop aimed at a tab arrived as a split. The stylesheet no
   * longer overlaps them, but reading the stack means no future overlay can hide a drop
   * place underneath it either.
   *
   * Guarded because hit testing is not universal: jsdom implements neither this nor its
   * singular form, having no layout to test a point against. An environment that cannot say
   * what is under a point has no drop target, which is the honest answer — and far better
   * than a `TypeError` thrown from inside a pointer listener, where nothing is waiting to
   * catch it. Tests that want a particular target stub this method; tests that merely start
   * a drag do not have to.
   */
  if (typeof document.elementsFromPoint !== 'function') return null
  const stack = document.elementsFromPoint(x, y)

  /*
   * A tab slot outranks a pane edge wherever both are under the pointer, because it is the
   * more deliberate aim: a slot is one tab wide and a reader is pointing at it, while an
   * edge is a third of a pane and means only "somewhere over there". Ordering the two here
   * rather than relying on which happens to be painted on top is what makes the overlap
   * above a styling mistake instead of a broken drag.
   */
  for (const element of stack) {
    const slot = element.closest(`[${DROP_SLOT_INDEX}]`)
    if (!slot) continue
    const groupId = slot.getAttribute(DROP_SLOT_GROUP)
    const index = Number(slot.getAttribute(DROP_SLOT_INDEX))
    if (groupId && Number.isInteger(index)) return { kind: 'slot', groupId, index }
  }

  for (const element of stack) {
    const edge = element.closest(`[${DROP_EDGE}]`)
    if (!edge) continue
    const name = edge.getAttribute(DROP_EDGE)
    const groupId = edge.getAttribute(DROP_EDGE_PANE)
    if (name && groupId) return { kind: 'edge', groupId, edge: name as Edge }
  }

  return null
}

export function useTabDrag({ onDropInSlot, onDropOnEdge }: TabDragHandlers): TabDrag {
  const onDrop = useCallback(
    (key: string, landing: TabDropTarget) => {
      if (landing.kind === 'slot') onDropInSlot(key, landing.groupId, landing.index)
      else onDropOnEdge(key, landing.groupId, landing.edge)
    },
    [onDropInSlot, onDropOnEdge],
  )
  return usePointerDrag({ targetAt, onDrop })
}
