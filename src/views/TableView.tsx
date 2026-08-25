import { useMemo, useRef, useState, type ReactNode } from "react";
import { SOURCE_SUGGESTIONS, STATE_CONFIG } from "../domain";
import type { Application, StateId } from "../domain";
import { AttachmentFilenames } from "./AttachmentFilenames";
import { CompleteActionButton } from "./CompleteActionButton";
import { InviteSummaries, inviteFilterText } from "./InviteSummaries";
import { StageNotesButton } from "./StageNotesButton";
import { compensationSortValue, compensationText } from "./compensation";
import type { MovableApplicationsViewProps } from "./types";
import { describePreference, preferenceFor, type PreferenceScore } from "./preference";
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
  | "preference"
  | "compensation"
  | "created_at"
  | "updated_at";
type SortDirection = "ascending" | "descending";
type StateColumnFilter = StateId | "all";
type ColumnKey = SortField | "attachments" | "prep_notes";

const COLUMN_ORDER: readonly ColumnKey[] = [
  "company",
  "role",
  "source",
  "state",
  "next_action",
  "invites",
  "deadline_at",
  "urgency",
  "preference",
  "compensation",
  "attachments",
  "prep_notes",
  "created_at",
  "updated_at",
];

const DEFAULT_COLUMN_WIDTH = 160;
const MIN_COLUMN_WIDTH = 72;
const RESIZE_KEYBOARD_STEP = 24;

/**
 * Typography research on continuous prose (e.g. Bringhurst's "Elements of Typographic Style")
 * puts the readable line length at 45-75 characters, 66 as the usual ideal. A table column
 * is scanned in short bursts rather than read start to finish, so this sits at the narrow end
 * of that band rather than at the prose ideal.
 */
const MAX_COLUMN_CHARACTERS = 60;
/** Average glyph width for the table's body font (13px, system sans stack) — ~0.58em per character. */
const CHAR_WIDTH_PX = 7.5;
/** Matches `padding: var(--s2) var(--s3)` on th/td: 2 x s3 (8px). */
const CELL_HORIZONTAL_PADDING = 16;
const MAX_COLUMN_WIDTH = Math.round(MAX_COLUMN_CHARACTERS * CHAR_WIDTH_PX + CELL_HORIZONTAL_PADDING);

function defaultColumnWidths(): Record<ColumnKey, number> {
  return Object.fromEntries(COLUMN_ORDER.map((column) => [column, DEFAULT_COLUMN_WIDTH])) as Record<
    ColumnKey,
    number
  >;
}

function clampColumnWidth(width: number): number {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width));
}

function estimateTextWidth(characterCount: number): number {
  return Math.round(characterCount * CHAR_WIDTH_PX + CELL_HORIZONTAL_PADDING);
}

interface ColumnFilters {
  company: string;
  role: string;
  source: string;
  state: StateColumnFilter;
  next_action: string;
  invites: string;
  deadline_at: string;
  urgency: string;
  preference: string;
  compensation: string;
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
  preference: "",
  compensation: "",
  attachments: "",
  created_at: "",
  updated_at: "",
};

const stateOrder = new Map(STATE_CONFIG.map((state, index) => [state.id, index]));

type UrgencyLookup = ReadonlyMap<string, UrgencyRanking>;
type PreferenceLookup = ReadonlyMap<string, PreferenceScore>;
/** Rendered compensation text, absent for the rows that have none. */
type CompensationLookup = ReadonlyMap<string, string>;

const UNRANKED_SCORE = -1;

/**
 * `null` means the row has no value for this column. It is deliberately not a sentinel
 * number: a sentinel has to be smaller or larger than every real value, and whichever you
 * pick it sorts to the wrong end as soon as the direction flips. The comparator keeps these
 * rows last in both directions instead.
 */
function comparableValue(
  application: Application,
  field: SortField,
  urgency: UrgencyLookup,
  preference: PreferenceLookup,
): string | number | null {
  if (field === "state") return stateOrder.get(application.state) ?? Number.MAX_SAFE_INTEGER;
  // Sorting by invite means sorting by what is next, so rows with nothing ahead sink.
  if (field === "invites") {
    const next = upcomingStateEvent(application);
    return next ? Date.parse(next.starts_at) : null;
  }
  if (field === "urgency") return urgency.get(application.id)?.score ?? UNRANKED_SCORE;
  if (field === "preference") return preference.get(application.id)?.score ?? null;
  // Null, not zero: an application nobody has quoted a number for is absent from this
  // column, not the worst-paid one, and a target of your own is not a figure anyone offered.
  if (field === "compensation") return compensationSortValue(application);
  if (field === "deadline_at") {
    return application.deadline_at ? parseTimestamp(application.deadline_at)?.getTime() ?? null : null;
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
  preference: PreferenceLookup,
  compensation: CompensationLookup,
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
  if (!includesQuery(describePreference(preference.get(application.id) ?? null), filters.preference)) {
    return false;
  }
  if (!includesQuery(compensation.get(application.id) ?? "", filters.compensation)) return false;
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
        filters.preference.trim() ||
        filters.compensation.trim() ||
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
  onCompleteAction,
  onMove,
}: MovableApplicationsViewProps) {
  const [sortField, setSortField] = useState<SortField>("updated_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("descending");
  const [filters, setFilters] = useState<ColumnFilters>(EMPTY_COLUMN_FILTERS);
  const [columnWidths, setColumnWidths] = useState<Record<ColumnKey, number>>(defaultColumnWidths);
  const resizing = useRef<{ column: ColumnKey; startX: number; startWidth: number } | null>(null);

  const resizeColumnBy = (column: ColumnKey, delta: number) => {
    setColumnWidths((current) => ({
      ...current,
      [column]: clampColumnWidth(current[column] + delta),
    }));
  };

  const handleResizeMove = (event: MouseEvent) => {
    const drag = resizing.current;
    if (!drag) return;
    const width = clampColumnWidth(drag.startWidth + (event.clientX - drag.startX));
    setColumnWidths((current) => ({ ...current, [drag.column]: width }));
  };

  const handleResizeEnd = () => {
    resizing.current = null;
    window.removeEventListener("mousemove", handleResizeMove);
    window.removeEventListener("mouseup", handleResizeEnd);
  };

  const startResize = (column: ColumnKey) => (event: React.MouseEvent) => {
    event.preventDefault();
    resizing.current = { column, startX: event.clientX, startWidth: columnWidths[column] };
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);
  };

  // Fits the column to its longest cell's full text, so double-click gives the smallest
  // width that still shows everything on one line, without exceeding the readable-width cap.
  const autoFitColumn = (column: ColumnKey) => {
    const cells = document.querySelectorAll(`[data-column="${column}"]`);
    let longestChars = 0;
    cells.forEach((cell) => {
      const text = (cell.textContent ?? "").replace(/\s+/g, " ").trim();
      longestChars = Math.max(longestChars, text.length);
    });
    setColumnWidths((current) => ({
      ...current,
      [column]: clampColumnWidth(estimateTextWidth(longestChars)),
    }));
  };

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

  const preferenceById = useMemo(() => {
    const lookup = new Map<string, PreferenceScore>();
    for (const application of applications) {
      const preference = preferenceFor(application);
      if (preference) lookup.set(application.id, preference);
    }
    return lookup;
  }, [applications]);

  const compensationById = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const application of applications) {
      const text = compensationText(application);
      if (text) lookup.set(application.id, text);
    }
    return lookup;
  }, [applications]);

  const visibleApplications = useMemo(() => {
    return applications
      .filter((application) =>
        matchesColumnFilters(application, filters, urgencyById, preferenceById, compensationById),
      )
      .sort((left, right) => {
        const leftValue = comparableValue(left, sortField, urgencyById, preferenceById);
        const rightValue = comparableValue(right, sortField, urgencyById, preferenceById);

        // Presence first, and outside the direction flip: a row with nothing to compare is
        // not the smallest value, it is absent, so it stays last whichever way the column
        // is sorted.
        if (leftValue === null || rightValue === null) {
          if (leftValue === rightValue) return 0;
          return leftValue === null ? 1 : -1;
        }

        const result =
          typeof leftValue === "number" && typeof rightValue === "number"
            ? leftValue - rightValue
            : String(leftValue).localeCompare(String(rightValue), undefined, {
                numeric: true,
                sensitivity: "base",
              });
        return sortDirection === "ascending" ? result : -result;
      });
  }, [applications, compensationById, filters, preferenceById, sortDirection, sortField, urgencyById]);

  const setSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection((current) => (current === "ascending" ? "descending" : "ascending"));
    } else {
      setSortField(field);
      setSortDirection(
        field === "created_at"
        || field === "updated_at"
        || field === "urgency"
        || field === "preference"
        // More pay is better, so the interesting end leads, the way it does for preference.
        || field === "compensation"
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

  const headerCell = (label: string, control: ReactNode, column: ColumnKey, field?: SortField) => (
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
      <div
        className="table-col-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label} column`}
        aria-valuenow={columnWidths[column]}
        tabIndex={0}
        onMouseDown={startResize(column)}
        onDoubleClick={() => autoFitColumn(column)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            resizeColumnBy(column, -RESIZE_KEYBOARD_STEP);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            resizeColumnBy(column, RESIZE_KEYBOARD_STEP);
          }
        }}
      />
    </th>
  );

  const bodyCell = (column: ColumnKey, content: ReactNode, props?: { header?: boolean }) =>
    props?.header ? (
      <th scope="row" data-column={column}>
        {content}
      </th>
    ) : (
      <td data-column={column}>{content}</td>
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
          <colgroup>
            {COLUMN_ORDER.map((column) => (
              <col key={column} style={{ width: `${columnWidths[column]}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {headerCell(
                "Company",
                textFilter("company", "Company", companySuggestions),
                "company",
                "company",
              )}
              {headerCell("Role", textFilter("role", "Role"), "role", "role")}
              {headerCell(
                "Source",
                textFilter("source", "Source", sourceSuggestions),
                "source",
                "source",
              )}
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
                "state",
              )}
              {headerCell(
                "Next action",
                textFilter("next_action", "Next action"),
                "next_action",
                "next_action",
              )}
              {headerCell("Invites", textFilter("invites", "Invites"), "invites", "invites")}
              {headerCell(
                "Deadline",
                textFilter("deadline_at", "Deadline"),
                "deadline_at",
                "deadline_at",
              )}
              {headerCell("Urgency", textFilter("urgency", "Urgency"), "urgency", "urgency")}
              {headerCell(
                "Preference",
                textFilter("preference", "Preference"),
                "preference",
                "preference",
              )}
              {headerCell(
                "Compensation",
                textFilter("compensation", "Compensation"),
                "compensation",
                "compensation",
              )}
              {headerCell("Attachments", textFilter("attachments", "Attachments"), "attachments")}
              {headerCell("Prep notes", null, "prep_notes")}
              {headerCell(
                "Created",
                textFilter("created_at", "Created"),
                "created_at",
                "created_at",
              )}
              {headerCell(
                "Last update",
                textFilter("updated_at", "Last update"),
                "updated_at",
                "updated_at",
              )}
            </tr>
          </thead>
          <tbody>
            {visibleApplications.map((application) => (
              <tr key={application.id}>
                {bodyCell(
                  "company",
                  <button type="button" className="table-link" onClick={() => onOpen(application.id)}>
                    {application.company}
                  </button>,
                  { header: true },
                )}
                {bodyCell("role", application.role || <span aria-label="Not set">—</span>)}
                {bodyCell("source", application.source || <span aria-label="Not set">—</span>)}
                {bodyCell(
                  "state",
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
                  </select>,
                )}
                {bodyCell(
                  "next_action",
                  application.next_action?.trim() ? (
                    <>
                      <span>{application.next_action}</span>
                      {application.next_action_at ? (
                        <time className="table-view__date" dateTime={application.next_action_at}>
                          {formatShortDate(application.next_action_at)}
                        </time>
                      ) : null}
                      <CompleteActionButton
                        application={application}
                        onCompleteAction={onCompleteAction}
                        variant="table"
                      />
                    </>
                  ) : (
                    <span aria-label="Not set">—</span>
                  ),
                )}
                {bodyCell(
                  "invites",
                  application.state_events.length > 0 ? (
                    <InviteSummaries invites={application.state_events} />
                  ) : (
                    <span aria-label="Not set">—</span>
                  ),
                )}
                {bodyCell(
                  "deadline_at",
                  application.deadline_at ? (
                    <time dateTime={application.deadline_at}>
                      {formatShortDate(application.deadline_at)}
                    </time>
                  ) : (
                    <span aria-label="Not set">—</span>
                  ),
                )}
                {bodyCell(
                  "urgency",
                  urgencyById.has(application.id) ? (
                    <span className="table-view__urgency">
                      {urgencyById.get(application.id)!.reason}
                    </span>
                  ) : (
                    <span aria-label="Not ranked">—</span>
                  ),
                )}
                {bodyCell(
                  "preference",
                  preferenceById.has(application.id) ? (
                    <span className="table-view__urgency">
                      {describePreference(preferenceById.get(application.id)!)}
                    </span>
                  ) : (
                    <span aria-label="Not rated">—</span>
                  ),
                )}
                {bodyCell(
                  "compensation",
                  compensationById.has(application.id) ? (
                    <span className="table-view__urgency">
                      {compensationById.get(application.id)}
                    </span>
                  ) : (
                    <span aria-label="Not recorded">—</span>
                  ),
                )}
                {bodyCell(
                  "attachments",
                  application.attachments.length > 0 ? (
                    <AttachmentFilenames attachments={application.attachments} variant="table" />
                  ) : (
                    <span aria-label="Not set">—</span>
                  ),
                )}
                {bodyCell(
                  "prep_notes",
                  <StageNotesButton
                    application={application}
                    onOpenStageNotes={onOpenStageNotes}
                    variant="table"
                  />,
                )}
                {bodyCell(
                  "created_at",
                  <time dateTime={application.created_at}>{formatShortDate(application.created_at)}</time>,
                )}
                {bodyCell(
                  "updated_at",
                  <time dateTime={application.updated_at}>{formatShortDate(application.updated_at)}</time>,
                )}
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
