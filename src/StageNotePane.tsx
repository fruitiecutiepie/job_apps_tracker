import { ExternalLink, X } from 'lucide-react'
import type { RefCallback } from 'react'
import { MarkdownNotes } from './markdown'
import { StageNoteEditor } from './StageNoteEditor'
import type { StageNote, StageNoteEditSession, StateId } from './domain'
import { stageNoteHeadingId, stageNotePanelId } from './stageNoteIds'

interface StageNotePaneProps {
  state: StateId
  label: string
  /** Whether this is the application's own stage, which the panel tints. */
  isCurrentState: boolean
  body: string
  saved: StageNote | undefined
  session: StageNoteEditSession | undefined
  isEditing: boolean
  /** Whether this pane is the one the outline, breadcrumbs, and find act on. */
  isFocused: boolean
  onFocus: () => void
  /** Closes this pane. Absent when the panel is not split, since one pane must remain. */
  onClose: (() => void) | null
  query: string
  matchBase: number
  currentMatch: number | null
  onChange: (value: string) => void
  onToggleEditing: () => void
  onOpenInEditor: () => void
  onStopExternal: () => void
  paneRef: RefCallback<HTMLDivElement>
  formatDate: (iso: string) => string
}

/**
 * One stage's note, scrolling on its own. A split panel shows two of these side by side,
 * each with its own scrollbar, so a long note in one does not drag the other along.
 */
export function StageNotePane({
  state,
  label,
  isCurrentState,
  body,
  saved,
  session,
  isEditing,
  isFocused,
  onFocus,
  onClose,
  query,
  matchBase,
  currentMatch,
  onChange,
  onToggleEditing,
  onOpenInEditor,
  onStopExternal,
  paneRef,
  formatDate,
}: StageNotePaneProps) {
  return (
    <div
      className={`panel__pane${isFocused ? ' panel__pane--focused' : ''}`}
      onFocusCapture={onFocus}
      onMouseDown={onFocus}
      ref={paneRef}
    >
      <section
        aria-labelledby={stageNoteHeadingId(state)}
        className={`stage-note${isCurrentState ? ' stage-note--current' : ''}`}
        id={stageNotePanelId(state)}
        role="tabpanel"
      >
        <header className="stage-note__header">
          <h3 id={stageNoteHeadingId(state)}>{label}</h3>
          {saved ? (
            <small className="stage-note__meta">
              Updated <time dateTime={saved.updated_at}>{formatDate(saved.updated_at)}</time>
            </small>
          ) : null}
          <span className="stage-note__actions">
            {session ? (
              <button
                aria-label={`Stop editing ${label} externally`}
                className="button button--quiet stage-note__mode"
                onClick={onStopExternal}
                type="button"
              >
                Stop
              </button>
            ) : (
              <>
                <button
                  aria-label={`Open ${label} in an editor`}
                  className="button button--quiet stage-note__mode"
                  onClick={onOpenInEditor}
                  type="button"
                >
                  <ExternalLink aria-hidden="true" size={14} />
                  Open in Editor
                </button>
                <button
                  aria-label={`${isEditing ? 'Read' : 'Edit'} ${label}`}
                  className="button button--quiet stage-note__mode"
                  onClick={onToggleEditing}
                  type="button"
                >
                  {isEditing ? 'Read' : 'Edit'}
                </button>
              </>
            )}
            {onClose ? (
              <button
                aria-label={`Close the ${label} pane`}
                className="icon-button stage-note__mode"
                onClick={onClose}
                type="button"
              >
                <X aria-hidden="true" size={14} />
              </button>
            ) : null}
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
            // Only the focused pane may take the caret, or two panes would fight over it.
            autoFocus={isFocused}
            key={state}
            label={label}
            onChange={onChange}
            value={body}
          />
        ) : body.trim() ? (
          <MarkdownNotes
            currentMatch={currentMatch}
            label={label}
            matchBase={matchBase}
            query={query}
            source={body}
          />
        ) : (
          <p className="stage-note__empty">No notes for this stage yet.</p>
        )}
      </section>
    </div>
  )
}
