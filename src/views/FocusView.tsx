import type { ReactNode } from "react";

import { focusGroups } from "./focusGroups";
import { StageNotesButton } from "./StageNotesButton";
import type { ApplicationsViewProps } from "./types";
import { formatShortDate } from "./viewUtils";

/**
 * An ordered group is a schedule or a priority order, so position means something and the
 * markup is an <ol>. Alphabetical groups carry no such meaning.
 */
function RowList({ ordered, children }: { ordered: boolean; children: ReactNode }) {
  return ordered ? (
    <ol className="action-list">{children}</ol>
  ) : (
    <ul className="action-list">{children}</ul>
  );
}

export function FocusView({ applications, onOpen, onOpenStageNotes }: ApplicationsViewProps) {
  const groups = focusGroups(applications);
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  // Derived, never remembered: disclosure is display state like the stale threshold.
  const leadGroup = groups.find((group) => group.rows.length > 0)?.id ?? null;

  if (total === 0) {
    return (
      <section className="empty-state" aria-labelledby="focus-heading">
        <h2 id="focus-heading">Nothing needs attention</h2>
        <p>Live applications appear here, grouped by what is most pressing.</p>
      </section>
    );
  }

  return (
    <div className="action-groups">
      {groups.map((group) => (
        <details className="action-group" key={group.id} open={group.id === leadGroup}>
          <summary className="focus-group__summary">
            <h2 className="focus-group__heading">{group.heading}</h2>
            <span className="count-badge" aria-label={`${group.rows.length} applications`}>
              {group.rows.length}
            </span>
          </summary>
          {group.rows.length === 0 ? (
            <p className="empty-inline">{group.emptyMessage}</p>
          ) : (
            <RowList ordered={group.ordered}>
              {group.rows.map(({ application, reason }) => (
                <li key={application.id}>
                  <button
                    className="action-card"
                    type="button"
                    onClick={() => onOpen(application.id)}
                    aria-label={`Open ${application.company}${application.role ? `, ${application.role}` : ""}`}
                  >
                    <span className="action-card__date">{reason}</span>
                    <strong>{application.next_action?.trim() || "No action set"}</strong>
                    <span>
                      {application.company}
                      {application.role ? ` · ${application.role}` : ""}
                    </span>
                    <span>
                      {application.deadline_at
                        ? `Deadline ${formatShortDate(application.deadline_at)} · `
                        : ""}
                      {`Updated ${formatShortDate(application.updated_at)}`}
                    </span>
                  </button>
                  <StageNotesButton
                    application={application}
                    onOpenStageNotes={onOpenStageNotes}
                    variant="card"
                  />
                </li>
              ))}
            </RowList>
          )}
        </details>
      ))}
    </div>
  );
}
