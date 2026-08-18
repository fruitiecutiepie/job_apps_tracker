import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  STATE_CONFIG,
  STATE_IDS,
  addAttachment,
  addStateEvent,
  applyStageNotes,
  applyStateEvents,
  createApplication,
  createAttachmentMetadata,
  createDemoDocument,
  createEmptyDocument,
  createUuidV7,
  editApplication,
  indexesAreStale,
  isSafeArchiveAttachmentPath,
  loadTrackerDocument,
  moveApplication,
  moveApplicationState,
  packTrackerArchive,
  parseTrackerDocument,
  rebuildIndexes,
  rejectedStateFor,
  removeAttachment,
  removeStateEvent,
  saveTrackerDocument,
  serializeTrackerDocument,
  setStageNote,
  stageNoteFor,
  stateEventsFor,
  trackerDatabasePath,
  unpackTrackerArchive,
  updateApplicationStageNotes,
  updateApplicationStateEvents,
  validateTrackerDocument,
} from './index'
import type { TrackerDocument } from './index'
import { MemoryTrackerStore } from './storage'

const REFERENCE = new Date('2026-08-14T12:00:00+10:00')

class MemoryStorage extends MemoryTrackerStore {}

describe('state configuration and demo content', () => {
  it('defines the complete ordered state list and preserves rejection labels', () => {
    expect(STATE_CONFIG).toHaveLength(19)
    expect(new Set(STATE_IDS).size).toBe(19)
    expect(STATE_CONFIG.find(({ id }) => id === 'offer_rejected')?.label).toBe(
      'Offer — Rejected',
    )
  })

  it('maps each state to its rejected counterpart when one exists', () => {
    const expected: Record<(typeof STATE_IDS)[number], (typeof STATE_IDS)[number] | null> = {
      headhunted: null,
      no_openings: null,
      applied: 'auto_rejected',
      auto_rejected: null,
      recruiter_messaged: 'recruiter_messaged_rejected',
      recruiter_messaged_rejected: null,
      online_assessment: 'online_assessment_rejected',
      online_assessment_rejected: null,
      recruiter_interview: 'recruiter_interview_rejected',
      recruiter_interview_rejected: null,
      take_home_assessment: 'take_home_assessment_rejected',
      take_home_assessment_rejected: null,
      interview_1: 'interview_1_rejected',
      interview_1_rejected: null,
      interview_2: 'interview_2_rejected',
      interview_2_rejected: null,
      offer: 'offer_rejected',
      offer_rejected: null,
      accepted: null,
    }

    expect(STATE_IDS.map((id) => [id, rejectedStateFor(id)])).toEqual(
      STATE_IDS.map((id) => [id, expected[id]]),
    )
  })

  it('creates one useful example in every state', () => {
    const document = createDemoDocument(REFERENCE)

    expect(document.applications).toHaveLength(19)
    expect(document.applications.map(({ state }) => state)).toEqual(STATE_IDS)
    expect(document.applications.every((application) =>
      application.state_history.at(-1)?.state === application.state,
    )).toBe(true)
    expect(document.schema).toBeDefined()
    expect(document.indexes.by_id).toHaveProperty(document.applications[0]!.id)

    const now = REFERENCE.getTime()
    expect(document.applications.some(({ next_action, next_action_at }) =>
      next_action && next_action_at && new Date(next_action_at).getTime() < now,
    )).toBe(true)
    expect(document.applications.some(({ next_action, next_action_at }) =>
      next_action && next_action_at && new Date(next_action_at).getTime() > now,
    )).toBe(true)
    expect(document.applications.some(({ next_action, next_action_at }) =>
      next_action && next_action_at === null,
    )).toBe(true)
    expect(document.applications.some(({ updated_at }) =>
      now - new Date(updated_at).getTime() >= 14 * 24 * 60 * 60 * 1000,
    )).toBe(true)
    expect(document.applications.some(({ deadline_at }) =>
      deadline_at && new Date(deadline_at).getTime() < now,
    )).toBe(true)
    expect(document.applications.some(({ deadline_at }) =>
      deadline_at && new Date(deadline_at).getTime() > now,
    )).toBe(true)
    expect(document.applications.some(({ deadline_at }) => deadline_at === null)).toBe(true)
  })

  it('keeps the default demo document deterministic across wall-clock dates', () => {
    vi.useFakeTimers()

    try {
      vi.setSystemTime(new Date('2026-08-14T12:00:00+10:00'))
      const first = createDemoDocument()

      vi.setSystemTime(new Date('2027-01-03T08:00:00+11:00'))
      expect(createDemoDocument()).toEqual(first)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('tracker profiles', () => {
  it('keeps live and demo databases on separate paths', () => {
    expect(trackerDatabasePath('live')).toBe('data/tracker.json')
    expect(trackerDatabasePath('demo')).toBe('data/demo/tracker.json')
  })
})

describe('application mutations', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('generates UUIDv7-compatible identifiers', () => {
    expect(createUuidV7(REFERENCE.getTime())).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('creates a normalized application with its initial history entry', () => {
    const application = createApplication(
      {
        company: '  Northwind  ',
        role: ' Engineer ',
        url: ' https://example.com/jobs/1 ',
        state: 'applied',
      },
      REFERENCE,
    )

    expect(application.company).toBe('Northwind')
    expect(application.role).toBe('Engineer')
    expect(application.url).toBe('https://example.com/jobs/1')
    expect(application.source).toBeNull()
    expect(application.state_history).toEqual([{ state: 'applied', at: REFERENCE.toISOString() }])
    expect(application.attachments).toEqual([])
    expect(() => createApplication({ company: 'Northwind', url: 'ftp://example.com' }, REFERENCE))
      .toThrow(/URL/i)
  })

  it('canonicalizes optional source text on create and edit', () => {
    const created = createApplication(
      { company: 'Northwind', source: ' LinkedIn ' },
      REFERENCE,
    )
    expect(created.source).toBe('LinkedIn')

    const edited = editApplication(
      created,
      { source: '  ' },
      new Date('2026-08-15T12:00:00+10:00'),
    )
    expect(edited.source).toBeNull()
  })

  it('separates ordinary edits from state history and clears orphan dates', () => {
    const original = createApplication(
      { company: 'Northwind', next_action: 'Follow up', next_action_at: '2026-08-20T09:00:00+10:00' },
      REFERENCE,
    )
    const editTime = new Date('2026-08-15T12:00:00+10:00')
    const edited = editApplication(original, { role: 'Staff Engineer', next_action: null }, editTime)

    expect(edited.state_history).toEqual(original.state_history)
    expect(edited.updated_at).toBe(editTime.toISOString())
    expect(edited.next_action).toBeNull()
    expect(edited.next_action_at).toBeNull()
  })

  it('keeps a deadline independent of the next action', () => {
    const created = createApplication(
      {
        company: 'Northwind',
        next_action: 'Follow up',
        next_action_at: '2026-08-20T09:00:00+10:00',
        deadline_at: '2026-08-22T17:00:00+10:00',
      },
      REFERENCE,
    )

    expect(created.deadline_at).toBe(new Date('2026-08-22T17:00:00+10:00').toISOString())

    const cleared = editApplication(created, { next_action: null }, REFERENCE)
    expect(cleared.next_action_at).toBeNull()
    expect(cleared.deadline_at).toBe(created.deadline_at)

    const removed = editApplication(created, { deadline_at: null }, REFERENCE)
    expect(removed.deadline_at).toBeNull()
    expect(removed.next_action_at).toBe(created.next_action_at)

    const untouched = editApplication(created, { role: 'Staff Engineer' }, REFERENCE)
    expect(untouched.deadline_at).toBe(created.deadline_at)
  })

  it('stores a deadline without any next action', () => {
    const created = createApplication(
      { company: 'Northwind', deadline_at: '2026-08-22T17:00:00+10:00' },
      REFERENCE,
    )

    expect(created.next_action).toBeNull()
    expect(created.next_action_at).toBeNull()
    expect(created.deadline_at).toBe(new Date('2026-08-22T17:00:00+10:00').toISOString())
  })

  it('appends state history for moves and makes same-state moves a no-op', () => {
    const original = createApplication({ company: 'Northwind' }, REFERENCE)
    const moveTime = new Date('2026-08-16T12:00:00+10:00')
    const moved = moveApplicationState(original, 'offer', moveTime)

    expect(moved.state).toBe('offer')
    expect(moved.state_history).toEqual([
      ...original.state_history,
      { state: 'offer', at: moveTime.toISOString() },
    ])
    expect(moveApplicationState(moved, 'offer', new Date())).toBe(moved)
  })

  it('does not replace a document for a same-state move', () => {
    const document = createDemoDocument(REFERENCE)
    const target = document.applications[2]!

    expect(
      moveApplication(document, target.id, target.state, new Date('2026-08-20T12:00:00+10:00')),
    ).toBe(document)
  })
})

describe('indexes', () => {
  it('rebuilds query indexes from applications', () => {
    const document = createDemoDocument(REFERENCE)
    const indexes = rebuildIndexes(document.applications)

    expect(Object.keys(indexes.by_id)).toHaveLength(19)
    expect(indexes.by_created_at).toHaveLength(19)
    expect(indexes.stats_current.applied).toBe(1)
    expect(indexes.stats_ever_reached.applied).toBeGreaterThanOrEqual(1)
    expect(indexesAreStale(document.applications, indexes)).toBe(false)
  })

  it('indexes only applications with a deadline, in chronological order', () => {
    const early = createApplication(
      { company: 'Acme', deadline_at: '2026-08-20T17:00:00+10:00' },
      REFERENCE,
    )
    const late = createApplication(
      { company: 'Beta', deadline_at: '2026-09-01T17:00:00+10:00' },
      REFERENCE,
    )
    const none = createApplication({ company: 'Cedar' }, REFERENCE)
    const indexes = rebuildIndexes([late, none, early])

    expect(indexes.by_deadline_at).toEqual([early.id, late.id])
  })

  it('orders by created_at and groups by company', () => {
    const acmeOlder = createApplication({ company: 'Acme' }, new Date('2026-01-01T00:00:00.000Z'))
    const beta = createApplication({ company: 'Beta' }, new Date('2026-03-01T00:00:00.000Z'))
    const acmeNewer = createApplication({ company: 'Acme' }, new Date('2026-06-01T00:00:00.000Z'))
    const indexes = rebuildIndexes([acmeNewer, beta, acmeOlder])

    expect(indexes.by_created_at).toEqual([acmeOlder.id, beta.id, acmeNewer.id])
    expect(indexes.by_company).toEqual({
      Acme: [acmeNewer.id, acmeOlder.id],
      Beta: [beta.id],
    })
  })

  it('detects stale indexes after collection changes', () => {
    const document = createDemoDocument(REFERENCE)
    const indexes = rebuildIndexes(document.applications)
    const shortened = document.applications.slice(1)

    expect(indexesAreStale(shortened, indexes)).toBe(true)
  })
})

describe('attachments', () => {
  it('canonicalizes missing attachments to an empty array', () => {
    const parsed = parseTrackerDocument(JSON.stringify({
      schema_version: 1,
      applications: [{
        id: '018f24c0-0000-7000-8000-000000000001',
        company: 'Northwind',
        role: null,
        url: null,
        source: null,
        state: 'applied',
        next_action: null,
        next_action_at: null,
        notes: null,
        created_at: REFERENCE.toISOString(),
        updated_at: REFERENCE.toISOString(),
      }],
    }))

    expect(parsed.applications[0]?.attachments).toEqual([])
  })

  it('adds and removes attachment metadata without changing state history', () => {
    const application = createApplication({ company: 'Northwind' }, REFERENCE)
    const attachment = createAttachmentMetadata('resume.pdf', 'application/pdf', 1200, REFERENCE)
    const withAttachment = addAttachment(application, attachment, REFERENCE)

    expect(withAttachment.attachments).toHaveLength(1)
    expect(withAttachment.state_history).toEqual(application.state_history)

    const removed = removeAttachment(
      withAttachment,
      attachment.id,
      new Date('2026-08-16T02:00:00.000Z'),
    )
    expect(removed.attachments).toHaveLength(0)
    expect(removed.updated_at).toBe('2026-08-16T02:00:00.000Z')
  })

  it('includes attachment filenames in search indexes', () => {
    const application = addAttachment(
      createApplication({ company: 'Northwind' }, REFERENCE),
      createAttachmentMetadata('cover-letter.pdf', 'application/pdf', 900, REFERENCE),
      REFERENCE,
    )
    const indexes = rebuildIndexes([application])
    expect(indexes.search_text[application.id]).toContain('cover-letter.pdf')
  })

  it('includes source in search indexes', () => {
    const application = createApplication(
      { company: 'Northwind', source: 'Referral' },
      REFERENCE,
    )
    const indexes = rebuildIndexes([application])
    expect(indexes.search_text[application.id]).toContain('referral')
  })
})

describe('stage prep notes', () => {
  const LATER = new Date('2026-08-16T02:00:00.000Z')

  it('records a prep note for a stage with its own timestamps', () => {
    const application = createApplication({ company: 'Northwind' }, REFERENCE)
    const withNote = setStageNote(application, 'interview_1', '  Ask about the panel  ', REFERENCE)

    expect(withNote.stage_notes).toEqual([
      {
        state: 'interview_1',
        body: 'Ask about the panel',
        created_at: REFERENCE.toISOString(),
        updated_at: REFERENCE.toISOString(),
      },
    ])
    expect(withNote.updated_at).toBe(REFERENCE.toISOString())
    expect(withNote.state_history).toEqual(application.state_history)
  })

  it('records notes for a stage the application has not reached yet', () => {
    const application = createApplication({ company: 'Northwind', state: 'applied' }, REFERENCE)
    const withNote = setStageNote(application, 'offer', 'Target band', REFERENCE)

    expect(stageNoteFor(withNote, 'offer')?.body).toBe('Target band')
    expect(withNote.state).toBe('applied')
  })

  it('keeps created_at when a note is rewritten and refreshes updated_at', () => {
    const application = setStageNote(
      createApplication({ company: 'Northwind' }, REFERENCE),
      'interview_1',
      'First draft',
      REFERENCE,
    )
    const rewritten = setStageNote(application, 'interview_1', 'Second draft', LATER)

    expect(stageNoteFor(rewritten, 'interview_1')).toEqual({
      state: 'interview_1',
      body: 'Second draft',
      created_at: REFERENCE.toISOString(),
      updated_at: LATER.toISOString(),
    })
    expect(rewritten.updated_at).toBe(LATER.toISOString())
  })

  it('treats an unchanged note as a no-op', () => {
    const application = setStageNote(
      createApplication({ company: 'Northwind' }, REFERENCE),
      'interview_1',
      'Ask about the panel',
      REFERENCE,
    )

    expect(setStageNote(application, 'interview_1', '  Ask about the panel ', LATER)).toBe(application)
  })

  it('clears a note when the body is blank and leaves other stages alone', () => {
    let application = createApplication({ company: 'Northwind' }, REFERENCE)
    application = setStageNote(application, 'interview_1', 'Panel notes', REFERENCE)
    application = setStageNote(application, 'offer', 'Comp notes', REFERENCE)

    const cleared = setStageNote(application, 'interview_1', '   ', LATER)
    expect(cleared.stage_notes.map((note) => note.state)).toEqual(['offer'])
    expect(cleared.updated_at).toBe(LATER.toISOString())
  })

  it('keeps notes in configured state order and rejects duplicate stages', () => {
    const application = applyStageNotes(
      createApplication({ company: 'Northwind' }, REFERENCE),
      [
        { state: 'offer', body: 'Comp notes' },
        { state: 'recruiter_interview', body: 'Recruiter notes' },
      ],
      REFERENCE,
    )

    expect(application.stage_notes.map((note) => note.state)).toEqual([
      'recruiter_interview',
      'offer',
    ])
    expect(() =>
      applyStageNotes(application, [
        { state: 'offer', body: 'One' },
        { state: 'offer', body: 'Two' },
      ], REFERENCE),
    ).toThrow(/only one prep note/)
  })

  it('updates stage notes through the document without touching other applications', () => {
    const document = createDemoDocument(REFERENCE)
    const target = document.applications.find((application) => application.state === 'interview_1')!
    const updated = updateApplicationStageNotes(
      document,
      target.id,
      [{ state: 'interview_1', body: 'Bring the case study' }],
      LATER,
    )

    const after = updated.applications.find((application) => application.id === target.id)!
    expect(stageNoteFor(after, 'interview_1')?.body).toBe('Bring the case study')
    expect(updated.applications).toHaveLength(document.applications.length)
    expect(updated.applications.filter((application) => application.id !== target.id)).toEqual(
      document.applications.filter((application) => application.id !== target.id),
    )
  })

  it('canonicalizes missing stage notes and sorts supplied ones by state order', () => {
    const parsed = parseTrackerDocument(JSON.stringify({
      schema_version: 1,
      applications: [
        {
          id: '018f24c0-0000-7000-8000-000000000001',
          company: 'Northwind',
          state: 'applied',
          created_at: REFERENCE.toISOString(),
          updated_at: REFERENCE.toISOString(),
        },
        {
          id: '018f24c0-0000-7000-8000-000000000002',
          company: 'Southwind',
          state: 'offer',
          stage_notes: [
            { state: 'offer', body: ' Comp notes ', created_at: REFERENCE.toISOString(), updated_at: REFERENCE.toISOString() },
            { state: 'interview_1', body: 'Panel notes', created_at: REFERENCE.toISOString(), updated_at: REFERENCE.toISOString() },
          ],
          created_at: REFERENCE.toISOString(),
          updated_at: REFERENCE.toISOString(),
        },
      ],
    }))

    expect(parsed.applications[0]?.stage_notes).toEqual([])
    expect(parsed.applications[1]?.stage_notes.map((note) => note.state)).toEqual([
      'interview_1',
      'offer',
    ])
    expect(parsed.applications[1]?.stage_notes[1]?.body).toBe('Comp notes')
  })

  it('rejects blank bodies, invalid stages, and duplicate stages', () => {
    const stageNotes = (notes: unknown) => ({
      schema_version: 1,
      applications: [{
        id: '018f24c0-0000-7000-8000-000000000001',
        company: 'Northwind',
        state: 'applied',
        stage_notes: notes,
        created_at: REFERENCE.toISOString(),
        updated_at: REFERENCE.toISOString(),
      }],
    })

    const blank = validateTrackerDocument(stageNotes([
      { state: 'applied', body: '   ', created_at: REFERENCE.toISOString(), updated_at: REFERENCE.toISOString() },
    ]))
    expect(blank.ok).toBe(false)

    const invalidState = validateTrackerDocument(stageNotes([
      { state: 'nope', body: 'Notes', created_at: REFERENCE.toISOString(), updated_at: REFERENCE.toISOString() },
    ]))
    expect(invalidState.ok).toBe(false)

    const duplicated = validateTrackerDocument(stageNotes([
      { state: 'applied', body: 'One', created_at: REFERENCE.toISOString(), updated_at: REFERENCE.toISOString() },
      { state: 'applied', body: 'Two', created_at: REFERENCE.toISOString(), updated_at: REFERENCE.toISOString() },
    ]))
    expect(duplicated.ok).toBe(false)
  })

  it('includes stage note text in search indexes', () => {
    const application = setStageNote(
      createApplication({ company: 'Northwind' }, REFERENCE),
      'interview_1',
      'Rehearse the migration story',
      REFERENCE,
    )
    const indexes = rebuildIndexes([application])

    expect(indexes.search_text[application.id]).toContain('rehearse the migration story')
    expect(indexes.search_text[application.id]).toContain('interview 1')
  })

  it('round-trips stage notes through export and import', () => {
    const document = createDemoDocument(REFERENCE)
    const roundTrip = parseTrackerDocument(serializeTrackerDocument(document))

    expect(roundTrip.applications.map((application) => application.stage_notes)).toEqual(
      document.applications.map((application) => application.stage_notes),
    )
    expect(
      document.applications.some((application) => application.stage_notes.length > 0),
    ).toBe(true)
  })
})

describe('calendar invites', () => {
  const LATER = new Date('2026-08-16T02:00:00.000Z')

  function invite(overrides: Record<string, unknown> = {}) {
    return {
      state: 'interview_1' as const,
      summary: 'Interview 1 — panel',
      starts_at: '2026-08-20T04:00:00.000Z',
      ...overrides,
    }
  }

  it('files an invite against a state with its own timestamps', () => {
    const application = createApplication({ company: 'Northwind' }, REFERENCE)
    const withInvite = addStateEvent(application, invite({ ends_at: '2026-08-20T05:00:00.000Z' }), REFERENCE)
    const [event] = withInvite.state_events

    expect(event).toMatchObject({
      state: 'interview_1',
      summary: 'Interview 1 — panel',
      starts_at: '2026-08-20T04:00:00.000Z',
      ends_at: '2026-08-20T05:00:00.000Z',
      location: null,
      url: null,
      ics_uid: null,
      sequence: 0,
      cancelled: false,
      created_at: REFERENCE.toISOString(),
      updated_at: REFERENCE.toISOString(),
    })
    expect(withInvite.updated_at).toBe(REFERENCE.toISOString())
    expect(withInvite.state_history).toEqual(application.state_history)
  })

  it('files an invite against a state the application has not reached', () => {
    const application = createApplication({ company: 'Northwind', state: 'applied' }, REFERENCE)
    const withInvite = addStateEvent(application, invite({ state: 'offer' }), REFERENCE)

    expect(stateEventsFor(withInvite, 'offer')).toHaveLength(1)
    expect(withInvite.state).toBe('applied')
  })

  it('keeps several invites for one state in start order', () => {
    const application = applyStateEvents(
      createApplication({ company: 'Northwind' }, REFERENCE),
      [
        invite({ summary: 'Afternoon panel', starts_at: '2026-08-20T06:00:00.000Z' }),
        invite({ summary: 'Morning panel', starts_at: '2026-08-20T01:00:00.000Z' }),
      ],
      REFERENCE,
    )

    expect(application.state_events.map((event) => event.summary)).toEqual([
      'Morning panel',
      'Afternoon panel',
    ])
  })

  it('orders invites by configured state order before start time', () => {
    const application = applyStateEvents(
      createApplication({ company: 'Northwind' }, REFERENCE),
      [
        invite({ state: 'offer', starts_at: '2026-08-19T04:00:00.000Z' }),
        invite({ state: 'recruiter_interview', starts_at: '2026-08-22T04:00:00.000Z' }),
      ],
      REFERENCE,
    )

    expect(application.state_events.map((event) => event.state)).toEqual([
      'recruiter_interview',
      'offer',
    ])
  })

  it('drops an invite whose description was cleared', () => {
    const application = applyStateEvents(
      createApplication({ company: 'Northwind' }, REFERENCE),
      [invite()],
      REFERENCE,
    )
    const cleared = applyStateEvents(
      application,
      [{ ...invite(), id: application.state_events[0]!.id, summary: '   ' }],
      LATER,
    )

    expect(cleared.state_events).toEqual([])
    expect(cleared.updated_at).toBe(LATER.toISOString())
  })

  it('keeps timestamps when nothing about an invite changed', () => {
    const application = applyStateEvents(
      createApplication({ company: 'Northwind' }, REFERENCE),
      [invite()],
      REFERENCE,
    )
    const resaved = applyStateEvents(
      application,
      [{ ...invite(), id: application.state_events[0]!.id }],
      LATER,
    )

    expect(resaved).toBe(application)
  })

  it('keeps created_at and refreshes updated_at when an invite is rescheduled', () => {
    const application = applyStateEvents(
      createApplication({ company: 'Northwind' }, REFERENCE),
      [invite()],
      REFERENCE,
    )
    const moved = applyStateEvents(
      application,
      [{
        ...invite(),
        id: application.state_events[0]!.id,
        starts_at: '2026-08-21T04:00:00.000Z',
      }],
      LATER,
    )

    expect(moved.state_events[0]!.created_at).toBe(REFERENCE.toISOString())
    expect(moved.state_events[0]!.updated_at).toBe(LATER.toISOString())
    expect(moved.updated_at).toBe(LATER.toISOString())
  })

  it('rejects an invite that ends before it starts', () => {
    expect(() =>
      addStateEvent(
        createApplication({ company: 'Northwind' }, REFERENCE),
        invite({ ends_at: '2026-08-20T03:00:00.000Z' }),
        REFERENCE,
      ),
    ).toThrow(/end before it starts/)
  })

  it('rejects two invites sharing one calendar UID', () => {
    expect(() =>
      applyStateEvents(
        createApplication({ company: 'Northwind' }, REFERENCE),
        [invite({ ics_uid: 'shared@example.com' }), invite({ ics_uid: 'shared@example.com' })],
        REFERENCE,
      ),
    ).toThrow(/UID/)
  })

  it('replaces the invite a rescheduled one supersedes, keeping the stage it was filed under', () => {
    const application = addStateEvent(
      createApplication({ company: 'Northwind' }, REFERENCE),
      invite({ ics_uid: 'panel@example.com', state: 'interview_2' }),
      REFERENCE,
    )
    const rescheduled = addStateEvent(
      application,
      invite({
        ics_uid: 'panel@example.com',
        state: 'applied',
        starts_at: '2026-08-27T04:00:00.000Z',
        sequence: 1,
      }),
      LATER,
    )

    expect(rescheduled.state_events).toHaveLength(1)
    expect(rescheduled.state_events[0]).toMatchObject({
      state: 'interview_2',
      starts_at: '2026-08-27T04:00:00.000Z',
      sequence: 1,
      created_at: REFERENCE.toISOString(),
      updated_at: LATER.toISOString(),
    })
    expect(rescheduled.state_events[0]!.id).toBe(application.state_events[0]!.id)
  })

  it('ignores an invite that is older than the one already stored', () => {
    const application = addStateEvent(
      createApplication({ company: 'Northwind' }, REFERENCE),
      invite({ ics_uid: 'panel@example.com', sequence: 3 }),
      REFERENCE,
    )
    const stale = addStateEvent(
      application,
      invite({ ics_uid: 'panel@example.com', sequence: 2, starts_at: '2026-09-01T04:00:00.000Z' }),
      LATER,
    )

    expect(stale).toBe(application)
  })

  it('re-importing the same invite changes nothing', () => {
    const application = addStateEvent(
      createApplication({ company: 'Northwind' }, REFERENCE),
      invite({ ics_uid: 'panel@example.com' }),
      REFERENCE,
    )

    expect(addStateEvent(application, invite({ ics_uid: 'panel@example.com' }), LATER)).toBe(
      application,
    )
  })

  it('keeps invites with different UIDs side by side', () => {
    let application = addStateEvent(
      createApplication({ company: 'Northwind' }, REFERENCE),
      invite({ ics_uid: 'one@example.com' }),
      REFERENCE,
    )
    application = addStateEvent(
      application,
      invite({ ics_uid: 'two@example.com', starts_at: '2026-08-21T04:00:00.000Z' }),
      LATER,
    )

    expect(application.state_events).toHaveLength(2)
  })

  it('removes an invite and leaves an unknown id alone', () => {
    const application = addStateEvent(
      createApplication({ company: 'Northwind' }, REFERENCE),
      invite(),
      REFERENCE,
    )
    const removed = removeStateEvent(application, application.state_events[0]!.id, LATER)

    expect(removed.state_events).toEqual([])
    expect(removed.updated_at).toBe(LATER.toISOString())
    expect(removeStateEvent(application, 'missing', LATER)).toBe(application)
  })

  it('updates invites through the document without touching other applications', () => {
    const document = createDemoDocument(REFERENCE)
    const target = document.applications[0]!
    const next = updateApplicationStateEvents(document, target.id, [invite()], LATER)

    expect(next.applications[0]!.state_events).toHaveLength(1)
    expect(next.applications[1]).toBe(document.applications[1])
    expect(updateApplicationStateEvents(document, 'missing', [invite()], LATER)).toBe(document)
  })

  it('canonicalizes missing invites on import and rejects invalid ones', () => {
    const withEvents = (events: unknown) => ({
      schema_version: 1,
      applications: [{
        id: '018f24c0-0000-7000-8000-000000000001',
        company: 'Northwind',
        state: 'applied',
        state_events: events,
        created_at: REFERENCE.toISOString(),
        updated_at: REFERENCE.toISOString(),
      }],
    })

    const missing = validateTrackerDocument(withEvents(undefined))
    expect(missing.ok).toBe(true)
    if (missing.ok) expect(missing.value.applications[0]!.state_events).toEqual([])

    const stored = {
      id: '018f24c0-0000-7000-8000-0000000000aa',
      state: 'applied',
      summary: 'Screening call',
      starts_at: REFERENCE.toISOString(),
      created_at: REFERENCE.toISOString(),
      updated_at: REFERENCE.toISOString(),
    }

    expect(validateTrackerDocument(withEvents([stored])).ok).toBe(true)
    expect(validateTrackerDocument(withEvents([{ ...stored, summary: '  ' }])).ok).toBe(false)
    expect(validateTrackerDocument(withEvents([{ ...stored, state: 'nope' }])).ok).toBe(false)
    expect(validateTrackerDocument(withEvents([{ ...stored, starts_at: 'soon' }])).ok).toBe(false)
    expect(
      validateTrackerDocument(withEvents([{ ...stored, ends_at: '2026-08-13T12:00:00.000Z' }])).ok,
    ).toBe(false)
    expect(validateTrackerDocument(withEvents([{ ...stored, url: 'mailto:dana@example.com' }])).ok)
      .toBe(false)
    expect(validateTrackerDocument(withEvents([{ ...stored, sequence: -1 }])).ok).toBe(false)
    expect(
      validateTrackerDocument(withEvents([
        { ...stored, ics_uid: 'shared@example.com' },
        { ...stored, id: '018f24c0-0000-7000-8000-0000000000bb', ics_uid: 'shared@example.com' },
      ])).ok,
    ).toBe(false)
  })

  it('includes invite text in search indexes', () => {
    const application = addStateEvent(
      createApplication({ company: 'Northwind' }, REFERENCE),
      invite({ summary: 'Panel with the platform team', location: 'Level 4, Example St' }),
      REFERENCE,
    )
    const indexes = rebuildIndexes([application])

    expect(indexes.search_text[application.id]).toContain('panel with the platform team')
    expect(indexes.search_text[application.id]).toContain('level 4, example st')
    expect(indexes.search_text[application.id]).toContain('interview 1')
  })

  it('round-trips invites through export and import', () => {
    const document = createDemoDocument(REFERENCE)
    const roundTrip = parseTrackerDocument(serializeTrackerDocument(document))

    expect(roundTrip.applications.map((application) => application.state_events)).toEqual(
      document.applications.map((application) => application.state_events),
    )
    expect(
      document.applications.some((application) => application.state_events.length > 0),
    ).toBe(true)
  })
})

describe('tracker archives', () => {
  it('round-trips zip archives with tracker.json and attachment files', () => {
    const document = createDemoDocument(REFERENCE)
    const applicationId = document.applications[0]!.id
    const attachmentId = '018f0000-0000-7000-8000-000000000099'
    document.applications[0]!.attachments = [
      createAttachmentMetadata('notes.pdf', 'application/pdf', 42, REFERENCE, attachmentId),
    ]
    const files = [{
      applicationId,
      attachmentId,
      data: new Uint8Array([1, 2, 3]),
    }]
    const unpacked = unpackTrackerArchive(packTrackerArchive(document, files))

    expect(unpacked.document.applications[0]?.attachments[0]?.filename).toBe('notes.pdf')
    expect(unpacked.files).toHaveLength(1)
    expect(unpacked.files[0]?.data).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('rejects archive attachment paths with traversal segments', () => {
    expect(
      isSafeArchiveAttachmentPath('attachments/../018f0000-0000-7000-8000-000000000001/018f0000-0000-7000-8000-000000000002'),
    ).toBeNull()
  })
})

describe('document validation and persistence', () => {
  it('sanitizes unknown fields, synthesizes omitted history, and clears orphan dates', () => {
    const raw = {
      schema_version: 1,
      ignored: 'future document metadata',
      applications: [{
        id: '018f24c0-0000-7000-8000-000000000001',
        company: 'Northwind',
        role: null,
        url: null,
        source: null,
        state: 'applied',
        next_action: null,
        next_action_at: '2026-08-20T09:00:00+10:00',
        notes: null,
        created_at: '2026-08-14T09:00:00+10:00',
        updated_at: '2026-08-14T09:00:00+10:00',
        ignored_application_field: true,
      }],
    }

    const parsed = parseTrackerDocument(JSON.stringify(raw))
    expect(parsed).not.toHaveProperty('ignored')
    expect(parsed).not.toHaveProperty('schema_version')
    expect(parsed.schema).toBeDefined()
    expect(parsed.indexes).toBeDefined()
    expect(parsed.applications[0]).not.toHaveProperty('ignored_application_field')
    expect(parsed.applications[0]?.next_action_at).toBeNull()
    expect(parsed.applications[0]?.state_history).toEqual([
      { state: 'applied', at: '2026-08-14T09:00:00+10:00' },
    ])
  })

  it('canonicalizes missing source to null on import', () => {
    const parsed = parseTrackerDocument(JSON.stringify({
      schema_version: 1,
      applications: [{
        id: '018f24c0-0000-7000-8000-000000000002',
        company: 'Northwind',
        role: null,
        url: null,
        state: 'applied',
        next_action: null,
        next_action_at: null,
        notes: null,
        created_at: REFERENCE.toISOString(),
        updated_at: REFERENCE.toISOString(),
      }],
    }))

    expect(parsed.applications[0]?.source).toBeNull()
  })

  it('canonicalizes a missing deadline to null on import', () => {
    const parsed = parseTrackerDocument(JSON.stringify({
      schema_version: 1,
      applications: [{
        id: '018f24c0-0000-7000-8000-000000000003',
        company: 'Northwind',
        role: null,
        url: null,
        source: null,
        state: 'applied',
        next_action: null,
        next_action_at: null,
        notes: null,
        created_at: REFERENCE.toISOString(),
        updated_at: REFERENCE.toISOString(),
      }],
    }))

    expect(parsed.applications[0]?.deadline_at).toBeNull()
  })

  it('imports a deadline that has no accompanying next action', () => {
    const parsed = parseTrackerDocument(JSON.stringify({
      schema_version: 1,
      applications: [{
        id: '018f24c0-0000-7000-8000-000000000004',
        company: 'Northwind',
        role: null,
        url: null,
        source: null,
        state: 'applied',
        next_action: null,
        next_action_at: null,
        deadline_at: '2026-08-22T17:00:00+10:00',
        notes: null,
        created_at: REFERENCE.toISOString(),
        updated_at: REFERENCE.toISOString(),
      }],
    }))

    expect(parsed.applications[0]?.deadline_at).toBe('2026-08-22T17:00:00+10:00')
  })

  it('accepts the new self-describing database shape', () => {
    const document = createDemoDocument(REFERENCE)
    const parsed = parseTrackerDocument(JSON.stringify(document))

    expect(parsed.applications).toEqual(document.applications)
    expect(parsed.indexes.stats_current).toEqual(document.indexes.stats_current)
  })

  it.each([
    [{ schema_version: 2, applications: [] }, 'schema_version'],
    [{ schema_version: 1, applications: [{ state: 'invented' }] }, 'applications[0]'],
    [{
      schema_version: 1,
      applications: [{
        id: 'one', company: 'Northwind', state: 'applied',
        created_at: 'not-a-date', updated_at: REFERENCE.toISOString(),
      }],
    }, 'created_at'],
  ])('rejects invalid documents (%s)', (value, expectedPath) => {
    const result = validateTrackerDocument(value)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some(({ path }) => path.includes(expectedPath))).toBe(true)
  })

  it('rejects timezone-qualified timestamps with impossible calendar dates', () => {
    const impossible = '2026-02-30T09:00:00+10:00'
    const cases: Array<{ path: string; mutate: (document: TrackerDocument) => void }> = [
      {
        path: 'applications[0].created_at',
        mutate: (document) => {
          document.applications[0]!.created_at = impossible
        },
      },
      {
        path: 'applications[0].updated_at',
        mutate: (document) => {
          document.applications[0]!.updated_at = impossible
        },
      },
      {
        path: 'applications[0].state_history[0].at',
        mutate: (document) => {
          document.applications[0]!.state_history[0]!.at = impossible
        },
      },
      {
        path: 'applications[0].next_action_at',
        mutate: (document) => {
          document.applications[0]!.next_action = 'Follow up'
          document.applications[0]!.next_action_at = impossible
        },
      },
      {
        path: 'applications[0].deadline_at',
        mutate: (document) => {
          document.applications[0]!.deadline_at = impossible
        },
      },
    ]

    cases.forEach(({ path, mutate }) => {
      const value = structuredClone(createDemoDocument(REFERENCE))
      mutate(value)
      const result = validateTrackerDocument(value)

      expect(result.ok, path).toBe(false)
      if (!result.ok) {
        expect(result.errors.some((error) => error.path === path)).toBe(true)
      }
    })
  })

  it('creates an empty canonical document', () => {
    const document = createEmptyDocument()
    expect(document.applications).toEqual([])
    expect(document.indexes.by_id).toEqual({})
  })

  it('seeds an empty document only when storage is absent and preserves subsequent saved data', () => {
    const storage = new MemoryStorage()
    const seeded = loadTrackerDocument(storage)
    expect(seeded.applications).toEqual([])

    const demo = createDemoDocument(REFERENCE)
    const changed: TrackerDocument = {
      ...demo,
      applications: demo.applications.slice(1),
    }
    saveTrackerDocument(changed, storage)
    const loaded = loadTrackerDocument(storage)
    expect(loaded.applications).toEqual(changed.applications)
  })

  it('leaves invalid stored data untouched', () => {
    const storage = new MemoryStorage()
    storage.setItem('job-applications-tracker:v1', '{invalid')

    expect(() => loadTrackerDocument(storage)).toThrow()
    expect(storage.getItem('job-applications-tracker:v1')).toBe('{invalid')
  })

  it('round-trips the canonical export document', () => {
    const document = createDemoDocument(REFERENCE)
    const roundTrip = parseTrackerDocument(serializeTrackerDocument(document))
    expect(roundTrip.applications).toEqual(document.applications)
    expect(roundTrip.indexes.stats_current).toEqual(document.indexes.stats_current)
  })
})
