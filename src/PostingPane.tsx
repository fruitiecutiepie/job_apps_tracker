/**
 * One application's captured job posting, in one pane.
 *
 * Read and written like a prep note, on the same draft and autosave machinery: a pasted
 * posting arrives mangled often enough — a run of blank lines, a nav menu, one long
 * paragraph — that being unable to tidy it where you read it is the wrong trade. What it
 * does not carry is a capture dock, because nobody said a posting to you, or a stage, which
 * it prepares for none of.
 *
 * Writing here corrects the posting rather than recapturing it, so `captured_at` stays put;
 * `revisePosting` is where that lives.
 */

import { useRef, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import type { RefCallback } from 'react'
import { MarkdownNotes } from './markdown'
import { StageNoteEditor } from './StageNoteEditor'
import { FORMATS, type Format } from './noteFormats'
import type { Posting } from './domain'
import { noteRefKey, tabId, type PostingRef } from './notesLayout'
import { stageNoteHeadingId, stageNotePanelId } from './stageNoteIds'

interface PostingPaneProps {
  /** Which application's posting. There is only ever one per application. */
  noteRef: PostingRef
  label: string
  company: string
  role: string
  /** The captured posting, or null when this application has none yet. */
  posting: Posting | null
  /** Whether this pane is the one the outline, breadcrumbs, and find act on. */
  isFocused: boolean
  onFocus: () => void
  /** Closes this pane. Absent when the panel is not split, since one pane must remain. */
  onClose: (() => void) | null
  /** The text being read or written, which is the draft rather than what was stored. */
  body: string
  onChange: (value: string) => void
  isEditing: boolean
  onToggleEditing: () => void
  /**
   * Opens the application's editor, which is where the posting's link and the way to forget
   * it live — neither belongs in a pane that shows its text.
   */
  onOpenApplication: () => void
  query: string
  matchBase: number
  currentMatch: number | null
  onJumpToSection?: (key: string) => void
  revealKeys?: Set<string>
  groupId: string
  paneRef: RefCallback<HTMLDivElement>
  formatDate: (value: string) => string
}

export function PostingPane({
  noteRef,
  label,
  company,
  role,
  posting,
  body,
  onChange,
  isEditing,
  onToggleEditing,
  onOpenApplication,
  isFocused,
  onFocus,
  onClose,
  query,
  matchBase,
  currentMatch,
  onJumpToSection,
  revealKeys,
  groupId,
  paneRef,
  formatDate,
}: PostingPaneProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const formatRef = useRef<((format: Format) => void) | null>(null)
  const [foldControls, setFoldControls] = useState<
    { allFolded: boolean; toggle: () => void } | null
  >(null)

  return (
    <div
      className={`panel__pane${isFocused ? ' panel__pane--focused' : ''}`}
      onFocusCapture={onFocus}
      onMouseDown={(event) => {
        onFocus()
        if (event.target === event.currentTarget) bodyRef.current?.focus()
      }}
    >
      <section
        aria-label={label}
        className="stage-note stage-note--posting"
        id={stageNotePanelId(groupId, noteRef)}
        role="tabpanel"
      >
        <header className="stage-note__header">
          {/* Kept and not printed, exactly as the stage note does it: the tab above says
              the same words, so this is for a reader being read to rather than looking. */}
          <h3 className="sr-only" id={stageNoteHeadingId(groupId, noteRef)}>{company} · {role}</h3>
          {/* Where the stage-switch dropdown sits on a prep note. A posting has no stage to
              switch to, so the pane says what it is instead. */}
          <span className="stage-note__posting-name">Job posting</span>
          {posting ? (
            <small className="stage-note__meta">
              <span className="sr-only">Captured </span>
              <time
                dateTime={posting.captured_at}
                title={`Captured ${formatDate(posting.captured_at)}`}
              >
                {formatDate(posting.captured_at)}
              </time>
            </small>
          ) : null}
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
          {isEditing ? (
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
            {posting?.source_url ? (
              <a
                aria-label={`Open the original ${company} posting`}
                className="button button--quiet stage-note__mode"
                href={posting.source_url}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink aria-hidden="true" size={14} />
                Original
              </a>
            ) : null}
            <button
              aria-label={`${isEditing ? 'Read' : 'Edit'} the ${company} job posting`}
              className="button button--quiet stage-note__mode"
              onClick={onToggleEditing}
              type="button"
            >
              {isEditing ? 'Read' : 'Edit'}
            </button>
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
          {isEditing ? (
            <StageNoteEditor
              autoFocus={isFocused}
              currentMatch={currentMatch}
              formatRef={formatRef}
              key={noteRefKey(noteRef)}
              label={label}
              matchBase={matchBase}
              onChange={onChange}
              onFoldControls={setFoldControls}
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
            <div className="stage-note__empty">
              <p className="stage-note__empty-text">
                No posting saved for {company} yet. Edit this pane to paste one in, or open
                the application to record where it came from.
              </p>
              <button
                className="button button--quiet"
                onClick={onOpenApplication}
                type="button"
              >
                Open {company}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
