import { STATE_LABELS } from "../domain";
import type { Application } from "../domain";
import {
  STALE_GRACE_DAYS,
  daysSinceLastMove,
  daysUntil,
  describeDue,
  rankByUrgency,
  type DueKind,
} from "./urgency";
import { upcomingStateEvent } from "./viewUtils";

export type FocusGroupId =
  | "due_now"
  | "due_week"
  | "due_later"
  | "no_date"
  | "nudge"
  | "quiet"
  | "wrapping_up";

export const DUE_SOON_DAYS = 7;

export interface FocusRow {
  application: Application;
  reason: string;
}

export interface FocusGroup {
  id: FocusGroupId;
  heading: string;
  emptyMessage: string;
  /**
   * True when a row's position carries meaning (a schedule, or oldest first). Groups sorted
   * alphabetically are unordered, and the markup says so.
   */
  ordered: boolean;
  rows: FocusRow[];
}

const GROUP_LABELS: readonly Omit<FocusGroup, "rows">[] = [
  {
    id: "due_now",
    heading: "Overdue or due today",
    emptyMessage: "Nothing is overdue or due today.",
    ordered: true,
  },
  {
    id: "due_week",
    heading: `Due in 1 to ${DUE_SOON_DAYS} days`,
    emptyMessage: "Nothing falls due this week.",
    ordered: true,
  },
  {
    id: "due_later",
    heading: `Due in more than ${DUE_SOON_DAYS} days`,
    emptyMessage: "Nothing is dated further out.",
    ordered: true,
  },
  {
    id: "no_date",
    heading: "Action with no date",
    emptyMessage: "Every action has a date.",
    ordered: false,
  },
  {
    id: "nudge",
    heading: `No stage change in more than ${STALE_GRACE_DAYS} days`,
    emptyMessage: "Nothing undated has gone quiet.",
    ordered: true,
  },
  {
    id: "quiet",
    heading: "Nothing dated or planned",
    emptyMessage: "Every live application has a date or an action.",
    ordered: false,
  },
  {
    id: "wrapping_up",
    heading: "Finished, action outstanding",
    emptyMessage: "No tasks left on finished applications.",
    ordered: false,
  },
];

interface DrivingDate {
  kind: DueKind;
  days: number;
}

/**
 * The nearest dated commitment, whichever field it came from. Placement uses the date
 * itself rather than the winning pressure, because pressure decays to zero past its horizon
 * and an action dated ten days out is still dated.
 */
function drivingDate(application: Application, today: Date): DrivingDate | null {
  const candidates: DrivingDate[] = [];

  const invite = upcomingStateEvent(application, today);
  if (invite) {
    const days = daysUntil(invite.starts_at, today);
    if (days !== null) candidates.push({ kind: "invite", days });
  }
  if (application.deadline_at) {
    const days = daysUntil(application.deadline_at, today);
    if (days !== null) candidates.push({ kind: "deadline", days });
  }
  if (application.next_action?.trim() && application.next_action_at) {
    const days = daysUntil(application.next_action_at, today);
    if (days !== null) candidates.push({ kind: "action", days });
  }

  return candidates.sort((left, right) => left.days - right.days)[0] ?? null;
}

function placementFor(
  application: Application,
  driving: DrivingDate | null,
  today: Date,
): FocusGroupId {
  if (driving) {
    if (driving.days <= 0) return "due_now";
    return driving.days <= DUE_SOON_DAYS ? "due_week" : "due_later";
  }
  // A named task takes precedence over silence: the task is the thing to look at.
  if (application.next_action?.trim()) return "no_date";
  // Same measure the staleness pressure uses, so placement and score cannot disagree.
  if (daysSinceLastMove(application, today) > STALE_GRACE_DAYS) return "nudge";
  return "quiet";
}

function byCompany(left: FocusRow, right: FocusRow): number {
  return left.application.company.localeCompare(right.application.company);
}

/**
 * Groups live applications by an explicit rule per group, so each heading states its own
 * membership test. Ordering within a group still comes from the urgency ranking, except
 * where a date makes chronological order the honest reading.
 *
 * Finished applications are never ranked, but a task left on one is still a task, so they
 * get a trailing group instead of disappearing.
 */
export function focusGroups(applications: Application[], today: Date = new Date()): FocusGroup[] {
  const ranked = rankByUrgency(applications, today);
  const rankedIds = new Set(ranked.map(({ application }) => application.id));

  const grouped = new Map<FocusGroupId, { row: FocusRow; days: number }[]>(
    GROUP_LABELS.map(({ id }) => [id, []]),
  );

  for (const ranking of ranked) {
    const driving = drivingDate(ranking.application, today);
    grouped.get(placementFor(ranking.application, driving, today))!.push({
      row: {
        application: ranking.application,
        // A dated row describes its date; an undated one keeps the score's explanation.
        reason: driving ? describeDue(driving.kind, driving.days) : ranking.reason,
      },
      days: driving?.days ?? 0,
    });
  }

  for (const application of applications) {
    if (rankedIds.has(application.id) || !application.next_action?.trim()) continue;
    grouped.get("wrapping_up")!.push({
      row: { application, reason: STATE_LABELS[application.state] },
      days: 0,
    });
  }

  return GROUP_LABELS.map((label) => {
    const entries = grouped.get(label.id)!;
    const chronological = label.id === "due_now" || label.id === "due_week" || label.id === "due_later";

    if (chronological) {
      entries.sort((left, right) => left.days - right.days);
    }

    const rows = entries.map(({ row }) => row);
    if (!label.ordered) rows.sort(byCompany);

    return { ...label, rows };
  });
}
