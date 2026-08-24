import { CircleCheck } from 'lucide-react'

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
  /** The draft next action, so Done knows whether there is anything to resolve. */
  nextAction: string
  onComplete: () => void
  onChange: (rows: CompletedActionRow[]) => void
}

/**
 * The record of next actions carried out, kept apart from Notes because the two are written
 * differently: Notes is prose you compose, while these are lines the app writes when you press
 * Done. Newest first — what you did last is what you are most likely to be checking.
 *
 * Done lives here rather than beside the Next action input so that pressing it shows the entry
 * appearing in the list directly below, and because a button inside a field's `label` would
 * fight the label for the click. Nothing is written until the dialog is saved, which is what
 * every other control in this form does.
 */
export function CompletedActionFields({
  rows,
  nextAction,
  onComplete,
  onChange,
}: CompletedActionFieldsProps) {
  const pending = nextAction.trim()

  return (
    <div className="field field--wide completed-field">
      <div className="completed-field__head">
        <span>Completed actions</span>
        <button
          className="button button--quiet"
          disabled={!pending}
          onClick={onComplete}
          title={pending ? undefined : 'Set a next action to mark one done'}
          type="button"
        >
          <CircleCheck aria-hidden="true" size={14} />
          <span>Mark next action done</span>
        </button>
      </div>

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
