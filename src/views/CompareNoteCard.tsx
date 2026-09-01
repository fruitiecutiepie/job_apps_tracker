import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { AUTOSAVE_MS } from "../StageNotesDialog";
import { StageNoteEditor } from "../StageNoteEditor";
import { CAPTURE_SECTION, MarkdownNotes, capturedMarkdown } from "../markdown";
import { stageNoteFor, stateLabel } from "../domain";
import type { Application, StateId } from "../domain";
import { formatShortDate, formatTimeOfDay } from "./viewUtils";

interface CompareNoteCardProps {
  application: Application;
  state: StateId;
  onSave: (body: string) => Promise<void>;
  onOpenFull: () => void;
}

/**
 * One application's note for one stage, inside the comparison board. A lighter sibling of
 * StageNotePane: it edits and autosaves the written note the same way, but leaves capturing
 * and correcting live lines, the external-editor handoff, and split-pane focus to the full
 * dialog — none of those make sense once several applications are already on screen at once.
 */
export function CompareNoteCard({ application, state, onSave, onOpenFull }: CompareNoteCardProps) {
  const saved = stageNoteFor(application, state);
  const label = `${application.company} · ${stateLabel(state)}`;
  const isCurrentState = application.state === state;

  const [draft, setDraft] = useState(saved?.body ?? "");
  const [isEditing, setIsEditing] = useState(!saved);
  const focusedRef = useRef(false);

  const savedBody = saved?.body ?? "";
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const savedBodyRef = useRef(savedBody);
  useEffect(() => {
    savedBodyRef.current = savedBody;
  }, [savedBody]);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  /**
   * A change that arrived from elsewhere (another tab, the full editor) replaces the draft
   * — but only while this card isn't the one being typed into, so an autosave in flight here
   * never gets overwritten by the very write it is about to cause.
   */
  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(savedBody);
  }, [saved?.updated_at, savedBody]);

  /**
   * Reads only refs, like the full dialog's own flush, so it can be called from the
   * unmount effect below without closing over a stale draft or a stale `saved`.
   */
  const flush = useCallback(() => {
    if (draftRef.current === savedBodyRef.current) return;
    void onSaveRef.current(draftRef.current);
  }, []);

  useEffect(() => {
    if (draft === savedBody) return;
    const timer = window.setTimeout(flush, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, savedBody, flush]);

  /** Flushes a pending edit rather than losing it when the board unmounts underneath it. */
  useEffect(() => {
    return flush;
  }, [flush]);

  const captured = saved?.heard.length
    ? capturedMarkdown(saved.heard, formatShortDate, formatTimeOfDay)
    : "";

  return (
    <article className={`compare-notes__card${isCurrentState ? " compare-notes__card--current" : ""}`}>
      <header className="stage-note__header compare-notes__card-header">
        <h4 className="compare-notes__card-title">
          {application.company}
          {application.role ? <span className="compare-notes__card-role"> — {application.role}</span> : null}
        </h4>
        {isCurrentState ? <span className="stage-note__badge">Current stage</span> : null}
        {saved ? (
          <small className="stage-note__meta">
            Updated <time dateTime={saved.updated_at}>{formatShortDate(saved.updated_at)}</time>
          </small>
        ) : null}
        <span className="stage-note__actions">
          <button
            aria-label={`Open ${label} in the full editor`}
            className="icon-button stage-note__mode"
            onClick={onOpenFull}
            type="button"
          >
            <ExternalLink aria-hidden="true" size={14} />
          </button>
          <button
            aria-label={`${isEditing ? "Read" : "Edit"} ${label}`}
            className="button button--quiet stage-note__mode"
            onClick={() => setIsEditing((current) => !current)}
            type="button"
          >
            {isEditing ? "Read" : "Edit"}
          </button>
        </span>
      </header>

      <div
        className="stage-note__body compare-notes__card-body"
        onFocusCapture={() => {
          focusedRef.current = true;
        }}
        onBlurCapture={() => {
          focusedRef.current = false;
        }}
      >
        {isEditing ? (
          <StageNoteEditor autoFocus={!saved} label={label} onChange={setDraft} sourceId={`${application.id}:${state}`} value={draft} />
        ) : draft.trim() ? (
          <MarkdownNotes foldAll label={label} source={draft} />
        ) : (
          <p className="stage-note__empty">No notes for this stage yet.</p>
        )}

        {captured ? (
          <div aria-label={`${CAPTURE_SECTION} in ${label}`} className="compare-notes__captured" role="log">
            <MarkdownNotes foldAll={false} label={`${label} captures`} source={captured} />
          </div>
        ) : null}
      </div>
    </article>
  );
}
