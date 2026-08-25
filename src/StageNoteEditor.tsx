import { useMemo, useRef } from 'react'
import { Bold, Heading2, Italic, List } from 'lucide-react'
import { splitMatches } from './markdown'

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
  /** The find's query. Its matches are painted on the layer behind the text. */
  query?: string
  /** Where this note's matches start in the panel's list, so a mark can be named. */
  matchBase?: number
  /** The ordinal of the match the find is sitting on, in that same list. */
  currentMatch?: number | null
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
  query = '',
  matchBase = 0,
  currentMatch = null,
}: StageNoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const marksRef = useRef<HTMLDivElement>(null)

  /*
   * A textarea cannot carry a highlight, and an unfocused one paints no selection either,
   * so the find would have nothing to show while the caret stays in its box. This layer
   * sits behind the text holding the same characters, transparent apart from the matches,
   * which is what makes them visible. It only mirrors while a query is running.
   */
  const marks = useMemo(() => {
    if (!query) return null
    let ordinal = matchBase
    return splitMatches(value, query).map((segment, index) => {
      if (!segment.isMatch) return <span key={index}>{segment.text}</span>
      const id = ordinal
      ordinal += 1
      return (
        <mark
          className={`markdown__match${id === currentMatch ? ' markdown__match--current' : ''}`}
          data-source-match-id={id}
          key={index}
        >
          {segment.text}
        </mark>
      )
    })
  }, [currentMatch, matchBase, query, value])

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
      {/*
        The mirror sits outside the label, not inside it. A label names its control by its
        content, so a mirror within it would read the whole note out as the box's name.
        Hidden from assistive tech for the same reason it is transparent: it is the same
        characters as the box in front of it, and announcing them twice helps nobody. The
        trailing line break keeps a note ending in a newline as tall as its mirror.
      */}
      <div className="stage-note__source">
        <div aria-hidden="true" className="stage-note__marks" ref={marksRef}>
          {marks}
          {'\n'}
        </div>
        <label className="field">
          <span className="sr-only">{label} prep notes</span>
          <textarea
            autoFocus={autoFocus}
            data-note-source={sourceId}
            onChange={(event) => onChange(event.target.value)}
            // The mirror behind the box only lines up while it is scrolled with it.
            onScroll={(event) => {
              const layer = marksRef.current
              if (!layer) return
              layer.scrollTop = event.currentTarget.scrollTop
              layer.scrollLeft = event.currentTarget.scrollLeft
            }}
            placeholder="Questions to ask, stories to tell, names to remember…"
            ref={textareaRef}
            rows={8}
            value={value}
          />
        </label>
      </div>
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
