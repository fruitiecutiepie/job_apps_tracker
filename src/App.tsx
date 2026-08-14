import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Download,
  KanbanSquare,
  ListChecks,
  Plus,
  RotateCcw,
  Search,
  Table2,
  Upload,
  X,
} from 'lucide-react'
import {
  STATE_CONFIG,
  STATE_LABELS,
  addApplication,
  createDemoDocument,
  deleteApplication,
  downloadTrackerDocument,
  loadTrackerDocument,
  moveApplication,
  parseTrackerDocument,
  resetTrackerDocument,
  saveTrackerDocument,
  updateApplication,
  type Application,
  type ApplicationInput,
  type StateId,
  type TrackerDocument,
} from './domain'
import {
  CalendarView,
  KanbanView,
  NextActionsView,
  StaleView,
  StatisticsView,
  TableView,
} from './views'

type ViewId = 'kanban' | 'table' | 'actions' | 'calendar' | 'stale' | 'statistics'

const VIEW_OPTIONS = [
  { id: 'kanban', label: 'Kanban', icon: KanbanSquare },
  { id: 'table', label: 'Table', icon: Table2 },
  { id: 'actions', label: 'Next actions', icon: ListChecks },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'stale', label: 'Stale', icon: RotateCcw },
  { id: 'statistics', label: 'Statistics', icon: ChartNoAxesColumnIncreasing },
] as const

function initializeTracker(): { tracker: TrackerDocument; warning: string | null } {
  try {
    return { tracker: loadTrackerDocument(), warning: null }
  } catch {
    const tracker = createDemoDocument()
    saveTrackerDocument(tracker)
    return {
      tracker,
      warning: 'Saved data could not be read, so the demo applications were restored.',
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function toDateTimeInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDateTimeInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

interface EditorValues {
  company: string
  role: string
  url: string
  state: StateId
  nextAction: string
  nextActionAt: string
  notes: string
}

interface ApplicationEditorProps {
  application: Application | null
  onClose: () => void
  onDelete?: () => void
  onSave: (values: EditorValues) => void
}

function ApplicationEditor({ application, onClose, onDelete, onSave }: ApplicationEditorProps) {
  const isEditing = application !== null
  const dialogRef = useRef<HTMLElement>(null)
  const [values, setValues] = useState<EditorValues>(() => ({
    company: application?.company ?? '',
    role: application?.role ?? '',
    url: application?.url ?? '',
    state: application?.state ?? 'applied',
    nextAction: application?.next_action ?? '',
    nextActionAt: toDateTimeInput(application?.next_action_at ?? null),
    notes: application?.notes ?? '',
  }))
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ))
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const active = document.activeElement
      const focusIsOutside = !active || !dialog.contains(active)
      if (event.shiftKey && (active === first || active === dialog || focusIsOutside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || active === dialog || focusIsOutside)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const update = <Key extends keyof EditorValues>(key: Key, value: EditorValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <section
        aria-labelledby="application-dialog-title"
        aria-modal="true"
        className="dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="dialog__header">
          <div>
            <p className="eyebrow">{isEditing ? 'Application details' : 'New opportunity'}</p>
            <h2 id="application-dialog-title">{isEditing ? 'Edit application' : 'Add application'}</h2>
          </div>
          <button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={20} />
          </button>
        </div>

        <form
          className="application-form"
          onSubmit={(event) => {
            event.preventDefault()
            setFormError(null)
            try {
              onSave(values)
            } catch (error) {
              setFormError(errorMessage(error))
            }
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Company</span>
              <input
                autoFocus
                onChange={(event) => update('company', event.target.value)}
                placeholder="e.g. Paper Kite"
                required
                value={values.company}
              />
            </label>
            <label className="field">
              <span>Role</span>
              <input
                onChange={(event) => update('role', event.target.value)}
                placeholder="e.g. Product designer"
                value={values.role}
              />
            </label>
            <label className="field field--wide">
              <span>Job URL</span>
              <input
                inputMode="url"
                onChange={(event) => update('url', event.target.value)}
                placeholder="https://…"
                type="url"
                value={values.url}
              />
            </label>
            <label className="field field--wide">
              <span>State</span>
              <select onChange={(event) => update('state', event.target.value as StateId)} value={values.state}>
                {STATE_CONFIG.map((state) => (
                  <option key={state.id} value={state.id}>{state.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Next action</span>
              <input
                onChange={(event) => update('nextAction', event.target.value)}
                placeholder="Follow up, prepare, send…"
                value={values.nextAction}
              />
            </label>
            <label className="field">
              <span>Next action date</span>
              <input
                disabled={!values.nextAction.trim()}
                onChange={(event) => update('nextActionAt', event.target.value)}
                type="datetime-local"
                value={values.nextActionAt}
              />
            </label>
            <label className="field field--wide">
              <span>Notes</span>
              <textarea
                onChange={(event) => update('notes', event.target.value)}
                placeholder="Contacts, interview notes, context…"
                rows={5}
                value={values.notes}
              />
            </label>
          </div>

          {formError && <p className="form-error" role="alert">{formError}</p>}

          <div className="dialog__actions">
            {isEditing && onDelete && (
              <button className="button button--danger" onClick={onDelete} type="button">Delete</button>
            )}
            <span className="dialog__actions-spacer" />
            <button className="button button--quiet" onClick={onClose} type="button">Cancel</button>
            <button className="button button--primary" type="submit">
              {isEditing ? 'Save changes' : 'Add application'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

export default function App() {
  const [initial] = useState(initializeTracker)
  const [tracker, setTracker] = useState(initial.tracker)
  const [activeView, setActiveView] = useState<ViewId>('kanban')
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<StateId | 'all'>('all')
  const [editor, setEditor] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(initial.warning)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const editorOpenerRef = useRef<HTMLElement | null>(null)
  const editorWasOpenRef = useRef(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editor) {
      editorWasOpenRef.current = true
      return
    }
    if (!editorWasOpenRef.current) return

    editorWasOpenRef.current = false
    const opener = editorOpenerRef.current
    editorOpenerRef.current = null
    const focusTarget = opener?.isConnected ? opener : addButtonRef.current
    focusTarget?.focus()
  }, [editor])

  const commit = (next: TrackerDocument, message?: string) => {
    saveTrackerDocument(next)
    setTracker(next)
    if (message) setNotice(message)
  }

  const filteredApplications = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return tracker.applications.filter((application) => {
      if (stateFilter !== 'all' && application.state !== stateFilter) return false
      if (!query) return true
      return [
        application.company,
        application.role,
        application.notes,
        application.next_action,
        STATE_LABELS[application.state],
      ].some((value) => value?.toLocaleLowerCase().includes(query))
    })
  }, [search, stateFilter, tracker.applications])

  const editingApplication = editor?.mode === 'edit'
    ? tracker.applications.find((application) => application.id === editor.id) ?? null
    : null

  const rememberEditorOpener = (opener?: HTMLElement) => {
    const activeElement = document.activeElement
    editorOpenerRef.current = opener
      ?? (activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null)
  }

  const openApplication = (id: string) => {
    rememberEditorOpener()
    setEditor({ mode: 'edit', id })
  }

  const openNewApplication = (opener: HTMLButtonElement) => {
    rememberEditorOpener(opener)
    setEditor({ mode: 'add' })
  }

  const closeEditor = () => setEditor(null)

  const move = (id: string, state: StateId) => {
    const current = tracker.applications.find((application) => application.id === id)
    const next = moveApplication(tracker, id, state)
    if (next !== tracker) commit(next, `${current?.company ?? 'Application'} moved to ${STATE_LABELS[state]}.`)
  }

  const currentView = (() => {
    const shared = { applications: filteredApplications, onOpen: openApplication }
    switch (activeView) {
      case 'table':
        return <TableView {...shared} onMove={move} />
      case 'actions':
        return <NextActionsView {...shared} />
      case 'calendar':
        return <CalendarView {...shared} />
      case 'stale':
        return <StaleView {...shared} />
      case 'statistics':
        return <StatisticsView applications={filteredApplications} />
      default:
        return (
          <KanbanView
            {...shared}
            onMove={move}
            visibleStates={stateFilter === 'all' ? undefined : [stateFilter]}
          />
        )
    }
  })()

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="Job applications tracker home">
          <span className="brand__mark" aria-hidden="true">J</span>
          <span>
            <strong>Job applications</strong>
            <small>Local tracker</small>
          </span>
        </a>

        <nav aria-label="Tracker views" className="view-nav">
          {VIEW_OPTIONS.map(({ id, label, icon: Icon }) => (
            <button
              aria-current={activeView === id ? 'page' : undefined}
              className="view-nav__item"
              key={id}
              onClick={() => setActiveView(id)}
              type="button"
            >
              <Icon aria-hidden="true" size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <button
          className="button button--primary add-button"
          onClick={(event) => openNewApplication(event.currentTarget)}
          ref={addButtonRef}
          type="button"
        >
          <Plus aria-hidden="true" size={18} />
          Add application
        </button>
      </header>

      <main id="main">
        <section className="workspace-header">
          <div>
            <p className="eyebrow">Your search, at a glance</p>
            <h1>{VIEW_OPTIONS.find((view) => view.id === activeView)?.label}</h1>
            <p className="workspace-header__summary">
              {filteredApplications.length} of {tracker.applications.length} applications shown
            </p>
          </div>

          <div className="workspace-actions">
            <button className="button button--quiet" onClick={() => importInputRef.current?.click()} type="button">
              <Upload aria-hidden="true" size={17} /> Import
            </button>
            <input
              accept="application/json,.json"
              className="sr-only"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                try {
                  const imported = parseTrackerDocument(await file.text())
                  if (window.confirm(`Replace your current tracker with ${imported.applications.length} imported applications?`)) {
                    commit(imported, `Imported ${imported.applications.length} applications.`)
                  }
                } catch (error) {
                  setNotice(`Import failed: ${errorMessage(error)}`)
                }
              }}
              ref={importInputRef}
              type="file"
            />
            <button className="button button--quiet" onClick={() => downloadTrackerDocument(tracker)} type="button">
              <Download aria-hidden="true" size={17} /> Export
            </button>
            <button
              className="button button--quiet"
              onClick={() => {
                if (window.confirm('Reset the tracker to the original 19 demo applications? This replaces your current data.')) {
                  const next = resetTrackerDocument()
                  setTracker(next)
                  setSearch('')
                  setStateFilter('all')
                  setNotice('Demo data restored.')
                }
              }}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={17} /> Reset demo data
            </button>
          </div>
        </section>

        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button aria-label="Dismiss message" className="icon-button" onClick={() => setNotice(null)} type="button">
              <X aria-hidden="true" size={17} />
            </button>
          </div>
        )}

        <section aria-label="Application filters" className="global-filters">
          <label className="search-field">
            <span className="sr-only">Search applications</span>
            <Search aria-hidden="true" size={18} />
            <input
              aria-label="Search applications"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search company, role, notes or action"
              type="search"
              value={search}
            />
          </label>
          <label className="filter-field">
            <span>State</span>
            <select
              aria-label="Filter by state"
              onChange={(event) => setStateFilter(event.target.value as StateId | 'all')}
              value={stateFilter}
            >
              <option value="all">All states</option>
              {STATE_CONFIG.map((state) => <option key={state.id} value={state.id}>{state.label}</option>)}
            </select>
          </label>
          {(search || stateFilter !== 'all') && (
            <button
              className="button button--quiet"
              onClick={() => {
                setSearch('')
                setStateFilter('all')
              }}
              type="button"
            >
              Clear filters
            </button>
          )}
        </section>

        <section className="view-surface">{currentView}</section>
      </main>

      {editor && (editor.mode === 'add' || editingApplication) && (
        <ApplicationEditor
          application={editor.mode === 'edit' ? editingApplication : null}
          onClose={closeEditor}
          onDelete={editor.mode === 'edit' ? () => {
            if (window.confirm(`Delete ${editingApplication?.company ?? 'this application'}?`)) {
              commit(deleteApplication(tracker, editor.id), 'Application deleted.')
              closeEditor()
            }
          } : undefined}
          onSave={(values) => {
            const input: ApplicationInput = {
              company: values.company,
              role: values.role || null,
              url: values.url || null,
              state: values.state,
              next_action: values.nextAction || null,
              next_action_at: values.nextAction.trim() ? fromDateTimeInput(values.nextActionAt) : null,
              notes: values.notes || null,
            }
            const now = new Date()
            if (editor.mode === 'add') {
              commit(addApplication(tracker, input, now), 'Application added.')
            } else {
              let next = updateApplication(tracker, editor.id, {
                company: input.company,
                role: input.role,
                url: input.url,
                next_action: input.next_action,
                next_action_at: input.next_action_at,
                notes: input.notes,
              }, now)
              next = moveApplication(next, editor.id, values.state, now)
              commit(next, 'Application updated.')
            }
            closeEditor()
          }}
        />
      )}
    </div>
  )
}
