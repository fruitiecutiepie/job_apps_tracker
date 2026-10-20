import { fromDateTimeInput, toDateTimeInput } from './dateInput'
import { createUuidV7, type Application, type NextActionDraft } from './domain'

/**
 * A next action as the editor holds it. `key` is local to this render and never stored: a
 * task that has not been saved yet has no id, and keying by index would let removing one row
 * shift the identity of every row after it. `at` is `datetime-local` wall time.
 */
export interface NextActionRow {
  key: string
  id?: string
  action: string
  at: string
}

export function blankRow(): NextActionRow {
  return { key: createUuidV7(), action: '', at: '' }
}

/** The stored tasks as rows, or one blank row to type into when there are none. */
export function nextActionRowsFor(application: Application | null): NextActionRow[] {
  const rows = (application?.next_actions ?? []).map((entry) => ({
    key: entry.id,
    id: entry.id,
    action: entry.action,
    at: toDateTimeInput(entry.at),
  }))
  return rows.length > 0 ? rows : [blankRow()]
}

/**
 * Rows as drafts. A blank row is simply dropped by the mutation, which is how the one blank
 * row a form always shows stays out of the document, and a date typed beside no task goes
 * with it.
 */
export function nextActionDrafts(rows: NextActionRow[]): NextActionDraft[] {
  return rows.map(({ id, action, at }) => ({
    id,
    action,
    at: action.trim() ? fromDateTimeInput(at) : null,
  }))
}
