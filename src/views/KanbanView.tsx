import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Heart, PartyPopper, Smile } from "lucide-react";
import { STAGE_CONFIG, classifyLifecycle, statusLabel } from "../domain";
import type { Status } from "../domain";
import { AttachmentFilenames } from "./AttachmentFilenames";
import { CompleteActionButton } from "./CompleteActionButton";
import { describeIdle, idleStatusFor } from "./idle";
import { describePreference, preferenceFor } from "./preference";
import { PostingButton } from "./PostingButton";
import { MessagesButton } from "./MessagesButton";
import { ArchivedBadge, MoveControls } from "./MoveControls";
import { StageNotesButton } from "./StageNotesButton";
import { moveFeedback } from "./moveFeedback";
import type { MoveFeedback } from "./moveFeedback";
import type { MovableApplicationsViewProps, MoveHandler } from "./types";
import { formatShortDate, kanbanColumnGroups, upcomingStageEvent } from "./viewUtils";
import { usePointerDrag } from "../usePointerDrag";

export function KanbanView({
  applications,
  onOpen,
  onOpenStageNotes,
  onOpenPosting,
  onOpenMessages,
  onCompleteAction,
  onMove,
  onArchive,
  visibleStages,
  visibleOutcomes,
  quietDays,
}: MovableApplicationsViewProps) {
  const columnGroups = useMemo(
    () => kanbanColumnGroups(applications, visibleStages, visibleOutcomes),
    [applications, visibleStages, visibleOutcomes],
  );
  const applicationsByLane = useMemo(() => {
    const lanes = new Map<string, typeof applications>();
    for (const application of applications) {
      const key = laneKey(application);
      lanes.set(key, [...(lanes.get(key) ?? []), application]);
    }
    return lanes;
  }, [applications]);

  // What the last move deserved saying, on which card. Display state only: it reacts to a
  // press for a moment and is gone long before anything else reads the board.
  const [feedback, setFeedback] = useState<CardFeedback | null>(null);
  const turn = useRef(0);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), FEEDBACK_MS[feedback.kind]);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // Every move made from the board goes through here — a drop, the arrows, End, the stage
  // select — so a card reacts the same way however it was moved.
  const moveWithFeedback: MoveHandler = (id, change) => {
    const application = applications.find((item) => item.id === id);
    if (!application) return;
    onMove(id, change);
    // "Still running" is the same reading Idle and the ranking use, and an archived
    // application is put away whatever its outcome, so it is not counted as running.
    const othersRunning = applications.filter(
      (item) =>
        item.id !== id && item.archived_at === null && classifyLifecycle(item) === "live",
    ).length;
    const reaction = moveFeedback(
      application,
      change,
      { othersRunning },
      turn.current,
    );
    if (!reaction) return;
    turn.current += 1;
    // A fresh object every time, so a second move restarts the timer and the toast.
    setFeedback({ ...reaction, id, run: turn.current });
  };

  /*
   * A card is dragged with the pointer — mouse, finger or pen — through the same gesture as
   * a prep note tab: a mouse picks it up by moving, a finger by holding still. It was HTML5
   * drag-and-drop, which a phone never starts, so the board could only be rearranged with
   * a mouse. A lane is found under the pointer by its `data-kanban-lane`, and the board
   * scrolls when a card is carried to its edge, so a phone can reach a stage off screen.
   */
  const scrollerRef = useRef<HTMLDivElement>(null);
  const moveRef = useRef(moveWithFeedback);
  useEffect(() => {
    moveRef.current = moveWithFeedback;
  });
  const onDrop = useCallback((id: string, lane: Status) => {
    // A same-lane drop is a no-op in the mutation, which is what keeps it off the disk,
    // and says nothing, since nothing moved.
    moveRef.current(id, lane);
  }, []);
  const scroller = useCallback(() => scrollerRef.current, []);
  const drag = usePointerDrag<Status>({
    targetAt: laneAt,
    onDrop,
    ghostClassName: "application-card--ghost",
    scroller,
  });
  const dropTarget = drag.target ? laneKey(drag.target) : null;

  return (
    <section className="kanban" aria-labelledby="kanban-heading">
      <h2 id="kanban-heading" className="sr-only">
        Applications board
      </h2>
      <p className="sr-only" id="kanban-instructions">
        Drag an application between lanes — on a touch screen, hold it first — or use the move buttons and the stage selector on each card.
      </p>
      <div className="kanban__scroller" aria-describedby="kanban-instructions" ref={scrollerRef}>
        <div className="kanban__columns">
          {columnGroups.map((group) => (
            <div className="kanban-column" key={group.stage}>
              {group.lanes.map((lane) => {
                const key = laneKey(lane);
                const headingId = `kanban-stage-${lane.stage}-${lane.outcome}`;
                const stageApplications = applicationsByLane.get(key) ?? [];
                const isEndedLane = lane.outcome !== "active";
                return (
                  <section
                    className={[
                      "kanban-lane",
                      isEndedLane ? `kanban-lane--ended kanban-lane--${lane.outcome}` : "",
                      dropTarget === key ? "kanban-lane--drop-target" : "",
                      feedback?.kind === "accepted" &&
                      stageApplications.some((item) => item.id === feedback.id)
                        ? "kanban-lane--celebrate"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-labelledby={headingId}
                    data-kanban-lane={key}
                    key={key}
                  >
                    <header className="kanban-lane__header">
                      <h3 id={headingId}>{statusLabel(lane)}</h3>
                      <span className="count-badge" aria-label={`${stageApplications.length} applications`}>
                        {stageApplications.length}
                      </span>
                    </header>

                    <div className="kanban-lane__cards">
                      {stageApplications.length === 0 ? (
                        <p className="kanban-lane__empty">Drop an application here</p>
                      ) : null}
                      {stageApplications.map((application) => {
                        // Silence since the last stage change, not since the last edit: a
                        // card you annotated yesterday can still have gone quiet for weeks.
                        const idle = idleStatusFor(application, new Date(), quietDays);
                        const invite = upcomingStageEvent(application);
                        // The board's one non-derivable fact about the role itself: how you
                        // judged it. Shown with the weakest judgement and what is missing,
                        // because a bare number would read as more certain than it is.
                        const preference = preferenceFor(application);
                        const openLabel = [
                          `Open ${application.company}`,
                          application.role,
                          idle ? describeIdle(idle) : null,
                        ]
                          .filter(Boolean)
                          .join(", ");
                        return (
                          <article
                            className={[
                              "application-card",
                              idle ? "application-card--idle" : "",
                              application.archived_at !== null ? "application-card--archived" : "",
                              drag.key === application.id ? "application-card--dragging" : "",
                              feedback?.id === application.id && feedback.kind !== "ended"
                                ? "application-card--landed"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            key={application.id}
                            onPointerDown={(event) => {
                              // A select opens its own list on a press, and a menu's item
                              // is chosen by one; neither is the start of a drag.
                              if ((event.target as Element).closest(NOT_A_HANDLE)) return;
                              drag.start(event, application.id);
                            }}
                            onClickCapture={(event) => {
                              // The click a browser sends after the drop is not also a
                              // press on whichever control the card was picked up by.
                              if (!drag.wasDragged()) return;
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                          >
                            {feedback?.id === application.id && feedback.kind === "accepted" ? (
                              <Confetti />
                            ) : null}
                            <button
                              type="button"
                              className="application-card__open"
                              onClick={() => onOpen(application.id)}
                              aria-label={openLabel}
                            >
                              <strong>{application.company}</strong>
                              {application.role ? <span>{application.role}</span> : null}
                            </button>
                            {application.archived_at !== null ? (
                              // The lane already says how it ended; this says it was put away.
                              <p className="application-card__archived">
                                <ArchivedBadge />
                              </p>
                            ) : null}
                            {idle ? (
                              <p className="application-card__idle">{describeIdle(idle)}</p>
                            ) : null}
                            {application.next_action?.trim() ? (
                              <p className="application-card__action">
                                {/*
                                  * Done sits on the label line, beside the task it resolves,
                                  * rather than in the card's footer row of card-wide controls.
                                  */}
                                <span className="application-card__action-head">
                                  <span className="application-card__label">Next</span>
                                  <CompleteActionButton
                                    application={application}
                                    onCompleteAction={onCompleteAction}
                                    variant="card"
                                  />
                                </span>
                                {application.next_action}
                                {application.next_action_at ? (
                                  <time dateTime={application.next_action_at}>
                                    {" "}
                                    · {formatShortDate(application.next_action_at)}
                                  </time>
                                ) : null}
                              </p>
                            ) : null}
                            {invite ? (
                              <p className="application-card__invite">
                                <span className="application-card__label">Invite</span> {invite.summary}
                                <time dateTime={invite.starts_at}>
                                  {" "}
                                  · {formatShortDate(invite.starts_at)}
                                </time>
                              </p>
                            ) : null}
                            {preference ? (
                              <p className="application-card__preference">
                                <span className="application-card__label">Preference</span> {describePreference(preference)}
                              </p>
                            ) : null}
                            <AttachmentFilenames attachments={application.attachments} variant="card" />
                            <MoveControls
                              application={application}
                              onArchive={onArchive}
                              onMove={moveWithFeedback}
                              variant="card"
                            />
                            {/*
                              * The card already sits in its stage's column, so the
                              * select does not repeat that stage: it reads "Stage".
                              * It lists stages only — how the stage went is the move
                              * buttons' business — and keeps the outcome, so it can
                              * correct where an application ended without reopening
                              * it. The native select stays — it is the accessible and
                              * touch fallback for drag-and-drop — laid over the
                              * trigger at zero opacity, so it keeps its role, its
                              * keyboard behaviour and its accessible name.
                              */}
                            <div className="application-card__row">
                              <span className="application-card__move">
                                <span aria-hidden="true">Stage</span>
                                <select
                                  aria-label={`Move ${application.company} to stage`}
                                  value={application.stage}
                                  onChange={(event) =>
                                    moveWithFeedback(application.id, {
                                      stage: event.target.value as Status["stage"],
                                    })}
                                >
                                  {STAGE_CONFIG.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </span>
                              <MessagesButton
                                application={application}
                                onOpenMessages={onOpenMessages}
                              />
                              <StageNotesButton
                                application={application}
                                onOpenStageNotes={onOpenStageNotes}
                                variant="card"
                              />
                              <PostingButton
                                application={application}
                                onOpenPosting={onOpenPosting}
                                variant="card"
                              />
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {/*
        * One live region for the board, always mounted, so a screen reader hears the
        * message whether the card was dragged or moved by its controls. `aria-live`
        * without the `status` role: that role names the app's own notice, and a second
        * one on the default view would make "the status" ambiguous.
        */}
      <div className="move-toast-region" aria-live="polite" aria-atomic="true">
        {feedback ? <MoveToast feedback={feedback} key={feedback.run} /> : null}
      </div>
    </section>
  );
}

function MoveToast({ feedback }: { feedback: CardFeedback }) {
  const Icon = feedback.kind === "accepted" ? PartyPopper : feedback.kind === "ended" ? Heart : Smile;
  return (
    <p
      className={`move-toast move-toast--${feedback.kind}`}
      style={{ "--toast-duration": `${FEEDBACK_MS[feedback.kind]}ms` } as CSSProperties}
    >
      <Icon aria-hidden="true" size={16} />
      <span>{feedback.message}</span>
    </p>
  );
}

type CardFeedback = MoveFeedback & { id: string; run: number };

// How long each message stays up: long enough to read, and an ending, which is a longer
// sentence and the one that matters most, longest. They never gate anything.
const FEEDBACK_MS: Record<MoveFeedback["kind"], number> = {
  progress: 2200,
  accepted: 3500,
  ended: 4500,
};
const CONFETTI_PIECES = 32;

/*
 * A burst from the card that landed on Accepted. Each piece is told its direction,
 * reach, spin and delay in unitless numbers; the stylesheet turns them into distances
 * on the spacing scale. Spread evenly round the circle with a fixed wobble, so it
 * reads as a burst without randomness making it differ from one render to the next.
 */
function Confetti() {
  return (
    <span className="confetti" aria-hidden="true">
      {Array.from({ length: CONFETTI_PIECES }, (_, index) => {
        const angle = (index / CONFETTI_PIECES) * 2 * Math.PI;
        const reach = 2.5 + (index % 4) * 0.75;
        const style = {
          "--dx": (Math.cos(angle) * reach).toFixed(2),
          "--dy": (Math.sin(angle) * reach - 1.5).toFixed(2),
          "--spin": `${(index % 2 ? 1 : -1) * (180 + (index % 5) * 90)}deg`,
          "--delay": `${(index % 3) * 40}ms`,
        } as CSSProperties;
        return <span className="confetti__piece" key={index} style={style} />;
      })}
    </span>
  );
}

/** What a press on a card that is not a drag lands on. */
const NOT_A_HANDLE = "select, input, textarea, .actions-menu__panel";

/**
 * The lane under a point of the window, read off the lanes' own attribute.
 *
 * A point level with the board but out in the page's gutter beside it counts as over the
 * nearest lane. That gutter is where a finger rests to scroll the board along — the edge
 * of a phone — and a card let go there went nowhere, the gutter being no lane at all.
 */
function laneAt(x: number, y: number): Status | null {
  // jsdom has no layout to hit-test against; with nothing under the point, there is no lane.
  if (typeof document.elementsFromPoint !== "function") return null;
  const board = document.querySelector(".kanban__scroller")?.getBoundingClientRect();
  if (board && y >= board.top && y <= board.bottom) {
    x = Math.min(Math.max(x, board.left + 1), board.right - 1);
  }
  for (const element of document.elementsFromPoint(x, y)) {
    const lane = element.closest("[data-kanban-lane]")?.getAttribute("data-kanban-lane");
    if (!lane) continue;
    const [stage, outcome] = lane.split(":");
    return { stage, outcome } as Status;
  }
  return null;
}

function laneKey({ stage, outcome }: Status): string {
  return `${stage}:${outcome}`;
}
