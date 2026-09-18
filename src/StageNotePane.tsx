import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, CornerDownLeft, ExternalLink, PencilLine, X } from 'lucide-react'
import type { RefCallback } from 'react'
import { CapturedLines, type CapturedLine } from './CapturedLines'
import { CAPTURE_STEP, MAX_CAPTURE_LOG, MIN_CAPTURE_LOG } from './notesArrangement'
import { CAPTURE_SECTION, CAPTURE_SECTION_IN_SENTENCE, MarkdownNotes } from './markdown'
import { StageNoteEditor } from './StageNoteEditor'
import { FORMATS, type Format } from './noteFormats'
import { STATE_CONFIG, type StageNote, type StageNoteEditSession, type StateId } from './domain'
import { noteRefKey, tabId, type NoteRef } from './notesLayout'
import { stageNoteHeadingId, stageNotePanelId } from './stageNoteIds'
import { shortcutKeys } from './shortcuts'

interface StageNotePaneProps {
  /** Which application's note, and for which stage. */
  noteRef: NoteRef
  label: string
  /**
   * The application's own name and role, not restated per stage: the header names the
   * application once, and the stage-switch dropdown beside it — not a second line of
   * text — is what says which of its stages this is.
   */
  company: string
  role: string
  /** Whether this is the application's own stage, which the panel tints. */
  isCurrentState: boolean
  /**
   * Swaps this pane's own tab for a different one of the application's stages — a change
   * to what this tab is showing, not a change to the application itself, and not a second
   * tab opened alongside it.
   */
  onSwitchStage: (state: StateId) => void
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
  /**
   * Whether the whole capture dock — the log and the box you type into — is open.
   * Collapsed by default: what you were told is not what you are looking at most of the
   * time you have a note open. Held by the panel rather than in here, the same way
   * `isEditingLines` is, so it survives this pane unmounting when its tab is switched
   * away from and back to.
   */
  isCaptureOpen: boolean
  onToggleCapture: () => void
  /** The pane this copy is in, since one note may be open in several. */
  groupId: string
  /** How tall the captured lines stand, shared by every pane, for the handle to report. */
  captureHeight: number
  /** Moves the dock's edge by that many pixels, positive for taller. */
  onResizeCapture: (delta: number) => void
  /** Stores a rewritten captured line, or removes it when the text is blank. */
  onRevise: (id: string, body: string) => Promise<void>
  /**
   * Follows a link in the note to one of its own headings, the same way the outline
   * follows a heading picked from it. Absent for the pane that is not focused, which
   * moves itself instead — the panel's jump scrolls the focused pane.
   */
  onJumpToSection?: (key: string) => void
  onChange: (value: string) => void
  /** Files one line under the note's capture section and stores it there and then. */
  onCapture: (line: string) => Promise<void>
  onToggleEditing: () => void
  /** Absent when the build cannot reach an editor process, which the static site cannot. */
  onOpenInEditor?: () => void
  onStopExternal: () => void
  paneRef: RefCallback<HTMLDivElement>
  formatDate: (iso: string) => string
  /**
   * Ancestor keys to force open, so a heading picked from the outline is not hidden inside
   * a fold. Taken by the editor as well as the reading view: a note being written folds too.
   */
  revealKeys?: Set<string>
}

/**
 * One stage's note, scrolling on its own. A split panel shows two of these side by side,
 * each with its own scrollbar, so a long note in one does not drag the other along.
 */
export function StageNotePane({
  noteRef,
  label,
  company,
  role,
  isCurrentState,
  onSwitchStage,
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
  isCaptureOpen,
  onToggleCapture,
  groupId,
  captureHeight,
  onResizeCapture,
  onRevise,
  onJumpToSection,
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

  const resizeRef = useRef(onResizeCapture)
  useEffect(() => {
    resizeRef.current = onResizeCapture
  }, [onResizeCapture])

  /*
   * The drag that moves the dock's edge, held only for as long as one lasts. Re-based on
   * every move rather than measured from where it started, so the edge tracks the pointer
   * instead of accelerating away from it as the deltas add up — the same reason the
   * handles between panes re-base theirs.
   */
  const endDrag = useRef<(() => void) | null>(null)
  // A drag outlives a re-render, but must not outlive the pane it belongs to.
  useEffect(() => () => endDrag.current?.(), [])

  const beginDrag = useCallback((startY: number) => {
    let from = startY
    const move = (event: MouseEvent) => {
      // Up is taller: the pointer moving towards the note grows the dock under it.
      resizeRef.current(from - event.clientY)
      from = event.clientY
    }
    const stop = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
      endDrag.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
    endDrag.current = stop
  }, [])
  const bodyRef = useRef<HTMLDivElement | null>(null)
  /*
   * The two things the header draws on behalf of whichever mode is showing. The fold
   * control is state — its label says which way it will go — so it arrives as state; the
   * formatter is only ever called, so it arrives as a ref and costs no render.
   */
  const [foldControls, setFoldControls] = useState<{ allFolded: boolean; toggle: () => void } | null>(null)
  const formatRef = useRef<((entry: Format) => void) | null>(null)

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
        // Named by the stage explicitly rather than by the heading below: two open panes
        // for the same application's different stages would otherwise share a heading —
        // "Halcyon Maps · Engineering Manager" — and read as the same region twice.
        aria-label={label}
        className={`stage-note${isCurrentState ? ' stage-note--current' : ''}`}
        id={stageNotePanelId(groupId, noteRef)}
        role="tabpanel"
      >
        <header className="stage-note__header">
          {/* Kept and not printed. The tab directly above this says the same words, in
              every pane and at every width — a pane brings the tab it is showing into
              view, so it is never the case that the header says something the strip does
              not. What a screen reader is handed for the note stays. */}
          <h3 className="sr-only" id={stageNoteHeadingId(groupId, noteRef)}>{company} · {role}</h3>
          <label className="stage-note__state">
            <span className="sr-only">Go to a different stage for {company}</span>
            <select
              className={`stage-note__state-select${isCurrentState ? ' stage-note__state-select--current' : ''}`}
              onChange={(event) => onSwitchStage(event.target.value as StateId)}
              value={noteRef.state}
            >
              {STATE_CONFIG.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.label}
                </option>
              ))}
            </select>
          </label>
          {saved ? (
            /*
             * The date carries the word only to a screen reader. A bare date in a note's
             * header reads as when it was last written, and spelling that out costs a line
             * of a narrow pane: with the word, this and the controls beside it cannot share
             * a row, and the header takes three rows where two will do.
             */
            <small className="stage-note__meta">
              <span className="sr-only">Updated </span>
              <time dateTime={saved.updated_at} title={`Updated ${formatDate(saved.updated_at)}`}>
                {formatDate(saved.updated_at)}
              </time>
            </small>
          ) : null}
          {/*
            * What the note is being done to, in the row that names it. Folding was a
            * button inside the scrolling column — it left the screen with the points it
            * folds — and formatting was a strip of its own over the box, a row of chrome
            * charged to every pane. Both are handed up by whichever mode is showing, so
            * this row draws them and neither owns a row.
            */}
          {foldControls ? (
            <button
              aria-label={`${foldControls.allFolded ? 'Expand' : 'Collapse'} all points in ${label}`}
              className="button button--quiet stage-note__fold-all"
              onClick={foldControls.toggle}
              type="button"
            >
              {foldControls.allFolded ? 'Expand all' : 'Collapse all'}
            </button>
          ) : null}
          {isEditing && !session ? (
            <span aria-label={`${label} formatting`} className="stage-note__toolbar" role="group">
              {FORMATS.map((entry) => (
                <button
                  aria-label={`${entry.title} in ${label}`}
                  className="icon-button stage-note__format"
                  key={entry.id}
                  onClick={() => formatRef.current?.(entry)}
                  title={entry.title}
                  type="button"
                >
                  <entry.icon aria-hidden="true" size={16} />
                </button>
              ))}
            </span>
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
                {onOpenInEditor && (
                  <button
                    aria-label={`Open ${label} in an editor`}
                    className="button button--quiet stage-note__mode"
                    onClick={onOpenInEditor}
                    type="button"
                  >
                    <ExternalLink aria-hidden="true" size={14} />
                    Open in Editor
                  </button>
                )}
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
            formatRef={formatRef}
            onFoldControls={setFoldControls}
            // Only the focused pane may take the caret, or two panes would fight over it.
            autoFocus={isFocused}
            currentMatch={currentMatch}
            key={noteRefKey(noteRef)}
            label={label}
            matchBase={matchBase}
            onChange={onChange}
            query={query}
            revealKeys={revealKeys}
            sourceId={tabId(groupId, noteRef)}
            value={body}
          />
        ) : body.trim() ? (
          <MarkdownNotes
            currentMatch={currentMatch}
            foldAll={false}
            label={label}
            matchBase={matchBase}
            onFoldControls={setFoldControls}
            onJumpToSection={onJumpToSection}
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
          {isCaptureOpen ? (
            /*
             * The dock's own edge, and a real `separator` rather than a styled border: a
             * drag is the obvious way to move it and no way at all without a pointer, so
             * it takes the arrow keys too — the same contract the handles between panes
             * keep. Only while the dock is open, since a closed one has no height to move.
             */
            <div
              aria-label={`Resize ${CAPTURE_SECTION_IN_SENTENCE} in ${label}`}
              aria-orientation="horizontal"
              aria-valuemax={MAX_CAPTURE_LOG}
              aria-valuemin={MIN_CAPTURE_LOG}
              aria-valuenow={captureHeight}
              className="stage-note__dock-resize"
              onKeyDown={(event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                // Up is taller: the dock grows against the note above it, so the edge
                // moves the way the key points.
                onResizeCapture(event.key === 'ArrowUp' ? CAPTURE_STEP : -CAPTURE_STEP)
              }}
              onMouseDown={(event) => {
                event.preventDefault()
                beginDrag(event.clientY)
              }}
              role="separator"
              tabIndex={0}
            />
          ) : null}
          <button
            aria-expanded={isCaptureOpen}
            aria-label={`${isCaptureOpen ? 'Hide' : 'Show'} ${CAPTURE_SECTION_IN_SENTENCE} in ${label}`}
            className={[
              'stage-note__dock-toggle',
              isCaptureOpen ? '' : 'stage-note__dock-toggle--collapsed',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={onToggleCapture}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={14} />
            {CAPTURE_SECTION}
            {lines.length > 0 ? <span className="stage-note__dock-count">{lines.length}</span> : null}
          </button>

          {isCaptureOpen ? (
            <>
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
                    // The one shortcut with no button in the title bar to hang a hint on, so
                    // the box it lands in is what names it. The shortcuts list carries the
                    // visible half.
                    aria-keyshortcuts={shortcutKeys('K')}
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
                    placeholder="What did they say? Enter files it, Shift+Enter starts a line"
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
            </>
          ) : null}
        </div>
      </section>
    </div>
  )
}
