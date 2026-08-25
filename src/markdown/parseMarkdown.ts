/**
 * A small Markdown subset parser for stage prep notes. It covers what notes actually
 * use—headings, nested lists, emphasis, code, and links—and produces an AST the
 * renderer can fold, rather than an HTML string it would have to trust.
 */

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'break' }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'emphasis'; children: InlineNode[] }
  | { type: 'link'; href: string; children: InlineNode[] }

export interface ListItem {
  content: InlineNode[]
  children: BlockNode[]
}

export interface HeadingBlock {
  type: 'heading'
  level: number
  content: InlineNode[]
  /**
   * Which line of the source the heading is written on, so the outline can jump to it
   * while the note is being edited and there is no rendered heading to scroll to. Counted
   * here rather than by searching the text later: only the parser knows that a `#` inside
   * a fenced code block is not a heading.
   */
  line: number
}

export interface ParagraphBlock {
  type: 'paragraph'
  content: InlineNode[]
}

export interface ListBlock {
  type: 'list'
  ordered: boolean
  items: ListItem[]
}

export interface CodeBlock {
  type: 'code'
  language: string | null
  value: string
}

export interface QuoteBlock {
  type: 'quote'
  children: BlockNode[]
}

export type BlockNode = HeadingBlock | ParagraphBlock | ListBlock | CodeBlock | QuoteBlock

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`~]+)?\s*$/
const LIST_ITEM = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/
const QUOTE = /^ {0,3}> ?(.*)$/
const ESCAPABLE = /[\\`*_[\]()#+\-.!>]/

/** Only linkable schemes render as links; anything else falls back to plain text. */
function safeHref(value: string): string | null {
  try {
    const url = new URL(value)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? value : null
  } catch {
    return null
  }
}

/**
 * Reads a link destination from just after `](`, counting nested parentheses so URLs
 * that contain them stay intact instead of being silently truncated.
 */
function readDestination(source: string, start: number): { value: string; end: number } | null {
  let depth = 1
  let cursor = start

  while (cursor < source.length) {
    const character = source[cursor]
    if (character === '\\') {
      cursor += 2
      continue
    }
    if (character === '(') depth += 1
    if (character === ')') {
      depth -= 1
      if (depth === 0) {
        const value = source.slice(start, cursor).trim()
        return value && !/\s/.test(value) ? { value, end: cursor } : null
      }
    }
    cursor += 1
  }

  return null
}

export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let text = ''
  let index = 0

  const flush = () => {
    if (text) {
      nodes.push({ type: 'text', value: text })
      text = ''
    }
  }

  while (index < source.length) {
    const rest = source.slice(index)
    const character = source[index]

    if (character === '\\' && ESCAPABLE.test(source[index + 1] ?? '')) {
      text += source[index + 1]
      index += 2
      continue
    }

    if (character === '`') {
      const code = /^(`+)([\s\S]*?)\1(?!`)/.exec(rest)
      if (code) {
        flush()
        nodes.push({ type: 'code', value: code[2].trim() })
        index += code[0].length
        continue
      }
    }

    if (character === '[') {
      const label = /^\[([^\]]*)\]\(/.exec(rest)
      const destination = label ? readDestination(rest, label[0].length) : null
      if (label && destination) {
        flush()
        const href = safeHref(destination.value)
        if (href) {
          nodes.push({ type: 'link', href, children: parseInline(label[1]) })
        } else {
          nodes.push(...parseInline(label[1]))
        }
        index += destination.end + 1
        continue
      }
    }

    // `_` inside a word is left alone so identifiers like stage_notes_value survive.
    const insideWord = character === '_' && /\w/.test(source[index - 1] ?? '')
    if ((character === '*' || character === '_') && !insideWord) {
      const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1(?!\w)/.exec(rest)
      if (strong) {
        flush()
        nodes.push({ type: 'strong', children: parseInline(strong[2]) })
        index += strong[0].length
        continue
      }
      const emphasis = /^(\*|_)(?=\S)([\s\S]*?\S)\1(?!\w)/.exec(rest)
      if (emphasis) {
        flush()
        nodes.push({ type: 'emphasis', children: parseInline(emphasis[2]) })
        index += emphasis[0].length
        continue
      }
    }

    text += character
    index += 1
  }

  flush()
  return nodes
}

function indentWidth(line: string): number {
  return line.length - line.trimStart().length
}

function startsBlock(line: string): boolean {
  return LIST_ITEM.test(line) || HEADING.test(line) || FENCE.test(line) || QUOTE.test(line)
}

/** Removes the shared leading indent so nested content can be parsed on its own terms. */
function dedent(lines: string[]): string[] {
  const indents = lines.filter((line) => line.trim()).map(indentWidth)
  const common = indents.length > 0 ? Math.min(...indents) : 0
  return lines.map((line) => (line.trim() ? line.slice(common) : ''))
}

/**
 * Splits one list item into the text of the item itself and the blocks hanging under it.
 * Lines that simply wrap the item keep flowing into its text; anything after a blank line
 * or starting a block of its own becomes a child, which is what makes the item foldable.
 */
function parseListItem(lines: string[]): ListItem {
  const content: InlineNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) break
    if (index > 0 && startsBlock(line)) break
    if (index > 0) content.push({ type: 'break' })
    content.push(...parseInline(line.trim()))
    index += 1
  }

  return { content, children: parseBlocks(lines.slice(index)) }
}

function parseList(lines: string[], start: number): { node: ListBlock; next: number } {
  const first = LIST_ITEM.exec(lines[start])!
  const markerIndent = first[1].length
  const ordered = first[3] !== undefined
  const items: ListItem[] = []
  let index = start

  while (index < lines.length) {
    const match = LIST_ITEM.exec(lines[index])
    if (!match || match[1].length !== markerIndent) break

    const body = [match[4]]
    const pendingBlanks: string[] = []
    let cursor = index + 1

    while (cursor < lines.length) {
      const line = lines[cursor]
      if (!line.trim()) {
        pendingBlanks.push('')
        cursor += 1
        continue
      }
      if (indentWidth(line) <= markerIndent) break
      body.push(...pendingBlanks.splice(0), line)
      cursor += 1
    }

    items.push(parseListItem([body[0], ...dedent(body.slice(1))]))
    index = cursor

    let lookahead = index
    while (lookahead < lines.length && !lines[lookahead].trim()) lookahead += 1
    const next = lines[lookahead]
    const nextItem = next === undefined ? null : LIST_ITEM.exec(next)
    if (!nextItem || nextItem[1].length !== markerIndent) break
    index = lookahead
  }

  return { node: { type: 'list', ordered, items }, next: index }
}

/**
 * `offset` is the source line `lines[0]` came from, so a heading can be told where it is
 * written even when this is recursing into the body of a quote.
 */
function parseBlocks(lines: string[], offset = 0): BlockNode[] {
  const blocks: BlockNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1][0]
      const body: string[] = []
      index += 1
      while (index < lines.length) {
        const closing = FENCE.exec(lines[index])
        if (closing && closing[1][0] === marker && closing[1].length >= fence[1].length) {
          index += 1
          break
        }
        body.push(lines[index])
        index += 1
      }
      blocks.push({ type: 'code', language: fence[2] ?? null, value: body.join('\n') })
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      // Each line of the body comes from exactly one source line, starting here.
      const quoteStart = index
      while (index < lines.length) {
        const quoted = QUOTE.exec(lines[index])
        if (quoted) {
          body.push(quoted[1])
          index += 1
          continue
        }
        if (!lines[index].trim() || startsBlock(lines[index])) break
        body.push(lines[index].trim())
        index += 1
      }
      blocks.push({ type: 'quote', children: parseBlocks(body, offset + quoteStart) })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        content: parseInline(heading[2]),
        line: offset + index,
      })
      index += 1
      continue
    }

    if (LIST_ITEM.test(line)) {
      const { node, next } = parseList(lines, index)
      blocks.push(node)
      index = next
      continue
    }

    const paragraph: InlineNode[] = []
    while (index < lines.length) {
      const current = lines[index]
      if (!current.trim() || startsBlock(current)) break
      if (paragraph.length > 0) paragraph.push({ type: 'break' })
      paragraph.push(...parseInline(current.trim()))
      index += 1
    }
    blocks.push({ type: 'paragraph', content: paragraph })
  }

  return blocks
}

export function parseMarkdown(source: string): BlockNode[] {
  return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'))
}

/** Plain text of an inline run, for accessible names on fold controls. */
export function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value
        case 'code':
          return node.value
        case 'break':
          return ' '
        default:
          return inlineText(node.children)
      }
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}
