import type { Application, NextAction } from './types'

function instant(value: string | null): number | null {
  if (value === null) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * The order next actions are stored and shown in: dated soonest first, then undated. Tasks
 * that tie — two undated, or two on the same instant — keep the order they were listed in,
 * through a stable sort rather than an id tiebreak: ids minted in one millisecond do not
 * order themselves, and the order a reader typed the tasks in is the one worth keeping. The
 * mutations and the validator both sort through `sortedNextActions`, and because the
 * validator reads the array in the order it was stored, a document comes back exactly as it
 * was written rather than reporting a change that did not happen.
 *
 * Compared by parsed instant rather than by string, since a date written with an offset does
 * not sort lexically.
 */
export function compareNextActions(left: NextAction, right: NextAction): number {
  const leftAt = instant(left.at)
  const rightAt = instant(right.at)
  if (leftAt === rightAt) return 0
  if (leftAt === null) return 1
  if (rightAt === null) return -1
  return leftAt - rightAt
}

export function sortedNextActions(actions: NextAction[]): NextAction[] {
  return [...actions].sort(compareNextActions)
}

/** The soonest dated task, which is the one urgency, bands and date sorts read. */
export function scheduledNextAction(application: Application): NextAction | null {
  return application.next_actions.find((entry) => entry.at !== null) ?? null
}

/** Whether an application has any task still to do. */
export function hasNextAction(application: Application): boolean {
  return application.next_actions.length > 0
}
