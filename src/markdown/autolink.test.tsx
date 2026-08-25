/**
 * A note is written mid-conversation and pasted into, so the URLs in one usually arrive
 * bare rather than wrapped in `[]()`. These read the rendered note, not the AST: what
 * was reported is that a pasted posting or meeting URL looks like a link in the reading
 * view and does nothing when clicked, which is a question of the markup that comes out.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MarkdownNotes } from './MarkdownNotes'

function readNote(source: string) {
  return render(
    <MarkdownNotes currentMatch={null} label="Screen" matchBase={0} query="" source={source} />,
  )
}

describe('links in the reading view', () => {
  it('opens a bare URL pasted into a note', () => {
    readNote('Posting: https://example.com/jobs\n')
    const link = screen.getByRole('link', { name: 'https://example.com/jobs' })
    expect(link).toHaveAttribute('href', 'https://example.com/jobs')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('opens a URL captured in a point, and one written as a link beside it', () => {
    readNote('- Zoom https://example.com/call and the [posting](https://example.com/jobs)\n')
    expect(screen.getByRole('link', { name: 'https://example.com/call' })).toHaveAttribute(
      'href',
      'https://example.com/call',
    )
    expect(screen.getByRole('link', { name: 'posting' })).toHaveAttribute(
      'href',
      'https://example.com/jobs',
    )
  })

  it('mails a bare address', () => {
    readNote('Recruiter: jane.doe@example.com\n')
    expect(screen.getByRole('link', { name: 'jane.doe@example.com' })).toHaveAttribute(
      'href',
      'mailto:jane.doe@example.com',
    )
  })

  it('renders one link, not a link inside a link, when the label is the URL', () => {
    const { container } = readNote('[https://example.com/jobs](https://example.com/jobs)\n')
    expect(container.querySelectorAll('a')).toHaveLength(1)
  })

  it('leaves a URL inside a code span as code', () => {
    const { container } = readNote('Run `curl https://example.com/jobs` first\n')
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it('leaves a URL inside a fenced block as code', () => {
    const { container } = readNote('```sh\ncurl https://example.com/jobs\n```\n')
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })
})
