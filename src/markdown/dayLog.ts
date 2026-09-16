/**
 * Grouping dated records under the day they read as, which is the one rule the capture log and
 * the correspondence log must not disagree on. Everything below the heading differs between
 * them — a captured line is one line, a message is a block someone else wrote — so only this
 * is shared.
 *
 * Grouping is a consequence of what `day` returns, not of the timestamps: two records share a
 * heading exactly when they read as the same date to whoever is looking at them. That is also
 * what decides where one day ends, which is the caller's business rather than this module's.
 */

export interface DayGroup<T> {
  label: string
  entries: T[]
}

/** Groups records under their day, oldest first, without touching the array it was given. */
export function dayGroups<T extends { at: string }>(
  entries: readonly T[],
  day: (at: string) => string,
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  // Compared as instants rather than as strings: a timestamp a person supplied may carry an
  // offset, and `2026-08-21T09:00:00+10:00` sorts after `2026-08-20T23:00:00Z` lexically while
  // falling before it in fact.
  const ordered = [...entries].sort(
    (left, right) => Date.parse(left.at) - Date.parse(right.at) || left.at.localeCompare(right.at),
  )

  for (const entry of ordered) {
    const label = day(entry.at)
    const current = groups[groups.length - 1]
    if (current && current.label === label) {
      current.entries.push(entry)
    } else {
      groups.push({ label, entries: [entry] })
    }
  }

  return groups
}
