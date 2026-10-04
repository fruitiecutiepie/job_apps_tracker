import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { StageNoteEditor } from './StageNoteEditor'

/*
 * A note can change under a box holding the caret without anyone typing into it: another
 * tab on the same tracker wrote it. Setting a textarea's value from outside sends the
 * caret to the end; the editor carries it through the change instead.
 */
function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <StageNoteEditor label="Northwind · Applied" onChange={setValue} value={value} />
      <button onClick={() => setValue((current) => `Before anything: ${current}`)} type="button">
        Elsewhere, above
      </button>
      <button onClick={() => setValue((current) => `${current} And later.`)} type="button">
        Elsewhere, below
      </button>
    </>
  )
}

function caretAt(box: HTMLTextAreaElement, offset: number) {
  box.focus()
  box.setSelectionRange(offset, offset)
  fireEvent.select(box)
}

describe('the caret when a note changes from elsewhere', () => {
  it('moves with the text when the change lands before it', () => {
    render(<Harness initial="Ask about the team." />)
    const box = screen.getByRole('textbox', { name: 'Northwind · Applied prep notes' }) as HTMLTextAreaElement
    caretAt(box, 9)

    // A click would move focus; the change arrives while the box still holds the caret.
    fireEvent.click(screen.getByRole('button', { name: 'Elsewhere, above' }))
    box.focus()

    expect(box.value).toBe('Before anything: Ask about the team.')
    expect(box.selectionStart).toBe(9 + 'Before anything: '.length)
  })

  it('stays where it was when the change lands after it', () => {
    render(<Harness initial="Ask about the team." />)
    const box = screen.getByRole('textbox', { name: 'Northwind · Applied prep notes' }) as HTMLTextAreaElement
    caretAt(box, 9)

    fireEvent.click(screen.getByRole('button', { name: 'Elsewhere, below' }))
    box.focus()

    expect(box.value).toBe('Ask about the team. And later.')
    expect(box.selectionStart).toBe(9)
  })

  /*
   * Formatting changes the note from the toolbar rather than from the box, so it does not
   * pass through the box's own edits. It is still the reader's change: the selection it
   * sets — the word, inside its new marks — must be the one left standing, not a caret
   * carried through it as though another tab had written.
   */
  it('leaves the selection formatting sets, rather than carrying the caret through it', async () => {
    render(<Harness initial="Ask about the team." />)
    const box = screen.getByRole('textbox', { name: 'Northwind · Applied prep notes' }) as HTMLTextAreaElement
    box.focus()
    box.setSelectionRange(14, 18)
    fireEvent.select(box)

    fireEvent.click(screen.getByRole('button', { name: 'Bold in Northwind · Applied' }))

    expect(box.value).toBe('Ask about the **team**.')
    await waitFor(() => {
      expect(box.value.slice(box.selectionStart, box.selectionEnd)).toBe('team')
    })
    expect(document.activeElement).toBe(box)
  })

  it('leaves the caret to the box when the change is the reader\'s own typing', async () => {
    const user = userEvent.setup()
    render(<Harness initial="Ask about the team." />)
    const box = screen.getByRole('textbox', { name: 'Northwind · Applied prep notes' }) as HTMLTextAreaElement
    caretAt(box, 3)

    await user.keyboard('!')
    expect(box.value).toBe('Ask! about the team.')
    expect(box.selectionStart).toBe(4)
  })
})
