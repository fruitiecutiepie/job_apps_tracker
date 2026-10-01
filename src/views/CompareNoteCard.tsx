import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { ExternalLink } from "lucide-react";
import { AUTOSAVE_MS } from "../StageNotesPanel";
import { StageNoteEditor } from "../StageNoteEditor";
import { CAPTURE_SECTION, MarkdownNotes, capturedMarkdown } from "../markdown";
import { stageNoteFor, stateLabel } from "../domain";
import type { Application, StateId } from "../domain";
import { formatShortDate, formatTimeOfDay } from "./viewUtils";
import {
  CARD_STEP,
  CARD_STEP_LARGE,
  DEFAULT_CARD_SIZE,
  MAX_CARD_HEIGHT,
  MIN_CARD_HEIGHT,
  MIN_CARD_WIDTH,
  clampCardHeight,
  clampCardWidth,
} from "./compareCardSize";
import type { CardSize } from "./compareCardSize";

type Axis = "width" | "height";

interface CompareNoteCardProps {
  application: Application;
  state: StateId;
  /** The application is at this stage now; otherwise the card says where it is instead. */
  isHere: boolean;
  onSave: (body: string) => Promise<void>;
  onOpenFull: () => void;
}

/**
 * One application's note for one stage, inside the comparison board. A lighter sibling of
 * StageNotePane: it edits and autosaves the written note the same way, but leaves capturing
 * and correcting live lines, the external-editor handoff, and split-pane focus to the prep
 * notes view — none of those make sense once several applications are already on screen.
 */
export function CompareNoteCard({ application, state, isHere, onSave, onOpenFull }: CompareNoteCardProps) {
  const saved = stageNoteFor(application, state);
  const label = `${application.company} · ${stateLabel(state)}`;

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

  const titleId = `compare-${application.id}-${state}`;

  /*
   * The card's own size, and what it measures at. `size` is what the reader asked for, null
   * on an axis they have not touched; `measured` is what is on screen, so a handle can say
   * where it stands and a drag or a key can start from there even while the card is still
   * following the row.
   */
  const cardRef = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState<CardSize>(DEFAULT_CARD_SIZE);
  const [measured, setMeasured] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new ResizeObserver(() => {
      const rect = card.getBoundingClientRect();
      setMeasured({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  const available = () => cardRef.current?.parentElement?.clientWidth ?? 0;
  const resizeTo = (axis: Axis, value: number) =>
    setSize((current) => ({
      ...current,
      [axis]: axis === "width" ? clampCardWidth(value, available()) : clampCardHeight(value),
    }));
  const reset = (axes: Axis[]) =>
    setSize((current) => ({ ...current, ...Object.fromEntries(axes.map((axis) => [axis, null])) }));

  /*
   * Measured from the card's own edge rather than by accumulating deltas, so the edge stays
   * under the pointer whatever the clamp did on the way. The offset is where on the handle
   * the press landed, so picking an edge up does not make it jump by the handle's width.
   */
  const beginDrag = (axes: Axis[]) => (event: PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const start = card.getBoundingClientRect();
    const offsetX = start.right - event.clientX;
    const offsetY = start.bottom - event.clientY;
    const move = (next: globalThis.PointerEvent) => {
      const rect = card.getBoundingClientRect();
      if (axes.includes("width")) resizeTo("width", next.clientX + offsetX - rect.left);
      if (axes.includes("height")) resizeTo("height", next.clientY + offsetY - rect.top);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  const stepKeys = (axis: Axis) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      reset([axis]);
      return;
    }
    const [less, more] = axis === "width" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (event.key !== less && event.key !== more) return;
    event.preventDefault();
    const step = (event.shiftKey ? CARD_STEP_LARGE : CARD_STEP) * (event.key === more ? 1 : -1);
    const from = cardRef.current?.getBoundingClientRect()[axis] ?? 0;
    resizeTo(axis, from + step);
  };

  const style = {
    ...(size.width !== null ? { width: `${size.width}px` } : {}),
    ...(size.height !== null ? { height: `${size.height}px` } : {}),
  } satisfies CSSProperties;
  const sizedClass = [
    "compare-notes__card",
    size.width !== null ? "compare-notes__card--sized-width" : "",
    size.height !== null ? "compare-notes__card--sized-height" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const captured = saved?.heard.length
    ? capturedMarkdown(saved.heard, formatShortDate, formatTimeOfDay)
    : "";

  return (
    <article aria-labelledby={titleId} className={sizedClass} ref={cardRef} style={style}>
      <header className="compare-notes__card-header">
        <h4 className="compare-notes__card-title" id={titleId} title={application.role ? `${application.company} — ${application.role}` : application.company}>
          {application.company}
          {application.role ? <span className="compare-notes__card-role"> — {application.role}</span> : null}
        </h4>
        <span className="compare-notes__card-actions">
          <button
            aria-label={`${isEditing ? "Read" : "Edit"} ${label}`}
            className="button button--quiet stage-note__mode"
            onClick={() => setIsEditing((current) => !current)}
            type="button"
          >
            {isEditing ? "Read" : "Edit"}
          </button>
          <button
            aria-label={`Open ${label} in prep notes`}
            className="icon-button stage-note__mode"
            onClick={onOpenFull}
            title="Open in prep notes"
            type="button"
          >
            <ExternalLink aria-hidden="true" size={14} />
          </button>
        </span>
        <p className="compare-notes__card-meta">
          {isHere ? (
            <span className="stage-note__badge">Current stage</span>
          ) : (
            <span>Now {stateLabel(application.state)}</span>
          )}
          {saved ? (
            <time dateTime={saved.updated_at}>
              <span className="sr-only">Updated </span>
              {formatShortDate(saved.updated_at)}
            </time>
          ) : (
            <span>Nothing written yet</span>
          )}
        </p>
      </header>

      <div
        className="compare-notes__card-body"
        onFocusCapture={() => {
          focusedRef.current = true;
        }}
        onBlurCapture={() => {
          focusedRef.current = false;
        }}
      >
        {isEditing ? (
          <StageNoteEditor label={label} onChange={setDraft} sourceId={`${application.id}:${state}`} value={draft} />
        ) : draft.trim() ? (
          <MarkdownNotes foldAll label={label} source={draft} />
        ) : (
          <p className="stage-note__empty">Nothing written for this stage.</p>
        )}

        {captured ? (
          <section aria-label={`${CAPTURE_SECTION} in ${label}`} className="compare-notes__captured">
            <h5 className="compare-notes__captured-heading">{CAPTURE_SECTION}</h5>
            <div role="log">
              <MarkdownNotes foldAll={false} label={`${label} captures`} source={captured} />
            </div>
          </section>
        ) : null}
      </div>

      {/*
        Real separators with arrow keys, like the handles between the notes panel's panes,
        because a drag is no way at all without a pointer. Enter does what a double-click
        does and puts the card back to the size the board gives it. The corner moves both
        edges at once and is pointer-only — the two edges already cover it from the keyboard.
      */}
      <div
        aria-label={`Resize the width of ${label}`}
        aria-orientation="vertical"
        aria-valuemin={MIN_CARD_WIDTH}
        aria-valuenow={size.width ?? measured.width}
        className="compare-notes__resize compare-notes__resize--width"
        onDoubleClick={() => reset(["width"])}
        onKeyDown={stepKeys("width")}
        onPointerDown={beginDrag(["width"])}
        role="separator"
        tabIndex={0}
        title="Drag to resize, double-click to reset"
      />
      <div
        aria-label={`Resize the height of ${label}`}
        aria-orientation="horizontal"
        aria-valuemax={MAX_CARD_HEIGHT}
        aria-valuemin={MIN_CARD_HEIGHT}
        aria-valuenow={size.height ?? measured.height}
        className="compare-notes__resize compare-notes__resize--height"
        onDoubleClick={() => reset(["height"])}
        onKeyDown={stepKeys("height")}
        onPointerDown={beginDrag(["height"])}
        role="separator"
        tabIndex={0}
        title="Drag to resize, double-click to reset"
      />
      <div
        aria-hidden="true"
        className="compare-notes__resize compare-notes__resize--corner"
        onDoubleClick={() => reset(["width", "height"])}
        onPointerDown={beginDrag(["width", "height"])}
        title="Drag to resize, double-click to reset"
      />
    </article>
  );
}
