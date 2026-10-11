import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { createDemoDocument } from './domain/demo'
import type { Application, StageId } from './domain'
import { openingLayout } from './notesArrangement'
import { StageNotesPanel, type StageNoteDraftBatch } from './StageNotesPanel'
import { stageLabel } from './domain'

/*
 * Another tab holding the same tracker writes the same note. A note autosaves its whole
 * body, so a tab with keystrokes not yet written would — without merging — go on showing
 * a stale body and then write it over the other tab's edit at its next pause. These pin
 * the panel's half: it merges what arrives, and it sends what each draft began from so the
 * save can merge again against whatever is stored by then.
 */
const BASE = 'Ask about the team.'

function halcyonWithNote(): Application {
  const application = createDemoDocument().applications.find((item) => item.company === 'Halcyon Maps')!
  const at = application.updated_at
  return {
    ...application,
    stage_notes: [{ stage: application.stage, body: BASE, heard: [], created_at: at, updated_at: at }],
  }
}

function withBody(application: Application, stage: StageId, body: string): Application {
  return {
    ...application,
    stage_notes: application.stage_notes.map((note) => (note.stage === stage ? { ...note, body } : note)),
  }
}

function mount() {
  const saved: StageNoteDraftBatch[][] = []
  let setApplications: (applications: Application[]) => void = () => {}
  const halcyon = halcyonWithNote()
  const layout = openingLayout(halcyon, halcyon.stage)

  function Harness() {
    const [applications, set] = useState([halcyon])
    setApplications = set
    return (
      <StageNotesPanel
        applications={applications}
        initial={{ layout, focusedGroupId: layout.id }}
        onArrange={() => {}}
        onCapture={async () => {}}
        onEmpty={() => {}}
        onExternalChange={async () => {}}
        onOpenApplication={() => {}}
        onRevise={async () => {}}
        onSaveDrafts={async (batches) => {
          saved.push(batches)
          return true
        }}
        request={null}
      />
    )
  }

  render(<Harness />)
  const label = `Halcyon Maps · ${stageLabel(halcyon.stage)}`
  return {
    halcyon,
    label,
    saved,
    elsewhere: (body: string) => act(() => setApplications([withBody(halcyon, halcyon.stage, body)])),
  }
}

describe('a note written in another tab at the same time', () => {
  it('merges the other tab\'s edit into keystrokes not yet saved', async () => {
    const user = userEvent.setup()
    const { label, elsewhere } = mount()
    await user.click(screen.getByRole('button', { name: `Edit ${label}` }))
    const box = screen.getByRole('textbox', { name: `${label} prep notes` })
    await user.click(box)
    await user.keyboard('{Control>}{End}{/Control} Ask about on-call.')

    elsewhere(`Before anything: the team page. ${BASE}`)

    expect(box).toHaveValue(`Before anything: the team page. ${BASE} Ask about on-call.`)
  })

  it('sends each draft with the text it began from, so the save can merge too', async () => {
    const user = userEvent.setup()
    const { label, saved } = mount()
    await user.click(screen.getByRole('button', { name: `Edit ${label}` }))
    await user.click(screen.getByRole('textbox', { name: `${label} prep notes` }))
    await user.keyboard('{Control>}{End}{/Control} More.')

    await waitFor(() => expect(saved).not.toHaveLength(0), { timeout: 3000 })
    expect(saved[0][0].drafts[0]).toMatchObject({ base: BASE, body: `${BASE} More.` })
  })

  it('takes the other tab\'s body as it is when nothing here is unsaved', async () => {
    const user = userEvent.setup()
    const { label, elsewhere } = mount()
    await user.click(screen.getByRole('button', { name: `Edit ${label}` }))
    const box = screen.getByRole('textbox', { name: `${label} prep notes` })

    elsewhere('Rewritten in the other tab.')
    expect(box).toHaveValue('Rewritten in the other tab.')
  })
})
