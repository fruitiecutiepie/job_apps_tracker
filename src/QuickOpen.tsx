import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
  /** "company, role", since the stage is not on this label at all. */
  label: string
  /** Every stage this application can reach, offered as a dropdown on its row. */
  stages: readonly QuickOpenStageOption[]
  /** What Enter opens on this row without touching its dropdown: the application's
   *  current stage, the one most likely wanted. */
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
      .map((entry, index) => ({ entry, index, score: fuzzyScore(entry.label, query) }))
      .filter((row): row is { entry: QuickOpenEntry; index: number; score: number } => row.score !== null)
    scored.sort((left, right) => left.score - right.score || left.index - right.index)
    return scored.map((row) => row.entry)
  }, [entries, query])

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
          {matches.map((entry) => (
            <li
              className={`quick-open__entry${entry === active ? ' quick-open__entry--active' : ''}`}
              key={entry.id}
            >
              <span className="quick-open__label">{entry.label}</span>
              <select
                aria-label={`${entry.label} stage`}
                className="quick-open__stage"
                onChange={(event) => {
                  const stageId = event.target.value
                  if (stageId) onPick(stageId)
                }}
                onFocus={() => setHighlighted(matches.indexOf(entry))}
                value=""
              >
                <option disabled value="">
                  Go to a stage…
                </option>
                {entry.stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.label}
                    {stage.open ? ' — Open' : ''}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
