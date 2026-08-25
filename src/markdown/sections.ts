/**
 * The section tree a parsed note folds along, and the key scheme that names every
 * foldable place in it. The renderer and the note search both walk this tree, so the
 * keys live here rather than in either of them: a key that meant one thing to the
 * renderer and another to the search would fold the wrong rows.
 */

import { inlineText, type BlockNode, type InlineNode } from './parseMarkdown'

export interface Section {
  key: string
  /** `line` is where the heading is written in the source, for jumping to it in the editor. */
  heading: { level: number; content: InlineNode[]; line: number } | null
  blocks: BlockNode[]
  children: Section[]
}

/** One key scheme, used by the renderer, the fold-all collector, and the search. */
export const blockKey = (path: string, index: number) => `${path}.b${index}`
export const itemKey = (path: string, index: number) => `${path}.i${index}`
/** `row` is `-1` for the header, so a table's header and body cells never collide. */
export const cellKey = (path: string, row: number, column: number) => `${path}.r${row}c${column}`

/** Groups blocks under their heading so a heading can fold everything beneath it. */
export function buildSections(blocks: BlockNode[]): Section {
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
        heading: { level: block.level, content: block.content, line: block.line },
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
export function collectFoldableKeys(section: Section): string[] {
  const keys: string[] = []
  const walk = (current: Section) => {
    if (current.heading) keys.push(current.key)
    collectBlockKeys(current.blocks, current.key, keys)
    current.children.forEach(walk)
  }
  walk(section)
  return keys
}

/**
 * The anchor a heading answers to, in the shape a generated table of contents writes:
 * lowercased, punctuation dropped, spaces turned into hyphens. Notes are written in an
 * editor and pasted in with their contents list already built, so the slugs here have to
 * be the ones already in those links — including the double hyphen that a dropped `/`
 * between two spaces leaves behind.
 */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\- ]+/gu, '')
    .replace(/ /g, '-')
}

/**
 * Every heading's anchor, mapped to the section it names. A repeated heading is numbered
 * from the second one on, the way a contents list numbers it, so two `### Notes` in one
 * note stay separately reachable rather than both leading to the first.
 */
export function sectionSlugs(root: Section): Map<string, string> {
  const slugs = new Map<string, string>()
  const counts = new Map<string, number>()

  const walk = (section: Section) => {
    if (section.heading) {
      const base = headingSlug(inlineText(section.heading.content))
      if (base) {
        const seen = counts.get(base) ?? 0
        counts.set(base, seen + 1)
        const slug = seen === 0 ? base : `${base}-${seen}`
        // First writer wins, so a heading cannot be shadowed by a later one whose own
        // numbering happens to land on the same slug.
        if (!slugs.has(slug)) slugs.set(slug, section.key)
      }
    }
    section.children.forEach(walk)
  }
  walk(root)

  return slugs
}

export interface OutlineEntry {
  key: string
  text: string
}

/** One heading in the outline, holding the headings nested under it. */
export interface OutlineNode extends OutlineEntry {
  /** Heading level as written, which is not the same as nesting depth. */
  level: number
  children: OutlineNode[]
}

/**
 * The note's headings as a tree, for the outline beside it. Nesting comes from the
 * section tree rather than from comparing levels, so a note that starts at `###` and
 * later uses `##` still outlines the way it reads.
 */
export function outlineTree(root: Section): OutlineNode[] {
  const nodeFor = (section: Section): OutlineNode => ({
    key: section.key,
    level: section.heading?.level ?? 1,
    text: inlineText(section.heading?.content ?? []),
    children: section.children.map(nodeFor),
  })

  return root.children.map(nodeFor)
}

/**
 * The headings above a section, itself last, for the breadcrumb trail and for marking
 * the outline path. Empty when the key names no section, which is what a note with no
 * headings at all reports.
 */
export function sectionPath(root: Section, key: string | null): OutlineEntry[] {
  if (!key) return []

  const find = (section: Section, trail: OutlineEntry[]): OutlineEntry[] | null => {
    const here = section.heading
      ? [...trail, { key: section.key, text: inlineText(section.heading.content) }]
      : trail
    if (section.key === key) return here
    for (const child of section.children) {
      const found = find(child, here)
      if (found) return found
    }
    return null
  }

  return find(root, []) ?? []
}

/**
 * The source line a section's heading is written on, or null when the key names no
 * section. What the outline jumps to while a note is open in the editor, where there is
 * no rendered heading to scroll to — only the text it was written as.
 */
export function sectionHeadingLine(root: Section, key: string | null): number | null {
  if (!key) return null

  const find = (section: Section): number | null => {
    if (section.key === key) return section.heading?.line ?? null
    for (const child of section.children) {
      const found = find(child)
      if (found !== null) return found
    }
    return null
  }

  return find(root)
}

/**
 * The section a line of the source falls inside: the last heading written at or before it.
 * Null when the note opens with writing above its first heading, which is where the note
 * genuinely is in no section at all.
 *
 * What the outline follows while a note is being written, where there is nothing rendered
 * to read a scroll position off and the caret is what says where the writer is.
 */
export function sectionAtLine(root: Section, line: number): string | null {
  let found: string | null = null

  // Depth first, which is the order the headings are written in.
  const walk = (section: Section) => {
    for (const child of section.children) {
      if (child.heading && child.heading.line <= line) found = child.key
      walk(child)
    }
  }
  walk(root)

  return found
}

export function blockText(blocks: BlockNode[]): string {
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
        case 'table':
          return [block.header, ...block.rows]
            .map((row) => row.map((cell) => inlineText(cell)).join(' '))
            .join(' ')
      }
    })
    .join(' ')
    .trim()
}
