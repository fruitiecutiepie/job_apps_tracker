import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { STATE_CONFIG, stateLabel, stateRank } from './domain'
import type { Application, StageNoteDraft, StateId } from './domain'
import { formatShortDate } from './views/viewUtils'
import { MarkdownNotes } from './markdown'
import { StageNoteEditor } from './StageNoteEditor'
import { useDialogKeyboard } from './useDialogKeyboard'

interface StageNotesDialogProps {
  application: Application
  onClose: () => void
  onSave: (drafts: StageNoteDraft[]) => Promise<void>
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

export function StageNotesDialog({ application, onClose, onSave }: StageNotesDialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const [drafts, setDrafts] = useState<Partial<Record<StateId, string>>>(() =>
    Object.fromEntries(application.stage_notes.map((note) => [note.state, note.body])),
  )
  const [addedStages, setAddedStages] = useState<StateId[]>([])
  // Stages that already hold notes open as readable outlines; empty ones open ready to type.
  const [editing, setEditing] = useState<StateId[]>(() =>
    application.stage_notes.length > 0 ? [] : [application.state],
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useDialogKeyboard(dialogRef, onClose)

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
            <p className="eyebrow">{title}</p>
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
              const isEditing = editing.includes(state)
              const body = drafts[state] ?? ''
              return (
                <section
                  className={['stage-note', isCurrent ? 'stage-note--current' : '']
                    .filter(Boolean)
                    .join(' ')}
                  key={state}
                >
                  <header className="stage-note__header">
                    <h3>{stateLabel(state)}</h3>
                    {isCurrent ? <span className="stage-note__badge">Current stage</span> : null}
                    {saved ? (
                      <small className="stage-note__meta">
                        Updated <time dateTime={saved.updated_at}>{formatShortDate(saved.updated_at)}</time>
                      </small>
                    ) : null}
                    <button
                      aria-label={`${isEditing ? 'Read' : 'Edit'} ${stateLabel(state)}`}
                      className="button button--quiet stage-note__mode"
                      onClick={() => toggleEditing(state)}
                      type="button"
                    >
                      {isEditing ? 'Read' : 'Edit'}
                    </button>
                  </header>
                  {isEditing ? (
                    <StageNoteEditor
                      autoFocus={isCurrent}
                      label={stateLabel(state)}
                      onChange={(value) => setDrafts((current) => ({ ...current, [state]: value }))}
                      value={body}
                    />
                  ) : body.trim() ? (
                    <MarkdownNotes label={stateLabel(state)} source={body} />
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
