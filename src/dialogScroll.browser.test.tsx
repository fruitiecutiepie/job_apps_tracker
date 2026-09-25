/**
 * Arriving at the messages section must scroll the dialog and nothing else. The backdrop is
 * `position: fixed` with `overflow-y: auto` and `place-items: center`, so it is a scroll
 * container of its own — and `scrollIntoView` walks every scrollable ancestor, which scrolls
 * the backdrop under the dialog and clips a centred child at its edges.
 */
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { page } from '@vitest/browser/context'

import { CorrespondenceFields } from './CorrespondenceFields'
import { createDemoDocument } from './domain/demo'
import { correspondenceRowsFor, type CorrespondenceRow } from './correspondence'

const atlas = createDemoDocument().applications.find((a) => a.company === 'Atlas Thread')!

function Harness() {
  const [rows, setRows] = useState<CorrespondenceRow[]>(correspondenceRowsFor(atlas))
  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        {Array.from({ length: 12 }, (_, i) => (
          <label className="field" key={i}><span>Filler {i}</span><input /></label>
        ))}
        <div className="form-grid">
          <CorrespondenceFields
            defaultState="recruiter_messaged"
            messagesFor="recruiter_messaged"
            onChange={setRows}
            rows={rows}
          />
        </div>
      </div>
    </div>
  )
}

describe('the dialog that opens at the messages', () => {
  it('stays inside its own width however long a subject or summary is', async () => {
    await page.viewport(520, 700)
    render(<Harness />)

    const backdrop = document.querySelector<HTMLElement>('.dialog-backdrop')!
    const dialog = document.querySelector<HTMLElement>('.dialog')!
    const box = dialog.getBoundingClientRect()

    // 42rem is what the dialog asks for, and it may not grow past the overlay it is centred
    // in. A grid item's `min-width` is `auto`, so one box that cannot shrink — a fieldset, a
    // row holding a line that does not wrap — sets a min-content floor and the dialog widens
    // off the side of the screen, clipping at both edges because it is centred.
    expect(Math.round(box.width)).toBeLessThanOrEqual(672)
    expect(Math.round(box.right)).toBeLessThanOrEqual(
      Math.round(backdrop.getBoundingClientRect().right),
    )
    expect(Math.round(box.left)).toBeGreaterThanOrEqual(0)

    // And no box inside it overflows sideways. Asserted on the boxes rather than on the
    // dialog's `scrollWidth`: a truncated line legitimately scrolls wider than it renders, so
    // the dialog's own scrollWidth says nothing, while a child wider than its parent does.
    const inner = dialog.clientWidth
    const overflowing = [...dialog.querySelectorAll<HTMLElement>('*')]
      .filter((node) => node.getBoundingClientRect().width > inner)
      .map((node) => `${node.tagName}.${node.className}`)
    expect(overflowing).toEqual([])
  })

  it('scrolls the dialog and leaves the backdrop where it was', async () => {
    await page.viewport(900, 700)
    render(<Harness />)

    const backdrop = document.querySelector<HTMLElement>('.dialog-backdrop')!
    const dialog = document.querySelector<HTMLElement>('.dialog')!

    // The section is what moved into view, inside the dialog's own scroll.
    expect(dialog.scrollTop).toBeGreaterThan(0)
    // And the fixed overlay never moves: a centred child scrolled inside it clips at its edges.
    expect(backdrop.scrollTop).toBe(0)
    expect(Math.round(dialog.getBoundingClientRect().left)).toBeGreaterThanOrEqual(0)
    expect(Math.round(dialog.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0)
  })
})
