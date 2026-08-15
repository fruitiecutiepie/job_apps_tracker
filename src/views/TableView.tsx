import { useMemo, useState } from "react";
import { STATE_CONFIG } from "../domain";
import type { StateId } from "../domain";
import { AttachmentFilenames } from "./AttachmentFilenames";
import type { MovableApplicationsViewProps } from "./types";
import { formatShortDate, parseTimestamp } from "./viewUtils";

type SortField = "company" | "role" | "source" | "state" | "next_action" | "created_at" | "updated_at";
type SortDirection = "ascending" | "descending";

const stateOrder = new Map(STATE_CONFIG.map((state, index) => [state.id, index]));

function comparableValue(
  application: MovableApplicationsViewProps["applications"][number],
  field: SortField,
): string | number {
  if (field === "state") return stateOrder.get(application.state) ?? Number.MAX_SAFE_INTEGER;
  if (field === "created_at") return parseTimestamp(application.created_at)?.getTime() ?? 0;
  if (field === "updated_at") return parseTimestamp(application.updated_at)?.getTime() ?? 0;
  return (application[field] ?? "").toLocaleLowerCase();
}

export function TableView({ applications, onOpen, onMove }: MovableApplicationsViewProps) {
  const [sortField, setSortField] = useState<SortField>("updated_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("descending");

  const visibleApplications = useMemo(() => {
    return [...applications].sort((left, right) => {
      const leftValue = comparableValue(left, sortField);
      const rightValue = comparableValue(right, sortField);
      const result =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), undefined, {
              numeric: true,
              sensitivity: "base",
            });
      return sortDirection === "ascending" ? result : -result;
    });
  }, [applications, sortDirection, sortField]);

  const setSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection((current) => (current === "ascending" ? "descending" : "ascending"));
    } else {
      setSortField(field);
      setSortDirection(field === "created_at" || field === "updated_at" ? "descending" : "ascending");
    }
  };

  const sortableHeader = (field: SortField, label: string) => (
    <th scope="col" aria-sort={sortField === field ? sortDirection : "none"}>
      <button type="button" className="table-sort" onClick={() => setSort(field)}>
        {label}
        <span aria-hidden="true">
          {sortField === field ? (sortDirection === "ascending" ? " ↑" : " ↓") : ""}
        </span>
      </button>
    </th>
  );

  return (
    <section className="table-view" aria-labelledby="table-heading">
      <div className="view-toolbar">
        <div>
          <h2 id="table-heading">All applications</h2>
          <p>{visibleApplications.length} shown</p>
        </div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {sortableHeader("company", "Company")}
              {sortableHeader("role", "Role")}
              {sortableHeader("source", "Source")}
              {sortableHeader("state", "State")}
              {sortableHeader("next_action", "Next action")}
              <th scope="col">Attachments</th>
              {sortableHeader("created_at", "Created")}
              {sortableHeader("updated_at", "Last update")}
            </tr>
          </thead>
          <tbody>
            {visibleApplications.map((application) => (
              <tr key={application.id}>
                <th scope="row">
                  <button type="button" className="table-link" onClick={() => onOpen(application.id)}>
                    {application.company}
                  </button>
                </th>
                <td>{application.role || <span aria-label="Not set">—</span>}</td>
                <td>{application.source || <span aria-label="Not set">—</span>}</td>
                <td>
                  <select
                    aria-label={`Move ${application.company} to state`}
                    className="table-state-select"
                    value={application.state}
                    onChange={(event) => onMove(application.id, event.target.value as StateId)}
                  >
                    {STATE_CONFIG.map((state) => (
                      <option key={state.id} value={state.id}>
                        {state.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {application.next_action?.trim() ? (
                    <>
                      <span>{application.next_action}</span>
                      {application.next_action_at ? (
                        <time className="table-view__date" dateTime={application.next_action_at}>
                          {formatShortDate(application.next_action_at)}
                        </time>
                      ) : null}
                    </>
                  ) : (
                    <span aria-label="Not set">—</span>
                  )}
                </td>
                <td>
                  {application.attachments.length > 0 ? (
                    <AttachmentFilenames attachments={application.attachments} variant="table" />
                  ) : (
                    <span aria-label="Not set">—</span>
                  )}
                </td>
                <td>
                  <time dateTime={application.created_at}>{formatShortDate(application.created_at)}</time>
                </td>
                <td>
                  <time dateTime={application.updated_at}>{formatShortDate(application.updated_at)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visibleApplications.length === 0 ? <p className="empty-state">No applications to show.</p> : null}
    </section>
  );
}
