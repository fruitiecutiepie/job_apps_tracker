/**
 * A folded section leaves its nested headings out of the DOM entirely rather than merely
 * hiding them, so jumping to one from the outline has nothing to scroll to until its
 * ancestors are opened. `revealKeys` is what the outline uses to open that path.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { MarkdownNotes } from './MarkdownNotes'
import { buildSections, sectionPath, type Section } from './sections'
import { inlineText, parseMarkdown } from './parseMarkdown'

const NOTE = ['## Java-specific', '', '### Multithreading', '', 'Some detail.'].join('\n')

const sectionsOf = (source: string) => buildSections(parseMarkdown(source))

/** The key the outline would hand back for the heading with this text. */
function keyFor(root: Section, text: string): string {
  const walk = (section: Section): string | null => {
    for (const child of section.children) {
      if (child.heading && inlineText(child.heading.content) === text) return child.key
      const found = walk(child)
      if (found) return found
    }
    return null
  }
  const key = walk(root)
  if (!key) throw new Error(`no heading called ${text}`)
  return key
}

describe('MarkdownNotes revealKeys', () => {
  it('drops a nested heading from the DOM while its parent is folded', async () => {
    const user = userEvent.setup()
    render(<MarkdownNotes label="Stage" source={NOTE} />)

    expect(screen.getByText('Multithreading')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Java-specific' }))

    expect(screen.queryByText('Multithreading')).not.toBeInTheDocument()
  })

  it('brings that heading back when its path is revealed', async () => {
    const user = userEvent.setup()
    const root = sectionsOf(NOTE)
    const path = new Set(
      sectionPath(root, keyFor(root, 'Multithreading')).map((entry) => entry.key),
    )

    const { rerender } = render(<MarkdownNotes label="Stage" source={NOTE} />)
    await user.click(screen.getByRole('button', { name: 'Java-specific' }))
    expect(screen.queryByText('Multithreading')).not.toBeInTheDocument()

    rerender(<MarkdownNotes label="Stage" revealKeys={path} source={NOTE} />)

    expect(screen.getByText('Multithreading')).toBeInTheDocument()
  })
})
