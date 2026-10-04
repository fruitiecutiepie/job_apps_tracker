import { describe, expect, it } from 'vitest'

import { createDemoDocument } from './domain/demo'
import { setPosting } from './domain/mutations'
import type { StateId, TrackerDocument } from './domain/types'
import { applyStageDraftBatches } from './stageDraftBatches'

const AT = new Date('2026-10-04T09:00:00.000Z')

/** The demo document with one application's current-stage note and posting set. */
function withNote(note: string, posting?: string): { document: TrackerDocument; id: string; state: StateId } {
  const document = createDemoDocument()
  const application = document.applications[0]
  const stamped = application.updated_at
  const updated = {
    ...application,
    stage_notes: [{ state: application.state, body: note, heard: [], created_at: stamped, updated_at: stamped }],
  }
  const withPosting = posting === undefined ? updated : setPosting(updated, { body: posting }, stamped)
  return {
    document: { ...document, applications: [withPosting, ...document.applications.slice(1)] },
    id: application.id,
    state: application.state,
  }
}

function noteIn(document: TrackerDocument, id: string): string | undefined {
  return document.applications.find((item) => item.id === id)?.stage_notes[0]?.body
}

/*
 * The panel's autosave stores whole bodies. Run on a document another tab has written
 * since the draft began, storing the draft as it is would undo that tab's edit; this is
 * where the two are merged, inside the mutation `commit` runs on the newest document.
 */
describe('storing the prep notes panel\'s drafts', () => {
  it('stores the draft as it is when the note has not moved since it began', () => {
    const { document, id, state } = withNote('Ask about the team.')
    const stored = applyStageDraftBatches(document, [
      { applicationId: id, drafts: [{ state, base: 'Ask about the team.', body: 'Ask about the team. And on-call.' }] },
    ], AT)
    expect(noteIn(stored, id)).toBe('Ask about the team. And on-call.')
  })

  it('keeps another tab\'s edit made since the draft began, and the draft\'s too', () => {
    const { document, id, state } = withNote('Before anything: the team page. Ask about the team.')
    const stored = applyStageDraftBatches(document, [
      { applicationId: id, drafts: [{ state, base: 'Ask about the team.', body: 'Ask about the team. And on-call.' }] },
    ], AT)
    expect(noteIn(stored, id)).toBe('Before anything: the team page. Ask about the team. And on-call.')
  })

  // Both typed at the end, so both are kept, the other tab's first: nothing is dropped.
  it('merges a posting the same way', () => {
    const { document, id } = withNote('Notes.', 'Senior engineer. Remote.')
    const stored = applyStageDraftBatches(document, [
      { applicationId: id, drafts: [], posting: 'Senior engineer. Remote-first.', postingBase: 'Senior engineer.' },
    ], AT)
    expect(stored.applications.find((item) => item.id === id)?.posting?.body).toBe(
      'Senior engineer. Remote. Remote-first.',
    )
  })
})
