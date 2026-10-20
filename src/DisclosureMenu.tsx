import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/** Matches the gap the panel's own rule leaves under the trigger. */
const PANEL_GAP = 8

/**
 * The lowest and highest line a panel opened under its trigger can use: the window's, or the
 * edge of the nearest box that clips it, whichever is tighter. A table's scroller is one — a
 * panel opened from its last row would otherwise be cut off, or grow a scrollbar in the table
 * to be reached.
 */
function visibleSpan(panel: HTMLElement): { top: number; bottom: number } {
  let top = 0
  let bottom = window.innerHeight
  for (let ancestor = panel.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (getComputedStyle(ancestor).overflowY === 'visible') continue
    const edge = ancestor.getBoundingClientRect()
    top = Math.max(top, edge.top)
    bottom = Math.min(bottom, edge.bottom)
  }
  return { top, bottom }
}

interface DisclosureMenuProps {
  /** What the trigger shows. */
  label: ReactNode
  /** The trigger's accessible name, when its face alone does not say what it opens. */
  ariaLabel?: string
  className?: string
  triggerClassName: string
  panelClassName: string
  children: ReactNode
}

/**
 * A button that shows a panel of plain buttons under it. A disclosure rather than an ARIA
 * menu, so Tab alone reaches the items: Escape and a press outside close it, and closing it
 * — by either, or by choosing an item — puts focus back on the trigger.
 *
 * Escape is stopped here, so one key press closes one thing and not the dialog or panel
 * the menu happens to sit in.
 */
export function DisclosureMenu({
  label,
  ariaLabel,
  className,
  triggerClassName,
  panelClassName,
  children,
}: DisclosureMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  /*
   * Opens upward when it would run past the bottom of what can show it and there is room
   * above for it — a row at the foot of a table or a board. Set on the element rather than
   * held in state: it is a reading of layout, taken once per opening, and a state update
   * here would re-render the panel to say what the DOM already knows.
   */
  useLayoutEffect(() => {
    const panel = panelRef.current
    const trigger = triggerRef.current
    if (!open || !panel || !trigger) return
    delete panel.dataset.placement
    const own = panel.getBoundingClientRect()
    const span = visibleSpan(panel)
    if (own.bottom <= span.bottom + 1) return
    if (own.height + PANEL_GAP <= trigger.getBoundingClientRect().top - span.top) {
      panel.dataset.placement = 'up'
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <div className={['disclosure-menu', className].filter(Boolean).join(' ')} ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={ariaLabel}
        className={triggerClassName}
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        {label}
      </button>
      {open && (
        <div
          className={panelClassName}
          ref={panelRef}
          onClick={() => {
            setOpen(false)
            triggerRef.current?.focus()
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
