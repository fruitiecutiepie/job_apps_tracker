import { useMemo, useState } from "react";
import { STATE_CONFIG, statusLabel } from "../domain";
import type { Status } from "../domain";
import { AttachmentFilenames } from "./AttachmentFilenames";
import { CompleteActionButton } from "./CompleteActionButton";
import { describeIdle, idleStatusFor } from "./idle";
import { describePreference, preferenceFor } from "./preference";
import { MessagesButton } from "./MessagesButton";
import { ArchivedBadge, MoveControls } from "./MoveControls";
import { StageNotesButton } from "./StageNotesButton";
import type { MovableApplicationsViewProps } from "./types";
import { formatShortDate, kanbanColumnGroups, upcomingStateEvent } from "./viewUtils";

export function KanbanView({
  applications,
  onOpen,
  onOpenStageNotes,
  onOpenMessages,
  onCompleteAction,
  onMove,
  onArchive,
  visibleStates,
  visibleOutcomes,
}: MovableApplicationsViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const columnGroups = useMemo(
    () => kanbanColumnGroups(applications, visibleStates, visibleOutcomes),
    [applications, visibleStates, visibleOutcomes],
  );
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const applicationsByLane = useMemo(() => {
    const lanes = new Map<string, typeof applications>();
    for (const application of applications) {
      const key = laneKey(application);
      lanes.set(key, [...(lanes.get(key) ?? []), application]);
    }
    return lanes;
  }, [applications]);

  const moveDroppedApplication = (lane: Status, id: string) => {
    // A same-lane drop is a no-op in the mutation, which is what keeps it off the disk.
    if (applications.some((item) => item.id === id)) onMove(id, lane);
    setDraggingId(null);
    setDropTarget(null);
  };

  return (
    <section className="kanban" aria-labelledby="kanban-heading">
      <h2 id="kanban-heading" className="sr-only">
        Applications board
      </h2>
      <p className="sr-only" id="kanban-instructions">
        Drag an application between lanes, or use the move buttons and the stage selector on each card.
      </p>
      <div className="kanban__scroller" aria-describedby="kanban-instructions">
        <div className="kanban__columns">
          {columnGroups.map((group) => (
            <div className="kanban-column" key={group.state}>
              {group.lanes.map((lane) => {
                const key = laneKey(lane);
                const headingId = `kanban-state-${lane.state}-${lane.outcome}`;
                const stateApplications = applicationsByLane.get(key) ?? [];
                const isEndedLane = lane.outcome !== "active";
                return (
                  <section
                    className={[
                      "kanban-lane",
                      isEndedLane ? `kanban-lane--ended kanban-lane--${lane.outcome}` : "",
                      dropTarget === key ? "kanban-lane--drop-target" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-labelledby={headingId}
                    key={key}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setDropTarget(key);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDropTarget(null);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      moveDroppedApplication(lane, event.dataTransfer.getData("text/plain"));
                    }}
                  >
                    <header className="kanban-lane__header">
                      <h3 id={headingId}>{statusLabel(lane)}</h3>
                      <span className="count-badge" aria-label={`${stateApplications.length} applications`}>
                        {stateApplications.length}
                      </span>
                    </header>

                    <div className="kanban-lane__cards">
                      {stateApplications.length === 0 ? (
                        <p className="kanban-lane__empty">Drop an application here</p>
                      ) : null}
                      {stateApplications.map((application) => {
                        // Silence since the last stage change, not since the last edit: a
                        // card you annotated yesterday can still have gone quiet for weeks.
                        const idle = idleStatusFor(application);
                        const invite = upcomingStateEvent(application);
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
                              draggingId === application.id ? "application-card--dragging" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            draggable
                            key={application.id}
                            onDragStart={(event) => {
                              setDraggingId(application.id);
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", application.id);
                            }}
                            onDragEnd={() => {
                              setDraggingId(null);
                              setDropTarget(null);
                            }}
                          >
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
                              onMove={onMove}
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
                                  value={application.state}
                                  onChange={(event) =>
                                    onMove(application.id, { state: event.target.value as Status["state"] })}
                                >
                                  {STATE_CONFIG.map((option) => (
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
    </section>
  );
}

function laneKey({ state, outcome }: Status): string {
  return `${state}:${outcome}`;
}
