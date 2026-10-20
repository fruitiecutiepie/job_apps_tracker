import { Trash2 } from 'lucide-react'
import { fromDateTimeInput, toDateTimeInput } from './dateInput'
import { statusLabel } from './domain'
import { formatSpan, stageTimeline } from './stageTimeline'
import type { StageHistoryRow } from './stageHistoryRows'
import { formatShortDate } from './views/viewUtils'

const LATEST = '9999-12-31T23:59'

interface StageHistoryProps {
  rows: StageHistoryRow[]
  onChange: (rows: StageHistoryRow[]) => void
}

/**
 * Every stage and outcome this application has moved through, oldest first: the order is
 * the story, so the list is an `<ol>` and where it stands now sits last, next to the Stage
 * and Outcome selects that change it. The spans are derived on render rather than stored.
 *
 * A move can be dated again or removed, as a draft like every other control in the form —
 * nothing is written until Save. The last entry can be neither removed nor dated before the
 * one ahead of it: it is where the application stands, and the record has to end there.
 */
export function StageHistory({ rows, onChange }: StageHistoryProps) {
  if (rows.length === 0) return null
  const ordered = [...rows].sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
  const entries = stageTimeline(ordered.map((row) => ({ ...row.entry, at: row.at })))

  return (
    <div className="field field--wide stage-history">
      <span id="stage-history-label">History</span>

      <ol aria-labelledby="stage-history-label" className="stage-history__list">
        {entries.map((entry, index) => {
          const row = ordered[index]!
          const label = statusLabel(row.entry)
          const span = formatSpan(entry)
          const earlier = ordered[index - 1]
          const later = ordered[index + 1]
          return (
            <li
              className={`stage-history__entry${entry.current ? ' stage-history__entry--current' : ''}`}
              key={`${row.entry.at}-${row.entry.stage}-${row.entry.outcome}`}
            >
              <span className="stage-history__what">
                <span className="stage-history__stage">{entry.label}</span>
                {span && <span className="stage-history__span">{span}</span>}
              </span>
              <span className="stage-history__controls">
                <input
                  aria-label={`Date of ${label}, ${formatShortDate(row.entry.at)}`}
                  className="stage-history__date"
                  // The record has to keep ending where the application stands, so the last
                  // move cannot be dated before the one ahead of it, or the one ahead after it.
                  // The last still gets a ceiling: without one the browser sizes the box for a
                  // six-digit year, and its date stops lining up with the rest.
                  max={later ? toDateTimeInput(later.at) : LATEST}
                  min={entry.current && earlier ? toDateTimeInput(earlier.at) : undefined}
                  onChange={(event) => {
                    const at = fromDateTimeInput(event.target.value)
                    if (!at) return
                    onChange(rows.map((item) => (item === row ? { ...item, at } : item)))
                  }}
                  required
                  type="datetime-local"
                  value={toDateTimeInput(row.at)}
                />
                {entry.current ? (
                  // Holds the Delete's width so the current move's date lines up with the rest.
                  <span aria-hidden="true" className="stage-history__delete-slot" />
                ) : (
                  <button
                    aria-label={`Delete ${label}, ${formatShortDate(row.entry.at)}, from history`}
                    className="button button--quiet stage-history__delete"
                    onClick={() => {
                      // Asks even though Save is what writes it: a move removed by mistake
                      // is easy to save along with everything else in the form.
                      if (!window.confirm(`Delete ${label} from this application's history? It is removed when you save.`)) return
                      onChange(rows.filter((item) => item !== row))
                    }}
                    title="Delete this move"
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
