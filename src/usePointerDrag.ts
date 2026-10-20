/**
 * Dragging something with a pointer of any kind: a prep note tab, a Kanban card.
 *
 * Both were HTML5 drag-and-drop once, which has two problems that turn out to be the same
 * problem. It does not exist on touch — `dragstart` is a mouse story, so a board that could
 * be rearranged with a trackpad could not be with a finger. And no browser automation can
 * drive it: a synthetic mouse does not start a native drag session, so it could not be
 * tested in a real browser either.
 *
 * Pointer events answer both. One code path covers mouse, touch and pen, the gesture is
 * ordinary events that a test can send, and nothing depends on a `DataTransfer` the
 * platform has to mint.
 *
 * How a drag is told apart from a tap differs by pointer, because the two are not the same
 * gesture. A mouse commits on distance: a press that moves is a drag, and one that does not
 * is a click. A finger commits on time, the way every native list-reorder does, because the
 * gesture a swipe over a card or a strip of tabs most resembles is scrolling — so a touch
 * has to be held still before it takes hold, and a finger that moves first is left to the
 * scroller.
 *
 * Once a finger has taken hold, the page must stop scrolling under it. A pointer event
 * cannot say so — the browser decides to pan from the touch events, and having decided it
 * cancels the pointer — so a `touchmove` listener refuses the pan for as long as a drag is
 * running. Without it the first movement after the hold scrolled the board and dropped
 * the card.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

/** How far a mouse must move before a press becomes a drag rather than a click. */
const MOUSE_THRESHOLD_PX = 6

/** How long a finger must be held before it picks something up instead of scrolling. */
export const TOUCH_HOLD_MS = 350

/**
 * How far a finger may stray while it is being held. Generous, because a finger resting on
 * a phone is never still, and a hold that a slight tremor cancels is a hold nobody can use.
 */
const TOUCH_SLOP_PX = 12

/** How close to a scroller's edge the pointer must be before the scroller follows it. */
const EDGE_PX = 48

/** How far the scroller moves per frame at its very edge; less further in. */
const EDGE_SPEED_PX = 14

/**
 * How long after a drop the click a browser sends for it is still swallowed. A touch's
 * click arrives in a task of its own after the release, so it cannot simply be the next
 * event; and a press that was not a drag must not have its click eaten later on.
 */
const CLICK_AFTER_DROP_MS = 400

export interface PointerDragOptions<Target> {
  /** What a drop at this point of the window would land on. */
  targetAt: (x: number, y: number) => Target | null
  /** Lands the dragged item. */
  onDrop: (key: string, target: Target) => void
  /**
   * Carries a copy of the pressed element under the pointer while it is dragged. A card
   * stays in its lane until it is dropped, so without one nothing on screen moves with
   * the finger and the gesture reads as having failed.
   */
  ghostClassName?: string
  /** A scroller to follow the pointer when it nears its left or right edge. */
  scroller?: () => HTMLElement | null
  /**
   * Scrolls the page itself when the pointer nears the top or bottom of the window, so a
   * card can be carried to a lane below the fold. Returns how much of the window's top is
   * covered — a sticky header — so the top edge is where the page's visible part begins
   * rather than under the header, where a finger cannot aim.
   */
  pageTopInset?: () => number
}

export interface PointerDrag<Target> {
  /** What is being dragged, or null when no drag has taken hold. */
  key: string | null
  /** Where it would land right now. */
  target: Target | null
  /** Begins watching a press. */
  start: (event: ReactPointerEvent<HTMLElement>, key: string, options?: StartOptions) => void
  /**
   * Whether the press that just ended was a drag. The click a browser sends after a
   * pointer sequence would otherwise also act, so anything clickable asks this before
   * acting on one — dropping something is not also a request to open it.
   */
  wasDragged: () => boolean
}

export interface StartOptions {
  /**
   * What is being dragged, when the press is on a part of it — a grip on a card. It is the
   * element carried under the pointer as the copy; the grip is still what holds the capture.
   */
  item?: HTMLElement | null
  /**
   * The press is on a handle that means nothing but "drag", so a finger moves it at once
   * the way a mouse does, with no hold first. A hold is there to tell a drag from a scroll,
   * and a handle answers that question itself — it is `touch-action: none`, so the browser
   * never starts a scroll from it.
   */
  handle?: boolean
}

interface Press {
  key: string
  pointerId: number
  pointerType: string
  element: HTMLElement
  item: HTMLElement
  handle: boolean
  from: { x: number; y: number }
  at: { x: number; y: number }
  /** Set once the press has become a drag. */
  dragging: boolean
  hold: number
  ghost: HTMLElement | null
  /** Where in the pressed element the pointer went down, so the copy keeps that grip. */
  grip: { x: number; y: number }
  frame: number
}

/*
 * While the pointer rests near a scroller's edge the scroller keeps moving, a frame at a
 * time, faster the nearer the edge — which is how a card on a phone reaches a stage five
 * columns away, the board being far wider than the screen. Reports whether it moved, since
 * what is under a still pointer changes as the board moves beneath it.
 */
/** The step for a pointer `distance` inside an edge zone: full at the edge, none past the zone. */
function edgeStep(distance: number): number {
  return EDGE_SPEED_PX * (1 - Math.max(0, distance) / EDGE_PX)
}

/** Scrolls the page when the pointer is near the top or bottom of its visible part. */
function scrollPageTowards(y: number, topInset: number): boolean {
  const bottom = window.innerHeight
  let step = 0
  if (y < topInset + EDGE_PX) step = -edgeStep(y - topInset)
  else if (y > bottom - EDGE_PX) step = edgeStep(bottom - y)
  if (step === 0) return false
  const before = window.scrollY
  window.scrollBy(0, step)
  return window.scrollY !== before
}

function scrollTowards(box: HTMLElement, x: number): boolean {
  const rect = box.getBoundingClientRect()
  let step = 0
  if (x < rect.left + EDGE_PX) step = -EDGE_SPEED_PX * (1 - Math.max(0, x - rect.left) / EDGE_PX)
  else if (x > rect.right - EDGE_PX) step = EDGE_SPEED_PX * (1 - Math.max(0, rect.right - x) / EDGE_PX)
  if (step === 0) return false
  const before = box.scrollLeft
  box.scrollLeft += step
  return box.scrollLeft !== before
}

/** Whether two targets name the same place: equal, or flat objects with equal fields. */
function sameTarget<Target>(a: Target | null, b: Target | null): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  const keys = Object.keys(a) as (keyof Target)[]
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

export function usePointerDrag<Target>({
  targetAt,
  onDrop,
  ghostClassName,
  scroller,
  pageTopInset,
}: PointerDragOptions<Target>): PointerDrag<Target> {
  const [key, setKey] = useState<string | null>(null)
  const [target, setTarget] = useState<Target | null>(null)

  const press = useRef<Press | null>(null)
  /** The last target, read at the release when the pointer is over nothing. */
  const lastTarget = useRef<Target | null>(null)
  /** Read by a click handler, which runs after the pointer sequence has ended. */
  const dragged = useRef(false)
  /**
   * The pointer whose drag Escape put back, still down. Its release is what produces the
   * click to swallow, and it may come long after the key.
   */
  const escaped = useRef<number | null>(null)
  const draggedReset = useRef(0)

  const options = useRef({ targetAt, onDrop, ghostClassName, scroller, pageTopInset })
  useEffect(() => {
    options.current = { targetAt, onDrop, ghostClassName, scroller, pageTopInset }
  }, [targetAt, onDrop, ghostClassName, scroller, pageTopInset])

  /*
   * Only a target that names somewhere else is news. A hit test answers with a fresh object
   * on every move, and handing each one to state redrew the whole board at pointer rate
   * while the card sat over one lane.
   */
  const aim = useCallback((next: Target | null) => {
    if (sameTarget(lastTarget.current, next)) return
    lastTarget.current = next
    setTarget(next)
  }, [])

  const clear = useCallback(() => {
    const held = press.current
    if (held) {
      window.clearTimeout(held.hold)
      window.cancelAnimationFrame(held.frame)
      held.ghost?.remove()
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
    lastTarget.current = null
    setKey(null)
    setTarget(null)
  }, [])

  const moveGhost = (held: Press) => {
    if (!held.ghost) return
    held.ghost.style.transform =
      `translate(${held.at.x - held.grip.x}px, ${held.at.y - held.grip.y}px)`
  }

  /**
   * Takes hold. The capture is what makes the rest of the gesture ours: every later move
   * and the release itself retarget to this element, which keeps the drag alive when the
   * pointer leaves it.
   */
  const arm = useCallback(() => {
    const held = press.current
    if (!held || held.dragging) return
    held.dragging = true
    dragged.current = true
    /*
     * Capture is an improvement on the drag, not a requirement of it. And it can fail:
     * `setPointerCapture` throws `NotFoundError` for a pointer the browser has no record
     * of, which happens when a finger lifts in the moment between the hold timer firing
     * and this running.
     */
    try {
      held.element.setPointerCapture?.(held.pointerId)
    } catch {
      // No capture, so the window listeners carry the drag on their own.
    }

    const className = options.current.ghostClassName
    if (className) {
      const rect = held.item.getBoundingClientRect()
      const ghost = held.item.cloneNode(true) as HTMLElement
      ghost.classList.add(className)
      ghost.setAttribute('aria-hidden', 'true')
      ghost.removeAttribute('id')
      for (const named of ghost.querySelectorAll('[id]')) named.removeAttribute('id')
      ghost.style.width = `${rect.width}px`
      ghost.style.height = `${rect.height}px`
      held.grip = { x: held.from.x - rect.left, y: held.from.y - rect.top }
      document.body.append(ghost)
      held.ghost = ghost
      moveGhost(held)
    }

    if (options.current.scroller || options.current.pageTopInset) {
      const follow = () => {
        const current = press.current
        if (!current?.dragging) return
        const box = options.current.scroller?.()
        const inset = options.current.pageTopInset?.()
        // Both may move in one frame: a finger in a corner is asking for both.
        const across = box ? scrollTowards(box, current.at.x) : false
        const down = inset === undefined ? false : scrollPageTowards(current.at.y, inset)
        if (across || down) aim(options.current.targetAt(current.at.x, current.at.y))
        current.frame = window.requestAnimationFrame(follow)
      }
      held.frame = window.requestAnimationFrame(follow)
    }
    // A finger held still never moved, so say where it is aiming now rather than at the
    // first movement.
    aim(options.current.targetAt(held.at.x, held.at.y))
    setKey(held.key)
  }, [aim])

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const held = press.current
      if (!held || event.pointerId !== held.pointerId) return
      held.at = { x: event.clientX, y: event.clientY }

      const travelled = Math.hypot(event.clientX - held.from.x, event.clientY - held.from.y)

      if (!held.dragging) {
        if (event.pointerType === 'mouse' || held.handle) {
          if (travelled < MOUSE_THRESHOLD_PX) return
          arm()
        } else {
          // Moved before the hold was up, so this was a scroll and never a drag.
          if (travelled > TOUCH_SLOP_PX) clear()
          return
        }
      }

      event.preventDefault()
      moveGhost(held)
      aim(options.current.targetAt(event.clientX, event.clientY))
    }

    const onUp = (event: PointerEvent) => {
      if (escaped.current === event.pointerId) {
        escaped.current = null
        window.clearTimeout(draggedReset.current)
        draggedReset.current = window.setTimeout(() => {
          dragged.current = false
        }, CLICK_AFTER_DROP_MS)
        return
      }
      const held = press.current
      if (!held || event.pointerId !== held.pointerId) return
      if (!held.dragging) {
        clear()
        return
      }

      // Read at the release rather than trusted from the last move: a drop lands where the
      // pointer was let go, and the last move may have been a frame earlier and elsewhere.
      const landing = options.current.targetAt(event.clientX, event.clientY) ?? lastTarget.current
      const dragKey = held.key
      clear()
      window.clearTimeout(draggedReset.current)
      draggedReset.current = window.setTimeout(() => {
        dragged.current = false
      }, CLICK_AFTER_DROP_MS)
      if (landing !== null) options.current.onDrop(dragKey, landing)
    }

    const onCancel = (event: PointerEvent) => {
      if (escaped.current === event.pointerId) {
        escaped.current = null
        dragged.current = false
        return
      }
      if (press.current?.pointerId !== event.pointerId) return
      clear()
      // A cancelled drag sends no click to swallow. Left set, the flag ate the next click
      // that arrived without a press before it — Enter on a card's button.
      dragged.current = false
    }

    /*
     * Escape puts the item back where it was. The pointer is still down, so its release
     * must not drop anything either — the press is forgotten here, and the click that
     * release produces, whenever it comes, is swallowed like any other after a drag.
     * Stopped, so the key closes no dialog or menu underneath on the way.
     */
    const onKeyDown = (event: KeyboardEvent) => {
      const held = press.current
      if (event.key !== 'Escape' || !held?.dragging) return
      event.preventDefault()
      event.stopPropagation()
      escaped.current = held.pointerId
      clear()
    }

    // The pan the browser would otherwise start the moment a held finger moves.
    const onTouchMove = (event: TouchEvent) => {
      if (press.current?.dragging && event.cancelable) event.preventDefault()
    }

    /*
     * A long press is also how a phone asks for the context menu, and on some the text
     * selection handles; either takes the gesture away mid-hold. Refused only for a touch
     * press being watched, so a right-click anywhere else is untouched.
     */
    const onContextMenu = (event: Event) => {
      if (press.current && press.current.pointerType !== 'mouse') event.preventDefault()
    }

    // On the window, so a drag that leaves its surface still ends rather than sticking.
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('contextmenu', onContextMenu)
    }
  }, [aim, arm, clear])

  // A drag interrupted by the component going away leaves no copy behind on the page.
  useEffect(() => clear, [clear])

  const start = useCallback(
    (event: ReactPointerEvent<HTMLElement>, dragKey: string, { item, handle = false }: StartOptions = {}) => {
      // The primary button only: a right-click belongs to the context menu, and a
      // middle-click to whatever the browser does with one.
      if (event.pointerType === 'mouse' && event.button !== 0) return

      window.clearTimeout(draggedReset.current)
      dragged.current = false
      // A new press means the escaped one is over, whether or not its release ever reached
      // the window — let go outside it, it did not. Left set, it took the next mouse
      // release for its own (a mouse is always pointer 1) and that drag never dropped.
      escaped.current = null
      const element = event.currentTarget
      const hold = event.pointerType === 'mouse' || handle
        ? 0
        : window.setTimeout(arm, TOUCH_HOLD_MS)

      press.current = {
        key: dragKey,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        element,
        item: item ?? element,
        handle,
        from: { x: event.clientX, y: event.clientY },
        at: { x: event.clientX, y: event.clientY },
        dragging: false,
        hold,
        ghost: null,
        grip: { x: 0, y: 0 },
        frame: 0,
      }
    },
    [arm],
  )

  const wasDragged = useCallback(() => dragged.current, [])

  return { key, target, start, wasDragged }
}
