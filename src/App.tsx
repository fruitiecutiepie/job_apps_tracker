import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Archive,
  CircleCheck,
  ChartNoAxesColumnIncreasing,
  ClipboardCopy,
  Coffee,
  Columns3,
  Download,
  KanbanSquare,
  ListOrdered,
  MoreHorizontal,
  NotebookPen,
  Plus,
  RotateCcw,
  Search,
  Table2,
  Upload,
  X,
} from 'lucide-react'
import {
  OUTCOME_CONFIG,
  SOURCE_SUGGESTIONS,
  STAGE_CONFIG,
  DEMO_APPLICATION_COUNT,
  archiveApplication,
  archivableApplications,
  archiveEndedApplications,
  archiveFilterMatches,
  outcomeAbandonsTask,
  outcomeFilterMatches,
  outcomesForFilter,
  stagesForFilter,
  stageFilterMatches,
  statusLabel,
  addApplication,
  clearLegacyLocalStorage,
  completeApplicationNextAction,
  updateApplicationCompletedActions,
  createAttachmentMetadata,
  createUuidV7,
  deleteApplication,
  deleteApplicationAttachmentFolder,
  downloadTrackerArchive,
  downloadArchive,
  formatFileSize,
  importTrackerArchive,
  describeImportErrors,
  readTrackerImport,
  type TrackerImportSuccess,
  loadTrackerDatabase,
  MAX_ATTACHMENT_BYTES,
  moveApplication,
  openAttachmentFile,
  readFileAsUint8Array,
  resetTrackerDatabase,
  saveTrackerDatabase,
  subscribeTrackerChanges,
  updateTrackerDatabase,
  renameTracker,
  setStages,
  applyStages,
  DEFAULT_STAGE_CONFIG,
  stageConfigFrom,
  tryLoadLegacyLocalStorage,
  updateApplication,
  reviseApplicationStageCapture,
  updateApplicationStageCapture,
  updateApplicationPosting,
  updateApplicationRatings,
  updateApplicationCorrespondence,
  updateApplicationStageEvents,
  uploadAttachmentFile,
  deleteAttachmentFile,
  type Application,
  type ApplicationInput,
  type Attachment,
  type CompletedActionDraft,
  type PostingDraft,
  type CorrespondenceDraft,
  type ArchiveFilter,
  type OutcomeFilter,
  type OutcomeId,
  type StageEventDraft,
  type StageFilter,
  type StageId,
  type Status,
  type TrackerDocument,
} from './domain'
import { isDemoTrackerProfile, trackerDatabasePath } from './domain/trackerProfile'
import { backend, isBrowserBackend, type StorageConnection, type TrackerSummary } from './backend'
import { KOFI_URL } from './siteLinks'
import { DemoBanner, StorageIntro, StorageStatus } from './StorageStatus'
import { ReplaceTrackerDialog, type ExistingTracker, type ReplaceChoice, type TrackerReplacement } from './ReplaceTrackerDialog'
import type { FileHandleLike } from './backend/fileSystem'
import { useStorageState } from './useStorageState'
import { TrackerSwitcher } from './TrackerSwitcher'
import { navigation, NEW_TRACKER, trackerHref } from './backend/trackerAddress'
import { useFileImport } from './useFileImport'
import { DisclosureMenu } from './DisclosureMenu'
import { FeedbackWidget } from './feedback/FeedbackWidget'
import { StagesDialog } from './StagesDialog'
import { ARCHIVE_BULK_NOTHING, archiveBulkConfirmation, archiveBulkLabel, archiveBulkNotice } from './archiveCopy'
import { ThemeMenu } from './ThemeMenu'
import { CompletedActionFields, type CompletedActionRow } from './CompletedActionFields'
import { RatingFields } from './RatingFields'
import { StageHistory } from './StageHistory'
import { CompensationFields } from './CompensationFields'
import {
  compensationFromValues,
  compensationValuesFor,
  firstCompensationProblem,
  type CompensationValues,
} from './compensation'
import { ratingDrafts, ratingValuesFor, type RatingValues } from './ratings'
import { fromDateTimeInput, toDateTimeInput } from './dateInput'
import { CorrespondenceFields } from './CorrespondenceFields'
import { InviteFields } from './InviteFields'
import {
  correspondenceDrafts,
  correspondenceRowsFor,
  firstCorrespondenceProblem,
  type CorrespondenceRow,
} from './correspondence'
import {
  firstInviteProblem,
  inviteDrafts,
  inviteRowsFor,
  type InviteRow,
} from './invites'
import type { StageNoteDraftBatch } from './StageNotesPanel'
import { applyEditorSave } from './editorSave'
import { applyStageDraftBatches, saveStageNoteDraft } from './stageDraftBatches'
import { postingRef, stageRef, type NoteRequest } from './notesLayout'
import { PostingField } from './PostingField'
import { formatShortDate } from './views/viewUtils'
import { firstPostingProblem, postingDraftFrom, postingRowFor, type PostingRow } from './posting'
import { StageNotesButton } from './views/StageNotesButton'
import { useDialogKeyboard } from './useDialogKeyboard'
import { idleFilterMatches, type IdleFilter } from './views/idle'
import { useStatsSettings } from './statsSettings'
import {
  CompareNotesView,
  KanbanView,
  PrepNotesView,
  StatisticsView,
  TableView,
} from './views'

type ViewId = 'kanban' | 'table' | 'statistics' | 'compare'

const VIEW_OPTIONS = [
  { id: 'kanban', label: 'Kanban', icon: KanbanSquare },
  { id: 'table', label: 'Table', icon: Table2 },
  { id: 'statistics', label: 'Statistics', icon: ChartNoAxesColumnIncreasing },
  { id: 'compare', label: 'Compare', icon: Columns3 },
] as const

/**
 * Prep notes is not one of those, and deliberately not a `ViewId` either. They are views of
 * the application collection — they share its count, its search and its filters — and this
 * is a workspace that ignores every one of them. It is a layer shown over whichever view
 * you are on, which is why it is held as a flag beside `activeView` rather than as one of
 * its values: the view underneath does not change while the notes are up, so putting it
 * back when they go needs nothing remembered.
 */
/*
 * "Prep" rather than "Prep notes": the view holds an application's job posting as well as
 * the notes written against it, and a posting is not a note anybody wrote. What survives
 * the rename is the adjective, which is true of everything here — you read the posting in
 * order to prepare. The notes themselves are still prep notes, and still say so.
 */
const NOTES_VIEW = { label: 'Prep', icon: NotebookPen } as const

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
  return (
    <DisclosureMenu
      ariaLabel="More actions"
      className="actions-menu"
      label={<MoreHorizontal aria-hidden="true" size={18} />}
      panelClassName="actions-menu__panel"
      triggerClassName="icon-button"
    >
      {children}
    </DisclosureMenu>
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
  stage: StageId
  outcome: OutcomeId
  archived: boolean
  nextAction: string
  nextActionAt: string
  deadlineAt: string
  notes: string
  ratings: RatingValues
  compensation: CompensationValues
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
  /** A stage whose messages open, and scroll to, when the dialog does. */
  messagesFor?: StageId
  onClose: () => void
  onDelete?: () => void
  onOpenStageNotes?: (id: string) => void
  onSave: (
    values: EditorValues,
    attachmentPlan: AttachmentSavePlan,
    invites: StageEventDraft[],
    completedActions: CompletedActionDraft[],
    posting: PostingDraft | null,
    correspondence: CorrespondenceDraft[],
    opened: Application | null,
  ) => Promise<void>
}

function ApplicationEditor({ application, messagesFor, onClose, onDelete, onOpenStageNotes, onSave }: ApplicationEditorProps) {
  const isEditing = application !== null
  const dialogRef = useRef<HTMLElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState<EditorValues>(() => ({
    company: application?.company ?? '',
    role: application?.role ?? '',
    url: application?.url ?? '',
    source: application?.source ?? '',
    stage: application?.stage ?? 'applied',
    outcome: application?.outcome ?? 'active',
    archived: application ? application.archived_at !== null : false,
    nextAction: application?.next_action ?? '',
    nextActionAt: toDateTimeInput(application?.next_action_at ?? null),
    deadlineAt: toDateTimeInput(application?.deadline_at ?? null),
    notes: application?.notes ?? '',
    ratings: ratingValuesFor(application),
    compensation: compensationValuesFor(application),
  }))
  const [invites, setInvites] = useState<InviteRow[]>(() => inviteRowsFor(application))
  const [correspondence, setCorrespondence] = useState<CorrespondenceRow[]>(() =>
    correspondenceRowsFor(application),
  )
  const [completedActions, setCompletedActions] = useState<CompletedActionRow[]>(() =>
    (application?.completed_actions ?? []).map((entry) => ({
      key: entry.id,
      id: entry.id,
      action: entry.action,
      at: entry.at,
    })),
  )
  const [posting, setPosting] = useState<PostingRow>(() => postingRowFor(application))
  const [keptAttachments] = useState<Attachment[]>(() => application?.attachments ?? [])
  const openedRef = useRef(application)
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
          <div className="dialog__header-title">
            <h2 id="application-dialog-title">{isEditing ? 'Edit application' : 'Add application'}</h2>
            {isEditing && application && onOpenStageNotes && (
              <StageNotesButton application={application} onOpenStageNotes={onOpenStageNotes} variant="table" />
            )}
          </div>
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
            const correspondenceProblem = firstCorrespondenceProblem(correspondence)
            if (correspondenceProblem) {
              setFormError(correspondenceProblem)
              return
            }
            const compensationProblem = firstCompensationProblem(values.compensation)
            if (compensationProblem) {
              setFormError(compensationProblem)
              return
            }
            const postingProblem = firstPostingProblem(posting)
            if (postingProblem) {
              setFormError(postingProblem)
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
                completedActions.map(({ id, action, at }) => ({ id, action, at })),
                postingDraftFrom(posting),
                correspondenceDrafts(correspondence),
                openedRef.current,
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
                // Not when the dialog was opened at a message: that lands on the
                // correspondence section, and this would take the focus straight back.
                autoFocus={!messagesFor}
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
            <PostingField
              applicationUrl={values.url}
              formatDate={formatShortDate}
              onChange={setPosting}
              row={posting}
            />
            {/*
              * Two selects, because they are two questions: how far it got, and whether it
              * is still going. Every pair is reachable here, which is what lets the quick
              * controls on the card and the row offer only the likely moves.
              */}
            <label className="field">
              <span>Stage</span>
              <select onChange={(event) => update('stage', event.target.value as StageId)} value={values.stage}>
                {STAGE_CONFIG.map((stage) => (
                  <option key={stage.id} value={stage.id}>{stage.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Outcome</span>
              <select onChange={(event) => update('outcome', event.target.value as OutcomeId)} value={values.outcome}>
                {OUTCOME_CONFIG.map((outcome) => (
                  <option key={outcome.id} value={outcome.id}>
                    {outcome.label} — {outcome.description}
                  </option>
                ))}
              </select>
            </label>
            {isEditing && (
              <label className="field field--wide field--check">
                <input
                  checked={values.archived}
                  onChange={(event) => update('archived', event.target.checked)}
                  type="checkbox"
                />
                <span>Archived — kept, but hidden from the current search</span>
              </label>
            )}
            {/* The saved record, so a stage picked but not yet saved is deliberately absent. */}
            {application && <StageHistory history={application.stage_history} />}
            <label className="field field--wide">
              <span>Deadline</span>
              <input
                onChange={(event) => update('deadlineAt', event.target.value)}
                type="datetime-local"
                value={values.deadlineAt}
              />
            </label>
            {/*
              * Action, its date, then Done — the control comes after the fields it acts on,
              * so the row reads in the order you fill it in. The button is a sibling of the
              * labels rather than inside one: a label hands its click to the first labelable
              * thing it wraps, and nesting an interactive control in there makes which one
              * you hit depend on the browser.
              */}
            <div className="field field--wide next-action-field">
              <label>
                <span>Next action</span>
                <input
                  onChange={(event) => update('nextAction', event.target.value)}
                  placeholder="Follow up, prepare, send…"
                  value={values.nextAction}
                />
              </label>
              <label>
                <span>Next action date</span>
                <input
                  disabled={!values.nextAction.trim()}
                  onChange={(event) => update('nextActionAt', event.target.value)}
                  type="datetime-local"
                  value={values.nextActionAt}
                />
              </label>
              <button
                aria-label="Mark next action done"
                className="button button--quiet"
                disabled={!values.nextAction.trim()}
                onClick={() => {
                  const action = values.nextAction.trim()
                  if (!action) return
                  // Draft only: the record is written when the dialog is saved, like every
                  // other control here, so closing without saving changes nothing.
                  setCompletedActions((current) => [
                    ...current,
                    { key: createUuidV7(), action, at: new Date().toISOString() },
                  ])
                  setValues((current) => ({ ...current, nextAction: '', nextActionAt: '' }))
                }}
                title={values.nextAction.trim() ? undefined : 'Set a next action to mark one done'}
                type="button"
              >
                <CircleCheck aria-hidden="true" size={14} />
                <span>Done</span>
              </button>
            </div>
            <CompletedActionFields onChange={setCompletedActions} rows={completedActions} />
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
              defaultStage={values.stage}
              onChange={setInvites}
              rows={invites}
            />
            <CorrespondenceFields
              defaultStage={values.stage}
              messagesFor={messagesFor}
              onChange={setCorrespondence}
              rows={correspondence}
            />
            <RatingFields
              onChange={(dimension, value) =>
                update('ratings', { ...values.ratings, [dimension]: value })
              }
              values={values.ratings}
            />
            <CompensationFields
              onAmountChange={(stage, bound, value) =>
                update('compensation', {
                  ...values.compensation,
                  stages: {
                    ...values.compensation.stages,
                    [stage]: { ...values.compensation.stages[stage], [bound]: value },
                  },
                })
              }
              onCurrencyChange={(currency) =>
                update('compensation', { ...values.compensation, currency })
              }
              values={values.compensation}
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
  // External editor saves arrive asynchronously, so they must read the newest document
  // rather than whichever one was current when their handler was created.
  const trackerRef = useRef<TrackerDocument | null>(null)
  /*
   * The open tracker's stages are module state that every label, column and filter reads,
   * since few of those places have the document to hand. They are applied here, during
   * render, because the components that read them render after this one in the same pass —
   * an effect would leave the first render after a rename showing the old names.
   */
  const storedStages = tracker?.stages
  const stages = useMemo(
    () => (storedStages ? stageConfigFrom(storedStages) : DEFAULT_STAGE_CONFIG),
    [storedStages],
  )
  applyStages(stages)
  const [stagesOpen, setStagesOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<ViewId>('kanban')
  /** Whether the prep notes workspace is up over that view. */
  const [notesOpen, setNotesOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<StageFilter>('all')
  const [idleFilter, setIdleFilter] = useState<IdleFilter>('all')
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all')
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>('current')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  /*
   * `messagesFor` opens the dialog with one stage's messages already unfolded and the section
   * scrolled to. Reading a message and wanting to fix it is the commonest way into this form
   * from the panel, and landing at the top of a long form to hunt for the row you were just
   * looking at is the whole of the annoyance.
   */
  const [editor, setEditor] = useState<
    { mode: 'add' } | { mode: 'edit'; id: string; messagesFor?: StageId } | null
  >(null)
  /**
   * The note a card or a row asked for, waiting to be opened into the prep notes view. The
   * nonce is what makes asking twice for the same note two requests: the second would
   * otherwise be no change at all, and nothing would bring the note back on show.
   */
  const [notesRequest, setNotesRequest] = useState<NoteRequest | null>(null)
  const notesNonce = useRef(0)
  const [notice, setNotice] = useState<string | null>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const dialogOpenerRef = useRef<HTMLElement | null>(null)
  const dialogWasOpenRef = useRef(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  /* Kept apart from the import input: that one replaces this tracker, this one starts another. */
  const otherTrackerInputRef = useRef<HTMLInputElement>(null)
  const storageState = useStorageState()

  /*
   * Another tab holding this tracker wrote it, or removed it. A newer document replaces
   * what is on screen at once, so the two tabs never show different trackers under one
   * name; a removal sends this tab where the removing one went, rather than letting its
   * next keystroke write the tracker back.
   */
  useEffect(() => subscribeTrackerChanges((change) => {
    if (change.kind === 'removed') {
      navigation.open(trackerHref(change.next?.id ?? NEW_TRACKER))
      return
    }
    trackerRef.current = change.document
    setTracker(change.document)
  }), [])
  const listTrackers = useCallback(() => backend.storage!.listTrackers(), [])

  /*
   * The tab says which tracker it holds, so several open at once can be told apart in the
   * tab strip — the whole point of holding more than one.
   */
  const trackerName = storageState?.tracker?.name ?? null
  useEffect(() => {
    if (trackerName === null) return
    const previous = document.title
    document.title = `${trackerName} — Job applications`
    return () => {
      document.title = previous
    }
  }, [trackerName])
  /*
   * A replacement waiting on its question: what the dialog asks about, and what runs if the
   * viewer goes ahead. An import and starting fresh are one gate, so neither can grow a
   * way of replacing the tracker the other does not ask about.
   */
  const [pendingReplace, setPendingReplace] = useState<{
    replacement: TrackerReplacement | ExistingTracker
    proceed: () => Promise<void>
    /** Downloads the tracker about to be replaced or removed, which need not be this one. */
    saveCopy: () => Promise<void>
    /** Opens an imported file as a tracker of its own, where a browser can hold several. */
    openAsNew?: () => Promise<void>
    /** Goes to the tracker a file already belongs to. */
    switchTo?: () => void
  } | null>(null)
  // Prep notes became a view rather than a dialog, so only the editor is one now.
  const dialogIsOpen = editor !== null
  // Read by every view, not only Statistics: its quiet threshold is the board's and the
  // table's Idle threshold too, and the activity filter reads it.
  const [statsSettings, changeStatsSetting] = useStatsSettings()

  useEffect(() => {
    let cancelled = false

    async function initialize() {
      try {
        /*
         * The migration is from the browser-storage era into the local JSON file, so it
         * only makes sense for the backend that owns that file. The static build has its
         * own storage and must not adopt a document it never wrote.
         */
        const legacy = isBrowserBackend() ? null : tryLoadLegacyLocalStorage()
        if (legacy && !isDemoTrackerProfile()) {
          await saveTrackerDatabase(legacy)
          clearLegacyLocalStorage()
          if (!cancelled) {
            setNotice('Moved your previous browser data into the local JSON file.')
          }
        }

        const loaded = await loadTrackerDatabase()
        if (!cancelled) {
          trackerRef.current = loaded
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

  // Reports whether the write landed, so a caller that keeps its own record of what is
  // stored — the notes panel, which retries what did not — can tell the two apart.
  /**
   * Writes run one at a time, and each is handed the document the write before it stored
   * rather than one read when it was scheduled.
   *
   * Every write here stores the whole document, so two of them built from the same
   * snapshot do not merge: the second silently undoes the first. That is not hypothetical
   * with the notes panel open — the autosave writes on a pause in typing while a captured
   * line writes the instant it is entered, and either can start while the other is in
   * flight. Losing what someone just told you, with nothing failing anywhere, is the worst
   * outcome this app has.
   *
   * Queueing the mutation rather than the save is what fixes it. A mutation that has not
   * run yet cannot be holding a stale document, so the fix cannot be undone by adding
   * another caller: passing a document instead of a function is no longer possible.
   */
  const writes = useRef<Promise<unknown>>(Promise.resolve())

  const commit = (
    mutate: (current: TrackerDocument) => TrackerDocument,
    message?: string,
  ): Promise<boolean> => {
    const done = writes.current.then(async () => {
      const current = trackerRef.current
      if (!current) return false

      try {
        /*
         * The mutation, not the document, goes to storage: where another tab holds this
         * tracker too, it is run there on whatever that tab last stored. Every mutation
         * returns the document it was given when there is nothing to do, which is also
         * what keeps a no-op move or an unchanged draft off the disk.
         */
        const { document: saved, wrote } = await updateTrackerDatabase(current, mutate)
        if (saved !== trackerRef.current) {
          trackerRef.current = saved
          setTracker(saved)
        }
        if (wrote && message) setNotice(message)
        return true
      } catch (error) {
        setNotice(`Save failed: ${errorMessage(error)}`)
        return false
      }
    })

    // The chain has to survive a failed write, or one would strand every write after it.
    writes.current = done.catch(() => undefined)
    return done
  }

  /**
   * The single way a file becomes the tracker, whichever of the three ways it arrived by.
   *
   * Reading and validating happen before the confirmation rather than after, so the
   * question names what is actually in the file. A file that cannot be read never gets as
   * far as asking, and says why instead.
   */
  const importFile = async (file: File, handle: Promise<FileHandleLike | null> | null = null) => {
    try {
      const result = readTrackerImport(await readFileAsUint8Array(file))
      if (!result.ok) {
        setNotice(`Import failed: ${describeImportErrors(result.errors)}`)
        return
      }
      const source = handle ? await handle : null

      // A file that already is a tracker here: this one is left alone, another is offered.
      if (await answeredAsExisting(file, source, result)) return

      // An empty tracker has nothing to replace, so there is nothing to ask.
      const current = trackerRef.current?.applications.length ?? 0
      if (current === 0) {
        await applyImport(result.document, result.files, file.name, source)
        return
      }

      /*
       * Where a browser holds several trackers, replacing never overwrites one. It opens the
       * file as a tracker in this tab and closes the one that was here, which is removing it
       * from this browser — so what can be lost is what removing loses. A tracker saved to
       * a folder loses nothing, its folder untouched; one whose last export has everything
       * loses nothing; only one kept nowhere but this browser is asked about a copy. The dev
       * server holds one file, so there replacing still means writing over it.
       */
      const connection = storageState?.connection ?? null
      const folder = connection?.kind === 'connected' ? connection.name : null
      const hosted = Boolean(storageState?.tracker)
      setPendingReplace({
        replacement: {
          kind: 'import',
          fileName: file.name,
          current,
          backedUp:
            folder !== null
            || (connection !== null && storageState?.unbackedSince === null),
          folder,
          openAsNewBeside: storageState?.tracker?.name ?? null,
        },
        proceed: hosted
          ? () => openInPlace(result, file.name, source)
          : () => applyImport(result.document, result.files, file.name, source),
        saveCopy: saveCurrentCopy,
        openAsNew: () => openAsTracker(result, file.name, source),
      })
    } catch (error) {
      setNotice(`Import failed: ${errorMessage(error)}`)
    }
  }

  /*
   * Whether a file is one this browser already holds as a tracker — the tracker.json of a
   * folder one saves to, or the file one was opened from — and if so, answers for it.
   * Matched by the browser comparing the two files on disk, never by what they hold: two
   * files that read alike are still two files, and opening the second as a tracker of its
   * own is a fair thing to want. Where the browser offers no handle on the file (a paste,
   * Firefox, Safari), nothing matches and the ordinary question is asked.
   */
  const answeredAsExisting = async (
    file: File,
    source: FileHandleLike | null,
    result: TrackerImportSuccess,
  ): Promise<boolean> => {
    if (!source || !backend.storage) return false
    const match = await backend.storage.findTrackerForFile(source)
    if (!match) return false
    if (match.id === storageState?.tracker?.id) {
      setNotice(
        match.folder
          ? `${file.name} is the file ${match.name} already saves to, so there is nothing to import.`
          : `${match.name} was opened from ${file.name} already, so there is nothing to import.`,
      )
      return true
    }
    setPendingReplace({
      replacement: { kind: 'existing', name: match.name, folder: match.folder ?? null },
      proceed: async () => {},
      saveCopy: async () => {},
      openAsNew: () => openAsTracker(result, file.name, source),
      switchTo: () => navigation.open(trackerHref(match.id)),
    })
    return true
  }

  /*
   * Replace: the file opens as a tracker in this tab, and the tracker that was here closes —
   * taken off this browser's list, its folder's files never touched. Created first, so a
   * failure leaves the old one where it was rather than leaving neither.
   */
  const openInPlace = async (result: TrackerImportSuccess, filename: string, source: FileHandleLike | null) => {
    const closing = storageState?.tracker?.id
    try {
      const created = await backend.storage!.createTracker(result.document, result.files, filename, source)
      if (closing) await backend.storage!.removeTracker(closing)
      navigation.open(trackerHref(created.id))
    } catch (error) {
      setNotice(`Import failed: ${errorMessage(error)}`)
    }
  }

  /* A file as a tracker of its own, remembering which file, so it can be recognised again. */
  const openAsTracker = async (result: TrackerImportSuccess, filename: string, source: FileHandleLike | null) => {
    const created = await backend.storage!.createTracker(result.document, result.files, filename, source)
    navigation.open(trackerHref(created.id))
  }

  const applyImport = async (
    document: TrackerImportSuccess['document'],
    files: TrackerImportSuccess['files'],
    filename: string,
    source: FileHandleLike | null = null,
  ) => {
    try {
      const saved = await importTrackerArchive(document, files)
      // What was just imported is a file the viewer already holds, and names the tracker.
      await backend.storage?.markBackedUp()
      await backend.storage?.nameAfterFile(filename, source)
      trackerRef.current = saved
      setTracker(saved)
      setNotice(`Imported ${saved.applications.length} applications.`)
    } catch (error) {
      setNotice(`Import failed: ${errorMessage(error)}`)
    }
  }

  /*
   * Removes this tab's tracker from browser storage and opens the next one. A connected
   * folder's files are never touched — they are the viewer's — which is why a folder
   * counts as the copy here when it does not for an import, which writes into it.
   */
  const saveCurrentCopy = async () => {
    const current = trackerRef.current
    if (current) await downloadTrackerArchive(current, new Date(), storageState?.tracker?.name)
  }

  /*
   * Removes a tracker from browser storage. Removing the one this tab holds opens the next;
   * removing another leaves this tab where it is, and any tab holding that one is moved on
   * by the backend.
   */
  const removeTracker = async (target: TrackerSummary) => {
    try {
      const next = await backend.storage!.removeTracker(target.id)
      if (target.id === storageState?.tracker?.id) {
        navigation.open(trackerHref(next?.id ?? NEW_TRACKER))
      } else {
        setNotice(`Removed ${target.name} from this browser.`)
      }
    } catch (error) {
      setNotice(`Could not remove ${target.name}: ${errorMessage(error)}`)
    }
  }

  /*
   * The tracker this tab holds is renamed through its document like any edit. Another one
   * is renamed by the backend, which writes its document — and its folder, if it has one.
   */
  /* Whether the name was stored, so a refused rename can leave the field open to retry. */
  const renameTrackerById = async (target: TrackerSummary, name: string): Promise<boolean> => {
    try {
      if (target.id === storageState?.tracker?.id) {
        return await commit((current) => renameTracker(current, name))
      }
      await backend.storage!.renameOtherTracker(target.id, name)
      return true
    } catch (error) {
      setNotice(`Could not rename ${target.name}: ${errorMessage(error)}`)
      return false
    }
  }

  const newTrackerFromFolder = async () => {
    try {
      const result = await backend.storage!.openFolder()
      if (result.outcome === 'opened') navigation.open(trackerHref(result.tracker.id))
    } catch (error) {
      setNotice(`Could not open the folder: ${errorMessage(error)}`)
    }
  }

  /*
   * The same reading and validating an import does, so an unreadable file says why rather
   * than becoming an empty tracker; then the document goes beside this tracker, not over it.
   */
  const newTrackerFromFile = async (file: File, source: FileHandleLike | null = null) => {
    try {
      const result = readTrackerImport(await readFileAsUint8Array(file))
      if (!result.ok) {
        setNotice(`Import failed: ${describeImportErrors(result.errors)}`)
        return
      }
      if (await answeredAsExisting(file, source, result)) return
      await openAsTracker(result, file.name, source)
    } catch (error) {
      setNotice(`Import failed: ${errorMessage(error)}`)
    }
  }

  /*
   * From a file…: through the browser's file picker where it has one, which hands back a
   * handle on the file and so lets it be recognised later; through a plain file input
   * everywhere else, which gives only the file.
   */
  const pickFileForNewTracker = async () => {
    const picker = (window as { showOpenFilePicker?: (options: unknown) => Promise<FileHandleLike[]> })
      .showOpenFilePicker
    if (!picker) {
      otherTrackerInputRef.current?.click()
      return
    }
    try {
      const [handle] = await picker({
        types: [{ description: 'Tracker export', accept: { 'application/json': ['.json'], 'application/zip': ['.zip'] } }],
      })
      if (handle) await newTrackerFromFile(await handle.getFile(), handle)
    } catch (error) {
      // Dismissing the picker is a decision, not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return
      setNotice(`Import failed: ${errorMessage(error)}`)
    }
  }

  /*
   * The same question an import asks, about whichever tracker is being removed: the one
   * this tab holds is measured from what is on screen, another from what its listing says.
   */
  const saveOtherCopy = async (target: TrackerSummary) => {
    const { document, files } = await backend.storage!.readTracker(target.id)
    downloadArchive(document, files, new Date(), target.name)
    await backend.storage!.markOtherBackedUp(target.id)
  }

  /* Export from a row: the tracker on screen as Export always did, any other by its id. */
  const exportTrackerById = (target: TrackerSummary) => {
    if (target.id === storageState?.tracker?.id) {
      exportTracker()
      return
    }
    saveOtherCopy(target).catch((error) => {
      setNotice(`Export failed: ${errorMessage(error)}`)
    })
  }

  const askToRemoveTracker = (target: TrackerSummary) => {
    const holding = target.id === storageState?.tracker?.id
    const connection = storageState?.connection ?? null
    const current = holding ? (trackerRef.current?.applications.length ?? 0) : target.applications
    const unbacked = holding ? (storageState?.unbackedSince ?? null) : (target.unbackedSince ?? null)
    // Another tracker's folder is the copy only while nothing is waiting to reach it: with
    // a backlog its permission lapsed, and what was typed since is in this browser alone.
    const folder = holding
      ? (connection?.kind === 'connected' ? connection.name : null)
      : (unbacked === null ? (target.folder ?? null) : null)
    // An empty tracker has nothing to lose, so there is nothing to ask.
    if (current === 0) {
      void removeTracker(target)
      return
    }
    setPendingReplace({
      replacement: {
        kind: 'remove',
        name: target.name,
        current,
        backedUp: folder !== null || (connection !== null && unbacked === null),
        folder,
      },
      proceed: () => removeTracker(target),
      saveCopy: holding ? saveCurrentCopy : () => saveOtherCopy(target),
    })
  }


  const answerReplace = async (choice: ReplaceChoice) => {
    const pending = pendingReplace
    setPendingReplace(null)
    if (!pending || choice === 'cancel') return
    if (choice === 'switch') {
      pending.switchTo?.()
      return
    }
    if (choice === 'open-new') {
      try {
        await pending.openAsNew?.()
      } catch (error) {
        setNotice(`Import failed: ${errorMessage(error)}`)
      }
      return
    }
    if (choice === 'save-then-proceed') {
      try {
        await pending.saveCopy()
      } catch (error) {
        // No copy, no replacement: the viewer asked for the two together.
        setNotice(`Nothing was replaced, because saving a copy failed: ${errorMessage(error)}`)
        return
      }
    }
    await pending.proceed()
  }

  const dragging = useFileImport({
    onFile: (file, handle) => void importFile(file, handle),
    onRefused: setNotice,
  })

  const companies = useMemo(() => {
    const names = [...new Set((tracker?.applications ?? []).map((application) => application.company))]
    return names.sort((left, right) => left.localeCompare(right))
  }, [tracker?.applications])

  // Only the sources actually in use: an empty option filters to nothing, and a suggestion
  // nobody has applied through would do the same.
  const sources = useMemo(() => {
    const names = new Set(
      (tracker?.applications ?? []).flatMap((application) => {
        const source = application.source?.trim()
        return source ? [source] : []
      }),
    )
    return [...names].sort((left, right) => left.localeCompare(right))
  }, [tracker?.applications])

  const filteredApplications = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const applications = tracker?.applications ?? []
    const searchText = tracker?.indexes.search_text ?? {}
    return applications.filter((application) => {
      if (!archiveFilterMatches(archiveFilter, application.archived_at)) return false
      if (!stageFilterMatches(stageFilter, application.stage)) return false
      if (!outcomeFilterMatches(outcomeFilter, application.outcome)) return false
      if (!idleFilterMatches(idleFilter, application, new Date(), statsSettings.quietDays)) return false
      if (companyFilter !== 'all' && application.company !== companyFilter) return false
      if (sourceFilter !== 'all' && application.source?.trim() !== sourceFilter) return false
      if (!query) return true
      return searchText[application.id]?.includes(query) ?? false
    })
  }, [archiveFilter, companyFilter, idleFilter, outcomeFilter, search, sourceFilter, stageFilter, statsSettings.quietDays, tracker?.applications, tracker?.indexes])

  /**
   * The roles of what is showing, one per line. Repeats are dropped: two applications to the
   * same role at the same company are one line to paste, not two.
   */
  const rolesToCopy = useMemo(() => {
    const roles = new Set(
      filteredApplications.flatMap((application) => {
        const role = application.role?.trim()
        return role ? [role] : []
      }),
    )
    return [...roles]
  }, [filteredApplications])

  const copyRoles = async () => {
    if (rolesToCopy.length === 0) {
      setNotice('Nothing to copy — no application showing has a role.')
      return
    }
    try {
      await navigator.clipboard.writeText(rolesToCopy.join('\n'))
      setNotice(`Copied ${rolesToCopy.length} ${rolesToCopy.length === 1 ? 'role' : 'roles'}.`)
    } catch (error) {
      setNotice(`Copy failed: ${errorMessage(error)}`)
    }
  }

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

  /*
   * Only while there is nothing to look at. Once the first application exists the banner
   * would be in the way, and the topbar control says the same thing in a line.
   */
  const showStorageIntro =
    storageState !== null
    && storageState.connection.kind !== 'connected'
    && tracker.applications.length === 0

  const editingApplication = editor?.mode === 'edit'
    ? tracker.applications.find((application) => application.id === editor.id) ?? null
    : null

  /**
   * Stores one stage's note on its own, for a file coming back from an external editor.
   * Only the stage named is touched, so the other stages' drafts are left alone.
   */
  const commitStageNote = async (
    applicationId: string,
    stage: StageId,
    body: string,
    base: string,
    message: string,
  ): Promise<string> => {
    let merged = body
    await commit((current) => {
      const next = saveStageNoteDraft(current, applicationId, stage, base, body, new Date())
      merged = next.applications
        .find((item) => item.id === applicationId)
        ?.stage_notes.find((note) => note.stage === stage)?.body ?? ''
      return next
    }, message)
    return merged
  }

  const captureStageLine = async (applicationId: string, stage: StageId, line: string) => {
    await commit(
      (current) => updateApplicationStageCapture(current, applicationId, stage, line, new Date()),
      'Note captured.',
    )
  }

  const reviseStageLine = async (
    applicationId: string,
    stage: StageId,
    entryId: string,
    revised: string,
  ) => {
    await commit(
      (current) =>
        reviseApplicationStageCapture(current, applicationId, stage, entryId, revised, new Date()),
      revised.trim() ? 'Note updated.' : 'Note removed.',
    )
  }

  const saveStageDrafts = async (batches: StageNoteDraftBatch[]) => {
    // One mutation for the lot, so a panel holding two companies' notes still writes once.
    // Folding rather than a call each keeps `commit`'s contract: it takes a mutation and
    // hands it the document, which each step passes along.
    //
    // No notice: the panel writes while it is being typed into, and a toast per pause
    // would sit permanently over the notes it is describing. The panel's status bar says
    // the same thing where the writing is already being watched.
    //
    //
    // The merge with whatever another tab stored meanwhile is in `applyStageDraftBatches`.
    const at = new Date()
    return commit((current) => applyStageDraftBatches(current, batches, at))
  }

  const rememberDialogOpener = (opener?: HTMLElement) => {
    const activeElement = document.activeElement
    dialogOpenerRef.current = opener
      ?? (activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null)
  }

  const openApplication = (id: string, messagesFor?: StageId) => {
    rememberDialogOpener()
    setEditor({ mode: 'edit', id, messagesFor })
  }

  const openNewApplication = (opener: HTMLButtonElement) => {
    rememberDialogOpener(opener)
    setEditor({ mode: 'add' })
  }

  /** Shows the notes over the view you are on, or takes them away and leaves it showing. */
  const toggleStageNotes = () => setNotesOpen((open) => !open)

  /**
   * Prep notes are shown over a view rather than in a dialog, so opening them is
   * navigation: there is no opener to return focus to afterwards, and a stale one would
   * aim at a card the switch has already unmounted.
   */
  /** Goes to Prep and asks for one thing in it, whatever was reached for. */
  const openNotesAt = (ref: NoteRequest['ref']) => {
    dialogOpenerRef.current = null
    // Nothing to restore focus to either: coming here from the application editor is the
    // editor handing over, and the note it opens onto takes the caret. Without this the
    // editor closing would fire the restore and pull focus back out to the topbar.
    dialogWasOpenRef.current = false
    notesNonce.current += 1
    setNotesRequest({ ref, nonce: notesNonce.current })
    setNotesOpen(true)
  }

  /**
   * A stage names a note other than the current stage's: the Compare view opens the stage it
   * is showing, which is often not where the application is now.
   */
  const openStageNotes = (id: string, stage?: StageId) => {
    const application = tracker.applications.find((candidate) => candidate.id === id)
    if (!application) return
    openNotesAt(stageRef(id, stage ?? application.stage))
  }

  /**
   * Goes straight to an application's captured posting. The fan it opens into is the same
   * one the prep notes open — the application's own material — so this differs only in
   * which of its tabs you land on.
   */
  const openPosting = (id: string) => {
    const application = tracker.applications.find((candidate) => candidate.id === id)
    if (!application?.posting) return
    openNotesAt(postingRef(id))
  }

  /*
   * Connecting adopts whatever the folder already holds, so the document has to be read
   * back rather than assumed unchanged: pointing the site at last week's export is one of
   * the two reasons anyone presses this.
   */
  const reloadAfter = async (
    connect: () => Promise<StorageConnection | null>,
    message: string,
  ) => {
    try {
      /*
       * Only a folder actually connected is news. A dismissed picker comes back null and a
       * refused permission comes back still needing one; both leave everything as it was,
       * and the topbar already says so.
       */
      const result = await connect()
      if (result?.kind !== 'connected') return
      const loaded = await loadTrackerDatabase()
      trackerRef.current = loaded
      setTracker(loaded)
      setNotice(message)
    } catch (error) {
      setNotice(`Could not open the folder: ${errorMessage(error)}`)
    }
  }

  /*
   * A folder another tracker in this browser already writes to is opened as that tracker
   * rather than connected a second time: two trackers writing whole documents into one
   * file would each undo the other. Picking the folder says "open this", so this does.
   */
  const connectStorage = () => {
    void reloadAfter(async () => {
      const result = await backend.storage!.connect()
      if (result.outcome === 'already-open' || result.outcome === 'opened') {
        navigation.open(trackerHref(result.tracker.id))
        return null
      }
      return result.outcome === 'connected' ? result.connection : null
    }, 'Changes are now saved to that folder too.')
  }

  const reconnectStorage = () => {
    void reloadAfter(() => backend.storage!.reconnect(), 'Reconnected to your folder.')
  }

  /*
   * A download is the one backup a browser without folder support can make, so it is
   * what clears the reminder. Whether the viewer then keeps the file is theirs to know:
   * the download is as far as a page can see.
   */
  const exportTracker = () => {
    downloadTrackerArchive(tracker, new Date(), storageState?.tracker?.name)
      .then(() => backend.storage?.markBackedUp())
      .catch((error) => {
        setNotice(`Export failed: ${errorMessage(error)}`)
      })
  }

  const closeEditor = () => setEditor(null)

  const move = (id: string, change: Partial<Status>) => {
    const moving = tracker.applications.find((application) => application.id === id)
    if (!moving) return
    const target: Status = { stage: change.stage ?? moving.stage, outcome: change.outcome ?? moving.outcome }
    // A rejection or a withdrawal drops an outstanding next action, so the notice says so
    // rather than leaving the task to vanish quietly off the plan.
    const clearing =
      Boolean(moving.next_action?.trim())
      && target.outcome !== moving.outcome
      && outcomeAbandonsTask(target.outcome)
    // A move to where it already stands returns the same document, and `commit` reads
    // that as nothing to write, so no notice is shown for it either.
    commit(
      (current) => moveApplication(current, id, change),
      `${moving.company} moved to ${statusLabel(target)}.${clearing ? ' Next action cleared.' : ''}`,
    )
  }

  const archive = (id: string, archived: boolean) => {
    const company = tracker.applications.find((application) => application.id === id)?.company ?? 'Application'
    commit(
      (current) => archiveApplication(current, id, archived),
      archived ? `${company} archived.` : `${company} is back in the current search.`,
    )
  }

  const archivableList = archivableApplications(tracker)
  const archivable = archivableList.length

  const archiveEnded = () => {
    if (archivable === 0) return
    if (!window.confirm(archiveBulkConfirmation(tracker.applications, archivableList))) return
    commit((current) => archiveEndedApplications(current), archiveBulkNotice(archivable))
  }

  const completeAction = (id: string) => {
    const finishing = tracker.applications.find((application) => application.id === id)
    commit(
      (current) => completeApplicationNextAction(current, id),
      `Action marked done for ${finishing?.company ?? 'the application'}.`,
    )
  }

  const notesLayer = (
    <PrepNotesView
      // Every application, not the filtered set: see `PrepNotesView`.
      applications={tracker.applications}
      onCapture={captureStageLine}
      onExternalChange={(applicationId: string, stage: StageId, body: string, base: string) =>
        commitStageNote(applicationId, stage, body, base, 'Prep notes saved from your editor.')}
      // The editor opens over the workspace rather than instead of it: the arrangement,
      // the drafts and the captures are all the panel's own state, and unmounting it to
      // change a company name would throw the lot away.
      onOpenApplication={openApplication}
      onRequested={() => setNotesRequest(null)}
      onRevise={reviseStageLine}
      onSaveDrafts={saveStageDrafts}
      request={notesRequest}
    />
  )

  const currentView = (() => {
    const shared = {
      applications: filteredApplications,
      onOpen: openApplication,
      onOpenStageNotes: openStageNotes,
      onOpenPosting: openPosting,
      onOpenMessages: openApplication,
      onCompleteAction: completeAction,
      quietDays: statsSettings.quietDays,
    }
    switch (activeView) {
      case 'table':
        return <TableView {...shared} onArchive={archive} onMove={move} />
      case 'statistics':
        return (
          <StatisticsView
            applications={filteredApplications}
            onOpen={openApplication}
            onSettingChange={changeStatsSetting}
            settings={statsSettings}
          />
        )
      case 'compare':
        return (
          <CompareNotesView
            applications={filteredApplications}
            onOpenStageNotes={openStageNotes}
            onSaveStageNote={async (id, stage, body, base) => {
              let merged = body
              await commit((current) => {
                const next = saveStageNoteDraft(current, id, stage, base, body, new Date())
                merged = next.applications
                  .find((item) => item.id === id)
                  ?.stage_notes.find((note) => note.stage === stage)?.body ?? ''
                return next
              })
              return merged
            }}
          />
        )
      default:
        return (
          <KanbanView
            {...shared}
            onArchive={archive}
            onMove={move}
            visibleOutcomes={outcomesForFilter(outcomeFilter)}
            visibleStages={stagesForFilter(stageFilter)}
          />
        )
    }
  })()

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__identity">
          <a className="brand" href="#main" aria-label="Job applications tracker home">
            <span className="brand__mark" aria-hidden="true">J</span>
            <span>
              <strong>Job applications</strong>
              {!storageState?.tracker && <small>Local tracker</small>}
            </span>
          </a>
          {storageState?.tracker && (
            <TrackerSwitcher
              current={storageState.tracker}
              currentFolder={storageState.connection.kind === 'connected' ? storageState.connection.name : null}
              listTrackers={listTrackers}
              onRemove={askToRemoveTracker}
              onRename={renameTrackerById}
              onNewFromFolder={
                storageState.connection.kind === 'unsupported' ? null : () => void newTrackerFromFolder()
              }
              onNewFromFile={() => void pickFileForNewTracker()}
              onExport={exportTrackerById}
            />
          )}
        </div>

        {/*
          * Where you are, in one cell: the seven views of the collection, and the prep
          * notes layer that goes over whichever of them you were reading. The layer keeps
          * out of the strip — it shares none of the filters, and it is a toggle rather
          * than a place in a list — but it belongs on this side of the bar rather than
          * among the actions, which act on the collection and not on where you stand.
          */}
        <div className="topbar__places">
          <nav aria-label="Tracker views" className="view-nav">
            {VIEW_OPTIONS.map(({ id, label, icon: Icon }) => (
              <button
                // Nothing in the strip is the page while the notes are up over it: what is
                // on screen is the workspace, not the view it was opened from.
                aria-current={!notesOpen && activeView === id ? 'page' : undefined}
                className="view-nav__item"
                key={id}
                // Picking a view is also a way out of the notes: the strip is how you get
                // back to the collection, and a tab that changed only what was underneath
                // would look like a button that does nothing.
                onClick={() => {
                  setActiveView(id)
                  setNotesOpen(false)
                }}
                type="button"
              >
                <Icon aria-hidden="true" size={16} />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          {/* A hairline rather than a gap: sharing a cell with the strip, the toggle would
              otherwise read as an eighth item in it, which is the one thing it is not. */}
          <span aria-hidden="true" className="topbar__divider" />

          {/*
            * A workspace shown over whatever view you are on, so it is a toggle: pressed
            * again it goes, and the view underneath comes back. `aria-pressed` rather than
            * `aria-current` for that reason — it is not one of the places in the strip
            * beside it, it is a layer over whichever of them you were reading.
            */}
          <button
            aria-pressed={notesOpen}
            className="button button--quiet topbar__notes"
            onClick={toggleStageNotes}
            title={
              notesOpen
                ? `Back to ${VIEW_OPTIONS.find((view) => view.id === activeView)?.label}`
                : NOTES_VIEW.label
            }
            type="button"
          >
            <NOTES_VIEW.icon aria-hidden="true" size={16} />
            <span>{NOTES_VIEW.label}</span>
          </button>
        </div>

        <div className="topbar__actions">
          {storageState && (
            <StorageStatus
              onConnect={connectStorage}
              onExport={exportTracker}
              onReconnect={reconnectStorage}
              state={storageState}
            />
          )}

          {/*
            * On every view, Prep included, because a problem can be on any of them. The
            * report it sends says which one the reader was on.
            */}
          <FeedbackWidget
            where={notesOpen ? NOTES_VIEW.label : VIEW_OPTIONS.find((view) => view.id === activeView)?.label ?? activeView}
          />

          <ThemeMenu />

          <button
            className="button button--primary add-button"
            onClick={(event) => openNewApplication(event.currentTarget)}
            ref={addButtonRef}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            Add application
          </button>

          {/*
            * Where a browser holds several trackers, Import and Export belong to each one —
            * they are on its row in the switcher — and a menu offering them here would act
            * on one of several without saying which. The dev server holds one file, so it
            * keeps them. Archive all ended and the demo's reset act on the tracker on
            * screen, so the menu stays for them everywhere.
            */}
          <MoreActionsMenu>
            {!storageState?.tracker && (
              <>
                <button
                  className="actions-menu__item"
                  onClick={() => importInputRef.current?.click()}
                  type="button"
                >
                  <Upload aria-hidden="true" size={16} /> Import
                </button>
                <button
                  className="actions-menu__item"
                  onClick={exportTracker}
                  type="button"
                >
                  <Download aria-hidden="true" size={16} /> Export
                </button>
              </>
            )}
            {/*
              * How a new job search starts clean. Exactly what End records — rejected,
              * withdrawn, closed — and never without asking: it touches every one of them
              * at once. With nothing ended it
              * stays, disabled and saying why, rather than vanishing: an action that is only
              * there some of the time is one nobody learns is there.
              */}
            <button
              className="actions-menu__item"
              disabled={archivable === 0}
              onClick={archiveEnded}
              title={archivable === 0 ? ARCHIVE_BULK_NOTHING : undefined}
              type="button"
            >
              <Archive aria-hidden="true" size={16} />
              {archiveBulkLabel(archivable)}
            </button>
            <button
              className="actions-menu__item"
              onClick={() => setStagesOpen(true)}
              type="button"
            >
              <ListOrdered aria-hidden="true" size={16} /> Stages
            </button>
            {isDemoTrackerProfile() && (
              <button
                className="actions-menu__item"
                onClick={async () => {
                  if (window.confirm(`Reset the tracker to the original ${DEMO_APPLICATION_COUNT} demo applications? This replaces your current data.`)) {
                    try {
                      const next = await resetTrackerDatabase()
                      setTracker(next)
                      setSearch('')
                      setStageFilter('all')
                      setOutcomeFilter('all')
                      setArchiveFilter('current')
                      setCompanyFilter('all')
                      setSourceFilter('all')
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
            {/*
              * The hosted builds, and `pnpm dev` so it can be seen while working on it. Not
              * `pnpm start`, which is someone using their own copy rather than developing it.
              */}
            {(isBrowserBackend() || import.meta.env.DEV) && (
              <a
                className="actions-menu__item"
                href={KOFI_URL}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Coffee aria-hidden="true" size={16} /> Support on Ko-fi
              </a>
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
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void importFile(file)
        }}
        ref={importInputRef}
        type="file"
      />
      <input
        accept="application/json,.json,application/zip,.zip"
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void newTrackerFromFile(file)
        }}
        ref={otherTrackerInputRef}
        tabIndex={-1}
        type="file"
      />

      {/*
        * Drop anywhere is invisible without this: the window is the target, so there is
        * nothing on screen for someone holding a file to aim at. It says what the drop will
        * do, which differs: the dev server's one file is replaced; where a browser holds
        * several trackers a file over one with applications asks whether to open as a new
        * tracker or replace, and over an empty one simply opens there.
        */}
      {dragging && (
        <div aria-hidden="true" className="import-drop">
          <p>
            {!storageState?.tracker
              ? 'Drop to import — replaces everything here'
              : tracker.applications.length > 0
                ? 'Drop to open — as a new tracker, or in place of this one'
                : 'Drop to open it here'}
          </p>
        </div>
      )}

      <main id="main">
        {/*
          * Prep notes is a workspace rather than a slice of the collection: the count, the
          * search and the filters all act on the collection, so a bar carrying them here
          * would offer controls that do nothing over a number that means nothing. The one
          * search that makes sense is over the notes, and it lives in the sidebar with the
          * tree it filters. That leaves nothing in this row but the word "Prep notes",
          * which the lit header button already says — so the heading stays for document
          * structure and the row it sat in does not, giving the notes a line back on every
          * window open.
          */}
        {notesOpen ? (
          <h1 className="sr-only">{NOTES_VIEW.label}</h1>
        ) : (
          /*
           * One row for the whole view context: which view, how much of the collection is
           * showing, and the filters that decide it. The view name is not repeated here as
           * a display heading — the nav tab already carries it — but it stays the page's
           * h1 for document structure.
           */
          <section aria-label="View context and filters" className="context-bar">
            <h1>{VIEW_OPTIONS.find((view) => view.id === activeView)?.label}</h1>
            <>
            <p className="context-bar__count">
              {filteredApplications.length} of {tracker.applications.length} applications shown
            </p>
            {/*
              * Search sits with the count rather than among the filters: it is what most
              * often decides that number, and it takes free text where the rest of the row
              * takes a value from a list.
              */}
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

            <div className="context-bar__filters">
              {/*
                * Stage and outcome are two selects because they are two questions, and
                * every pairing of them is one somebody asks: "Round 1, rejected".
                */}
              <select
                aria-label="Filter by stage"
                onChange={(event) => setStageFilter(event.target.value as StageFilter)}
                value={stageFilter}
              >
                <option value="all">All stages</option>
                {STAGE_CONFIG.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
              </select>
              <select
                aria-label="Filter by outcome"
                onChange={(event) => setOutcomeFilter(event.target.value as OutcomeFilter)}
                value={outcomeFilter}
              >
                <option value="all">All outcomes</option>
                <option value="ended">Ended, any way</option>
                {OUTCOME_CONFIG.map((outcome) => (
                  <option key={outcome.id} value={outcome.id}>{outcome.label}</option>
                ))}
              </select>
              {/*
                * Archived applications are out of sight by default, which is the point of
                * archiving them; this is how you look back.
                */}
              <select
                aria-label="Filter by archive"
                onChange={(event) => setArchiveFilter(event.target.value as ArchiveFilter)}
                value={archiveFilter}
              >
                <option value="current">Current search</option>
                <option value="archived">Archived</option>
                <option value="all">Current and archived</option>
              </select>
              {/*
                * Activity gets its own control rather than joining the stage select's
                * groups. The outcome groups could share that control because they answer
                * the same question a single stage does; idleness is orthogonal to stage,
                * so "Round 1 and idle" is a combination worth expressing and one
                * select cannot hold both halves of it.
                */}
              <select
                aria-label="Filter by activity"
                onChange={(event) => setIdleFilter(event.target.value as IdleFilter)}
                value={idleFilter}
              >
                <option value="all">All activity</option>
                <option value="idle">Idle</option>
                <option value="not_idle">Active</option>
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
              {/*
                * Copy roles is paired with the source select rather than left loose in the
                * filter row: the two wrap together, so the button sits at the right of the
                * last filter instead of dropping onto a line of its own.
                */}
              <div className="context-bar__source">
                <select
                  aria-label="Filter by source"
                  onChange={(event) => setSourceFilter(event.target.value)}
                  value={sourceFilter}
                >
                  <option value="all">All sources</option>
                  {sources.map((source) => (
                    <option key={source} value={source}>{source}</option>
                  ))}
                </select>
                <button
                  className="button button--quiet"
                  disabled={rolesToCopy.length === 0}
                  onClick={copyRoles}
                  type="button"
                >
                  <ClipboardCopy aria-hidden="true" size={15} /> Copy roles
                </button>
              </div>
              {/*
                * Always drawn, and disabled when there is nothing to clear. Appearing only
                * once a filter was set, it pushed the row about under the pointer the moment
                * the first filter changed.
                */}
              <button
                  className="button button--quiet"
                  disabled={!(search || stageFilter !== 'all' || outcomeFilter !== 'all' || archiveFilter !== 'current' || idleFilter !== 'all' || companyFilter !== 'all' || sourceFilter !== 'all')}
                  onClick={() => {
                    setSearch('')
                    setStageFilter('all')
                    setOutcomeFilter('all')
                    setArchiveFilter('current')
                    setIdleFilter('all')
                    setCompanyFilter('all')
                    setSourceFilter('all')
                  }}
                  type="button"
                >
                  Clear filters
                </button>
            </div>
            </>
          </section>
        )}

        {isBrowserBackend() && isDemoTrackerProfile() && <DemoBanner />}

        {showStorageIntro && (
          <StorageIntro
            connection={storageState.connection}
            onConnect={connectStorage}
            onAdd={(opener) => openNewApplication(opener)}
            onImport={() => importInputRef.current?.click()}
            showDemoLink={!isDemoTrackerProfile()}
          />
        )}

        {stagesOpen && tracker && (
          <StagesDialog
            tracker={tracker}
            onClose={() => setStagesOpen(false)}
            onSave={(next) => {
              setStagesOpen(false)
              void commit((current) => setStages(current, next), 'Stages saved.')
            }}
            stages={stages}
          />
        )}

        {pendingReplace && (
          <ReplaceTrackerDialog
            onChoose={(choice) => void answerReplace(choice)}
            replacement={pendingReplace.replacement}
          />
        )}

        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button aria-label="Dismiss message" className="icon-button" onClick={() => setNotice(null)} type="button">
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        )}
        <section className={`view-surface${notesOpen ? ' view-surface--panel' : ''}`}>
          {notesOpen ? notesLayer : currentView}
        </section>
      </main>

      {editor && (editor.mode === 'add' || editingApplication) && (
        <ApplicationEditor
          key={editor.mode === 'add' ? 'add' : editor.id}
          application={editor.mode === 'edit' ? editingApplication : null}
          messagesFor={editor.mode === 'edit' ? editor.messagesFor : undefined}
          onClose={closeEditor}
          onDelete={editor.mode === 'edit' ? async () => {
            if (window.confirm(`Delete ${editingApplication?.company ?? 'this application'}?`)) {
              await deleteApplicationAttachmentFolder(editor.id)
              await commit((current) => deleteApplication(current, editor.id), 'Application deleted.')
              closeEditor()
            }
          } : undefined}
          onOpenStageNotes={editor.mode === 'edit' ? (id) => {
            closeEditor()
            openStageNotes(id)
          } : undefined}
          onSave={async (
            values,
            attachmentPlan,
            invites,
            completedActions,
            posting,
            correspondence,
            opened,
          ) => {
            const input: ApplicationInput = {
              company: values.company,
              role: values.role || null,
              url: values.url || null,
              source: values.source || null,
              stage: values.stage,
              outcome: values.outcome,
              next_action: values.nextAction || null,
              next_action_at: values.nextAction.trim() ? fromDateTimeInput(values.nextActionAt) : null,
              deadline_at: fromDateTimeInput(values.deadlineAt),
              notes: values.notes || null,
              compensation: compensationFromValues(values.compensation),
            }
            const now = new Date()
            if (editor.mode === 'add') {
              // Named here rather than by the mutation, so the attachment folder can be
              // written under its id before the application itself is stored. The write
              // then stays one derivation from whatever document is current when it runs.
              const id = createUuidV7(now)
              const attachments = await applyAttachmentPlan(id, attachmentPlan, now)
              await commit((current) => {
                let next = addApplication(current, input, now, id)
                if (attachments.length > 0) {
                  next = updateApplication(next, id, { attachments }, now)
                }
                next = updateApplicationStageEvents(next, id, invites, now)
                next = updateApplicationCorrespondence(next, id, correspondence, now)
                next = updateApplicationCompletedActions(next, id, completedActions, now)
                next = updateApplicationPosting(next, id, posting, now)
                return updateApplicationRatings(next, id, ratingDrafts(values.ratings), now)
              }, 'Application added.')
            } else if (opened) {
              const attachments = await applyAttachmentPlan(editor.id, attachmentPlan, now)
              await commit((current) => applyEditorSave(current, opened, {
                input,
                compensationValues: values.compensation,
                ratingValues: values.ratings,
                correspondence,
                invites,
                completedActions,
                posting,
                stage: values.stage,
                outcome: values.outcome,
                archived: values.archived,
                nextActionAt: values.nextActionAt,
                deadlineAt: values.deadlineAt,
                attachments,
                removedAttachmentIds: attachmentPlan.removedAttachmentIds,
                stagedCount: attachmentPlan.stagedFiles.length,
              }, now), 'Application updated.')
            }
            closeEditor()
          }}
        />
      )}

    </div>
  )
}
