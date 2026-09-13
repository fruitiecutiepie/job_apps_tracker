/**
 * Dragging a prep note tab, with a pointer of any kind.
 *
 * This was HTML5 drag-and-drop, which has two problems that turn out to be the same
 * problem. It does not exist on touch — `dragstart` is a mouse story, so the panel could
 * be arranged with a trackpad and not with a finger. And no browser automation can drive
 * it: a synthetic mouse does not start a native drag session, so the drag could not be
 * tested in a real browser either, only against a hand-written `DataTransfer` in jsdom.
 *
 * Pointer events answer both. One code path covers mouse, touch and pen, the gesture is
 * ordinary events that a test can send, and nothing depends on a `DataTransfer` the
 * platform has to mint.
 *
 * How a drag is told apart from a tap differs by pointer, because the two are not the same
 * gesture. A mouse commits on distance: a press that moves is a drag, and one that does not
 * is a click. A finger commits on time, the way every native list-reorder does, because the
 * gesture a horizontal swipe on a strip of tabs most resembles is scrolling it — so a touch
 * has to be held still before it takes hold of a tab, and a finger that moves first is
 * left to the scroller.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Edge } from './notesLayout'

/** How far a mouse must move before a press becomes a drag rather than a click. */
const MOUSE_THRESHOLD_PX = 6

/** How long a finger must be held on a tab before it picks it up instead of scrolling. */
const TOUCH_HOLD_MS = 350

/**
 * How far a finger may stray while it is being held. Generous, because a finger resting on
 * a phone is never still, and a hold that a slight tremor cancels is a hold nobody can use.
 */
const TOUCH_SLOP_PX = 12

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

export interface TabDrag {
  /** The tab being dragged, or null when no drag has taken hold. */
  key: string | null
  /** Where it would land right now. */
  target: TabDropTarget | null
  /** Begins watching a press on one tab. */
  start: (event: ReactPointerEvent<HTMLElement>, key: string) => void
  /**
   * Whether the press that just ended was a drag. The click a browser sends after a
   * pointer sequence would otherwise also switch tabs, so a tab asks this before acting
   * on one — dropping a tab somewhere is not also a request to read it.
   */
  wasDragged: () => boolean
}

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
  const [key, setKey] = useState<string | null>(null)
  const [target, setTarget] = useState<TabDropTarget | null>(null)

  /** The press being watched, before and during a drag. */
  const press = useRef<{
    key: string
    pointerId: number
    element: HTMLElement
    from: { x: number; y: number }
    /** Set once the press has become a drag. */
    dragging: boolean
    hold: number
  } | null>(null)

  /** Read by a tab's click handler, which runs after the pointer sequence has ended. */
  const dragged = useRef(false)

  const handlers = useRef({ onDropInSlot, onDropOnEdge })
  useEffect(() => {
    handlers.current = { onDropInSlot, onDropOnEdge }
  }, [onDropInSlot, onDropOnEdge])

  const clear = useCallback(() => {
    const held = press.current
    if (held) {
      window.clearTimeout(held.hold)
      // Guarded and caught both: the pointer is usually gone by now, which is the ordinary
      // way a release or a cancel arrives, and letting go of a capture nobody holds is not
      // a failure worth propagating out of a finished gesture.
      try {
        if (held.element.hasPointerCapture?.(held.pointerId)) {
          held.element.releasePointerCapture(held.pointerId)
        }
      } catch {
        // Already released, or the pointer is gone. Either way there is nothing to undo.
      }
    }
    press.current = null
    setKey(null)
    setTarget(null)
  }, [])

  /**
   * Takes hold of the tab. The capture is what makes the rest of the gesture ours: every
   * later move and the release itself retarget to this element, which both keeps the drag
   * alive when the pointer leaves the tab and stops the browser reading the movement as a
   * scroll of the strip underneath.
   */
  const arm = useCallback(() => {
    const held = press.current
    if (!held || held.dragging) return
    held.dragging = true
    dragged.current = true
    /*
     * Capture is an improvement on the drag, not a requirement of it: it keeps the events
     * coming when the pointer leaves the tab and stops the browser reading the movement as
     * a scroll. The window listeners work either way, so a capture that cannot be taken is
     * not a reason to abandon the gesture.
     *
     * And it can fail. `setPointerCapture` throws `NotFoundError` for a pointer the browser
     * has no record of, which happens when the pointer ends in the moment between the hold
     * timer firing and this running — a finger lifted just as the tab was picked up.
     */
    try {
      held.element.setPointerCapture?.(held.pointerId)
    } catch {
      // No capture, so the window listeners carry the drag on their own.
    }
    setKey(held.key)
  }, [])

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const held = press.current
      if (!held || event.pointerId !== held.pointerId) return

      const travelled = Math.hypot(event.clientX - held.from.x, event.clientY - held.from.y)

      if (!held.dragging) {
        if (event.pointerType === 'mouse') {
          if (travelled < MOUSE_THRESHOLD_PX) return
          arm()
        } else {
          // Moved before the hold was up, so this was a scroll and never a drag.
          if (travelled > TOUCH_SLOP_PX) clear()
          return
        }
      }

      // A captured pointer's move is still a scroll candidate in some engines; saying no
      // here keeps the strip still while a tab is being carried across it.
      event.preventDefault()
      setTarget(targetAt(event.clientX, event.clientY))
    }

    const onUp = (event: PointerEvent) => {
      const held = press.current
      if (!held || event.pointerId !== held.pointerId) return
      if (!held.dragging) {
        clear()
        return
      }

      // Read at the release rather than trusted from the last move: a drop lands where the
      // pointer was let go, and the last move may have been a frame earlier and elsewhere.
      const landing = targetAt(event.clientX, event.clientY) ?? target
      const dragKey = held.key
      clear()
      if (!landing) return
      if (landing.kind === 'slot') {
        handlers.current.onDropInSlot(dragKey, landing.groupId, landing.index)
      } else {
        handlers.current.onDropOnEdge(dragKey, landing.groupId, landing.edge)
      }
    }

    const onCancel = (event: PointerEvent) => {
      if (press.current?.pointerId === event.pointerId) clear()
    }

    // On the window, so a drag that leaves the panel still ends rather than sticking.
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [arm, clear, target])

  const start = useCallback(
    (event: ReactPointerEvent<HTMLElement>, tabKey: string) => {
      // The primary button only: a right-click belongs to the context menu, and a
      // middle-click to whatever the browser does with one.
      if (event.pointerType === 'mouse' && event.button !== 0) return

      dragged.current = false
      const element = event.currentTarget
      const hold = event.pointerType === 'mouse'
        ? 0
        : window.setTimeout(arm, TOUCH_HOLD_MS)

      press.current = {
        key: tabKey,
        pointerId: event.pointerId,
        element,
        from: { x: event.clientX, y: event.clientY },
        dragging: false,
        hold,
      }
    },
    [arm],
  )

  const wasDragged = useCallback(() => dragged.current, [])

  return { key, target, start, wasDragged }
}
