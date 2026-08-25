/**
 * Finding text inside a parsed note.
 *
 * The reading view folds, and a folded row is unmounted rather than hidden, so the
 * browser's own find cannot see into it. This walks the section tree instead and
 * answers three things at once, all from a single pass in render order:
 *
 * - how many matches the note holds, so the find widget can count them;
 * - which foldable keys have to open for every match to be on screen;
 * - where each text-bearing node's matches start in that count, so the renderer can
 *   number its highlights without depending on the order React happens to render in.
 *
 * Matching is a case-insensitive substring of the parsed text, not of the Markdown
 * source: a search for `bold` finds the word inside `**bold**`, and a search for `*`
 * finds nothing, because no reader sees those asterisks.
 */

import { blockKey, cellKey, itemKey, type Section } from './sections'
import type { BlockNode, InlineNode } from './parseMarkdown'

export interface Segment {
  text: string
  isMatch: boolean
}

export interface NoteSearch {
  /** Total matches in the note. */
  count: number
  /** Foldable keys that must be open for every match to be rendered. */
  reveal: Set<string>
  /**
   * Container key to the ordinal of its first match, counting from 0 within this note.
   * A container absent from the map holds no matches.
   */
  bases: Map<string, number>
}

const EMPTY: NoteSearch = { count: 0, reveal: new Set(), bases: new Map() }

/** Names the heading of a section as a text container, distinct from its fold key. */
export const headingKey = (sectionKey: string) => `${sectionKey}#h`

/**
 * Splits text into alternating plain and matching runs. The renderer wraps the
 * matching ones, so this is the single definition of what counts as a match.
 */
export function splitMatches(text: string, query: string): Segment[] {
  if (!query) return [{ text, isMatch: false }]

  const segments: Segment[] = []
  const haystack = text.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  let from = 0

  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) break
    if (at > from) segments.push({ text: text.slice(from, at), isMatch: false })
    segments.push({ text: text.slice(at, at + needle.length), isMatch: true })
    from = at + needle.length
  }

  if (from < text.length) segments.push({ text: text.slice(from), isMatch: false })
  return segments
}

/**
 * Where each match starts in a raw string, counting from 0. A note being written is in a
 * textarea, which has no elements to mark, so a find steps through it by selecting these
 * ranges instead. Same matcher as `splitMatches`, so source and rendered notes agree on
 * what counts and the panel can number them in one list.
 */
export function matchOffsets(text: string, query: string): number[] {
  if (!query) return []

  const offsets: number[] = []
  const haystack = text.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  let from = 0

  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return offsets
    offsets.push(at)
    from = at + needle.length
  }
}

function countInText(text: string, query: string): number {
  if (!query) return 0
  const haystack = text.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  let total = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return total
    total += 1
    from = at + needle.length
  }
}

/**
 * Counts matches in inline content in the order the renderer visits it: emphasis,
 * strong, and links are containers, so their children are counted in place.
 */
function countInInline(nodes: InlineNode[], query: string): number {
  let total = 0
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'code':
        total += countInText(node.value, query)
        break
      case 'strong':
      case 'emphasis':
      case 'link':
        total += countInInline(node.children, query)
        break
      case 'break':
        break
    }
  }
  return total
}

export function searchNote(root: Section, query: string): NoteSearch {
  if (!query) return EMPTY

  const reveal = new Set<string>()
  const bases = new Map<string, number>()
  let count = 0

  /**
   * Records a container's matches. `gates` are the foldable keys standing between the
   * container and the note: they only open if the container actually holds a match.
   */
  const record = (key: string, matches: number, gates: string[]) => {
    if (matches === 0) return
    bases.set(key, count)
    count += matches
    for (const gate of gates) reveal.add(gate)
  }

  const walkBlocks = (blocks: BlockNode[], path: string, gates: string[]) => {
    blocks.forEach((block, index) => {
      const key = blockKey(path, index)
      switch (block.type) {
        case 'paragraph':
          record(key, countInInline(block.content, query), gates)
          return
        case 'code':
          // A code block's own body is behind its fold; the summary line is not.
          record(key, countInText(block.value, query), [...gates, key])
          return
        case 'quote':
          walkBlocks(block.children, key, [...gates, key])
          return
        case 'list':
          block.items.forEach((item, itemIndex) => {
            const key2 = itemKey(key, itemIndex)
            // An item's own line shows whether or not its sub-points are folded.
            record(key2, countInInline(item.content, query), gates)
            if (item.children.length === 0) return
            walkBlocks(item.children, key2, [...gates, key2])
          })
          return
        case 'table':
          // A table isn't itself foldable, so a cell's match needs no gate of its own.
          block.header.forEach((cell, column) => {
            record(cellKey(key, -1, column), countInInline(cell, query), gates)
          })
          block.rows.forEach((row, rowIndex) => {
            row.forEach((cell, column) => {
              record(cellKey(key, rowIndex, column), countInInline(cell, query), gates)
            })
          })
          return
        case 'heading':
          // buildSections lifts every heading into a section of its own.
          return
      }
    })
  }

  const walkSection = (section: Section, gates: string[]) => {
    // A folded heading still shows its own text, so it is not behind its own key.
    if (section.heading) {
      record(headingKey(section.key), countInInline(section.heading.content, query), gates)
    }
    const inner = section.heading ? [...gates, section.key] : gates
    walkBlocks(section.blocks, section.key, inner)
    section.children.forEach((child) => walkSection(child, inner))
  }

  walkSection(root, [])
  return { count, reveal, bases }
}
