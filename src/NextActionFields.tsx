import { CircleCheck, Plus, Trash2 } from 'lucide-react'
import { blankRow, type NextActionRow } from './nextActionRows'

interface NextActionFieldsProps {
  rows: NextActionRow[]
  onChange: (rows: NextActionRow[]) => void
  /** Moves one task to the completed actions; like every control here, a draft until saved. */
  onComplete: (action: string) => void
}

/**
 * Every task still to do, one row each: the task, its date, then Done and Delete — the
 * controls follow the fields they act on, so a row reads in the order you fill it in. The
 * buttons are siblings of the inputs rather than inside a label: a label hands its click to
 * the first labelable thing it wraps, which would make which control you hit depend on the
 * browser.
 *
 * The column headings are written once above the rows rather than on every row, and each
 * control carries its position in its accessible name instead, so two rows never share a
 * name. Removing the last task leaves a blank row rather than no field at all: a form with
 * nothing to type a task into would need a press on Add before the first keystroke.
 */
export function NextActionFields({ rows, onChange, onComplete }: NextActionFieldsProps) {
  const update = (key: string, patch: Partial<NextActionRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  const without = (key: string) => {
    const kept = rows.filter((row) => row.key !== key)
    onChange(kept.length > 0 ? kept : [blankRow()])
  }

  return (
    <div aria-labelledby="next-actions-heading" className="field field--wide next-action-field" role="group">
      <span id="next-actions-heading">Next actions</span>
      <div className="next-action-field__grid">
        <div aria-hidden="true" className="next-action-field__heads">
          <span>Task</span>
          <span>Date</span>
        </div>
        <ol className="next-action-field__list">
          {rows.map((row, index) => {
            const position = index + 1
            const empty = !row.action.trim()
            return (
              <li className="next-action-field__row" key={row.key}>
                <input
                  aria-label={`Next action ${position}`}
                  onChange={(event) => update(row.key, { action: event.target.value })}
                  placeholder="Follow up, prepare, send…"
                  value={row.action}
                />
                <input
                  aria-label={`Date for next action ${position}`}
                  disabled={empty}
                  onChange={(event) => update(row.key, { at: event.target.value })}
                  type="datetime-local"
                  value={row.at}
                />
                <button
                  aria-label={`Mark next action ${position} done`}
                  className="button button--quiet"
                  disabled={empty}
                  onClick={() => {
                    const action = row.action.trim()
                    if (!action) return
                    onComplete(action)
                    without(row.key)
                  }}
                  title={empty ? 'Set a next action to mark one done' : 'Mark next action done'}
                  type="button"
                >
                  <CircleCheck aria-hidden="true" size={14} />
                </button>
                <button
                  aria-label={`Delete next action ${position}`}
                  className="button button--quiet"
                  disabled={empty}
                  // Drops the row and records nothing: the task is not happening, rather than
                  // done. Like Done, nothing is written until the dialog is saved.
                  onClick={() => without(row.key)}
                  title={empty ? 'Set a next action to delete one' : 'Delete next action'}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={14} />
                </button>
              </li>
            )
          })}
        </ol>
      </div>
      <div>
        <button
          className="button button--quiet"
          onClick={() => onChange([...rows, blankRow()])}
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
          Add next action
        </button>
      </div>
    </div>
  )
}
