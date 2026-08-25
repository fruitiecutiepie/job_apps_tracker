import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { inlineText, parseMarkdown, type BlockNode, type InlineNode, type ListBlock, type QuoteBlock } from './parseMarkdown'
import { tokenizeCode } from './highlightCode'
import {
  blockKey,
  blockText,
  buildSections,
  collectFoldableKeys,
  itemKey,
  type Section,
} from './sections'
import { headingKey, searchNote, splitMatches } from './searchNote'

/**
 * What the renderer needs to highlight a find. `base` shifts this note's ordinals into
 * the panel's list, which runs across every note on screen, so a highlight can be named
 * `data-match-id` and scrolled to from outside.
 */
interface Marks {
  query: string
  base: number
  current: number | null
  bases: Map<string, number>
}

/** A running ordinal, shared by every inline node inside one text container. */
interface Cursor {
  next: number
}

function preview(text: string, limit = 48): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > limit ? `${collapsed.slice(0, limit).trimEnd()}…` : collapsed
}

/** Seeds a container's cursor from the ordinal the search assigned it. */
function cursorFor(marks: Marks | null, key: string): Cursor {
  return { next: marks?.bases.get(key) ?? 0 }
}

/**
 * Wraps the matching runs of one string. Highlighting is numbered from `cursor`, which
 * the caller seeded from the search: rendering never decides the numbers itself, so a
 * re-render cannot renumber the matches under the find widget.
 */
function highlight(text: string, marks: Marks, cursor: Cursor, keyPrefix: string): ReactNode {
  const segments = splitMatches(text, marks.query)
  if (segments.length === 1 && !segments[0].isMatch) return text

  return segments.map((segment, index) => {
    if (!segment.isMatch) return <span key={`${keyPrefix}s${index}`}>{segment.text}</span>
    const id = marks.base + cursor.next
    cursor.next += 1
    return (
      <mark
        className={`markdown__match${id === marks.current ? ' markdown__match--current' : ''}`}
        data-match-id={id}
        key={`${keyPrefix}m${index}`}
      >
        {segment.text}
      </mark>
    )
  })
}

/**
 * Renders inline content. This is a plain function rather than a component so that a
 * container and everything nested inside it share one cursor in document order.
 */
function inline(nodes: InlineNode[], marks: Marks | null, cursor: Cursor): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return (
          <span key={index}>
            {marks ? highlight(node.value, marks, cursor, `${index}.`) : node.value}
          </span>
        )
      case 'break':
        return <br key={index} />
      case 'code':
        return (
          <code key={index}>
            {marks ? highlight(node.value, marks, cursor, `${index}.`) : node.value}
          </code>
        )
      case 'strong':
        return <strong key={index}>{inline(node.children, marks, cursor)}</strong>
      case 'emphasis':
        return <em key={index}>{inline(node.children, marks, cursor)}</em>
      case 'link':
        return (
          <a key={index} href={node.href} rel="noreferrer noopener" target="_blank">
            {inline(node.children, marks, cursor)}
          </a>
        )
    }
  })
}

/**
 * Renders a fenced code block's body as coloured tokens, with a find's matches still
 * highlighted inside them. `highlight` runs per token rather than once over the whole
 * body, so a token keeps its own colour beneath the match instead of losing it.
 */
function codeContent(
  value: string,
  language: string | null,
  marks: Marks | null,
  cursor: Cursor,
  keyPrefix: string,
): ReactNode {
  return tokenizeCode(value, language).map((token, index) => {
    const rendered = marks ? highlight(token.text, marks, cursor, `${keyPrefix}${index}.`) : token.text
    if (token.type === 'plain') return <span key={index}>{rendered}</span>
    return (
      <span className={`markdown__token markdown__token--${token.type}`} key={index}>
        {rendered}
      </span>
    )
  })
}

interface FoldProps {
  collapsed: Set<string>
  onToggle: (key: string) => void
  marks: Marks | null
}

/**
 * A fold control whose text is also a hit target. The chevron is the real button, so it
 * stays focusable and named for assistive tech; the text beside it toggles on click
 * without becoming a button itself, which would nest any link inside it and make the
 * note impossible to select and copy.
 */
function FoldRow({
  className,
  collapsed,
  label,
  onToggle,
  children,
}: {
  className?: string
  collapsed: boolean
  label: string
  onToggle: () => void
  children: ReactNode
}) {
  const toggleFromText = (event: MouseEvent<HTMLElement>) => {
    // Let links do their own job, and let a drag-select finish without folding.
    if ((event.target as HTMLElement).closest('a')) return
    if (!window.getSelection()?.isCollapsed) return
    onToggle()
  }

  return (
    <span className={`markdown__fold-row${className ? ` ${className}` : ''}`}>
      <button
        aria-expanded={!collapsed}
        aria-label={label}
        className={`markdown__fold${collapsed ? ' markdown__fold--collapsed' : ''}`}
        onClick={onToggle}
        type="button"
      >
        <ChevronRight aria-hidden="true" size={14} />
      </button>
      <span className="markdown__fold-text" onClick={toggleFromText}>
        {children}
      </span>
    </span>
  )
}

function MarkdownList({ list, path, collapsed, onToggle, marks }: FoldProps & { list: ListBlock; path: string }) {
  const Tag = list.ordered ? 'ol' : 'ul'
  return (
    <Tag className="markdown__list">
      {list.items.map((item, index) => {
        const key = itemKey(path, index)
        const foldable = item.children.length > 0
        const isCollapsed = collapsed.has(key)
        const content = inline(item.content, marks, cursorFor(marks, key))
        return (
          <li className="markdown__item" key={key}>
            {foldable ? (
              <FoldRow
                className="markdown__item-line"
                collapsed={isCollapsed}
                label={`${inlineText(item.content)} sub-points`}
                onToggle={() => onToggle(key)}
              >
                {content}
              </FoldRow>
            ) : (
              <span className="markdown__item-line">
                <span aria-hidden="true" className="markdown__bullet-spacer" />
                <span className="markdown__item-content">{content}</span>
              </span>
            )}
            {foldable && !isCollapsed ? (
              <MarkdownBlocks
                blocks={item.children}
                collapsed={collapsed}
                marks={marks}
                onToggle={onToggle}
                path={key}
              />
            ) : null}
          </li>
        )
      })}
    </Tag>
  )
}

function MarkdownQuote({ quote, path, collapsed, onToggle, marks }: FoldProps & { quote: QuoteBlock; path: string }) {
  const isCollapsed = collapsed.has(path)
  return (
    <blockquote className="markdown__quote">
      <FoldRow
        className="markdown__fold-row--summary"
        collapsed={isCollapsed}
        label={`Quote: ${preview(blockText(quote.children))}`}
        onToggle={() => onToggle(path)}
      >
        Quote: {preview(blockText(quote.children))}
      </FoldRow>
      {!isCollapsed ? (
        <MarkdownBlocks
          blocks={quote.children}
          collapsed={collapsed}
          marks={marks}
          onToggle={onToggle}
          path={path}
        />
      ) : null}
    </blockquote>
  )
}

function MarkdownBlocks({ blocks, path, collapsed, onToggle, marks }: FoldProps & { blocks: BlockNode[]; path: string }) {
  return blocks.map((block, index) => {
    const key = blockKey(path, index)
    switch (block.type) {
      case 'paragraph':
        return (
          <p className="markdown__paragraph" key={key}>
            {inline(block.content, marks, cursorFor(marks, key))}
          </p>
        )
      case 'code': {
        const isCollapsed = collapsed.has(key)
        const lines = block.value ? block.value.split('\n').length : 0
        return (
          <div className="markdown__code-block" key={key}>
            <FoldRow
              className="markdown__fold-row--summary"
              collapsed={isCollapsed}
              label={`${block.language ?? 'Code'} · ${lines} ${lines === 1 ? 'line' : 'lines'}`}
              onToggle={() => onToggle(key)}
            >
              {block.language ?? 'Code'} · {lines} {lines === 1 ? 'line' : 'lines'}
            </FoldRow>
            {!isCollapsed ? (
              <pre className="markdown__code">
                <code>{codeContent(block.value, block.language, marks, cursorFor(marks, key), 'c')}</code>
              </pre>
            ) : null}
          </div>
        )
      }
      case 'quote':
        return (
          <MarkdownQuote
            collapsed={collapsed}
            key={key}
            marks={marks}
            onToggle={onToggle}
            path={key}
            quote={block}
          />
        )
      case 'list':
        return (
          <MarkdownList
            collapsed={collapsed}
            key={key}
            list={block}
            marks={marks}
            onToggle={onToggle}
            path={key}
          />
        )
      default:
        return null
    }
  })
}

function MarkdownSection({ section, collapsed, onToggle, marks }: FoldProps & { section: Section }) {
  const isCollapsed = section.heading ? collapsed.has(section.key) : false
  const Heading = `h${Math.min((section.heading?.level ?? 1) + 3, 6)}` as 'h4'

  return (
    <section
      className={`markdown__section${section.heading ? ' markdown__section--titled' : ''}`}
    >
      {section.heading ? (
        <Heading
          className={`markdown__heading markdown__heading--${section.heading.level}`}
          data-section-key={section.key}
        >
          <FoldRow
            collapsed={isCollapsed}
            label={inlineText(section.heading.content)}
            onToggle={() => onToggle(section.key)}
          >
            {inline(section.heading.content, marks, cursorFor(marks, headingKey(section.key)))}
          </FoldRow>
        </Heading>
      ) : null}
      {!isCollapsed ? (
        <>
          <MarkdownBlocks
            blocks={section.blocks}
            collapsed={collapsed}
            marks={marks}
            onToggle={onToggle}
            path={section.key}
          />
          {section.children.map((child) => (
            <MarkdownSection
              collapsed={collapsed}
              key={child.key}
              marks={marks}
              onToggle={onToggle}
              section={child}
            />
          ))}
        </>
      ) : null}
    </section>
  )
}

interface MarkdownNotesProps {
  source: string
  /** Names the fold-all control when several notes are on screen at once. */
  label: string
  /** The find widget's query. Matches are highlighted and folds holding one open. */
  query?: string
  /** Where this note's matches start in the panel's list across every note on screen. */
  matchBase?: number
  /** The ordinal of the match the find widget is sitting on, in that same list. */
  currentMatch?: number | null
  /**
   * Whether to offer the fold-all control. Off where the note is a pinned strip rather
   * than a column to read: a permanent button costs a row that the note itself wants,
   * and every point in it still folds on its own.
   */
  foldAll?: boolean
  /**
   * Ancestor keys to force open, for a jump landing inside a section that is folded.
   * Left collapsed afterwards is not an option — the jump would have nothing to show.
   */
  revealKeys?: Set<string>
}

export function MarkdownNotes({
  source,
  label,
  query = '',
  matchBase = 0,
  currentMatch = null,
  foldAll = true,
  revealKeys,
}: MarkdownNotesProps) {
  const section = useMemo(() => buildSections(parseMarkdown(source)), [source])
  const keys = useMemo(() => collectFoldableKeys(section), [section])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const search = useMemo(() => searchNote(section, query), [section, query])

  const marks = useMemo<Marks | null>(
    () => (query && search.count > 0 ? { query, base: matchBase, current: currentMatch, bases: search.bases } : null),
    [currentMatch, matchBase, query, search],
  )

  /**
   * A fold holding a match, or a jump's landing place, opens for as long as that reason
   * lasts, then goes back to however the reader had left it: finding or jumping to
   * something must not quietly rearrange the outline they were working through.
   */
  const effectiveCollapsed = useMemo(() => {
    if (search.reveal.size === 0 && !revealKeys?.size) return collapsed
    const next = new Set(collapsed)
    for (const key of search.reveal) next.delete(key)
    if (revealKeys) for (const key of revealKeys) next.delete(key)
    return next
  }, [collapsed, revealKeys, search])

  const toggle = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  const allCollapsed = keys.length > 0 && keys.every((key) => collapsed.has(key))

  return (
    <div className="markdown">
      {foldAll && keys.length > 0 ? (
        <button
          aria-label={`${allCollapsed ? 'Expand' : 'Collapse'} all points in ${label}`}
          className="button button--quiet markdown__fold-all"
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(keys))}
          type="button"
        >
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </button>
      ) : null}
      <MarkdownSection
        collapsed={effectiveCollapsed}
        marks={marks}
        onToggle={toggle}
        section={section}
      />
    </div>
  )
}
