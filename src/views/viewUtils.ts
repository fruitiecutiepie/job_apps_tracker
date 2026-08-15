import { rejectedStateFor, STATE_CONFIG } from "../domain";
import type { StateId } from "../domain";

export interface KanbanColumnGroup {
  lanes: StateId[];
}

const REJECTED_COUNTERPARTS = new Set(
  STATE_CONFIG.map(({ id }) => rejectedStateFor(id)).filter((id): id is StateId => id !== null),
);

export function kanbanColumnGroups(visibleStates?: readonly StateId[]): KanbanColumnGroup[] {
  if (visibleStates) {
    const visible = new Set(visibleStates);
    return STATE_CONFIG.filter(({ id }) => visible.has(id)).map(({ id }) => ({ lanes: [id] }));
  }

  return STATE_CONFIG.reduce<KanbanColumnGroup[]>((groups, { id }) => {
    if (REJECTED_COUNTERPARTS.has(id)) return groups;

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

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
