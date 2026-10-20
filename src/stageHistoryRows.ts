import type { Application, StageHistoryEntry } from './domain'
import type { StageHistoryChange } from './domain/mutations'

/**
 * A recorded move as the editor holds it. `entry` is the move as stored when the form
 * opened and never changes; `at` is the date the form currently shows for it. A row the
 * reader removes is simply absent from the list.
 */
export interface StageHistoryRow {
  entry: StageHistoryEntry
  at: string
}

export function stageHistoryRowsFor(application: Application | null): StageHistoryRow[] {
  return (application?.stage_history ?? []).map((entry) => ({ entry, at: entry.at }))
}

/** What the form changed against the history it opened with: a new date, or `null` for a removal. */
export function stageHistoryChanges(
  opened: Application,
  rows: StageHistoryRow[],
): StageHistoryChange[] {
  const changes: StageHistoryChange[] = []
  for (const entry of opened.stage_history) {
    const row = rows.find((candidate) => candidate.entry === entry)
    if (!row) changes.push({ entry, at: null })
    else if (row.at !== entry.at) changes.push({ entry, at: row.at })
  }
  return changes
}
