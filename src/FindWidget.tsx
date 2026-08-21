import { useEffect, useRef, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'

interface FindWidgetProps {
  query: string
  onQuery: (value: string) => void
  /** Total matches across every note the panel is showing in reading mode. */
  total: number
  /** Zero-based position in that list, or null when there is nothing to sit on. */
  current: number | null
  onNext: () => void
  onPrevious: () => void
  onClose: () => void
}

/**
 * The find bar, floating over the top-right of the notes area the way an editor's does.
 * Enter and Shift+Enter step through matches; Escape closes the bar rather than the
 * panel, which is why it stops the key from reaching the dialog's own Escape handler.
 */
export function FindWidget({
  query,
  onQuery,
  total,
  current,
  onNext,
  onPrevious,
  onClose,
}: FindWidgetProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (event.shiftKey) onPrevious()
    else onNext()
  }

  const status = !query
    ? ''
    : total === 0
      ? 'No results'
      : `${(current ?? 0) + 1} of ${total}`

  return (
    <div className="find-widget">
      <input
        aria-label="Find in notes"
        className="find-widget__input"
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find"
        ref={inputRef}
        type="text"
        value={query}
      />
      <output aria-live="polite" className="find-widget__count">
        {status}
      </output>
      <button
        aria-label="Previous match"
        className="icon-button find-widget__step"
        disabled={total === 0}
        onClick={onPrevious}
        type="button"
      >
        <ChevronUp aria-hidden="true" size={16} />
      </button>
      <button
        aria-label="Next match"
        className="icon-button find-widget__step"
        disabled={total === 0}
        onClick={onNext}
        type="button"
      >
        <ChevronDown aria-hidden="true" size={16} />
      </button>
      <button
        aria-label="Close find"
        className="icon-button find-widget__step"
        onClick={onClose}
        type="button"
      >
        <X aria-hidden="true" size={16} />
      </button>
    </div>
  )
}
