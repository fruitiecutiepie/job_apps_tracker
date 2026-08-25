/**
 * A note that carries its own table of contents links to its headings by fragment —
 * `[Background](#background)` — which is what a Markdown note written elsewhere and
 * pasted in arrives with. Those links belong to the note, not to the web: following one
 * moves the reading view to that heading, opening whatever fold it is inside, rather
 * than leaving the panel for a URL the browser cannot resolve.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MarkdownNotes } from './MarkdownNotes'
import { headingSlug, sectionSlugs } from './sections'
import { buildSections, parseInline, parseMarkdown } from './index'

const NOTE = [
  '- [Background](#background)',
  '  - [Experience / CV Walkthrough](#experience--cv-walkthrough)',
  '',
  '## Background',
  '',
  'Why they are hiring.',
  '',
  '### Experience / CV Walkthrough',
  '',
  'The three roles worth telling.',
  '',
].join('\n')

describe('heading slugs', () => {
  it('slugs a heading the way a generated table of contents does', () => {
    expect(headingSlug('Background')).toBe('background')
    expect(headingSlug('Experience / CV Walkthrough')).toBe('experience--cv-walkthrough')
    expect(headingSlug('What are the team’s goals?')).toBe('what-are-the-teams-goals')
  })

  it('numbers a heading repeated in one note, as a table of contents does', () => {
    const slugs = sectionSlugs(buildSections(parseMarkdown('## Notes\n\n### Notes\n')))
    expect([...slugs.keys()]).toEqual(['notes', 'notes-1'])
  })
})

describe('fragment links', () => {
  it('keeps a fragment destination as a link', () => {
    expect(parseInline('[Background](#background)')).toEqual([
      { type: 'link', href: '#background', children: [{ type: 'text', value: 'Background' }] },
    ])
  })

  it('renders one in the note without sending it to a new tab', () => {
    render(<MarkdownNotes label="Screen" source={NOTE} />)
    const link = screen.getByRole('link', { name: 'Background' })
    expect(link).toHaveAttribute('href', '#background')
    expect(link).not.toHaveAttribute('target')
  })

  it('jumps to the heading it names rather than navigating', async () => {
    const onJump = vi.fn()
    render(<MarkdownNotes label="Screen" onJumpToSection={onJump} source={NOTE} />)

    await userEvent.click(screen.getByRole('link', { name: 'Experience / CV Walkthrough' }))

    // The key of the `### Experience / CV Walkthrough` section, nested under Background.
    expect(onJump).toHaveBeenCalledWith('root.h1.h2')
  })

  it('opens the fold the heading is inside when it follows the link itself', async () => {
    const { container } = render(<MarkdownNotes label="Screen" source={NOTE} />)

    await userEvent.click(screen.getByRole('button', { name: 'Collapse all points in Screen' }))
    expect(screen.queryByText('Why they are hiring.')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: 'Background' }))
    expect(screen.getByText('Why they are hiring.')).toBeInTheDocument()
    expect(container.querySelector('[data-section-key="root.h1"]')).toBeTruthy()
  })

  it('does nothing for a fragment no heading answers to', async () => {
    render(<MarkdownNotes label="Screen" source={'[Missing](#nowhere)\n'} />)
    await userEvent.click(screen.getByRole('link', { name: 'Missing' }))
    expect(screen.getByRole('link', { name: 'Missing' })).toBeInTheDocument()
  })

  it('still refuses a destination that is neither a fragment nor a linkable scheme', () => {
    expect(parseInline('[bad](javascript:alert(1))')).toEqual([{ type: 'text', value: 'bad' }])
    expect(parseInline('[local](/etc/passwd)')).toEqual([{ type: 'text', value: 'local' }])
  })
})
