import { STATE_CONFIG } from './domain'
import type { StateHistoryEntry, StateId } from './domain'
import { localDayNumber, parseTimestamp } from './views/viewUtils'

const LABELS = new Map<StateId, string>(STATE_CONFIG.map(({ id, label }) => [id, label]))

export interface TimelineEntry {
  state: StateId
  label: string
  at: string
  /** Whole local days between this move and the next one, or `null` when a timestamp is unreadable. */
  days: number | null
  /** The last entry: the application is still in this state, so its span is still running. */
  current: boolean
}

/**
 * `state_history` read as spans rather than instants. A move records when a state was
 * entered; how long it then held is the difference to the next move, and for the last
 * entry the difference to now — which is why this is derived on render and never stored.
 *
 * Days are counted in browser-local days, the same measure staleness and overdue grouping
 * use, so two moves on one day read as no elapsed days rather than as a rounded fraction.
 */
export function stateTimeline(
  history: readonly StateHistoryEntry[],
  now: Date = new Date(),
): TimelineEntry[] {
  return history.map((entry, index) => {
    const next = history[index + 1]
    const to = next === undefined ? now : parseTimestamp(next.at)
    return {
      state: entry.state,
      label: LABELS.get(entry.state) ?? entry.state,
      at: entry.at,
      days: daysBetween(entry.at, to),
      current: next === undefined,
    }
  })
}

function daysBetween(from: string, to: Date | null): number | null {
  const start = parseTimestamp(from)
  if (!start || !to) return null
  return Math.max(0, localDayNumber(to) - localDayNumber(start))
}

/**
 * How long a span held, in words. A move on the same day spent no days in the state
 * before it, and the state still running says so rather than reading as settled.
 */
export function formatSpan(entry: TimelineEntry): string | null {
  if (entry.days === null) return null
  if (entry.current) return entry.days === 0 ? 'Today' : `${dayCount(entry.days)} so far`
  return entry.days === 0 ? 'Same day' : dayCount(entry.days)
}

function dayCount(days: number): string {
  return days === 1 ? '1 day' : `${days} days`
}
