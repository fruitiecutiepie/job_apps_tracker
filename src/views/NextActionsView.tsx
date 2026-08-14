import type { Application } from "../domain";
import type { ApplicationsViewProps } from "./types";
import { formatShortDate, parseTimestamp, startOfLocalDay } from "./viewUtils";

interface ActionGroupProps {
  applications: Application[];
  emptyMessage: string;
  heading: string;
  onOpen: (id: string) => void;
}

function ActionGroup({ applications, emptyMessage, heading, onOpen }: ActionGroupProps) {
  return (
    <section className="action-group" aria-labelledby={`actions-${heading.toLowerCase()}`}>
      <div className="section-heading-row">
        <h2 id={`actions-${heading.toLowerCase()}`}>{heading}</h2>
        <span className="count-badge" aria-label={`${applications.length} applications`}>
          {applications.length}
        </span>
      </div>
      {applications.length === 0 ? (
        <p className="empty-inline">{emptyMessage}</p>
      ) : (
        <ul className="action-list">
          {applications.map((application) => (
            <li key={application.id}>
              <button
                className="action-card"
                type="button"
                onClick={() => onOpen(application.id)}
                aria-label={`Open ${application.company}: ${application.next_action}`}
              >
                <span className="action-card__date">
                  {formatShortDate(application.next_action_at)}
                </span>
                <strong>{application.next_action}</strong>
                <span>
                  {application.company}
                  {application.role ? ` · ${application.role}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function NextActionsView({ applications, onOpen }: ApplicationsViewProps) {
  const today = startOfLocalDay(new Date());
  const withActions = applications.filter(
    (application) => application.next_action?.trim(),
  );

  const overdue = withActions
    .filter((application) => {
      if (!application.next_action_at) return false;
      const date = parseTimestamp(application.next_action_at);
      return date !== null && startOfLocalDay(date) < today;
    })
    .sort(compareActionDates);

  const upcoming = withActions
    .filter((application) => {
      if (!application.next_action_at) return false;
      const date = parseTimestamp(application.next_action_at);
      return date !== null && startOfLocalDay(date) >= today;
    })
    .sort(compareActionDates);

  const unscheduled = withActions
    .filter((application) => !application.next_action_at)
    .sort((left, right) => left.company.localeCompare(right.company));

  if (withActions.length === 0) {
    return (
      <section className="empty-state" aria-labelledby="next-actions-heading">
        <h2 id="next-actions-heading">No next actions yet</h2>
        <p>Add a next action to an application and it will show up here.</p>
      </section>
    );
  }

  return (
    <div className="action-groups">
      <ActionGroup
        heading="Overdue"
        applications={overdue}
        emptyMessage="Nothing overdue."
        onOpen={onOpen}
      />
      <ActionGroup
        heading="Upcoming"
        applications={upcoming}
        emptyMessage="No scheduled actions."
        onOpen={onOpen}
      />
      <ActionGroup
        heading="Unscheduled"
        applications={unscheduled}
        emptyMessage="No actions waiting for a date."
        onOpen={onOpen}
      />
    </div>
  );
}

function compareActionDates(left: Application, right: Application): number {
  return (
    new Date(left.next_action_at ?? 0).getTime() -
    new Date(right.next_action_at ?? 0).getTime()
  );
}
