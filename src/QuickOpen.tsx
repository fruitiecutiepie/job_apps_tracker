import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { fuzzyScore } from './quickOpenMatch'

export interface QuickOpenStageOption {
  /** What picking this option opens: a note's key. */
  id: string
  label: string
  /** Whether the panel is already showing this stage, so picking it only switches tab. */
  open: boolean
}

export interface QuickOpenEntry {
  /** The application, not a stage: one row per (company, role) keeps the list the length
   *  of the applications rather than the length of every stage any of them could reach. */
  id: string
  /** Rows for the same company group under one heading rather than repeating it. */
  company: string
  role: string
  /** Every stage this application can reach, offered on its row's stage menu. */
  stages: readonly QuickOpenStageOption[]
  /** What the row itself opens: the application's current stage, the one most likely
   *  wanted, so reaching it costs one click or Enter rather than a trip through a menu. */
  defaultStageId: string
}

interface QuickOpenProps {
  entries: readonly QuickOpenEntry[]
  onPick: (id: string) => void
  onClose: () => void
}

/**
 * The note picker, opened with Ctrl+P. It reaches every stage of every application rather
 * than only the ones already on screen, which is how notes get written for a stage an
 * application has not reached yet, and how a second company's notes get into the panel.
 */
export function QuickOpen({ entries, onPick, onClose }: QuickOpenProps) {
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const matches = useMemo(() => {
    const scored = entries
      .map((entry, index) => ({
        entry,
        index,
        score: fuzzyScore(`${entry.company} ${entry.role}`, query),
      }))
      .filter((row): row is { entry: QuickOpenEntry; index: number; score: number } => row.score !== null)
    scored.sort((left, right) => left.score - right.score || left.index - right.index)
    return scored.map((row) => row.entry)
  }, [entries, query])

  // Grouped by company without disturbing the match order above: a Map remembers each
  // key's first insertion, so the group with the best-scoring role still sorts first.
  const groups = useMemo(() => {
    const byCompany = new Map<string, QuickOpenEntry[]>()
    for (const entry of matches) {
      const rows = byCompany.get(entry.company) ?? []
      rows.push(entry)
      byCompany.set(entry.company, rows)
    }
    return [...byCompany.entries()].map(([company, rows]) => ({ company, rows }))
  }, [matches])

  const active = matches[Math.min(highlighted, matches.length - 1)]

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (active) onPick(active.defaultStageId)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    if (matches.length === 0) return
    const step = event.key === 'ArrowDown' ? 1 : -1
    setHighlighted((current) => {
      const next = Math.min(current, matches.length - 1) + step
      return (next + matches.length) % matches.length
    })
  }

  return (
    <div className="quick-open">
      <input
        aria-label="Go to stage"
        className="quick-open__input"
        onChange={(event) => {
          setQuery(event.target.value)
          setHighlighted(0)
        }}
        onKeyDown={onKeyDown}
        placeholder="Search company or role…"
        ref={inputRef}
        type="text"
        value={query}
      />
      {matches.length === 0 ? (
        <p className="quick-open__empty">No application matches that.</p>
      ) : (
        <ul aria-label="Applications" className="quick-open__list">
          {groups.map((group) => (
            <li className="quick-open__group" key={group.company}>
              <p className="quick-open__company">{group.company}</p>
              <ul className="quick-open__roles">
                {group.rows.map((entry) => {
                  const isActive = entry === active
                  const isDefaultOpen = entry.stages.find(
                    (stage) => stage.id === entry.defaultStageId,
                  )?.open

                  return (
                    <li
                      className={`quick-open__role${isActive ? ' quick-open__role--active' : ''}`}
                      key={entry.id}
                    >
                      <button
                        className="quick-open__role-button"
                        onClick={() => onPick(entry.defaultStageId)}
                        onFocus={() => setHighlighted(matches.indexOf(entry))}
                        type="button"
                      >
                        {entry.role}
                        {isDefaultOpen ? <span className="quick-open__badge">Open</span> : null}
                      </button>
                      <span className="quick-open__stage-trigger">
                        <ChevronDown aria-hidden="true" size={14} />
                        <select
                          aria-label={`Other stages for ${entry.company}, ${entry.role}`}
                          className="quick-open__stage-select"
                          onChange={(event) => {
                            const stageId = event.target.value
                            if (stageId) onPick(stageId)
                          }}
                          onFocus={() => setHighlighted(matches.indexOf(entry))}
                          value=""
                        >
                          <option disabled value="">
                            Other stages…
                          </option>
                          {entry.stages.map((stage) => (
                            <option key={stage.id} value={stage.id}>
                              {stage.label}
                              {stage.open ? ' — Open' : ''}
                            </option>
                          ))}
                        </select>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
