import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, FilePlus2, Trash2 } from 'lucide-react'

import type { TrackerSummary } from './backend'
import { NEW_TRACKER, trackerHref } from './backend/trackerAddress'

export interface TrackerSwitcherProps {
  current: { id: string; name: string }
  listTrackers: () => Promise<TrackerSummary[]>
  /** Asks before removing this tab's tracker from the browser. */
  onRemove: () => void
}

function describeCount(count: number): string {
  return count === 1 ? '1 application' : `${count} applications`
}

/**
 * Which tracker this tab holds, and the way to the others. A browser can hold several —
 * a folder in one tab, an imported file in another — so the name on this button is also
 * the answer to "which file am I in", the question the tab's own title answers too.
 *
 * Every tracker is a link rather than a button, because switching is a navigation: a
 * plain click opens it here, and a middle click or a modified one opens it in a tab of
 * its own, which is how two are worked on at once. New tracker is a link for the same
 * reason. Like More actions it is a disclosure of plain controls, not an ARIA menu, so
 * Tab alone reaches everything in it.
 */
export function TrackerSwitcher({ current, listTrackers, onRemove }: TrackerSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [trackers, setTrackers] = useState<TrackerSummary[] | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void listTrackers().then((listed) => {
      if (!cancelled) setTrackers(listed)
    })
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
      cancelled = true
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, listTrackers])

  // A tracker never saved is not in the list yet, but it is the one on screen.
  const listed = trackers ?? []
  const rows = listed.some((tracker) => tracker.id === current.id)
    ? listed
    : [{ id: current.id, name: current.name, applications: 0, openedAt: '' }, ...listed]

  return (
    <div className="actions-menu tracker-switcher" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Tracker: ${current.name}. Switch tracker`}
        className="tracker-switcher__trigger"
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        title={current.name}
        type="button"
      >
        <span className="tracker-switcher__name">{current.name}</span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {open && (
        <div className="actions-menu__panel tracker-switcher__panel">
          <p className="tracker-switcher__caption" id="tracker-switcher-caption">
            Trackers in this browser. Open one in a new tab to work in two at once.
          </p>
          <ul aria-labelledby="tracker-switcher-caption" className="tracker-switcher__list">
            {rows.map((tracker) => {
              const isCurrent = tracker.id === current.id
              return (
                <li key={tracker.id}>
                  <a
                    aria-current={isCurrent ? 'page' : undefined}
                    className="actions-menu__item tracker-switcher__item"
                    href={trackerHref(tracker.id)}
                  >
                    {isCurrent ? <Check aria-hidden="true" size={16} /> : <span className="tracker-switcher__spacer" />}
                    <span className="tracker-switcher__label">
                      <span className="tracker-switcher__name">{tracker.name}</span>
                      <small>{describeCount(tracker.applications)}</small>
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
          <a className="actions-menu__item" href={trackerHref(NEW_TRACKER)}>
            <FilePlus2 aria-hidden="true" size={16} /> New tracker
          </a>
          <button
            className="actions-menu__item"
            onClick={() => {
              setOpen(false)
              onRemove()
            }}
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} /> Remove this tracker
          </button>
        </div>
      )}
    </div>
  )
}
