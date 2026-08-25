import { formatShortDate } from './views/viewUtils'

/**
 * A completed action as the editor holds it. `key` is local to this render and never stored:
 * an entry that has not been saved yet has no id, and keying by index would let removing one
 * row shift the identity of every row after it.
 */
export interface CompletedActionRow {
  key: string
  id?: string
  action: string
  at: string
}

interface CompletedActionFieldsProps {
  rows: CompletedActionRow[]
  onChange: (rows: CompletedActionRow[]) => void
}

/**
 * The record of next actions carried out, kept apart from Notes because the two are written
 * differently: Notes is prose you compose, while these are lines the app writes when you press
 * Done. Newest first — what you did last is what you are most likely to be checking.
 *
 * Read-only apart from Remove. Entries arrive from the Done button on the Next action field,
 * which is where the task being resolved actually is; this section is where it lands.
 */
export function CompletedActionFields({ rows, onChange }: CompletedActionFieldsProps) {
  return (
    <div className="field field--wide completed-field">
      <span>Completed actions</span>

      {rows.length === 0 ? (
        <p className="empty-inline">No action has been marked done yet.</p>
      ) : (
        <ul className="completed-field__list">
          {[...rows].reverse().map((row) => (
            <li className="completed-item" key={row.key}>
              <span className="completed-item__action">{row.action}</span>
              <time className="completed-item__date" dateTime={row.at}>
                {formatShortDate(row.at)}
              </time>
              <button
                aria-label={`Remove completed action ${row.action}`}
                className="button button--quiet"
                onClick={() => onChange(rows.filter((candidate) => candidate.key !== row.key))}
                type="button"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
