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

export type TableAlign = 'left' | 'center' | 'right'

export interface TableBlock {
  type: 'table'
  /** One entry per column, in header order; `null` where the delimiter set none. */
  align: (TableAlign | null)[]
  header: InlineNode[][]
  rows: InlineNode[][][]
}

export type BlockNode = HeadingBlock | ParagraphBlock | ListBlock | CodeBlock | QuoteBlock | TableBlock

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`~]+)?\s*$/
const LIST_ITEM = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/
const QUOTE = /^ {0,3}> ?(.*)$/
const ESCAPABLE = /[\\`*_[\]()#+\-.!>]/
// A table's second line: one or more `-`, optionally flanked by `:`, per column. `|`
// is required somewhere in this row, which is what tells it apart from a bare `---`
// under a line of text — a divider some notes use, not a would-be one-column table.
const TABLE_DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/**
 * A URL or an email typed straight into a note, with no `[]()` around it. Notes are
 * written mid-conversation and pasted into, so a posting or a meeting URL usually
 * arrives bare; without this it would read as a link and do nothing when clicked.
 */
const BARE_URL = /^https?:\/\/[^\s<>]+/i
const BARE_EMAIL = /^(?:mailto:)?[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/i
const ANGLE_LINK = /^<([^\s<>]+)>/

/**
 * Gives back the punctuation a sentence put after a bare URL rather than swallowing it
 * into the destination: a note ends "…join at https://meet.example.com/abc." far more
 * often than it links to a path that really ends in a full stop. A closing parenthesis
 * only comes off when the URL never opened it, so `…/a_(b)` stays whole.
 */
function trimTrailingPunctuation(value: string): string {
  let end = value.length

  while (end > 0) {
    const character = value[end - 1]
    if (character === ')') {
      const slice = value.slice(0, end)
      const opened = slice.split('(').length - 1
      const closed = slice.split(')').length - 1
      if (closed <= opened) break
    } else if (!'.,;:!?\'"'.includes(character)) {
      break
    }
    end -= 1
  }

  return value.slice(0, end)
}

/**
 * A link to a heading of the note itself, which is how a note carrying its own table of
 * contents refers to its parts. The reading view follows one by moving to that heading
 * rather than by navigating, so the fragment is kept as written and resolved there.
 */
function fragmentHref(value: string): string | null {
  return /^#\S+$/.test(value) ? value : null
}

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

/**
 * Parses one line's inline content. `autolink` is off while a written link's label is
 * parsed: a bare URL used as its own label would otherwise become a second link nested
 * inside the first, which is invalid and renders as an unclickable stub.
 */
export function parseInline(source: string, autolink = true): InlineNode[] {
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
        const href = fragmentHref(destination.value) ?? safeHref(destination.value)
        if (href) {
          nodes.push({ type: 'link', href, children: parseInline(label[1], false) })
        } else {
          nodes.push(...parseInline(label[1], false))
        }
        index += destination.end + 1
        continue
      }
    }

    if (autolink) {
      const angle = character === '<' ? ANGLE_LINK.exec(rest) : null
      if (angle) {
        const target = angle[1]
        const href = safeHref(target) ?? safeHref(`mailto:${target}`)
        if (href && (href === target || BARE_EMAIL.test(target))) {
          flush()
          nodes.push({ type: 'link', href, children: [{ type: 'text', value: target }] })
          index += angle[0].length
          continue
        }
      }

      // A URL only starts where a word does, so an address inside a longer token—and
      // the second half of one already being read—is left as the text it is part of.
      const atBoundary = !/[\w@./]/.test(source[index - 1] ?? '')
      const bare = atBoundary ? (BARE_URL.exec(rest) ?? BARE_EMAIL.exec(rest)) : null
      if (bare) {
        const target = trimTrailingPunctuation(bare[0])
        // A bare address carries no scheme of its own, so it is posted through mailto.
        const href = /^(?:https?:\/\/|mailto:)/i.test(target) ? safeHref(target) : safeHref(`mailto:${target}`)
        if (href) {
          flush()
          nodes.push({ type: 'link', href, children: [{ type: 'text', value: target }] })
          index += target.length
          continue
        }
      }
    }

    // `_` inside a word is left alone so identifiers like stage_notes_value survive.
    const insideWord = character === '_' && /\w/.test(source[index - 1] ?? '')
    if ((character === '*' || character === '_') && !insideWord) {
      const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1(?!\w)/.exec(rest)
      if (strong) {
        flush()
        nodes.push({ type: 'strong', children: parseInline(strong[2], autolink) })
        index += strong[0].length
        continue
      }
      const emphasis = /^(\*|_)(?=\S)([\s\S]*?\S)\1(?!\w)/.exec(rest)
      if (emphasis) {
        flush()
        nodes.push({ type: 'emphasis', children: parseInline(emphasis[2], autolink) })
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

/** A row that could plausibly open or continue a table: it has a `|` outside escapes. */
function looksLikeTableRow(line: string): boolean {
  return line.trim().length > 0 && /(?<!\\)\|/.test(line)
}

/**
 * Splits a table row into cell source text, dropping the outer pipes a row is usually
 * written with. `\|` inside a cell survives as a literal pipe rather than a separator.
 */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim()
  const cells: string[] = []
  let cell = ''

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]
    if (character === '\\' && trimmed[index + 1] === '|') {
      cell += '|'
      index += 1
      continue
    }
    if (character === '|') {
      cells.push(cell)
      cell = ''
      continue
    }
    cell += character
  }
  cells.push(cell)

  if (cells.length > 1 && cells[0].trim() === '') cells.shift()
  if (cells.length > 1 && cells[cells.length - 1].trim() === '') cells.pop()
  return cells.map((value) => value.trim())
}

function parseTableAlign(cell: string): TableAlign | null {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

/** Whether `lines[index]` opens a table, which takes the next line too to tell. */
function startsTable(lines: string[], index: number): boolean {
  const line = lines[index]
  const delimiter = lines[index + 1]
  return looksLikeTableRow(line) && delimiter !== undefined && delimiter.includes('|') && TABLE_DELIMITER_ROW.test(delimiter)
}

function indentWidth(line: string): number {
  return line.length - line.trimStart().length
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index]
  return LIST_ITEM.test(line) || HEADING.test(line) || FENCE.test(line) || QUOTE.test(line) || startsTable(lines, index)
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
    if (index > 0 && startsBlock(lines, index)) break
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
        if (!lines[index].trim() || startsBlock(lines, index)) break
        body.push(lines[index].trim())
        index += 1
      }
      blocks.push({ type: 'quote', children: parseBlocks(body, offset + quoteStart) })
      continue
    }

    if (startsTable(lines, index)) {
      const header = splitTableRow(line).map((cell) => parseInline(cell))
      const columns = header.length
      const align = splitTableRow(lines[index + 1]).map(parseTableAlign)
      index += 2

      const rows: InlineNode[][][] = []
      while (index < lines.length && looksLikeTableRow(lines[index])) {
        const cells = splitTableRow(lines[index]).map((cell) => parseInline(cell)).slice(0, columns)
        while (cells.length < columns) cells.push([])
        rows.push(cells)
        index += 1
      }

      blocks.push({
        type: 'table',
        align: header.map((_, column) => align[column] ?? null),
        header,
        rows,
      })
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
      if (!current.trim() || startsBlock(lines, index)) break
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
