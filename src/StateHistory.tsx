import type { StateHistoryEntry } from './domain'
import { formatSpan, stateTimeline } from './stateTimeline'
import { formatShortDate } from './views/viewUtils'

interface StateHistoryProps {
  history: readonly StateHistoryEntry[]
}

/**
 * Every state this application has moved through, oldest first: the order is the story,
 * so the list is an `<ol>` and the current state sits last, next to the State select that
 * changes it. It is a record, not a field — nothing here is editable, and the spans are
 * derived on render rather than stored.
 */
export function StateHistory({ history }: StateHistoryProps) {
  if (history.length === 0) return null
  const entries = stateTimeline(history)

  return (
    <div className="field field--wide state-history">
      <span id="state-history-label">History</span>

      <ol aria-labelledby="state-history-label" className="state-history__list">
        {entries.map((entry) => {
          const span = formatSpan(entry)
          return (
            <li
              className={`state-history__entry${entry.current ? ' state-history__entry--current' : ''}`}
              key={`${entry.at}-${entry.state}`}
            >
              <span className="state-history__state">{entry.label}</span>
              <time className="state-history__date" dateTime={entry.at}>
                {formatShortDate(entry.at)}
              </time>
              {span && <span className="state-history__span">{span}</span>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
