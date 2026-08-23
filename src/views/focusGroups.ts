import { STATE_LABELS } from "../domain";
import type { Application } from "../domain";
import { preferenceFor } from "./preference";
import {
  SCORE_EPSILON,
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
 * What the group has already decided about a row, so the comparator below reads as one
 * chain rather than three passes over the same list.
 */
interface Entry {
  row: FocusRow;
  /** Days to the driving date; only a chronological group reads it. */
  days: number;
  /** The urgency score, or 0 for a finished application that was never ranked. */
  score: number;
  /** Derived here and used only for order — never folded into `score`. */
  preference: number | null;
}

/**
 * Higher preference first, with unjudged last among otherwise tied rows: the same treatment
 * the table's Preference column gives a null, because never rated is not the same as rated
 * badly. Total and transitive on purpose — returning 0 against a null would make the order
 * depend on which pairs the sort happened to compare.
 */
function byPreference(left: Entry, right: Entry): number {
  if (left.preference === right.preference) return 0;
  if (left.preference === null) return 1;
  if (right.preference === null) return -1;
  return right.preference - left.preference;
}

/**
 * The within-group order, with preference appended to the end of the chain it already had.
 *
 * The group's own rule comes first, so a schedule stays a schedule and an alphabetical group
 * stays alphabetical. Then the urgency score, unchanged — preference is never added to or
 * multiplied into it, and cannot overturn it. Only where the score is already tied, where
 * the ranking would otherwise fall back to a deadline timestamp, an age or an id, does
 * preference get to speak. So its effect is invisible until enough rows are rated to tie.
 */
function compareWithin(label: Omit<FocusGroup, "rows">, chronological: boolean) {
  return (left: Entry, right: Entry): number => {
    // No group is both chronological and alphabetical, and `nudge` is neither: its rule *is*
    // ranked order, so it falls straight through to the score below.
    if (chronological) {
      if (left.days !== right.days) return left.days - right.days;
    } else if (!label.ordered) {
      const byName = byCompany(left.row, right.row);
      if (byName !== 0) return byName;
    }

    if (Math.abs(left.score - right.score) > SCORE_EPSILON) return right.score - left.score;
    return byPreference(left, right);
  };
}

/**
 * Groups live applications by an explicit rule per group, so each heading states its own
 * membership test. Ordering within a group still comes from the urgency ranking, except
 * where a date makes chronological order the honest reading, with preference appended to the
 * end of that chain as a tiebreak.
 *
 * Finished applications are never ranked, but a task left on one is still a task, so they
 * get a trailing group instead of disappearing.
 */
export function focusGroups(applications: Application[], today: Date = new Date()): FocusGroup[] {
  const ranked = rankByUrgency(applications, today);
  const rankedIds = new Set(ranked.map(({ application }) => application.id));

  const grouped = new Map<FocusGroupId, Entry[]>(GROUP_LABELS.map(({ id }) => [id, []]));

  for (const ranking of ranked) {
    const driving = drivingDate(ranking.application, today);
    grouped.get(placementFor(ranking.application, driving, today))!.push({
      row: {
        application: ranking.application,
        // A dated row describes its date; an undated one keeps the score's explanation.
        reason: driving ? describeDue(driving.kind, driving.days) : ranking.reason,
      },
      days: driving?.days ?? 0,
      score: ranking.score,
      preference: preferenceFor(ranking.application)?.score ?? null,
    });
  }

  for (const application of applications) {
    if (rankedIds.has(application.id) || !application.next_action?.trim()) continue;
    grouped.get("wrapping_up")!.push({
      row: { application, reason: STATE_LABELS[application.state] },
      days: 0,
      // Finished applications are never ranked, so they all tie and the group's own rule
      // decides, with preference behind it as everywhere else.
      score: 0,
      preference: preferenceFor(application)?.score ?? null,
    });
  }

  return GROUP_LABELS.map((label) => {
    const entries = grouped.get(label.id)!;
    const chronological = label.id === "due_now" || label.id === "due_week" || label.id === "due_later";

    entries.sort(compareWithin(label, chronological));

    return { ...label, rows: entries.map(({ row }) => row) };
  });
}
