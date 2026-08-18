import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import {
  inlineText,
  parseMarkdown,
  type BlockNode,
  type InlineNode,
  type ListBlock,
  type QuoteBlock,
} from './parseMarkdown'

interface Section {
  key: string
  heading: { level: number; content: InlineNode[] } | null
  blocks: BlockNode[]
  children: Section[]
}

/** One key scheme, used by both the renderer and the fold-all collector so they cannot drift. */
const blockKey = (path: string, index: number) => `${path}.b${index}`
const itemKey = (path: string, index: number) => `${path}.i${index}`

/** Groups blocks under their heading so a heading can fold everything beneath it. */
function buildSections(blocks: BlockNode[]): Section {
  const root: Section = { key: 'root', heading: null, blocks: [], children: [] }
  const stack: Section[] = [root]
  let counter = 0

  for (const block of blocks) {
    if (block.type === 'heading') {
      while (stack.length > 1 && (stack[stack.length - 1].heading?.level ?? 0) >= block.level) {
        stack.pop()
      }
      counter += 1
      const parent = stack[stack.length - 1]
      const section: Section = {
        key: `${parent.key}.h${counter}`,
        heading: { level: block.level, content: block.content },
        blocks: [],
        children: [],
      }
      parent.children.push(section)
      stack.push(section)
      continue
    }
    stack[stack.length - 1].blocks.push(block)
  }

  return root
}

function collectBlockKeys(blocks: BlockNode[], path: string, keys: string[]): void {
  blocks.forEach((block, index) => {
    const key = blockKey(path, index)
    if (block.type === 'code') {
      keys.push(key)
      return
    }
    if (block.type === 'quote') {
      keys.push(key)
      collectBlockKeys(block.children, key, keys)
      return
    }
    if (block.type === 'list') {
      block.items.forEach((item, itemIndex) => {
        if (item.children.length === 0) return
        const key2 = itemKey(key, itemIndex)
        keys.push(key2)
        collectBlockKeys(item.children, key2, keys)
      })
    }
  })
}

/** Every key that can fold, in render order, for Collapse all. */
function collectFoldableKeys(section: Section): string[] {
  const keys: string[] = []
  const walk = (current: Section) => {
    if (current.heading) keys.push(current.key)
    collectBlockKeys(current.blocks, current.key, keys)
    current.children.forEach(walk)
  }
  walk(section)
  return keys
}

function blockText(blocks: BlockNode[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'paragraph':
        case 'heading':
          return inlineText(block.content)
        case 'code':
          return block.value
        case 'quote':
          return blockText(block.children)
        case 'list':
          return block.items.map((item) => inlineText(item.content)).join(' ')
      }
    })
    .join(' ')
    .trim()
}

function preview(text: string, limit = 48): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > limit ? `${collapsed.slice(0, limit).trimEnd()}…` : collapsed
}

function Inline({ nodes }: { nodes: InlineNode[] }): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <span key={index}>{node.value}</span>
      case 'break':
        return <br key={index} />
      case 'code':
        return <code key={index}>{node.value}</code>
      case 'strong':
        return <strong key={index}><Inline nodes={node.children} /></strong>
      case 'emphasis':
        return <em key={index}><Inline nodes={node.children} /></em>
      case 'link':
        return (
          <a key={index} href={node.href} rel="noreferrer noopener" target="_blank">
            <Inline nodes={node.children} />
          </a>
        )
    }
  })
}

interface FoldProps {
  collapsed: Set<string>
  onToggle: (key: string) => void
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

function MarkdownList({ list, path, collapsed, onToggle }: FoldProps & { list: ListBlock; path: string }) {
  const Tag = list.ordered ? 'ol' : 'ul'
  return (
    <Tag className="markdown__list">
      {list.items.map((item, index) => {
        const key = itemKey(path, index)
        const foldable = item.children.length > 0
        const isCollapsed = collapsed.has(key)
        return (
          <li className="markdown__item" key={key}>
            {foldable ? (
              <FoldRow
                className="markdown__item-line"
                collapsed={isCollapsed}
                label={`${inlineText(item.content)} sub-points`}
                onToggle={() => onToggle(key)}
              >
                <Inline nodes={item.content} />
              </FoldRow>
            ) : (
              <span className="markdown__item-line">
                <span aria-hidden="true" className="markdown__bullet-spacer" />
                <span className="markdown__item-content">
                  <Inline nodes={item.content} />
                </span>
              </span>
            )}
            {foldable && !isCollapsed ? (
              <MarkdownBlocks
                blocks={item.children}
                collapsed={collapsed}
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

function MarkdownQuote({ quote, path, collapsed, onToggle }: FoldProps & { quote: QuoteBlock; path: string }) {
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
          onToggle={onToggle}
          path={path}
        />
      ) : null}
    </blockquote>
  )
}

function MarkdownBlocks({ blocks, path, collapsed, onToggle }: FoldProps & { blocks: BlockNode[]; path: string }) {
  return blocks.map((block, index) => {
    const key = blockKey(path, index)
    switch (block.type) {
      case 'paragraph':
        return (
          <p className="markdown__paragraph" key={key}>
            <Inline nodes={block.content} />
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
              <pre className="markdown__code"><code>{block.value}</code></pre>
            ) : null}
          </div>
        )
      }
      case 'quote':
        return (
          <MarkdownQuote
            collapsed={collapsed}
            key={key}
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
            onToggle={onToggle}
            path={key}
          />
        )
      default:
        return null
    }
  })
}

function MarkdownSection({ section, collapsed, onToggle }: FoldProps & { section: Section }) {
  const isCollapsed = section.heading ? collapsed.has(section.key) : false
  const Heading = `h${Math.min((section.heading?.level ?? 1) + 3, 6)}` as 'h4'

  return (
    <section className="markdown__section">
      {section.heading ? (
        <Heading className={`markdown__heading markdown__heading--${section.heading.level}`}>
          <FoldRow
            collapsed={isCollapsed}
            label={inlineText(section.heading.content)}
            onToggle={() => onToggle(section.key)}
          >
            <Inline nodes={section.heading.content} />
          </FoldRow>
        </Heading>
      ) : null}
      {!isCollapsed ? (
        <>
          <MarkdownBlocks
            blocks={section.blocks}
            collapsed={collapsed}
            onToggle={onToggle}
            path={section.key}
          />
          {section.children.map((child) => (
            <MarkdownSection
              collapsed={collapsed}
              key={child.key}
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
}

export function MarkdownNotes({ source, label }: MarkdownNotesProps) {
  const section = useMemo(() => buildSections(parseMarkdown(source)), [source])
  const keys = useMemo(() => collectFoldableKeys(section), [section])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

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
      {keys.length > 0 ? (
        <button
          aria-label={`${allCollapsed ? 'Expand' : 'Collapse'} all points in ${label}`}
          className="button button--quiet markdown__fold-all"
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(keys))}
          type="button"
        >
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </button>
      ) : null}
      <MarkdownSection collapsed={collapsed} onToggle={toggle} section={section} />
    </div>
  )
}
