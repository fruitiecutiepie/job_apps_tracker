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
