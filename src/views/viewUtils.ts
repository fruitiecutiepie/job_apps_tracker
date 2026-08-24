import { rejectedStateFor, STATE_CONFIG } from "../domain";
import type { Application, StateEvent, StateId } from "../domain";

export interface KanbanColumnGroup {
  lanes: StateId[];
}

const REJECTED_COUNTERPARTS = new Set(
  STATE_CONFIG.map(({ id }) => rejectedStateFor(id)).filter((id): id is StateId => id !== null),
);

export function isRejectedState(state: StateId): boolean {
  return REJECTED_COUNTERPARTS.has(state);
}

export function kanbanColumnGroups(visibleStates?: readonly StateId[]): KanbanColumnGroup[] {
  if (visibleStates) {
    const visible = new Set(visibleStates);
    return STATE_CONFIG.filter(({ id }) => visible.has(id)).map(({ id }) => ({ lanes: [id] }));
  }

  return STATE_CONFIG.reduce<KanbanColumnGroup[]>((groups, { id }) => {
    if (isRejectedState(id)) return groups;

    const lanes: StateId[] = [id];
    const rejected = rejectedStateFor(id);
    if (rejected) lanes.push(rejected);
    groups.push({ lanes });
    return groups;
  }, []);
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

const longDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
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

export function formatLongDate(date: Date): string {
  return longDateFormatter.format(date);
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

export const DEFAULT_STALE_THRESHOLD_DAYS = 14

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

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
