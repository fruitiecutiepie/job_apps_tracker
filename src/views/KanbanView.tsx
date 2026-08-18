import { useMemo, useState } from "react";
import { STATE_CONFIG, stateLabel } from "../domain";
import type { StateId } from "../domain";
import { AttachmentFilenames } from "./AttachmentFilenames";
import { StageNotesButton } from "./StageNotesButton";
import type { MovableApplicationsViewProps } from "./types";
import {
  applicationAgeInDays,
  DEFAULT_STALE_THRESHOLD_DAYS,
  formatShortDate,
  kanbanColumnGroups,
  upcomingStateEvent,
} from "./viewUtils";

export function KanbanView({
  applications,
  onOpen,
  onOpenStageNotes,
  onMove,
  visibleStates,
}: MovableApplicationsViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const columnGroups = useMemo(() => kanbanColumnGroups(visibleStates), [visibleStates]);
  const stateById = useMemo(
    () => new Map(STATE_CONFIG.map((state) => [state.id, state])),
    [],
  );
  const [dropTarget, setDropTarget] = useState<StateId | null>(null);
  const applicationsByState = useMemo(
    () =>
      new Map(
        STATE_CONFIG.map((state) => [
          state.id,
          applications.filter((application) => application.state === state.id),
        ]),
      ),
    [applications],
  );

  const moveDroppedApplication = (state: StateId, id: string) => {
    const application = applications.find((item) => item.id === id);
    if (application && application.state !== state) onMove(id, state);
    setDraggingId(null);
    setDropTarget(null);
  };

  return (
    <section className="kanban" aria-labelledby="kanban-heading">
      <h2 id="kanban-heading" className="sr-only">
        Applications board
      </h2>
      <p className="sr-only" id="kanban-instructions">
        Drag an application between columns, or use the state selector on each card.
      </p>
      <div className="kanban__scroller" aria-describedby="kanban-instructions">
        <div className="kanban__columns">
          {columnGroups.map((group) => (
            <div className="kanban-column" key={group.lanes.join("-")}>
              {group.lanes.map((stateId) => {
                const state = stateById.get(stateId);
                if (!state) return null;
                const stateApplications = applicationsByState.get(state.id) ?? [];
                const isRejectedLane = stateId !== group.lanes[0];
                return (
                  <section
                    className={[
                      "kanban-lane",
                      isRejectedLane ? "kanban-lane--rejected" : "",
                      dropTarget === state.id ? "kanban-lane--drop-target" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-labelledby={`kanban-state-${state.id}`}
                    key={state.id}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setDropTarget(state.id);
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
                      moveDroppedApplication(state.id, event.dataTransfer.getData("text/plain"));
                    }}
                  >
                    <header className="kanban-lane__header">
                      <h3 id={`kanban-state-${state.id}`}>{state.label}</h3>
                      <span className="count-badge" aria-label={`${stateApplications.length} applications`}>
                        {stateApplications.length}
                      </span>
                    </header>

                    <div className="kanban-lane__cards">
                      {stateApplications.length === 0 ? (
                        <p className="kanban-lane__empty">Drop an application here</p>
                      ) : null}
                      {stateApplications.map((application) => {
                        const ageInDays = applicationAgeInDays(application.updated_at);
                        const stale = ageInDays >= DEFAULT_STALE_THRESHOLD_DAYS;
                        const invite = upcomingStateEvent(application);
                        const openLabel = [
                          `Open ${application.company}`,
                          application.role,
                          stale ? `stale, last updated ${ageInDays} days ago` : null,
                        ]
                          .filter(Boolean)
                          .join(", ");
                        return (
                          <article
                            className={[
                              "application-card",
                              stale ? "application-card--stale" : "",
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
                            {stale ? (
                              <p className="application-card__age">Untouched {ageInDays} days</p>
                            ) : null}
                            {application.next_action?.trim() ? (
                              <p className="application-card__action">
                                <span>Next</span> {application.next_action}
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
                                <span>Invite</span> {invite.summary}
                                <time dateTime={invite.starts_at}>
                                  {" "}
                                  · {formatShortDate(invite.starts_at)}
                                </time>
                              </p>
                            ) : null}
                            <AttachmentFilenames attachments={application.attachments} variant="card" />
                            {/*
                              * The card already sits in its state's lane, so the
                              * select does not repeat that state: it reads "Move".
                              * The native select stays — it is the accessible and
                              * touch fallback for drag-and-drop — laid over the
                              * trigger at zero opacity, so it keeps its role, its
                              * keyboard behaviour and its accessible name.
                              */}
                            <div className="application-card__row">
                              <span className="application-card__move">
                                <span aria-hidden="true">Move</span>
                                <select
                                  aria-label={`Move ${application.company} to state`}
                                  value={application.state}
                                  onChange={(event) => onMove(application.id, event.target.value as StateId)}
                                >
                                  {STATE_CONFIG.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {stateLabel(option.id)}
                                    </option>
                                  ))}
                                </select>
                              </span>
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
