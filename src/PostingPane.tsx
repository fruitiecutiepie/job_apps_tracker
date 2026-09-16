/**
 * One application's captured job posting, in one pane.
 *
 * A reading surface only. The posting is the one thing in the panel nobody here wrote: it
 * is pasted in whole, in the application editor, at the moment it was read. So there is no
 * draft to autosave, no external editor session, and no capture dock — the header keeps the
 * stage note's shape minus everything that belongs to a stage, because a posting prepares
 * for none.
 */

import { useRef, useState } from 'react'
import { ExternalLink, PencilLine, X } from 'lucide-react'
import type { RefCallback } from 'react'
import { MarkdownNotes } from './markdown'
import type { Posting } from './domain'
import type { PostingRef } from './notesLayout'
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
  /** Opens the application editor, which is the only place a posting can be changed. */
  onEdit: () => void
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
  isFocused,
  onFocus,
  onClose,
  onEdit,
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
            {/* A posting is pasted in whole, in the editor that captured it, so editing it
                here would be a second way to say the same thing. */}
            <button
              aria-label={`Edit the ${company} posting`}
              className="button button--quiet stage-note__mode"
              onClick={onEdit}
              type="button"
            >
              <PencilLine aria-hidden="true" size={14} />
              Edit
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
          {posting ? (
            <MarkdownNotes
              currentMatch={currentMatch}
              foldAll={false}
              label={label}
              matchBase={matchBase}
              onFoldControls={setFoldControls}
              onJumpToSection={onJumpToSection}
              query={query}
              revealKeys={revealKeys}
              source={posting.body}
            />
          ) : (
            <p className="stage-note__empty">
              No posting saved for {company} yet. Paste one into the application to keep what
              it said.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
