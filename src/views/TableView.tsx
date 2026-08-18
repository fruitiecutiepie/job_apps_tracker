import { useMemo, useState, type ReactNode } from "react";
import { SOURCE_SUGGESTIONS, STATE_CONFIG } from "../domain";
import type { Application, StateId } from "../domain";
import { AttachmentFilenames } from "./AttachmentFilenames";
import { InviteSummaries, inviteFilterText } from "./InviteSummaries";
import { StageNotesButton } from "./StageNotesButton";
import type { MovableApplicationsViewProps } from "./types";
import { rankByUrgency, type UrgencyRanking } from "./urgency";
import { formatShortDate, parseTimestamp, upcomingStateEvent } from "./viewUtils";

type SortField =
  | "company"
  | "role"
  | "source"
  | "state"
  | "next_action"
  | "invites"
  | "deadline_at"
  | "urgency"
  | "created_at"
  | "updated_at";
type SortDirection = "ascending" | "descending";
type StateColumnFilter = StateId | "all";

interface ColumnFilters {
  company: string;
  role: string;
  source: string;
  state: StateColumnFilter;
  next_action: string;
  invites: string;
  deadline_at: string;
  urgency: string;
  attachments: string;
  created_at: string;
  updated_at: string;
}

const EMPTY_COLUMN_FILTERS: ColumnFilters = {
  company: "",
  role: "",
  source: "",
  state: "all",
  next_action: "",
  invites: "",
  deadline_at: "",
  urgency: "",
  attachments: "",
  created_at: "",
  updated_at: "",
};

const stateOrder = new Map(STATE_CONFIG.map((state, index) => [state.id, index]));

type UrgencyLookup = ReadonlyMap<string, UrgencyRanking>;

const UNRANKED_SCORE = -1;

function comparableValue(
  application: Application,
  field: SortField,
  urgency: UrgencyLookup,
): string | number {
  if (field === "state") return stateOrder.get(application.state) ?? Number.MAX_SAFE_INTEGER;
  // Sorting by invite means sorting by what is next, so rows with nothing ahead sink.
  if (field === "invites") {
    const next = upcomingStateEvent(application);
    return next ? Date.parse(next.starts_at) : Number.MAX_SAFE_INTEGER;
  }
  if (field === "urgency") return urgency.get(application.id)?.score ?? UNRANKED_SCORE;
  if (field === "deadline_at") {
    return application.deadline_at
      ? parseTimestamp(application.deadline_at)?.getTime() ?? Number.MAX_SAFE_INTEGER
      : Number.MAX_SAFE_INTEGER;
  }
  if (field === "created_at") return parseTimestamp(application.created_at)?.getTime() ?? 0;
  if (field === "updated_at") return parseTimestamp(application.updated_at)?.getTime() ?? 0;
  return (application[field] ?? "").toLocaleLowerCase();
}

function includesQuery(value: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return value.toLocaleLowerCase().includes(needle);
}

function matchesColumnFilters(
  application: Application,
  filters: ColumnFilters,
  urgency: UrgencyLookup,
): boolean {
  if (filters.state !== "all" && application.state !== filters.state) return false;
  if (!includesQuery(application.company, filters.company)) return false;
  if (!includesQuery(application.role ?? "", filters.role)) return false;
  if (!includesQuery(application.source ?? "", filters.source)) return false;

  const nextActionText = [application.next_action, formatShortDate(application.next_action_at)]
    .filter((value) => value && value !== "Not scheduled")
    .join(" ");
  if (!includesQuery(nextActionText, filters.next_action)) return false;
  if (!includesQuery(inviteFilterText(application.state_events), filters.invites)) return false;
  const deadlineText = application.deadline_at ? formatShortDate(application.deadline_at) : "";
  if (!includesQuery(deadlineText, filters.deadline_at)) return false;
  if (!includesQuery(urgency.get(application.id)?.reason ?? "", filters.urgency)) return false;
  if (!includesQuery(application.attachments.map((attachment) => attachment.filename).join(" "), filters.attachments)) {
    return false;
  }
  if (!includesQuery(formatShortDate(application.created_at), filters.created_at)) return false;
  if (!includesQuery(formatShortDate(application.updated_at), filters.updated_at)) return false;
  return true;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function sourceFilterSuggestions(applications: Application[]): string[] {
  const fromData = uniqueSorted(
    applications.flatMap((application) => (application.source?.trim() ? [application.source.trim()] : [])),
  );
  const extras = fromData.filter(
    (source) => !(SOURCE_SUGGESTIONS as readonly string[]).includes(source),
  );
  return [...SOURCE_SUGGESTIONS, ...extras];
}

function columnFiltersAreActive(filters: ColumnFilters): boolean {
  return (
    filters.state !== "all" ||
    Boolean(
      filters.company.trim() ||
        filters.role.trim() ||
        filters.source.trim() ||
        filters.next_action.trim() ||
        filters.invites.trim() ||
        filters.deadline_at.trim() ||
        filters.urgency.trim() ||
        filters.attachments.trim() ||
        filters.created_at.trim() ||
        filters.updated_at.trim(),
    )
  );
}

export function TableView({
  applications,
  onOpen,
  onOpenStageNotes,
  onMove,
}: MovableApplicationsViewProps) {
  const [sortField, setSortField] = useState<SortField>("updated_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("descending");
  const [filters, setFilters] = useState<ColumnFilters>(EMPTY_COLUMN_FILTERS);

  const stateFilterOptions = useMemo(() => {
    const present = new Set(applications.map((application) => application.state));
    if (filters.state !== "all") present.add(filters.state);
    return STATE_CONFIG.filter((state) => present.has(state.id));
  }, [applications, filters.state]);

  const companySuggestions = useMemo(
    () => uniqueSorted(applications.map((application) => application.company)),
    [applications],
  );

  const sourceSuggestions = useMemo(() => sourceFilterSuggestions(applications), [applications]);

  const urgencyById = useMemo(() => {
    const lookup = new Map<string, UrgencyRanking>();
    for (const ranking of rankByUrgency(applications)) {
      lookup.set(ranking.application.id, ranking);
    }
    return lookup;
  }, [applications]);

  const visibleApplications = useMemo(() => {
    return applications
      .filter((application) => matchesColumnFilters(application, filters, urgencyById))
      .sort((left, right) => {
        const leftValue = comparableValue(left, sortField, urgencyById);
        const rightValue = comparableValue(right, sortField, urgencyById);
        const result =
          typeof leftValue === "number" && typeof rightValue === "number"
            ? leftValue - rightValue
            : String(leftValue).localeCompare(String(rightValue), undefined, {
                numeric: true,
                sensitivity: "base",
              });
        return sortDirection === "ascending" ? result : -result;
      });
  }, [applications, filters, sortDirection, sortField, urgencyById]);

  const setSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection((current) => (current === "ascending" ? "descending" : "ascending"));
    } else {
      setSortField(field);
      setSortDirection(
        field === "created_at" || field === "updated_at" || field === "urgency"
          ? "descending"
          : "ascending",
      );
    }
  };

  const setTextFilter = (field: keyof Omit<ColumnFilters, "state">, value: string) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const textFilter = (
    field: keyof Omit<ColumnFilters, "state">,
    label: string,
    suggestions?: readonly string[],
  ) => {
    const listId = suggestions ? `table-filter-${field}-suggestions` : undefined;
    return (
      <>
        <input
          aria-label={`Filter ${label} column`}
          list={listId}
          onChange={(event) => setTextFilter(field, event.target.value)}
          placeholder="Filter"
          type="search"
          value={filters[field]}
        />
        {suggestions ? (
          <datalist id={listId}>
            {suggestions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        ) : null}
      </>
    );
  };

  const headerCell = (label: string, control: ReactNode, field?: SortField) => (
    <th scope="col" aria-sort={field ? (sortField === field ? sortDirection : "none") : undefined}>
      <div className="table-col-header">
        {field ? (
          <button type="button" className="table-sort" onClick={() => setSort(field)}>
            {label}
            <span aria-hidden="true">
              {sortField === field ? (sortDirection === "ascending" ? " ↑" : " ↓") : ""}
            </span>
          </button>
        ) : (
          <span className="table-col-header__label">{label}</span>
        )}
        {control}
      </div>
    </th>
  );

  const filtersActive = columnFiltersAreActive(filters);

  return (
    <section className="table-view" aria-labelledby="table-heading">
      <div className="view-toolbar">
        <h2 className="sr-only" id="table-heading">All applications</h2>
        {filtersActive ? (
          <button
            className="button button--quiet"
            onClick={() => setFilters(EMPTY_COLUMN_FILTERS)}
            type="button"
          >
            Clear column filters
          </button>
        ) : null}
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {headerCell("Company", textFilter("company", "Company", companySuggestions), "company")}
              {headerCell("Role", textFilter("role", "Role"), "role")}
              {headerCell("Source", textFilter("source", "Source", sourceSuggestions), "source")}
              {headerCell(
                "State",
                <select
                  aria-label="Filter State column"
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      state: event.target.value as StateColumnFilter,
                    }))
                  }
                  value={filters.state}
                >
                  <option value="all">All states</option>
                  {stateFilterOptions.map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.label}
                    </option>
                  ))}
                </select>,
                "state",
              )}
              {headerCell("Next action", textFilter("next_action", "Next action"), "next_action")}
              {headerCell("Invites", textFilter("invites", "Invites"), "invites")}
              {headerCell("Deadline", textFilter("deadline_at", "Deadline"), "deadline_at")}
              {headerCell("Urgency", textFilter("urgency", "Urgency"), "urgency")}
              {headerCell("Attachments", textFilter("attachments", "Attachments"))}
              {headerCell("Prep notes", null)}
              {headerCell("Created", textFilter("created_at", "Created"), "created_at")}
              {headerCell("Last update", textFilter("updated_at", "Last update"), "updated_at")}
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
                  {application.state_events.length > 0 ? (
                    <InviteSummaries invites={application.state_events} />
                  ) : (
                    <span aria-label="Not set">—</span>
                  )}
                </td>
                <td>
                  {application.deadline_at ? (
                    <time dateTime={application.deadline_at}>
                      {formatShortDate(application.deadline_at)}
                    </time>
                  ) : (
                    <span aria-label="Not set">—</span>
                  )}
                </td>
                <td>
                  {urgencyById.has(application.id) ? (
                    <span className="table-view__urgency">
                      {urgencyById.get(application.id)!.reason}
                    </span>
                  ) : (
                    <span aria-label="Not ranked">—</span>
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
                  <StageNotesButton
                    application={application}
                    onOpenStageNotes={onOpenStageNotes}
                    variant="table"
                  />
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
      {visibleApplications.length === 0 ? (
        <p className="empty-state">
          {filtersActive ? "No applications match these column filters." : "No applications to show."}
        </p>
      ) : null}
    </section>
  );
}
