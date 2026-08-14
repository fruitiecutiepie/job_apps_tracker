import { useMemo, useState } from "react";
import { STATE_CONFIG, stateLabel } from "../domain";
import type { StateId } from "../domain";
import type { MovableApplicationsViewProps } from "./types";
import { formatShortDate } from "./viewUtils";

export function KanbanView({
  applications,
  onOpen,
  onMove,
  visibleStates,
}: MovableApplicationsViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const renderedStates = visibleStates
    ? STATE_CONFIG.filter(({ id }) => visibleStates.includes(id))
    : STATE_CONFIG;
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
        {renderedStates.map((state) => {
            const stateApplications = applicationsByState.get(state.id) ?? [];
            return (
              <section
                className={`kanban-column${dropTarget === state.id ? " kanban-column--drop-target" : ""}`}
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
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  moveDroppedApplication(state.id, event.dataTransfer.getData("text/plain"));
                }}
              >
                <header className="kanban-column__header">
                  <h3 id={`kanban-state-${state.id}`}>{state.label}</h3>
                  <span className="count-badge" aria-label={`${stateApplications.length} applications`}>
                    {stateApplications.length}
                  </span>
                </header>

                <div className="kanban-column__cards">
                  {stateApplications.length === 0 ? (
                    <p className="kanban-column__empty">Drop an application here</p>
                  ) : null}
                  {stateApplications.map((application) => (
                    <article
                      className={`application-card${draggingId === application.id ? " application-card--dragging" : ""}`}
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
                        aria-label={`Open ${application.company}${application.role ? `, ${application.role}` : ""}`}
                      >
                        <strong>{application.company}</strong>
                        {application.role ? <span>{application.role}</span> : null}
                      </button>
                      {application.next_action?.trim() ? (
                        <p className="application-card__action">
                          <span>Next</span> {application.next_action}
                          {application.next_action_at ? (
                            <time dateTime={application.next_action_at}> · {formatShortDate(application.next_action_at)}</time>
                          ) : null}
                        </p>
                      ) : null}
                      <label className="application-card__move">
                        <span className="sr-only">Move {application.company} to state</span>
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
                      </label>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}
