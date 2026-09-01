import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Bold, ChevronRight, Heading2, Italic, List } from 'lucide-react'
import { buildSections, foldRegions, parseMarkdown, splitMatches } from './markdown'
import { lineStartOffset, offsetTopsWithin } from './noteEditorJump'
import {
  applyProjectedEdit,
  FOLD_DATA,
  hiddenRanges,
  isHidden,
  projectText,
  toProjectedLine,
  toProjectedOffset,
  toSourceOffset,
} from './noteFolds'

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
  /**
   * Section keys to force open, for a jump landing inside a fold. The same prop the
   * reading view takes, so picking a heading from the outline opens the same folds
   * whichever mode the note is in.
   */
  revealKeys?: Set<string>
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

/** What a fold's control is called, taken from the line it folds as it was written. */
function summary(line: string, limit = 40): string {
  const text = line.trim().replace(/^[>\s]*/, '').replace(/^(#{1,6}|[-*+]|\d+[.)])\s*/, '').trim()
  const named = text || line.trim()
  return named.length > limit ? `${named.slice(0, limit).trimEnd()}…` : named
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
  revealKeys,
}: StageNoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const marksRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  /**
   * Which folds are closed, named by the source line their own heading, point, quote, or
   * fence is written on. Lines rather than the keys the reading view folds by: a key is
   * the section's place in the note, and typing a heading above one would hand its key —
   * and so its fold — to the section below it. A line is moved by an edit above it, which
   * is exactly what a fold anchored to a line should do.
   */
  const [folded, setFolded] = useState<ReadonlySet<number>>(() => new Set())
  /** Where the caret has to be put once a fold has opened or closed under it. */
  const pendingCaret = useRef<number | null>(null)

  const lines = useMemo(() => value.split('\n'), [value])
  const regions = useMemo(
    () => foldRegions(buildSections(parseMarkdown(value)), lines),
    [lines, value],
  )

  /**
   * A fold is opened for as long as there is a reason to see inside it, then closes back
   * up: a jump from the outline lands somewhere it can be read, and the find never hides
   * the match it is counting. Held open rather than dropped, so the note goes back to the
   * shape it was left in once the find is closed.
   */
  const effective = useMemo(() => {
    const open = new Set(folded)
    for (const region of regions) {
      if (!open.has(region.line)) continue
      if (revealKeys?.has(region.key)) open.delete(region.line)
      else if (query && splitMatches(lines.slice(region.start, region.end + 1).join('\n'), query).some((part) => part.isMatch)) {
        open.delete(region.line)
      }
    }
    return open
  }, [folded, lines, query, regions, revealKeys])

  const ranges = useMemo(() => hiddenRanges(regions, effective), [effective, regions])
  const projected = useMemo(() => projectText(lines, ranges), [lines, ranges])

  /*
   * A textarea cannot carry a highlight, and an unfocused one paints no selection either,
   * so the find would have nothing to show while the caret stays in its box. This layer
   * sits behind the text holding the same characters, transparent apart from the matches,
   * which is what makes them visible. It only mirrors while a query is running.
   *
   * It mirrors the box, not the note: what is folded away is not on either layer, and a
   * fold holding a match is open, so the two still number their matches alike.
   */
  const marks = useMemo(() => {
    if (!query) return null
    let ordinal = matchBase
    return splitMatches(projected, query).map((segment, index) => {
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
  }, [currentMatch, matchBase, projected, query])

  /** The folds whose own header line the box is showing, so there is a row to hang one on. */
  const controls = useMemo(
    () => regions.filter((region) => !isHidden(region.line, ranges)),
    [ranges, regions],
  )

  const [tops, setTops] = useState<readonly number[]>([])

  /**
   * Where each fold's control sits, measured off the box rather than counted as lines: the
   * box soft-wraps, so a written line can stand several lines tall and every control below
   * a wrapped paragraph would sit short of the line it names.
   */
  const measure = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea || typeof getComputedStyle !== 'function') return
    // Nothing to measure against until the box has a width — which is every render under
    // a test runner, where there is no layout at all and every answer would be zero.
    if (!textarea.clientWidth) return
    const offsets = controls.map((region) =>
      lineStartOffset(projected, toProjectedLine(region.line, ranges)),
    )
    const next = offsetTopsWithin(textarea, projected, offsets)
    setTops((current) =>
      current.length === next.length && current.every((top, index) => top === next[index])
        ? current
        : next,
    )
  }, [controls, projected, ranges])

  /*
   * Measuring means laying the note out a second time, off-screen, so it is done once per
   * frame rather than once per keystroke: a fast typist would otherwise pay for a copy of
   * the note on every character, and only the last of them is the one on screen.
   */
  useLayoutEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = 0
      measure()
    })
    return () => {
      if (frame) cancelAnimationFrame(frame)
    }
  }, [measure])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || typeof ResizeObserver === 'undefined') return
    // The panel is split and unsplit and the window resized under a note being written,
    // and every one of those rewraps it under the controls beside it.
    const observer = new ResizeObserver(() => measure())
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [measure])

  /** Puts the caret back where it was in the note once the box has been reprojected. */
  useLayoutEffect(() => {
    const offset = pendingCaret.current
    if (offset === null) return
    pendingCaret.current = null
    const textarea = textareaRef.current
    if (!textarea || document.activeElement !== textarea) return
    const position = toProjectedOffset(projected, value, ranges, offset)
    // jsdom implements no selection, and the panel still has to render there.
    textarea.setSelectionRange?.(position, position)
  }, [projected, ranges, value])

  const toggle = (line: number) => {
    const textarea = textareaRef.current
    if (textarea && document.activeElement === textarea) {
      pendingCaret.current = toSourceOffset(projected, value, ranges, textarea.selectionStart)
    }
    setFolded((current) => {
      const next = new Set(current)
      if (!next.delete(line)) next.add(line)
      return next
    })
  }

  const allFolded = controls.length > 0 && regions.every((region) => folded.has(region.line))

  const edit = (next: string, caret: number) => {
    const result = applyProjectedEdit(value, projected, next, ranges, effective, regions, caret)
    setFolded((current) => {
      // Only the folds this edit moved or opened change; the rest are left as they were.
      const kept = new Set(current)
      for (const line of result.blocked) kept.delete(line)
      if (result.blocked.length > 0) return kept
      return result.anchors
    })
    if (result.blocked.length === 0 && result.text !== value) onChange(result.text)
  }

  const format = (entry: Format) => {
    const textarea = textareaRef.current
    if (!textarea) return
    // The box holds the note with its folds taken out, so where the caret is in the box
    // is not where it is in the note. Formatting is applied to the note.
    const start = toSourceOffset(projected, value, ranges, textarea.selectionStart)
    const end = toSourceOffset(projected, value, ranges, textarea.selectionEnd)
    const result = entry.prefix
      ? applyPrefix(value, start, end, entry.prefix)
      : applyWrap(value, start, end, entry.wrap!)

    onChange(result.value)
    requestAnimationFrame(() => {
      const written = result.value.split('\n')
      const after = hiddenRanges(foldRegions(buildSections(parseMarkdown(result.value)), written), folded)
      const text = projectText(written, after)
      textarea.focus()
      textarea.setSelectionRange(
        toProjectedOffset(text, result.value, after, result.selectionStart),
        toProjectedOffset(text, result.value, after, result.selectionEnd),
      )
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
        {regions.length > 0 ? (
          <button
            aria-label={`${allFolded ? 'Expand' : 'Collapse'} all points in ${label}`}
            className="button button--quiet stage-note__fold-all"
            onClick={() => setFolded(allFolded ? new Set() : new Set(regions.map((region) => region.line)))}
            type="button"
          >
            {allFolded ? 'Expand all' : 'Collapse all'}
          </button>
        ) : null}
      </div>
      {/*
        The mirror sits outside the label, not inside it. A label names its control by its
        content, so a mirror within it would read the whole note out as the box's name.
        Hidden from assistive tech for the same reason it is transparent: it is the same
        characters as the box in front of it, and announcing them twice helps nobody. The
        trailing line break keeps a note ending in a newline as tall as its mirror.
      */}
      <div className="stage-note__source">
        {/*
          The fold controls stand in their own column beside the box rather than inside it:
          a textarea has no room in its text for anything that is not text. They scroll with
          it, which is what keeps each one against the line it folds.
        */}
        <div aria-label={`Folds in ${label}`} className="stage-note__gutter" role="group">
          <div className="stage-note__gutter-lines" ref={gutterRef}>
            {controls.map((region, index) => {
              const isFolded = folded.has(region.line)
              return (
                <button
                  aria-expanded={!isFolded}
                  aria-label={`${isFolded ? 'Expand' : 'Collapse'} ${summary(lines[region.line])} in ${label}`}
                  className={`stage-note__fold${isFolded ? ' stage-note__fold--folded' : ''}`}
                  key={region.line}
                  onClick={() => toggle(region.line)}
                  style={{ top: `${tops[index] ?? 0}px` }}
                  type="button"
                >
                  <ChevronRight aria-hidden="true" size={14} />
                </button>
              )
            })}
          </div>
        </div>
        <div className="stage-note__box">
          <div aria-hidden="true" className="stage-note__marks" ref={marksRef}>
            {marks}
            {'\n'}
          </div>
          <label className="field">
            <span className="sr-only">{label} prep notes</span>
            <textarea
              autoFocus={autoFocus}
              data-note-source={sourceId}
              {...{ [FOLD_DATA]: JSON.stringify(ranges) }}
              onChange={(event) => edit(event.target.value, event.target.selectionStart)}
              // The mirror behind the box and the folds beside it only line up while they
              // are scrolled with it.
              onScroll={(event) => {
                const layer = marksRef.current
                const gutter = gutterRef.current
                if (gutter) gutter.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`
                if (!layer) return
                layer.scrollTop = event.currentTarget.scrollTop
                layer.scrollLeft = event.currentTarget.scrollLeft
              }}
              placeholder="Questions to ask, stories to tell, names to remember…"
              ref={textareaRef}
              rows={8}
              value={projected}
            />
          </label>
        </div>
      </div>
      <p className="stage-note__hint">
        Markdown: <code>##</code> heading, <code>-</code> bullet (indent to nest),
        {' '}<code>&gt;</code> quote (<code>&gt;&gt;</code> to nest one inside another),
        {' '}<code>```</code> fenced code, <code>**bold**</code>, <code>_italic_</code>,
        {' '}<code>`code`</code>, <code>[link](https://…)</code>. A pasted
        {' '}<code>https://…</code> URL or email address links itself, and
        {' '}<code>[to a heading](#heading)</code> jumps within the note.
        Headings, bullets with sub-points, quotes, and code blocks fold here as they do in
        the reading view — from the chevrons beside them, or all at once. A line straight
        after a <code>&gt;</code> joins that quote — leave a blank line to end it.
      </p>
    </div>
  )
}
