/**
 * Keeps a popup panel inside the window, wherever its trigger sits.
 *
 * A panel is laid out by the stylesheet first — under its trigger, against whichever edge
 * the stylesheet chose — and that placement is read back and moved only as far as it has to
 * go: across, to clear the side of the window it ran past, and above the trigger when there
 * is no room below but there is above. Then it is pinned there with `position: fixed`, which
 * is what takes it out of every scroll box between it and the page. A panel absolutely
 * placed inside a Kanban column or a table cell is clipped by that scroller, however much
 * window there is beyond it; fixed, it answers to the window alone.
 *
 * Fixed means it no longer travels with what it opened from, so it is placed again whenever
 * anything scrolls or the window resizes.
 *
 * Returns the cleanup, for an effect to hand back.
 */

import { useLayoutEffect, type RefObject } from 'react'

/** Space kept between a panel and the window's edge, and between it and its trigger. */
const GUTTER = 8

export function keepInView(panel: HTMLElement, trigger: HTMLElement | null): () => void {
  const place = () => {
    // Back to the stylesheet's own placement, so each pass starts from what it intends
    // rather than from where the last pass moved it.
    panel.style.position = ''
    panel.style.left = ''
    panel.style.top = ''
    panel.style.right = ''
    panel.style.bottom = ''
    panel.style.maxHeight = ''
    panel.style.overflowY = ''

    const width = document.documentElement.clientWidth
    const height = window.innerHeight
    const box = panel.getBoundingClientRect()
    // A panel with no layout (jsdom, or display: none) has nothing to correct.
    if (box.width === 0 && box.height === 0) return

    const left = Math.max(GUTTER, Math.min(box.left, width - GUTTER - box.width))

    let top = box.top
    const room = height - GUTTER
    if (box.bottom > room && trigger) {
      const above = trigger.getBoundingClientRect().top - GUTTER - box.height
      top = above >= GUTTER ? above : Math.max(GUTTER, room - box.height)
    }
    const maxHeight = height - 2 * GUTTER

    panel.style.position = 'fixed'
    panel.style.left = `${left}px`
    panel.style.top = `${top}px`
    panel.style.right = 'auto'
    panel.style.bottom = 'auto'
    /*
     * `fixed` is relative to the window only where no ancestor makes itself the containing
     * block, and some here do: the prep notes view is a size container, and containment is
     * one of the things that does it. Whatever the origin turned out to be, the panel is
     * moved by however far it landed from where it was meant to.
     */
    const landed = panel.getBoundingClientRect()
    panel.style.left = `${left + (left - landed.left)}px`
    panel.style.top = `${top + (top - landed.top)}px`
    if (box.height > maxHeight) {
      panel.style.maxHeight = `${maxHeight}px`
      panel.style.overflowY = 'auto'
    }
  }

  place()
  // Capture, so a scroll in any box — the board, a table, a dialog — moves it too.
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  return () => {
    window.removeEventListener('scroll', place, true)
    window.removeEventListener('resize', place)
  }
}

/** Keeps an open panel in view for as long as it is open. */
export function useKeepInView(
  open: boolean,
  panel: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    if (!open || !panel.current) return
    return keepInView(panel.current, trigger.current)
  }, [open, panel, trigger])
}
