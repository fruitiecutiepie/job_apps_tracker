import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Download,
  KanbanSquare,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Table2,
  Target,
  Upload,
  X,
} from 'lucide-react'
import {
  SOURCE_SUGGESTIONS,
  STATE_CONFIG,
  STATE_LABELS,
  addApplication,
  clearLegacyLocalStorage,
  createAttachmentMetadata,
  createUuidV7,
  deleteApplication,
  deleteApplicationAttachmentFolder,
  downloadTrackerArchive,
  formatFileSize,
  importTrackerArchive,
  isZipArchive,
  loadTrackerDatabase,
  MAX_ATTACHMENT_BYTES,
  moveApplication,
  openAttachmentFile,
  parseTrackerDocument,
  readFileAsUint8Array,
  resetTrackerDatabase,
  saveTrackerDatabase,
  tryLoadLegacyLocalStorage,
  unpackTrackerArchive,
  updateApplication,
  updateApplicationStageNotes,
  updateApplicationStateEvents,
  uploadAttachmentFile,
  deleteAttachmentFile,
  type Application,
  type ApplicationInput,
  type Attachment,
  type StageNoteDraft,
  type StateEventDraft,
  type StateId,
  type TrackerDocument,
} from './domain'
import { isDemoTrackerProfile, trackerDatabasePath } from './domain/trackerProfile'
import { fromDateTimeInput, toDateTimeInput } from './dateInput'
import { InviteFields } from './InviteFields'
import {
  firstInviteProblem,
  inviteDrafts,
  inviteRowsFor,
  type InviteRow,
} from './invites'
import { StageNotesDialog } from './StageNotesDialog'
import { useDialogKeyboard } from './useDialogKeyboard'
import {
  CalendarView,
  FocusView,
  KanbanView,
  StaleView,
  StatisticsView,
  TableView,
} from './views'

type ViewId = 'kanban' | 'table' | 'focus' | 'calendar' | 'stale' | 'statistics'

const VIEW_OPTIONS = [
  { id: 'kanban', label: 'Kanban', icon: KanbanSquare },
  { id: 'table', label: 'Table', icon: Table2 },
  { id: 'focus', label: 'Focus', icon: Target },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'stale', label: 'Stale', icon: RotateCcw },
  { id: 'statistics', label: 'Statistics', icon: ChartNoAxesColumnIncreasing },
] as const

/*
 * Occasional collection-wide actions (import, export, demo reset) live behind
 * one trigger so they stop competing with the per-session controls beside them.
 *
 * This is a disclosure holding plain buttons, not an ARIA menu: a real
 * role="menu" owes the user arrow-key navigation and typeahead, whereas Tab
 * already reaches buttons in DOM order. `children` is a render prop so each
 * item can close the panel after acting.
 */
function MoreActionsMenu({ children }: { children: ReactNode }) {
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

  return (
    <div className="actions-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="More actions"
        className="icon-button"
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <MoreHorizontal aria-hidden="true" size={18} />
      </button>
      {open && (
        <div
          className="actions-menu__panel"
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

async function applyAttachmentPlan(
  applicationId: string,
  plan: AttachmentSavePlan,
  at: Date,
): Promise<Attachment[]> {
  for (const attachmentId of plan.removedAttachmentIds) {
    await deleteAttachmentFile(applicationId, attachmentId)
  }

  const finalAttachments = [...plan.keptAttachments]
  for (const staged of plan.stagedFiles) {
    const metadata = createAttachmentMetadata(
      staged.file.name,
      staged.file.type || null,
      staged.file.size,
      at,
      staged.id,
    )
    await uploadAttachmentFile(applicationId, metadata.id, staged.file, metadata.mime)
    finalAttachments.push(metadata)
  }

  return finalAttachments
}

interface EditorValues {
  company: string
  role: string
  url: string
  source: string
  state: StateId
  nextAction: string
  nextActionAt: string
  deadlineAt: string
  notes: string
}

interface StagedAttachmentFile {
  id: string
  file: File
}

interface AttachmentSavePlan {
  keptAttachments: Attachment[]
  removedAttachmentIds: string[]
  stagedFiles: StagedAttachmentFile[]
}

interface ApplicationEditorProps {
  application: Application | null
  onClose: () => void
  onDelete?: () => void
  onSave: (
    values: EditorValues,
    attachmentPlan: AttachmentSavePlan,
    invites: StateEventDraft[],
  ) => Promise<void>
}

function ApplicationEditor({ application, onClose, onDelete, onSave }: ApplicationEditorProps) {
  const isEditing = application !== null
  const dialogRef = useRef<HTMLElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState<EditorValues>(() => ({
    company: application?.company ?? '',
    role: application?.role ?? '',
    url: application?.url ?? '',
    source: application?.source ?? '',
    state: application?.state ?? 'applied',
    nextAction: application?.next_action ?? '',
    nextActionAt: toDateTimeInput(application?.next_action_at ?? null),
    deadlineAt: toDateTimeInput(application?.deadline_at ?? null),
    notes: application?.notes ?? '',
  }))
  const [invites, setInvites] = useState<InviteRow[]>(() => inviteRowsFor(application))
  const [keptAttachments] = useState<Attachment[]>(() => application?.attachments ?? [])
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([])
  const [stagedFiles, setStagedFiles] = useState<StagedAttachmentFile[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const visibleAttachments = keptAttachments.filter(
    (attachment) => !removedAttachmentIds.includes(attachment.id),
  )

  useDialogKeyboard(dialogRef, onClose)

  const update = <Key extends keyof EditorValues>(key: Key, value: EditorValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const stageFiles = (files: FileList | null) => {
    if (!files) return
    const next = [...stagedFiles]
    for (const file of Array.from(files)) {
      if (file.size === 0) {
        setFormError('Attachment files must not be empty.')
        continue
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setFormError(`Each attachment must be ${formatFileSize(MAX_ATTACHMENT_BYTES)} or smaller.`)
        continue
      }
      next.push({ id: createUuidV7(), file })
    }
    setStagedFiles(next)
    setFormError(null)
  }

  const removeStagedFile = (id: string) => {
    setStagedFiles((current) => current.filter((item) => item.id !== id))
  }

  const removeExistingAttachment = (attachment: Attachment) => {
    if (!window.confirm(`Remove ${attachment.filename} from this application?`)) return
    setRemovedAttachmentIds((current) => [...current, attachment.id])
  }

  const openAttachment = async (attachment: Attachment) => {
    if (!application) return
    try {
      await openAttachmentFile(application.id, attachment.id, attachment.filename)
    } catch (error) {
      setFormError(errorMessage(error))
    }
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
          <h2 id="application-dialog-title">{isEditing ? 'Edit application' : 'Add application'}</h2>
          <button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={20} />
          </button>
        </div>

        <form
          className="application-form"
          onSubmit={async (event) => {
            event.preventDefault()
            setFormError(null)
            const inviteProblem = firstInviteProblem(invites)
            if (inviteProblem) {
              setFormError(inviteProblem)
              return
            }
            setSaving(true)
            try {
              await onSave(
                values,
                {
                  keptAttachments: visibleAttachments,
                  removedAttachmentIds,
                  stagedFiles,
                },
                inviteDrafts(invites),
              )
            } catch (error) {
              setFormError(errorMessage(error))
            } finally {
              setSaving(false)
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
            <label className="field">
              <span>Source</span>
              <input
                list="application-source-suggestions"
                onChange={(event) => update('source', event.target.value)}
                placeholder="e.g. LinkedIn, referral"
                value={values.source}
              />
              <datalist id="application-source-suggestions">
                {SOURCE_SUGGESTIONS.map((source) => (
                  <option key={source} value={source} />
                ))}
              </datalist>
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
            <label className="field field--wide">
              <span>Deadline</span>
              <input
                onChange={(event) => update('deadlineAt', event.target.value)}
                type="datetime-local"
                value={values.deadlineAt}
              />
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
            <InviteFields
              defaultState={values.state}
              onChange={setInvites}
              rows={invites}
            />
            <div className="field field--wide attachment-field">
              <span>Attachments</span>
              {visibleAttachments.length > 0 && (
                <ul className="attachment-list" aria-label="Current attachments">
                  {visibleAttachments.map((attachment) => (
                    <li className="attachment-item" key={attachment.id}>
                      <span className="attachment-item__meta">
                        <strong>{attachment.filename}</strong>
                        <small>{formatFileSize(attachment.size)}</small>
                      </span>
                      <span className="attachment-item__actions">
                        {isEditing && (
                          <button
                            className="button button--quiet"
                            onClick={() => openAttachment(attachment)}
                            type="button"
                          >
                            Open
                          </button>
                        )}
                        <button
                          className="button button--quiet"
                          onClick={() => removeExistingAttachment(attachment)}
                          type="button"
                        >
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {stagedFiles.length > 0 && (
                <ul className="attachment-list" aria-label="Attachments to add">
                  {stagedFiles.map((staged) => (
                    <li className="attachment-item" key={staged.id}>
                      <span className="attachment-item__meta">
                        <strong>{staged.file.name}</strong>
                        <small>{formatFileSize(staged.file.size)}</small>
                      </span>
                      <button
                        className="button button--quiet"
                        onClick={() => removeStagedFile(staged.id)}
                        type="button"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                className="button button--quiet"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                Add files
              </button>
              <input
                aria-label="Attachments"
                className="sr-only"
                multiple
                onChange={(event) => {
                  stageFiles(event.target.files)
                  event.target.value = ''
                }}
                ref={fileInputRef}
                type="file"
              />
            </div>
          </div>

          {formError && <p className="form-error" role="alert">{formError}</p>}

          <div className="dialog__actions">
            {isEditing && onDelete && (
              <button className="button button--danger" onClick={onDelete} type="button">Delete</button>
            )}
            <span className="dialog__actions-spacer" />
            <button className="button button--quiet" onClick={onClose} type="button">Cancel</button>
            <button className="button button--primary" disabled={saving} type="submit">
              {isEditing ? 'Save changes' : 'Add application'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

export default function App() {
  const [tracker, setTracker] = useState<TrackerDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<ViewId>('kanban')
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<StateId | 'all'>('all')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [editor, setEditor] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null)
  const [stageNotesId, setStageNotesId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const dialogOpenerRef = useRef<HTMLElement | null>(null)
  const dialogWasOpenRef = useRef(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const dialogIsOpen = editor !== null || stageNotesId !== null

  useEffect(() => {
    let cancelled = false

    async function initialize() {
      try {
        const legacy = tryLoadLegacyLocalStorage()
        if (legacy && !isDemoTrackerProfile()) {
          await saveTrackerDatabase(legacy)
          clearLegacyLocalStorage()
          if (!cancelled) {
            setNotice('Moved your previous browser data into the local JSON file.')
          }
        }

        const loaded = await loadTrackerDatabase()
        if (!cancelled) {
          setTracker(loaded)
          setLoadError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(errorMessage(error))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    initialize()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (dialogIsOpen) {
      dialogWasOpenRef.current = true
      return
    }
    if (!dialogWasOpenRef.current) return

    dialogWasOpenRef.current = false
    const opener = dialogOpenerRef.current
    dialogOpenerRef.current = null
    const focusTarget = opener?.isConnected ? opener : addButtonRef.current
    focusTarget?.focus()
  }, [dialogIsOpen])

  const commit = async (next: TrackerDocument, message?: string) => {
    try {
      const saved = await saveTrackerDatabase(next)
      setTracker(saved)
      if (message) setNotice(message)
    } catch (error) {
      setNotice(`Save failed: ${errorMessage(error)}`)
    }
  }

  const companies = useMemo(() => {
    const names = [...new Set((tracker?.applications ?? []).map((application) => application.company))]
    return names.sort((left, right) => left.localeCompare(right))
  }, [tracker?.applications])

  const filteredApplications = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const applications = tracker?.applications ?? []
    const searchText = tracker?.indexes.search_text ?? {}
    return applications.filter((application) => {
      if (stateFilter !== 'all' && application.state !== stateFilter) return false
      if (companyFilter !== 'all' && application.company !== companyFilter) return false
      if (!query) return true
      return searchText[application.id]?.includes(query) ?? false
    })
  }, [companyFilter, search, stateFilter, tracker?.applications, tracker?.indexes])

  if (loading) {
    return (
      <div className="app-shell">
        <main id="main">
          <p className="empty-state">Loading tracker data…</p>
        </main>
      </div>
    )
  }

  if (loadError || !tracker) {
    return (
      <div className="app-shell">
        <main id="main">
          <section className="empty-state">
            <h1>Could not load tracker data</h1>
            <p>{loadError ?? 'Tracker data is unavailable.'}</p>
            <p>
              Fix or remove <code>{trackerDatabasePath()}</code>, then reload the page. Your file was not overwritten.
            </p>
          </section>
        </main>
      </div>
    )
  }

  const editingApplication = editor?.mode === 'edit'
    ? tracker.applications.find((application) => application.id === editor.id) ?? null
    : null

  const stageNotesApplication = stageNotesId
    ? tracker.applications.find((application) => application.id === stageNotesId) ?? null
    : null

  const rememberDialogOpener = (opener?: HTMLElement) => {
    const activeElement = document.activeElement
    dialogOpenerRef.current = opener
      ?? (activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null)
  }

  const openApplication = (id: string) => {
    rememberDialogOpener()
    setEditor({ mode: 'edit', id })
  }

  const openNewApplication = (opener: HTMLButtonElement) => {
    rememberDialogOpener(opener)
    setEditor({ mode: 'add' })
  }

  const openStageNotes = (id: string) => {
    rememberDialogOpener()
    setStageNotesId(id)
  }

  const closeEditor = () => setEditor(null)

  const move = (id: string, state: StateId) => {
    const current = tracker.applications.find((application) => application.id === id)
    const next = moveApplication(tracker, id, state)
    if (next !== tracker) commit(next, `${current?.company ?? 'Application'} moved to ${STATE_LABELS[state]}.`)
  }

  const currentView = (() => {
    const shared = {
      applications: filteredApplications,
      onOpen: openApplication,
      onOpenStageNotes: openStageNotes,
    }
    switch (activeView) {
      case 'table':
        return <TableView {...shared} onMove={move} />
      case 'focus':
        return <FocusView {...shared} />
      case 'calendar':
        return <CalendarView {...shared} />
      case 'stale':
        return <StaleView {...shared} onMove={move} />
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
              <Icon aria-hidden="true" size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="topbar__actions">
          <button
            className="button button--primary add-button"
            onClick={(event) => openNewApplication(event.currentTarget)}
            ref={addButtonRef}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            Add application
          </button>

          <MoreActionsMenu>
            <button
              className="actions-menu__item"
              onClick={() => importInputRef.current?.click()}
              type="button"
            >
              <Upload aria-hidden="true" size={16} /> Import
            </button>
            <button
              className="actions-menu__item"
              onClick={() => {
                downloadTrackerArchive(tracker).catch((error) => {
                  setNotice(`Export failed: ${errorMessage(error)}`)
                })
              }}
              type="button"
            >
              <Download aria-hidden="true" size={16} /> Export
            </button>
            {isDemoTrackerProfile() && (
              <button
                className="actions-menu__item"
                onClick={async () => {
                  if (window.confirm('Reset the tracker to the original 19 demo applications? This replaces your current data.')) {
                    try {
                      const next = await resetTrackerDatabase()
                      setTracker(next)
                      setSearch('')
                      setStateFilter('all')
                      setCompanyFilter('all')
                      setNotice('Demo data restored.')
                    } catch (error) {
                      setNotice(`Reset failed: ${errorMessage(error)}`)
                    }
                  }
                }}
                type="button"
              >
                <RotateCcw aria-hidden="true" size={16} /> Reset demo data
              </button>
            )}
          </MoreActionsMenu>
        </div>
      </header>

      {/*
        * Kept outside MoreActionsMenu: the panel unmounts when it closes, and
        * the picker is opened by the Import item after the panel is gone.
        */}
      <input
        accept="application/json,.json,application/zip,.zip"
        className="sr-only"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          try {
            const bytes = await readFileAsUint8Array(file)
            if (isZipArchive(bytes)) {
              const { document, files } = unpackTrackerArchive(bytes)
              if (window.confirm(`Replace your current tracker with ${document.applications.length} imported applications and ${files.length} attachments?`)) {
                const saved = await importTrackerArchive(document, files)
                setTracker(saved)
                setNotice(`Imported ${saved.applications.length} applications.`)
              }
              return
            }

            const imported = parseTrackerDocument(new TextDecoder().decode(bytes))
            if (window.confirm(`Replace your current tracker with ${imported.applications.length} imported applications?`)) {
              await importTrackerArchive(imported, [])
              const saved = await loadTrackerDatabase()
              setTracker(saved)
              setNotice(`Imported ${saved.applications.length} applications.`)
            }
          } catch (error) {
            setNotice(`Import failed: ${errorMessage(error)}`)
          }
        }}
        ref={importInputRef}
        type="file"
      />

      <main id="main">
        {/*
          * One row for the whole view context: which view, how much of the
          * collection is showing, and the filters that decide it. The view name
          * is not repeated here as a display heading — the nav tab already
          * carries it — but it stays the page's h1 for document structure.
          */}
        <section aria-label="View context and filters" className="context-bar">
          <h1>{VIEW_OPTIONS.find((view) => view.id === activeView)?.label}</h1>
          <p className="context-bar__count">
            {filteredApplications.length} of {tracker.applications.length} applications shown
          </p>

          <div className="context-bar__filters">
            <div className="search-field">
              <Search aria-hidden="true" size={15} />
              <input
                aria-label="Search applications"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search company, role, source, notes or action"
                type="search"
                value={search}
              />
            </div>
            <select
              aria-label="Filter by state"
              onChange={(event) => setStateFilter(event.target.value as StateId | 'all')}
              value={stateFilter}
            >
              <option value="all">All states</option>
              {STATE_CONFIG.map((state) => <option key={state.id} value={state.id}>{state.label}</option>)}
            </select>
            <select
              aria-label="Filter by company"
              onChange={(event) => setCompanyFilter(event.target.value)}
              value={companyFilter}
            >
              <option value="all">All companies</option>
              {companies.map((company) => (
                <option key={company} value={company}>{company}</option>
              ))}
            </select>
            {(search || stateFilter !== 'all' || companyFilter !== 'all') && (
              <button
                className="button button--quiet"
                onClick={() => {
                  setSearch('')
                  setStateFilter('all')
                  setCompanyFilter('all')
                }}
                type="button"
              >
                Clear filters
              </button>
            )}
          </div>
        </section>

        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button aria-label="Dismiss message" className="icon-button" onClick={() => setNotice(null)} type="button">
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        )}
        <section className="view-surface">{currentView}</section>
      </main>

      {editor && (editor.mode === 'add' || editingApplication) && (
        <ApplicationEditor
          application={editor.mode === 'edit' ? editingApplication : null}
          onClose={closeEditor}
          onDelete={editor.mode === 'edit' ? async () => {
            if (window.confirm(`Delete ${editingApplication?.company ?? 'this application'}?`)) {
              await deleteApplicationAttachmentFolder(editor.id)
              await commit(deleteApplication(tracker, editor.id), 'Application deleted.')
              closeEditor()
            }
          } : undefined}
          onSave={async (values, attachmentPlan, invites) => {
            const input: ApplicationInput = {
              company: values.company,
              role: values.role || null,
              url: values.url || null,
              source: values.source || null,
              state: values.state,
              next_action: values.nextAction || null,
              next_action_at: values.nextAction.trim() ? fromDateTimeInput(values.nextActionAt) : null,
              deadline_at: fromDateTimeInput(values.deadlineAt),
              notes: values.notes || null,
            }
            const now = new Date()
            if (editor.mode === 'add') {
              let next = addApplication(tracker, input, now)
              const created = next.applications.at(-1)!
              const attachments = await applyAttachmentPlan(created.id, attachmentPlan, now)
              if (attachments.length > 0) {
                next = updateApplication(next, created.id, { attachments }, now)
              }
              next = updateApplicationStateEvents(next, created.id, invites, now)
              await commit(next, 'Application added.')
            } else {
              const attachments = await applyAttachmentPlan(editor.id, attachmentPlan, now)
              let next = updateApplication(tracker, editor.id, {
                company: input.company,
                role: input.role,
                url: input.url,
                source: input.source,
                next_action: input.next_action,
                next_action_at: input.next_action_at,
                deadline_at: input.deadline_at,
                notes: input.notes,
                attachments,
              }, now)
              next = updateApplicationStateEvents(next, editor.id, invites, now)
              next = moveApplication(next, editor.id, values.state, now)
              await commit(next, 'Application updated.')
            }
            closeEditor()
          }}
        />
      )}

      {stageNotesApplication && (
        <StageNotesDialog
          application={stageNotesApplication}
          onClose={() => setStageNotesId(null)}
          onSave={async (drafts: StageNoteDraft[]) => {
            await commit(
              updateApplicationStageNotes(tracker, stageNotesApplication.id, drafts, new Date()),
              'Prep notes saved.',
            )
            setStageNotesId(null)
          }}
        />
      )}
    </div>
  )
}
