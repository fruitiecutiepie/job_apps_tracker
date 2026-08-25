import { useRef } from 'react'
import { Bold, Heading2, Italic, List } from 'lucide-react'

interface StageNoteEditorProps {
  label: string
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  /**
   * Names this box for the find, which reaches it through the DOM: a note being written
   * holds source rather than highlights, so a match is shown by selecting it here.
   */
  sourceId?: string
}

interface Format {
  id: string
  title: string
  icon: typeof Bold
  wrap?: string
  prefix?: string
}

const FORMATS: readonly Format[] = [
  { id: 'bold', title: 'Bold', icon: Bold, wrap: '**' },
  { id: 'italic', title: 'Italic', icon: Italic, wrap: '_' },
  { id: 'heading', title: 'Heading', icon: Heading2, prefix: '## ' },
  { id: 'bullet', title: 'Bullet point', icon: List, prefix: '- ' },
]

/** Toggles a line prefix on every line the selection touches. */
function applyPrefix(value: string, start: number, end: number, prefix: string) {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lineEnd = value.indexOf('\n', end)
  const sliceEnd = lineEnd === -1 ? value.length : lineEnd
  const lines = value.slice(lineStart, sliceEnd).split('\n')
  const allPrefixed = lines.every((line) => line.startsWith(prefix))
  const next = lines
    .map((line) => (allPrefixed ? line.slice(prefix.length) : `${prefix}${line}`))
    .join('\n')

  return {
    value: `${value.slice(0, lineStart)}${next}${value.slice(sliceEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + next.length,
  }
}

function applyWrap(value: string, start: number, end: number, wrap: string) {
  const selected = value.slice(start, end)
  const alreadyWrapped =
    selected.length > wrap.length * 2
    && selected.startsWith(wrap)
    && selected.endsWith(wrap)

  const next = alreadyWrapped
    ? selected.slice(wrap.length, -wrap.length)
    : `${wrap}${selected || 'text'}${wrap}`

  return {
    value: `${value.slice(0, start)}${next}${value.slice(end)}`,
    selectionStart: start + (alreadyWrapped ? 0 : wrap.length),
    selectionEnd: start + next.length - (alreadyWrapped ? 0 : wrap.length),
  }
}

export function StageNoteEditor({
  label,
  value,
  onChange,
  autoFocus,
  sourceId,
}: StageNoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const format = (entry: Format) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const { selectionStart, selectionEnd } = textarea
    const result = entry.prefix
      ? applyPrefix(value, selectionStart, selectionEnd, entry.prefix)
      : applyWrap(value, selectionStart, selectionEnd, entry.wrap!)

    onChange(result.value)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }

  return (
    <div className="stage-note__editor">
      <div className="stage-note__toolbar" role="group" aria-label={`${label} formatting`}>
        {FORMATS.map((entry) => (
          <button
            aria-label={`${entry.title} in ${label}`}
            className="icon-button stage-note__format"
            key={entry.id}
            onClick={() => format(entry)}
            title={entry.title}
            type="button"
          >
            <entry.icon aria-hidden="true" size={16} />
          </button>
        ))}
      </div>
      <label className="field">
        <span className="sr-only">{label} prep notes</span>
        <textarea
          autoFocus={autoFocus}
          data-note-source={sourceId}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Questions to ask, stories to tell, names to remember…"
          ref={textareaRef}
          rows={8}
          value={value}
        />
      </label>
      <p className="stage-note__hint">
        Markdown: <code>##</code> heading, <code>-</code> bullet (indent to nest),
        {' '}<code>&gt;</code> quote (<code>&gt;&gt;</code> to nest one inside another),
        {' '}<code>```</code> fenced code, <code>**bold**</code>, <code>_italic_</code>,
        {' '}<code>`code`</code>, <code>[link](https://…)</code>. A pasted
        {' '}<code>https://…</code> URL or email address links itself, and
        {' '}<code>[to a heading](#heading)</code> jumps within the note.
        Headings, bullets with sub-points, quotes, and code blocks all fold in the reading
        view. A line straight after a <code>&gt;</code> joins that quote — leave a blank
        line to end it.
      </p>
    </div>
  )
}
