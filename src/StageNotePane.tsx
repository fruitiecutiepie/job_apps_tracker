import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, ExternalLink, PencilLine, X } from 'lucide-react'
import type { RefCallback } from 'react'
import { CapturedLines, type CapturedLine } from './CapturedLines'
import { CAPTURE_SECTION, MarkdownNotes } from './markdown'
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
  /** Where the captured lines' matches start, after this stage's written note. */
  heardMatchBase: number
  currentMatch: number | null
  /**
   * The lines captured during this stage, as Markdown to read. Derived from what is stored
   * rather than from a draft: a capture is written the moment it is entered, so there is no
   * version of it here that Save could still change.
   */
  captured: string
  /** The same lines as records, for correcting them one at a time. */
  lines: readonly CapturedLine[]
  /** Whether the captured lines are open for correcting rather than being read. */
  isEditingLines: boolean
  onToggleEditLines: () => void
  /** Stores a rewritten captured line, or removes it when the text is blank. */
  onRevise: (id: string, body: string) => Promise<void>
  onChange: (value: string) => void
  /** Files one line under the note's capture section and stores it there and then. */
  onCapture: (line: string) => Promise<void>
  onToggleEditing: () => void
  onOpenInEditor: () => void
  onStopExternal: () => void
  paneRef: RefCallback<HTMLDivElement>
  formatDate: (iso: string) => string
  /** Ancestor keys to force open, so a heading picked from the outline is not hidden inside a fold. */
  revealKeys?: Set<string>
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
  heardMatchBase,
  currentMatch,
  captured,
  lines,
  isEditingLines,
  onToggleEditLines,
  onRevise,
  onChange,
  onCapture,
  onToggleEditing,
  onOpenInEditor,
  onStopExternal,
  paneRef,
  formatDate,
  revealKeys,
}: StageNotePaneProps) {
  const [line, setLine] = useState('')
  const [capturing, setCapturing] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  /**
   * The note itself takes focus when the pane opens with nothing else claiming it (no
   * editor autofocused, no tab or button already focused): a scrollable div is otherwise
   * never a keyboard target, so Cmd+Up/Down and Page Up/Down would scroll the page behind
   * the panel — which is now scroll-locked — rather than the note actually on screen.
   * Guarded to only body having focus, not merely "outside the pane", so it never steals
   * focus back from a tab arrow-keyed to deliberately, or from the capture box or sidebar.
   */
  useEffect(() => {
    if (!isFocused || document.activeElement !== document.body) return
    bodyRef.current?.focus()
  }, [isFocused])

  /**
   * Holds the newest line in view as captures arrive. The log is short by design, so
   * without this a conversation would scroll its own latest answer out of sight.
   */
  useEffect(() => {
    const log = logRef.current
    // Guarded: jsdom has no layout, so scrollHeight is 0 and there is nothing to hold.
    if (log) log.scrollTop = log.scrollHeight
  }, [captured])

  /**
   * The line is cleared once the capture has been committed rather than optimistically,
   * so a slow write cannot be typed over halfway through. A failed write surfaces as the
   * app's own notice and leaves the line in the note, which is where it can be recovered
   * from — losing what an interviewer just said is the one outcome worth ruling out.
   */
  const capture = async () => {
    const text = line.trim()
    if (!text || capturing) return
    setCapturing(true)
    try {
      await onCapture(text)
      setLine('')
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div
      className={`panel__pane${isFocused ? ' panel__pane--focused' : ''}`}
      onFocusCapture={onFocus}
      onMouseDown={(event) => {
        onFocus()
        // A click on the pane's own background, not on a button or the editor inside it,
        // is someone reaching for this note to scroll it — give it the keyboard focus
        // that takes, rather than leaving focus wherever it last was.
        if (event.target === event.currentTarget) bodyRef.current?.focus()
      }}
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

        {/*
          The note scrolls in here rather than the pane scrolling around it, so the header
          above and the dock below are simply always on screen instead of being stuck there
          over a column that runs past them. Nothing can show through above or below them,
          and the card's own rounded corners clip what scrolls.
        */}
        <div
          className="stage-note__body"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) bodyRef.current?.focus()
          }}
          ref={(node) => {
            bodyRef.current = node
            paneRef(node)
          }}
          tabIndex={-1}
        >
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
            sourceId={state}
            value={body}
          />
        ) : body.trim() ? (
          <MarkdownNotes
            currentMatch={currentMatch}
            label={label}
            matchBase={matchBase}
            query={query}
            revealKeys={revealKeys}
            source={body}
          />
        ) : (
          <p className="stage-note__empty">
            {captured
              ? 'Nothing was written for this stage before the conversation.'
              : 'No notes for this stage yet.'}
          </p>
        )}
        </div>

        {/*
          What you were told is pinned below what you prepared, and stays on screen however
          far the note above it scrolls: it is the part of a stage you are still adding to.
          It shows in every mode, including while the note is being written or is out with
          an external editor, because captures are a field of their own now — there is no
          write for a second caret here to race.
        */}
        <div className="stage-note__dock">
          {captured && !isEditingLines ? (
            <div
              aria-label={`${CAPTURE_SECTION} in ${label}`}
              className="stage-note__log"
              ref={logRef}
              role="log"
            >
              <MarkdownNotes
                currentMatch={currentMatch}
                foldAll={false}
                label={`${label} captures`}
                matchBase={heardMatchBase}
                query={query}
                source={captured}
              />
            </div>
          ) : null}

          {isEditingLines ? (
            <div className="stage-note__log stage-note__log--editing" ref={logRef}>
              <CapturedLines label={label} lines={lines} onRevise={onRevise} />
            </div>
          ) : null}
          <div className="stage-note__capture">
            <label className="field">
              <span className="sr-only">Capture a line in {label}</span>
              <textarea
                data-capture-focus={isFocused ? 'true' : undefined}
                // Never disabled, not even mid-write: taking the caret away from someone
                // typing what they are being told is worse than a write it has to wait for.
                onChange={(event) => setLine(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  // Shift+Enter is the way to a second line, so Enter stays the fast path:
                  // the box is answered mid-conversation, and reaching for a button to file
                  // what was just said is the thing this dock exists to avoid.
                  if (event.shiftKey) return
                  // The panel is one form around every stage, so Enter would otherwise
                  // save the lot and close it in the middle of a conversation.
                  event.preventDefault()
                  void capture()
                }}
                placeholder={`What did they say? Enter files it under ${CAPTURE_SECTION}, Shift+Enter starts a line`}
                value={line}
              />
            </label>
            {lines.length > 0 ? (
              <button
                aria-label={`${isEditingLines ? 'Read' : 'Correct'} the captured lines in ${label}`}
                aria-pressed={isEditingLines}
                className="button button--quiet stage-note__mode"
                onClick={onToggleEditLines}
                type="button"
              >
                <PencilLine aria-hidden="true" size={14} />
                {isEditingLines ? 'Done' : 'Correct'}
              </button>
            ) : null}
            <button
              aria-label={`Capture this line in ${label}`}
              className="button button--quiet stage-note__mode"
              disabled={capturing || !line.trim()}
              onClick={() => void capture()}
              type="button"
            >
              <CornerDownLeft aria-hidden="true" size={14} />
              Capture
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
