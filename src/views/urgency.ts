import { STATE_CONFIG } from "../domain";
import type { Application, StateId } from "../domain";
import { applicationAgeInDays, isRejectedState, localDayNumber, parseTimestamp } from "./viewUtils";

/**
 * Urgency is derived view state, never persisted: it depends on browser-local "today"
 * and on weights that live in this module rather than in the tracker document.
 */
export type Lifecycle = "live" | "rejected" | "closed";

const CLOSED_STATES = new Set<StateId>(["accepted", "no_openings"]);

/** View-only grouping. It never restricts moves; any state can still move to any other. */
export function classifyLifecycle(state: StateId): Lifecycle {
  if (isRejectedState(state)) return "rejected";
  if (CLOSED_STATES.has(state)) return "closed";
  return "live";
}

/**
 * Position within the live stages only. The configured order interleaves live and
 * rejected states, so the raw STATE_CONFIG index is not a progress measure.
 */
const LIVE_STATE_ORDER = new Map<StateId, number>(
  STATE_CONFIG.filter(({ id }) => classifyLifecycle(id) === "live").map(({ id }, index) => [
    id,
    index,
  ]),
);

export const DEADLINE_HORIZON_DAYS = 14;
export const ACTION_HORIZON_DAYS = 7;
export const STALE_GRACE_DAYS = 7;
export const STALE_PEAK_DAYS = 21;

const PASSED_DEADLINE_PRESSURE = 0.8;
const UNSCHEDULED_ACTION_PRESSURE = 0.2;
/**
 * Staleness is inferred ("this probably needs a nudge"), while a deadline and an overdue
 * action are facts, so it is capped below their ceiling and cannot outrank them.
 */
const STALE_MAX_PRESSURE = 0.6;
const STACKING_WEIGHT = 0.15;
const STAGE_FLOOR = 0.5;
/**
 * Equal scores can be reached by different arithmetic paths and land a float bit apart,
 * which would silently decide the order instead of the tiebreak below.
 */
const SCORE_EPSILON = 1e-9;

/** Which pressure won, so callers can group without parsing the reason text. */
export type UrgencyKind = "deadline" | "action" | "staleness" | "none";

export interface UrgencyRanking {
  application: Application;
  score: number;
  reason: string;
  kind: UrgencyKind;
  /** The date driving the winning pressure, when it has one. */
  dueAt: string | null;
}

interface PressureTerm {
  pressure: number;
  detail: string;
  kind: UrgencyKind;
  dueAt: string | null;
}

const NO_PRESSURE: PressureTerm = { pressure: 0, detail: "", kind: "none", dueAt: null };

function stageWeight(state: StateId): number {
  const ordinal = LIVE_STATE_ORDER.get(state);
  if (ordinal === undefined) return 0;
  return (ordinal + 1) / LIVE_STATE_ORDER.size;
}

/** Whole browser-local calendar days from today, so a time earlier today is still day 0. */
export function daysUntil(value: string, today: Date): number | null {
  const date = parseTimestamp(value);
  return date ? localDayNumber(date) - localDayNumber(today) : null;
}

function dayCount(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * The single source of date phrasing, shared by the pressure terms and by Focus, so a row
 * cannot describe a date one way while the score describes it another.
 */
export function describeDue(kind: "deadline" | "action", days: number): string {
  const subject = kind === "deadline" ? "Deadline" : "Action";
  if (days < 0) {
    return kind === "deadline"
      ? `Deadline passed ${dayCount(-days)} ago`
      : `Action overdue ${dayCount(-days)}`;
  }
  if (days === 0) return kind === "deadline" ? "Deadline today" : "Action due today";
  return `${subject} in ${dayCount(days)}`;
}

function deadlinePressure(application: Application, today: Date): PressureTerm {
  if (!application.deadline_at) return NO_PRESSURE;
  const days = daysUntil(application.deadline_at, today);
  if (days === null) return NO_PRESSURE;
  const term = {
    kind: "deadline" as const,
    dueAt: application.deadline_at,
    detail: describeDue("deadline", days),
  };
  if (days < 0) return { ...term, pressure: PASSED_DEADLINE_PRESSURE };
  if (days === 0) return { ...term, pressure: 1 };
  return { ...term, pressure: Math.max(0, 1 - days / DEADLINE_HORIZON_DAYS) };
}

function actionPressure(application: Application, today: Date): PressureTerm {
  if (!application.next_action?.trim()) return NO_PRESSURE;
  if (!application.next_action_at) {
    return {
      kind: "action",
      dueAt: null,
      pressure: UNSCHEDULED_ACTION_PRESSURE,
      detail: "Action not scheduled",
    };
  }
  const days = daysUntil(application.next_action_at, today);
  if (days === null) return NO_PRESSURE;
  const term = {
    kind: "action" as const,
    dueAt: application.next_action_at,
    detail: describeDue("action", days),
  };
  if (days <= 0) return { ...term, pressure: 1 };
  return { ...term, pressure: Math.max(0, 1 - days / ACTION_HORIZON_DAYS) };
}

/** Silence on a live application is pressure to nudge it, not a reason to rank it lower. */
function stalenessPressure(application: Application, today: Date): PressureTerm {
  const age = applicationAgeInDays(application.updated_at, today);
  const span = STALE_PEAK_DAYS - STALE_GRACE_DAYS;
  const ramp = Math.min(1, Math.max(0, (age - STALE_GRACE_DAYS) / span));
  return {
    kind: "staleness",
    dueAt: null,
    pressure: STALE_MAX_PRESSURE * ramp,
    detail: `No change for ${dayCount(age)}`,
  };
}

/**
 * Returns null for rejected and closed applications: they are not low-urgency, they
 * are finished, so they stay out of the ranking entirely.
 */
export function urgencyFor(application: Application, today: Date = new Date()): UrgencyRanking | null {
  if (classifyLifecycle(application.state) !== "live") return null;

  // Ordered by precedence, so an equal-pressure tie resolves to the external fact first.
  const terms = [
    deadlinePressure(application, today),
    actionPressure(application, today),
    stalenessPressure(application, today),
  ];
  const dominant = terms.reduce((best, term) => (term.pressure > best.pressure ? term : best));
  const total = terms.reduce((sum, term) => sum + term.pressure, 0);

  // The dominant pressure drives the score and the explanation. The others stack only into
  // the headroom above it, so urgency never reaches 1 unless a term genuinely does, and
  // several mild pressures cannot leapfrog one nearer deadline.
  const stacked = (1 - dominant.pressure) * STACKING_WEIGHT * (total - dominant.pressure);
  const urgency = dominant.pressure + stacked;
  const stage = STAGE_FLOOR + (1 - STAGE_FLOOR) * stageWeight(application.state);

  // A term can win with zero pressure (a deadline beyond the horizon and nothing else), so
  // kind and dueAt collapse to "none" alongside the reason rather than naming a dead term.
  const pressing = dominant.pressure > 0;

  return {
    application,
    score: urgency * stage,
    reason: pressing ? dominant.detail : "Nothing scheduled",
    kind: pressing ? dominant.kind : "none",
    dueAt: pressing ? dominant.dueAt : null,
  };
}

function timeValue(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  return parseTimestamp(value)?.getTime() ?? Number.POSITIVE_INFINITY;
}

/** Undated sorts last, and equal values compare equal rather than producing NaN. */
function compareTimes(left: string | null, right: string | null): number {
  const leftValue = timeValue(left);
  const rightValue = timeValue(right);
  if (leftValue === rightValue) return 0;
  return leftValue < rightValue ? -1 : 1;
}

/** Most urgent first, with a total tiebreak so the order is stable under filtering. */
export function rankByUrgency(
  applications: Application[],
  today: Date = new Date(),
): UrgencyRanking[] {
  return applications
    .map((application) => urgencyFor(application, today))
    .filter((ranking): ranking is UrgencyRanking => ranking !== null)
    .sort((left, right) => {
      if (Math.abs(left.score - right.score) > SCORE_EPSILON) return right.score - left.score;

      const byDeadline = compareTimes(left.application.deadline_at, right.application.deadline_at);
      if (byDeadline !== 0) return byDeadline;

      const byAction = compareTimes(
        left.application.next_action_at,
        right.application.next_action_at,
      );
      if (byAction !== 0) return byAction;

      const byUpdated = compareTimes(left.application.updated_at, right.application.updated_at);
      if (byUpdated !== 0) return byUpdated;

      return left.application.id.localeCompare(right.application.id);
    });
}
