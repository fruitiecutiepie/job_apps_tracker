import type { StageHistoryEntry } from './domain'
import { formatSpan, stageTimeline } from './stageTimeline'
import { formatShortDate } from './views/viewUtils'

interface StageHistoryProps {
  history: readonly StageHistoryEntry[]
}

/**
 * Every stage and outcome this application has moved through, oldest first: the order is
 * the story, so the list is an `<ol>` and where it stands now sits last, next to the Stage
 * and Outcome selects that change it. It is a record, not a field — nothing here is editable, and the spans are
 * derived on render rather than stored.
 */
export function StageHistory({ history }: StageHistoryProps) {
  if (history.length === 0) return null
  const entries = stageTimeline(history)

  return (
    <div className="field field--wide stage-history">
      <span id="stage-history-label">History</span>

      <ol aria-labelledby="stage-history-label" className="stage-history__list">
        {entries.map((entry) => {
          const span = formatSpan(entry)
          return (
            <li
              className={`stage-history__entry${entry.current ? ' stage-history__entry--current' : ''}`}
              key={`${entry.at}-${entry.stage}-${entry.outcome}`}
            >
              <span className="stage-history__stage">{entry.label}</span>
              <time className="stage-history__date" dateTime={entry.at}>
                {formatShortDate(entry.at)}
              </time>
              {span && <span className="stage-history__span">{span}</span>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
