import type { Application } from "../domain";
import { classifyLifecycle, daysSinceLastMove } from "./urgency";

/**
 * Idle is a second axis, not a twentieth state: it qualifies an application's stage
 * without ever changing it, so an idle application stays in its own Kanban lane and
 * still moves wherever any other application can. Like urgency, it is derived view
 * state and never persisted — it depends on browser-local "today".
 */
export const IDLE_THRESHOLD_DAYS = 30;

export interface IdleStatus {
  days: number;
}

/**
 * Null when the application is not idle. Note that covers two different things — moved
 * recently, and finished — so a caller that needs to tell them apart should ask
 * `classifyLifecycle` itself rather than read this as "fresh".
 *
 * Silence is measured from the last stage change, never `updated_at`: any edit refreshes
 * that, so saving an invite or fixing a typo would reset the very quiet this names. The
 * threshold is inclusive, matching the stale thresholds, so exactly 30 days qualifies.
 */
export function idleStatusFor(application: Application, today: Date = new Date()): IdleStatus | null {
  // Rejected and closed applications are finished, not idle. Counting them would mark
  // every old rejection and swamp the signal this exists to give.
  if (classifyLifecycle(application.state) !== "live") return null;
  if (application.state_history.length === 0) return null;

  const days = daysSinceLastMove(application, today);
  return days >= IDLE_THRESHOLD_DAYS ? { days } : null;
}

/**
 * The one place Idle phrasing is built, the way `describeDue` is the only place date
 * phrasing is built. The card and the table column both read it, so two views cannot
 * describe the same silence differently, and the column filter matches its own text.
 */
export function describeIdle(status: IdleStatus | null): string {
  if (!status) return "";
  return `Idle ${status.days === 1 ? "1 day" : `${status.days} days`}`;
}

export type IdleFilter = "all" | "idle" | "not_idle";

/** Not-idle is the complement, so a finished application falls in it rather than nowhere. */
export function idleFilterMatches(
  filter: IdleFilter,
  application: Application,
  today: Date = new Date(),
): boolean {
  if (filter === "all") return true;
  const idle = idleStatusFor(application, today) !== null;
  return filter === "idle" ? idle : !idle;
}
