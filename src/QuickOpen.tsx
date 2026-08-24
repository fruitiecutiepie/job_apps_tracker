import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { StateId } from './domain'
import { fuzzyScore } from './quickOpenMatch'

export interface QuickOpenEntry {
  id: StateId
  label: string
  /** Whether the panel is already showing this stage, so picking it only switches tab. */
  open: boolean
}

interface QuickOpenProps {
  entries: readonly QuickOpenEntry[]
  onPick: (state: StateId) => void
  onClose: () => void
}

/**
 * The stage picker, opened with Ctrl+P. It reaches every stage rather than only the ones
 * already on screen, which is how notes get written for a stage the application has not
 * reached yet.
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
      if (active) onPick(active.id)
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
        placeholder="Go to stage…"
        ref={inputRef}
        type="text"
        value={query}
      />
      {matches.length === 0 ? (
        <p className="quick-open__empty">No stage matches that.</p>
      ) : (
        <ul aria-label="Stages" className="quick-open__list">
          {matches.map((entry) => (
            <li key={entry.id}>
              <button
                className={`quick-open__entry${entry === active ? ' quick-open__entry--active' : ''}`}
                onClick={() => onPick(entry.id)}
                type="button"
              >
                <span className="quick-open__label">{entry.label}</span>
                {entry.open ? <span className="quick-open__badge">Open</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
