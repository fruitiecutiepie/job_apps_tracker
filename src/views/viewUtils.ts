import { OUTCOME_IDS, STATE_CONFIG } from "../domain";
import type { Application, OutcomeId, StateEvent, StateId, Status } from "../domain";

export interface KanbanColumnGroup {
  state: StateId;
  /** The stage's running lane first, then one per way of ending that is on show. */
  lanes: Status[];
}

/**
 * One column per stage, and in it a lane per outcome. The running lane is always drawn
 * (when the filter admits it), because it is where a card is dragged to move it on; a lane
 * for a way of ending is drawn only once something ended that way, so nine stages do not
 * cost the board thirty-six mostly empty lanes. A filter naming one outcome draws that lane
 * everywhere, since asking for it is asking where it would be.
 *
 * Every lane drawn is its own drop target, so dragging onto "Interview 1 — Rejected" is the
 * same move End makes.
 */
export function kanbanColumnGroups(
  applications: readonly Application[],
  visibleStates?: readonly StateId[],
  visibleOutcomes: readonly OutcomeId[] = OUTCOME_IDS,
): KanbanColumnGroup[] {
  const stages = visibleStates ? new Set(visibleStates) : null;
  const held = new Set(applications.map((application) => `${application.state}:${application.outcome}`));
  const onlyOne = visibleOutcomes.length === 1;

  return STATE_CONFIG.flatMap(({ id: state }) => {
    if (stages && !stages.has(state)) return [];
    const lanes = visibleOutcomes
      .filter((outcome) => outcome === "active" || onlyOne || held.has(`${state}:${outcome}`))
      .map((outcome) => ({ state, outcome }));
    return lanes.length > 0 ? [{ state, lanes }] : [];
  });
}

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const timeOfDayFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function parseTimestamp(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatShortDate(value: string | null): string {
  if (!value) return "Not scheduled";
  const date = parseTimestamp(value);
  return date ? shortDateFormatter.format(date) : "Invalid date";
}

/**
 * The time of day a timestamp fell on, for a stamp read beside something already filed
 * under its date. It says nothing about which day it was: that is the caller's to say,
 * and repeating it on every line is what this is meant to avoid.
 */
export function formatTimeOfDay(value: string): string {
  const date = parseTimestamp(value);
  return date ? timeOfDayFormatter.format(date) : "Invalid date";
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

export function applicationAgeInDays(updatedAt: string, today: Date = new Date()): number {
  const updated = parseTimestamp(updatedAt)
  if (!updated) return 0
  return Math.max(0, localDayNumber(today) - localDayNumber(updated))
}

/**
 * The next invite worth showing on a card: soonest first, cancelled ones skipped,
 * and anything earlier today still counts — the same browser-local day boundary
 * the overdue grouping uses.
 */
/** Text a column filter can match against every invite on an application. */
export function inviteFilterText(invites: StateEvent[]): string {
  return invites
    .map((invite) =>
      [
        invite.summary,
        invite.location,
        formatShortDate(invite.starts_at),
        invite.cancelled ? "cancelled" : null,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");
}

export function upcomingStateEvent(
  application: Application,
  today: Date = new Date(),
): StateEvent | null {
  const from = startOfLocalDay(today).getTime();
  return (
    application.state_events
      .filter((event) => {
        if (event.cancelled) return false;
        const at = parseTimestamp(event.starts_at);
        return at !== null && at.getTime() >= from;
      })
      .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at))[0] ?? null
  );
}

