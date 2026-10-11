import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDialogKeyboard } from '../useDialogKeyboard'
import { FeedbackWidget } from './FeedbackWidget'
import type { FeedbackSubmission } from './report'

interface Sent {
  url: string
  submission: FeedbackSubmission
  screenshots: File[]
}

/*
 * The panel posts a `FormData`; this reads it back the way the route will, so a test can
 * say what was sent rather than how it was assembled.
 */
function stubInbox(answer: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const form = init?.body as FormData
    const entry = {
      url: String(input),
      submission: JSON.parse(String(form.get('report'))) as FeedbackSubmission,
      screenshots: form.getAll('screenshot') as File[],
    }
    sent.push(entry)
    return answer(entry)
  }))
  return sent
}

const ok = () => new Response(JSON.stringify({ id: 'remote-1' }), { status: 201 })

beforeEach(() => {
  // jsdom has no object URLs; the thumbnails only need a string.
  let next = 0
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:test/${(next += 1)}`),
    revokeObjectURL: vi.fn(),
  }))
})

function Page({ dialog = false }: { dialog?: boolean }) {
  return (
    <>
      <FeedbackWidget where="Kanban" />
      <button type="button">Add application</button>
      <label>
        Company <input defaultValue="" />
      </label>
      {dialog && <Dialog />}
    </>
  )
}

function Dialog() {
  const [open, setOpen] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  useDialogKeyboard(ref, () => setOpen(false))
  return open ? (
    <div aria-label="Edit application" aria-modal="true" ref={ref} role="dialog">
      <button type="button">Save</button>
    </div>
  ) : null
}

function panel() {
  return screen.getByRole('dialog', { name: 'Feedback' })
}

describe('the feedback panel', () => {
  it('sends what was written, with the page it was about and an optional email', async () => {
    const sent = stubInbox(ok)
    const user = userEvent.setup()
    render(<Page />)

    await user.click(screen.getByRole('button', { name: 'Feedback' }))
    const form = within(panel())
    expect(form.getByRole('textbox', { name: 'What went wrong?' })).toHaveFocus()

    await user.click(form.getByRole('radio', { name: 'Idea' }))
    await user.type(form.getByRole('textbox', { name: 'What would make this better?' }), 'Dark mode for the board')
    await user.type(form.getByRole('textbox', { name: /Email me/ }), 'me@example.com')
    await user.click(form.getByRole('button', { name: 'Send' }))

    await screen.findByText('Thank you — it is sent.')
    expect(screen.getByText('You will hear at me@example.com when it is dealt with.')).toBeInTheDocument()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.url).toBe('/api/feedback')
    expect(sent[0]!.submission).toMatchObject({
      kind: 'idea',
      message: 'Dark mode for the board',
      email: 'me@example.com',
      context: { view: 'Kanban', build: 'local demo' },
    })
  })

  it('will not send an empty message or an email that is not one', async () => {
    const sent = stubInbox(ok)
    const user = userEvent.setup()
    render(<Page />)
    await user.click(screen.getByRole('button', { name: 'Feedback' }))
    const form = within(panel())

    await user.click(form.getByRole('button', { name: 'Send' }))
    expect(form.getByText('Write a line about it first.')).toBeInTheDocument()

    await user.type(form.getByRole('textbox', { name: 'What went wrong?' }), 'Broken')
    await user.type(form.getByRole('textbox', { name: /Email me/ }), 'not-an-address')
    await user.click(form.getByRole('button', { name: 'Send' }))
    expect(form.getByText(/That email address does not look right/)).toBeInTheDocument()
    expect(sent).toHaveLength(0)
  })

  it('shrinks to a pill while the problem is shown, recording the controls and never the typing', async () => {
    const sent = stubInbox(ok)
    const user = userEvent.setup()
    render(<Page />)

    await user.click(screen.getByRole('button', { name: 'Feedback' }))
    await user.type(within(panel()).getByRole('textbox', { name: 'What went wrong?' }), 'Add does nothing')
    await user.click(within(panel()).getByRole('button', { name: /Show me/ }))

    expect(screen.queryByRole('dialog', { name: 'Feedback' })).not.toBeInTheDocument()
    const pill = screen.getByRole('region', { name: 'Recording steps for your feedback' })
    expect(pill).toHaveTextContent('Recording · 0 steps')

    await user.click(screen.getByRole('button', { name: 'Add application' }))
    await user.type(screen.getByRole('textbox', { name: 'Company' }), 'Secret Employer')
    await user.tab()
    expect(pill).toHaveTextContent('Recording · 2 steps')

    await user.click(within(pill).getByRole('button', { name: 'Done' }))
    const steps = within(panel()).getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual([
      'Clicked button “Add application”',
      'Edited “Company”',
    ])
    // What was being written survives the round trip.
    expect(within(panel()).getByRole('textbox', { name: 'What went wrong?' })).toHaveValue('Add does nothing')

    // Any step can be taken out before it goes.
    await user.click(within(panel()).getByRole('button', { name: 'Remove step: Edited “Company”' }))
    await user.click(within(panel()).getByRole('button', { name: 'Send' }))
    await screen.findByText('Thank you — it is sent.')
    expect(sent[0]!.submission.steps.map((step) => step.text)).toEqual(['Clicked button “Add application”'])
    expect(JSON.stringify(sent[0]!.submission)).not.toContain('Secret Employer')
  })

  it('takes a pasted image as a screenshot rather than as a tracker to import', async () => {
    const sent = stubInbox(ok)
    const windowPaste = vi.fn()
    window.addEventListener('paste', windowPaste)
    const user = userEvent.setup()
    render(<Page />)
    await user.click(screen.getByRole('button', { name: 'Feedback' }))

    const image = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' })
    const textbox = within(panel()).getByRole('textbox', { name: 'What went wrong?' })
    fireEvent.paste(textbox, { clipboardData: { files: [image], types: ['Files'] } })

    expect(await within(panel()).findByRole('img', { name: 'Screenshot 1' })).toBeInTheDocument()
    expect(windowPaste).not.toHaveBeenCalled()
    window.removeEventListener('paste', windowPaste)

    await user.type(textbox, 'See the picture')
    await user.click(within(panel()).getByRole('button', { name: 'Send' }))
    await screen.findByText('Thank you — it is sent.')
    expect(sent[0]!.screenshots).toHaveLength(1)
    expect(sent[0]!.screenshots[0]!.type).toBe('image/png')
  })

  it('keeps a report that could not be sent, and sends it again on request', async () => {
    let up = false
    stubInbox(() => (up ? ok() : new Response(JSON.stringify({ error: 'Inbox is down.' }), { status: 503 })))
    const user = userEvent.setup()
    render(<Page />)
    await user.click(screen.getByRole('button', { name: 'Feedback' }))
    await user.type(within(panel()).getByRole('textbox', { name: 'What went wrong?' }), 'It broke')
    await user.click(within(panel()).getByRole('button', { name: 'Send' }))

    await within(panel()).findByText('Not sent: Inbox is down.')
    expect(within(panel()).getByRole('button', { name: /Sent/, pressed: true })).toBeInTheDocument()

    up = true
    await user.click(within(panel()).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(within(panel()).queryByText(/Not sent/)).not.toBeInTheDocument())
    expect(within(panel()).getByText(/^Sent /)).toBeInTheDocument()
  })

  it('closes on Escape without closing the dialog it was opened over, and keeps the draft', async () => {
    stubInbox(ok)
    const user = userEvent.setup()
    render(<Page dialog />)

    await user.click(screen.getByRole('button', { name: 'Feedback' }))
    await user.type(within(panel()).getByRole('textbox', { name: 'What went wrong?' }), 'Half written')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Feedback' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Edit application' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Feedback' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Feedback' }))
    expect(within(panel()).getByRole('textbox', { name: 'What went wrong?' })).toHaveValue('Half written')
  })

  /*
   * The browser's prompt speaks of sharing or recording the screen, which is alarming from a
   * button reading Screenshot. The panel says what is coming first — once per browser.
   */
  it('says what the browser will ask before the first screenshot, and only then', async () => {
    const getDisplayMedia = vi.fn(async () => {
      throw new DOMException('Declined', 'NotAllowedError')
    })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia } })
    try {
      const user = userEvent.setup()
      render(<Page />)
      await user.click(screen.getByRole('button', { name: 'Feedback' }))

      await user.click(within(panel()).getByRole('button', { name: 'Screenshot' }))
      let notice = within(panel()).getByRole('group', { name: 'Before the screenshot' })
      expect(notice).toHaveTextContent('Your browser will ask to share this tab.')
      expect(getDisplayMedia).not.toHaveBeenCalled()

      await user.click(within(notice).getByRole('button', { name: 'Cancel' }))
      expect(within(panel()).queryByRole('group', { name: 'Before the screenshot' })).not.toBeInTheDocument()
      expect(getDisplayMedia).not.toHaveBeenCalled()

      await user.click(within(panel()).getByRole('button', { name: 'Screenshot' }))
      notice = within(panel()).getByRole('group', { name: 'Before the screenshot' })
      await user.click(within(notice).getByRole('button', { name: 'Continue' }))
      await waitFor(() => expect(getDisplayMedia).toHaveBeenCalledTimes(1))
      // Saying no to the browser is a choice, not an error.
      await waitFor(() => expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument())

      await user.click(within(panel()).getByRole('button', { name: 'Screenshot' }))
      // The panel steps out of the picture while the browser is asked, hence `hidden`.
      expect(screen.queryByRole('group', { name: 'Before the screenshot', hidden: true })).not.toBeInTheDocument()
      await waitFor(() => expect(getDisplayMedia).toHaveBeenCalledTimes(2))
      expect(await screen.findByRole('dialog', { name: 'Feedback' })).toBeVisible()
    } finally {
      Reflect.deleteProperty(navigator, 'mediaDevices')
    }
  })
})
