import { useEffect, useRef, useState } from 'react'

import { useKeepInView } from './keepInView'
import type { ReactNode } from 'react'

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

  /*
   * Held inside the window, and out of reach of any scroller around it. A menu on a Kanban
   * card or in a table row opened past the edge of the board's own scroll box and was cut
   * off there, on a phone more often than not.
   */
  const panelRef = useRef<HTMLDivElement>(null)
  useKeepInView(open, panelRef, triggerRef)

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
