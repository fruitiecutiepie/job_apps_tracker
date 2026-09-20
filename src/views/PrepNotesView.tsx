import { useCallback, useEffect, useRef, useState } from "react";
import type { Application, StateId } from "../domain";
import {
  ARRANGEMENT_SAVE_MS,
  clearArrangement,
  loadArrangement,
  openingLayout,
  saveArrangement,
  type Arrangement,
} from "../notesArrangement";
import { FIRST_PANE_ID, openInGroup, singleGroup, type NoteRequest } from "../notesLayout";
import { StageNotesPanel, type StageNoteDraftBatch } from "../StageNotesPanel";

interface PrepNotesViewProps {
  /**
   * Every application, deliberately unfiltered. A tab is the panel's own arrangement, and
   * a filter over the board is not a reason to take a note being written away — a company
   * filter would otherwise empty a workspace the reader assembled.
   */
  applications: Application[];
  /** A note asked for from a card, a table row or the application editor. */
  request: NoteRequest | null;
  /** Acknowledges that request, so navigating back here later does not reopen it. */
  onRequested: () => void;
  onSaveDrafts: (batches: StageNoteDraftBatch[]) => Promise<boolean>;
  onExternalChange: (applicationId: string, state: StateId, body: string) => Promise<void>;
  onCapture: (applicationId: string, state: StateId, line: string) => Promise<void>;
  /** Opens an application's editor, which is where a captured posting is changed. */
  onEditApplication: (id: string) => void;
  onRevise: (applicationId: string, state: StateId, entryId: string, body: string) => Promise<void>;
  /** Opens the application editor for the application a note in the panel prepares for. */
  onOpenApplication: (applicationId: string) => void;
}

/**
 * The prep notes workspace as somewhere you go rather than something you open.
 *
 * This view owns what survives the app being closed: it restores the arrangement on the
 * way in, remembers every change to it on the way out, and holds the empty state for when
 * there is nothing open. The panel below it owns the notes and assumes at least one is
 * open — an invariant worth keeping, since everything it derives reads the note on show.
 */
export function PrepNotesView({
  applications,
  request,
  onRequested,
  onSaveDrafts,
  onExternalChange,
  onCapture,
  onEditApplication,
  onRevise,
  onOpenApplication,
}: PrepNotesViewProps) {
  /**
   * What the panel mounts with. Set once per sitting: the panel owns the arrangement from
   * then on and reports it back, so writing every change here would remount the panel on
   * each tab click and lose the drafts in it.
   */
  const [initial, setInitial] = useState<Arrangement | null>(() => {
    const restored = loadArrangement(applications);
    if (!restored) return openingFor(applications, request);
    if (!request) return restored;
    // Arriving from a card onto a restored workspace opens the note asked for and nothing
    // else: re-fanning that application's noted stages would pile them up on every visit.
    return {
      layout: openInGroup(restored.layout, restored.focusedGroupId, request.ref),
      focusedGroupId: restored.focusedGroupId,
    };
  });

  const handled = useRef<number | null>(null);
  const requestedRef = useRef(onRequested);
  useEffect(() => {
    requestedRef.current = onRequested;
  }, [onRequested]);

  useEffect(() => {
    if (!request || request.nonce === handled.current) return;
    handled.current = request.nonce;
    // A request that arrives with nothing open has no panel to reach: start one here.
    setInitial((current) => current ?? openingFor(applications, request));
    requestedRef.current();
  }, [applications, request]);

  /**
   * Arrangement writes settle before they are stored. Dragging a divider reports a change
   * per pointer move; everything else changes at human rate, so this only has to stop one
   * drag from being a few hundred writes.
   */
  const pending = useRef<Arrangement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!pending.current) return;
    saveArrangement(pending.current);
    pending.current = null;
  }, []);

  const remember = useCallback(
    (arrangement: Arrangement) => {
      pending.current = arrangement;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, ARRANGEMENT_SAVE_MS);
    },
    [flush],
  );

  // Leaving the view is the ordinary way out, so the last arrangement is written on the
  // way rather than waiting for a settle that the unmount would cut short.
  useEffect(() => flush, [flush]);

  const empty = useCallback(() => {
    pending.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    clearArrangement();
    setInitial(null);
  }, []);

  return (
    <section aria-label="Stage prep notes" className="panel-view">
      {initial ? (
        <StageNotesPanel
          applications={applications}
          initial={initial}
          onArrange={remember}
          onCapture={onCapture}
          onEditApplication={onEditApplication}
          onEmpty={empty}
          onExternalChange={onExternalChange}
          onOpenApplication={onOpenApplication}
          onRevise={onRevise}
          onSaveDrafts={onSaveDrafts}
          request={request}
        />
      ) : (
        <p className="panel-view__empty">
          Nothing open yet. Prep notes opened from a card on the board or a row in the table
          arrive here, and stay arranged the way you leave them.
        </p>
      )}
    </section>
  );
}

/** The arrangement a request starts from when there is nothing to restore. */
function openingFor(applications: Application[], request: NoteRequest | null): Arrangement | null {
  if (!request) return null;
  const application = applications.find((candidate) => candidate.id === request.ref.applicationId);
  if (!application) return null;
  // A posting prepares for no stage, so there are no sibling notes to open beside it: the
  // arrangement it starts from is the one pane holding it.
  const layout = request.ref.kind === 'posting'
    ? singleGroup(FIRST_PANE_ID, request.ref)
    : openingLayout(application, request.ref.state);
  return { layout, focusedGroupId: layout.id };
}
