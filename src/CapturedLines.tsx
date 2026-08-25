import { useState } from 'react'
import { Trash2 } from 'lucide-react'

export interface CapturedLine {
  id: string
  body: string
  /** The time it was captured, already formatted: the row shows it, it does not read it. */
  stamp: string
}

interface CapturedLinesProps {
  /** The stage these were captured in, for names a screen reader can tell apart. */
  label: string
  lines: readonly CapturedLine[]
  /** Stores a rewritten line, or removes it when the text is blank. */
  onRevise: (id: string, body: string) => Promise<void>
}

interface CapturedLineRowProps {
  label: string
  line: CapturedLine
  onRevise: (body: string) => Promise<void>
}

/**
 * One captured line, open for correcting. The stamp stays out of the box: it is the
 * moment the line was captured, which an edit does not change and so cannot be asked to
 * retype.
 */
function CapturedLineRow({ label, line, onRevise }: CapturedLineRowProps) {
  const [draft, setDraft] = useState(line.body)
  const [saving, setSaving] = useState(false)
  const changed = draft.trim() !== line.body

  const revise = async (body: string) => {
    if (saving) return
    setSaving(true)
    try {
      await onRevise(body)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="stage-note__line">
      <code className="stage-note__stamp">{line.stamp}</code>
      <label className="field">
        <span className="sr-only">Captured at {line.stamp} in {label}</span>
        <textarea
          onBlur={() => {
            // A row left by tabbing or clicking away keeps what was typed into it: this
            // is a correction to something already written down, not a draft to abandon.
            if (changed) void revise(draft)
          }}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(line.body)
              return
            }
            if (event.key !== 'Enter' || event.shiftKey) return
            // Shift+Enter starts a line, the way the capture box does, and Enter must not
            // reach the form around the panel and save every stage.
            event.preventDefault()
            if (changed) void revise(draft)
          }}
          rows={1}
          value={draft}
        />
      </label>
      <button
        aria-label={`Remove the line captured at ${line.stamp} in ${label}`}
        className="icon-button stage-note__line-remove"
        disabled={saving}
        onClick={() => void revise('')}
        type="button"
      >
        <Trash2 aria-hidden="true" size={14} />
      </button>
    </li>
  )
}

/**
 * The captured lines of one stage, open for correcting: a typo from typing mid-sentence,
 * a line left half-finished when the conversation moved on, or one captured by an Enter
 * nobody meant. Each row stores itself as it is left, because a correction is worth no
 * more ceremony than the capture it is fixing.
 *
 * Rows are keyed by what is stored as well as by id, so a row whose line has been stored
 * starts again from it rather than holding a draft the store has already moved past.
 */
export function CapturedLines({ label, lines, onRevise }: CapturedLinesProps) {
  return (
    <ul aria-label={`Captured lines in ${label}`} className="stage-note__lines">
      {lines.map((line) => (
        <CapturedLineRow
          key={`${line.id}:${line.body}`}
          label={label}
          line={line}
          onRevise={(body) => onRevise(line.id, body)}
        />
      ))}
    </ul>
  )
}
