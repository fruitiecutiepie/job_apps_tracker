import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import {
  closeStageNoteEditor,
  openStageNoteInEditor,
  readStageNoteFromEditor,
  STATE_CONFIG,
  stateLabel,
  stateRank,
  type Application,
  type StageNoteDraft,
  type StageNoteEditSession,
  type StateId,
} from './domain'
import { formatShortDate } from './views/viewUtils'
import { MarkdownNotes } from './markdown'
import { StageNoteEditor } from './StageNoteEditor'
import { useDialogKeyboard } from './useDialogKeyboard'

/**
 * How often the scratch file is re-read while a stage is open in an external editor. The
 * server writes nothing on its own, so this is the only way changes come back.
 */
const EDITOR_POLL_MS = 1000

interface StageNotesDialogProps {
  application: Application
  onClose: () => void
  onSave: (drafts: StageNoteDraft[]) => Promise<void>
  /** Commits a change that arrived from an external editor, which has no Save button. */
  onExternalChange: (state: StateId, body: string) => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

/**
 * Orders the stages on show with the application's current stage first, so the notes you
 * need during an interview are the first thing on screen.
 */
function visibleStages(current: StateId, noted: StateId[]): StateId[] {
  const rest = [...new Set(noted)]
    .filter((state) => state !== current)
    .sort((left, right) => stateRank(left) - stateRank(right))
  return [current, ...rest]
}

export function StageNotesDialog({
  application,
  onClose,
  onSave,
  onExternalChange,
}: StageNotesDialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const [drafts, setDrafts] = useState<Partial<Record<StateId, string>>>(() =>
    Object.fromEntries(application.stage_notes.map((note) => [note.state, note.body])),
  )
  // The poll loop reads drafts outside of React's render cycle, so it needs a live copy.
  const draftsRef = useRef(drafts)
  const [addedStages, setAddedStages] = useState<StateId[]>([])
  // Stages that already hold notes open as readable outlines; empty ones open ready to type.
  const [editing, setEditing] = useState<StateId[]>(() =>
    application.stage_notes.length > 0 ? [] : [application.state],
  )
  const [sessions, setSessions] = useState<Partial<Record<StateId, StageNoteEditSession>>>({})
  const sessionsRef = useRef(sessions)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Held in a ref so the poll interval below is not torn down and restarted on every
  // render: the parent recreates this callback each time, and a commit causes a render.
  const externalChangeRef = useRef(onExternalChange)
  useEffect(() => {
    externalChangeRef.current = onExternalChange
  }, [onExternalChange])

  useDialogKeyboard(dialogRef, onClose)

  const setDraft = (state: StateId, value: string) => {
    draftsRef.current = { ...draftsRef.current, [state]: value }
    setDrafts(draftsRef.current)
  }

  const openInEditor = async (state: StateId) => {
    setFormError(null)
    try {
      const session = await openStageNoteInEditor(application.id, state, draftsRef.current[state] ?? '')
      sessionsRef.current = { ...sessionsRef.current, [state]: session }
      setSessions(sessionsRef.current)
      // The external editor owns this stage while the session lasts.
      setEditing((current) => current.filter((entry) => entry !== state))
      // A scheme URL has to be opened by this browser: the server cannot reach an editor
      // on the machine looking at the page. The banner repeats it as a clickable fallback
      // in case the browser declines to follow a programmatic navigation.
      if (session.open_url) window.location.assign(session.open_url)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  const stopEditingExternally = async (state: StateId) => {
    const remaining = { ...sessionsRef.current }
    delete remaining[state]
    sessionsRef.current = remaining
    setSessions(remaining)
    try {
      await closeStageNoteEditor(application.id, state)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  const activeSessionKey = Object.keys(sessions).sort().join(',')

  useEffect(() => {
    const states = activeSessionKey ? (activeSessionKey.split(',') as StateId[]) : []
    if (states.length === 0) return

    let cancelled = false
    const pull = async () => {
      for (const state of states) {
        try {
          const contents = await readStageNoteFromEditor(application.id, state)
          if (cancelled || !contents) continue
          if ((draftsRef.current[state] ?? '') === contents.body) continue
          setDraft(state, contents.body)
          await externalChangeRef.current(state, contents.body)
        } catch {
          // A transient read failure should not end the session; the next tick retries.
        }
      }
    }

    const timer = window.setInterval(pull, EDITOR_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeSessionKey, application.id])

  // Closing the dialog ends every session it started, so no scratch files are left behind.
  useEffect(() => {
    const applicationId = application.id
    return () => {
      for (const state of Object.keys(sessionsRef.current)) {
        void closeStageNoteEditor(applicationId, state as StateId)
      }
    }
  }, [application.id])

  const stages = useMemo(
    () =>
      visibleStages(application.state, [
        ...application.stage_notes.map((note) => note.state),
        ...addedStages,
      ]),
    [addedStages, application.state, application.stage_notes],
  )

  const noteByState = useMemo(
    () => new Map(application.stage_notes.map((note) => [note.state, note])),
    [application.stage_notes],
  )

  const toggleEditing = (state: StateId) => {
    setEditing((current) =>
      current.includes(state) ? current.filter((entry) => entry !== state) : [...current, state],
    )
  }

  const remainingStates = STATE_CONFIG.filter((state) => !stages.includes(state.id))
  const title = [application.company, application.role].filter(Boolean).join(' — ')

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section
        aria-labelledby="stage-notes-dialog-title"
        aria-modal="true"
        className="dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="dialog__header">
          <div>
            <p className="dialog__subject">{title}</p>
            <h2 id="stage-notes-dialog-title">Stage prep notes</h2>
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
            setSaving(true)
            try {
              await onSave(stages.map((state) => ({ state, body: drafts[state] ?? '' })))
            } catch (error) {
              setFormError(errorMessage(error))
            } finally {
              setSaving(false)
            }
          }}
        >
          <div className="stage-notes">
            {stages.map((state) => {
              const isCurrent = state === application.state
              const saved = noteByState.get(state)
              const session = sessions[state]
              const isEditing = editing.includes(state) && !session
              const body = drafts[state] ?? ''
              const label = stateLabel(state)
              return (
                <section
                  className={['stage-note', isCurrent ? 'stage-note--current' : '']
                    .filter(Boolean)
                    .join(' ')}
                  key={state}
                >
                  <header className="stage-note__header">
                    <h3>{label}</h3>
                    {isCurrent ? <span className="stage-note__badge">Current stage</span> : null}
                    {saved ? (
                      <small className="stage-note__meta">
                        Updated <time dateTime={saved.updated_at}>{formatShortDate(saved.updated_at)}</time>
                      </small>
                    ) : null}
                    <span className="stage-note__actions">
                      {session ? (
                        <button
                          aria-label={`Stop editing ${label} externally`}
                          className="button button--quiet stage-note__mode"
                          onClick={() => stopEditingExternally(state)}
                          type="button"
                        >
                          Stop
                        </button>
                      ) : (
                        <>
                          <button
                            aria-label={`Open ${label} in an editor`}
                            className="button button--quiet stage-note__mode"
                            onClick={() => openInEditor(state)}
                            type="button"
                          >
                            <ExternalLink aria-hidden="true" size={14} />
                            Open in Editor
                          </button>
                          <button
                            aria-label={`${isEditing ? 'Read' : 'Edit'} ${label}`}
                            className="button button--quiet stage-note__mode"
                            onClick={() => toggleEditing(state)}
                            type="button"
                          >
                            {isEditing ? 'Read' : 'Edit'}
                          </button>
                        </>
                      )}
                    </span>
                  </header>

                  {session ? (
                    <p className="stage-note__external" role="status">
                      {session.open_url ? (
                        <>
                          Handed to <a href={session.open_url}>{session.editor}</a> on this machine.
                        </>
                      ) : session.host ? (
                        <>
                          Opened <strong>on {session.host}</strong>, not on this machine. Set
                          {' '}<code>TRACKER_EDITOR_URL</code> to open it here instead.
                        </>
                      ) : (
                        <>Open in <strong>{session.editor}</strong>.</>
                      )}
                      {' '}Saves land here and are stored automatically.
                      {' '}<code>{session.absolute_path}</code>
                    </p>
                  ) : null}

                  {isEditing ? (
                    <StageNoteEditor
                      autoFocus={isCurrent}
                      label={label}
                      onChange={(value) => setDraft(state, value)}
                      value={body}
                    />
                  ) : body.trim() ? (
                    <MarkdownNotes label={label} source={body} />
                  ) : (
                    <p className="stage-note__empty">No notes for this stage yet.</p>
                  )}
                </section>
              )
            })}
          </div>

          {remainingStates.length > 0 ? (
            <label className="field">
              <span>Add notes for another stage</span>
              <select
                onChange={(event) => {
                  const state = event.target.value as StateId | ''
                  if (!state) return
                  setAddedStages((current) => [...current, state])
                  setEditing((current) => [...current, state])
                  event.target.value = ''
                }}
                value=""
              >
                <option value="">Choose a stage…</option>
                {remainingStates.map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <p className="stage-notes__hint">
            Clearing a stage’s notes removes them when you save.
          </p>

          {formError && <p className="form-error" role="alert">{formError}</p>}

          <div className="dialog__actions">
            <span className="dialog__actions-spacer" />
            <button className="button button--quiet" onClick={onClose} type="button">Cancel</button>
            <button className="button button--primary" disabled={saving} type="submit">
              Save notes
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
