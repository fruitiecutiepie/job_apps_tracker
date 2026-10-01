import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Download, FilePlus2, FolderOpen, Pencil, Trash2, Upload, X } from 'lucide-react'

import type { TrackerSummary } from './backend'
import { NEW_TRACKER, trackerHref } from './backend/trackerAddress'

export interface TrackerSwitcherProps {
  current: { id: string; name: string }
  listTrackers: () => Promise<TrackerSummary[]>
  /** Asks before removing a tracker from the browser — this tab's or another. */
  onRemove: (tracker: TrackerSummary) => void
  onRename: (tracker: TrackerSummary, name: string) => Promise<void>
  /** Downloads a tracker as an export file — this tab's or another. */
  onExport: (tracker: TrackerSummary) => void
  /** Replaces a tracker's contents from an export file, after the import question. */
  onImport: (tracker: TrackerSummary) => void
  /** Starts a new tracker from a folder; absent where the browser cannot open one. */
  onNewFromFolder: (() => void) | null
  /** Starts a new tracker from an exported file. */
  onNewFromFile: () => void
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
 * its own, which is how two are worked on at once. Rename, Export, Import and Remove sit
 * at the end of each row as icons, acting on that row's tracker, so a tracker can be tidied without
 * opening it first; each names its tracker to a screen reader and on hover, since an icon
 * alone does not say which row it belongs to. Like More actions it is a disclosure of
 * plain controls, not an ARIA menu, so Tab alone reaches everything in it.
 */
export function TrackerSwitcher({
  current,
  listTrackers,
  onRemove,
  onRename,
  onExport,
  onImport,
  onNewFromFolder,
  onNewFromFile,
}: TrackerSwitcherProps) {
  const [open, setOpen] = useState(false)
  /*
   * Renaming happens on the row being renamed rather than in a dialog: it is one field,
   * and the list around it is the context that makes the new name mean something.
   */
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [trackers, setTrackers] = useState<TrackerSummary[] | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const refresh = useCallback(async () => {
    setTrackers(await listTrackers())
  }, [listTrackers])

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
      setRenamingId(null)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, listTrackers])

  // A tracker never saved is not in the list yet, but it is the one on screen.
  const listed = trackers ?? []
  const rows: TrackerSummary[] = listed.some((tracker) => tracker.id === current.id)
    ? listed
    : [{ id: current.id, name: current.name, applications: 0, openedAt: '' }, ...listed]

  const startRenaming = (tracker: TrackerSummary) => {
    setDraftName(tracker.name)
    setRenamingId(tracker.id)
  }

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
              if (tracker.id === renamingId) {
                return (
                  <li key={tracker.id}>
                    <form
                      className="tracker-switcher__row tracker-switcher__rename"
                      onSubmit={(event) => {
                        event.preventDefault()
                        if (!draftName.trim()) return
                        void onRename(tracker, draftName).then(async () => {
                          setRenamingId(null)
                          await refresh()
                        })
                      }}
                    >
                      <input
                        aria-label={`New name for ${tracker.name}`}
                        autoFocus
                        className="tracker-switcher__input"
                        onChange={(event) => setDraftName(event.target.value)}
                        onFocus={(event) => event.currentTarget.select()}
                        onKeyDown={(event) => {
                          // Escape backs out of the rename, not out of the whole panel.
                          if (event.key !== 'Escape') return
                          event.stopPropagation()
                          setRenamingId(null)
                        }}
                        value={draftName}
                      />
                      <button
                        aria-label={`Save the name for ${tracker.name}`}
                        className="icon-button tracker-switcher__action"
                        disabled={!draftName.trim()}
                        title="Save name"
                        type="submit"
                      >
                        <Check aria-hidden="true" size={16} />
                      </button>
                      <button
                        aria-label={`Keep the name ${tracker.name}`}
                        className="icon-button tracker-switcher__action"
                        onClick={() => setRenamingId(null)}
                        title="Cancel"
                        type="button"
                      >
                        <X aria-hidden="true" size={16} />
                      </button>
                    </form>
                  </li>
                )
              }
              return (
                <li className="tracker-switcher__row" key={tracker.id}>
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
                  <button
                    aria-label={`Rename ${tracker.name}`}
                    className="icon-button tracker-switcher__action"
                    onClick={() => startRenaming(tracker)}
                    title={`Rename ${tracker.name}`}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={15} />
                  </button>
                  <button
                    aria-label={`Export ${tracker.name}`}
                    className="icon-button tracker-switcher__action"
                    onClick={() => {
                      setOpen(false)
                      onExport(tracker)
                    }}
                    title={`Export ${tracker.name} as a file`}
                    type="button"
                  >
                    <Download aria-hidden="true" size={15} />
                  </button>
                  <button
                    aria-label={`Import a file into ${tracker.name}`}
                    className="icon-button tracker-switcher__action"
                    onClick={() => {
                      setOpen(false)
                      onImport(tracker)
                    }}
                    title={`Import a file into ${tracker.name}, replacing what it holds`}
                    type="button"
                  >
                    <Upload aria-hidden="true" size={15} />
                  </button>
                  <button
                    aria-label={`Remove ${tracker.name} from this browser`}
                    className="icon-button tracker-switcher__action tracker-switcher__action--remove"
                    onClick={() => {
                      setOpen(false)
                      onRemove(tracker)
                    }}
                    title={`Remove ${tracker.name} from this browser`}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                </li>
              )
            })}
          </ul>
          {/*
            * A new tracker starts from nothing, from a folder, or from a file, and those are
            * offered together because which one is the question someone starting a tracker
            * is answering. Each opens beside this tracker, never over it.
            */}
          <div aria-labelledby="tracker-switcher-new" className="tracker-switcher__group" role="group">
            <p className="tracker-switcher__caption" id="tracker-switcher-new">New tracker</p>
            <a className="actions-menu__item" href={trackerHref(NEW_TRACKER)}>
              <FilePlus2 aria-hidden="true" size={16} /> Blank tracker
            </a>
            {onNewFromFolder && (
              <button
                className="actions-menu__item"
                onClick={() => {
                  setOpen(false)
                  onNewFromFolder()
                }}
                type="button"
              >
                <FolderOpen aria-hidden="true" size={16} /> From a folder…
              </button>
            )}
            <button
              className="actions-menu__item"
              onClick={() => {
                setOpen(false)
                onNewFromFile()
              }}
              type="button"
            >
              <Upload aria-hidden="true" size={16} /> From a file…
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
