import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_STAGE_CONFIG,
  DATA_VERSION,
  addApplication,
  applyStages,
  createDemoDocument,
  createEmptyDocument,
  documentStages,
  isStateId,
  migrateDocument,
  needsMigration,
  parseTrackerDocument,
  renameTracker,
  serializeTrackerDocument,
  setStages,
  stageInUse,
  stateLabel,
  statusLabel,
  validateTrackerDocument,
} from '.'

import type { StateId, TrackerDocument } from './types'

const AT = '2026-08-01T09:00:00+10:00'

/** The document with one stage called something else. */
function renameStage(document: TrackerDocument, state: StateId, label: string): TrackerDocument {
  return setStages(
    document,
    documentStages(document).stages.map((stage) => (stage.id === state ? { ...stage, label } : stage)),
  )
}

/** The document with one more round than it had. */
function addRound(document: TrackerDocument): TrackerDocument {
  const { stages, rounds } = documentStages(document)
  return setStages(document, [...stages, { id: `round_${rounds + 1}`, label: '' }])
}

/** The document asked to keep this many rounds. */
function keepRounds(document: TrackerDocument, rounds: number): TrackerDocument {
  return setStages(document, documentStages(document).stages.filter(({ id }) => {
    const match = /^round_(\d+)$/.exec(id)
    return !match || Number(match[1]) <= rounds
  }))
}
const LATER = '2026-08-08T09:00:00+10:00'

afterEach(() => applyStages(DEFAULT_STAGE_CONFIG))

describe('stage ids as of version 4', () => {
  it('migrates version-3 stage ids wherever an application files something by stage', () => {
    const raw = {
      schema_version: 3,
      applications: [{
        id: 'one',
        company: 'Northwind',
        state: 'interview_2',
        outcome: 'rejected',
        state_history: [
          { state: 'recruiter_interview', outcome: 'active', at: AT },
          { state: 'interview_1', outcome: 'active', at: AT },
          { state: 'interview_2', outcome: 'rejected', at: LATER },
        ],
        stage_notes: [{ state: 'interview_1', body: 'System design', heard: [], created_at: AT, updated_at: AT }],
        state_events: [{
          id: 'event', state: 'recruiter_interview', summary: 'Screen', starts_at: AT, ends_at: null,
          location: null, url: null, ics_uid: null, sequence: 0, cancelled: false, created_at: AT, updated_at: AT,
        }],
        correspondence: [{
          id: 'message', state: 'interview_2', direction: 'received', body: 'Thanks, but no.',
          at: LATER, created_at: LATER, updated_at: LATER,
        }],
        created_at: AT,
        updated_at: LATER,
      }],
    }

    expect(needsMigration(raw)).toBe(true)
    const parsed = parseTrackerDocument(JSON.stringify(raw))
    const [application] = parsed.applications

    expect(parsed.schema_version).toBe(DATA_VERSION)
    expect(application).toMatchObject({ state: 'round_2', outcome: 'rejected' })
    expect(application!.state_history.map((entry) => entry.state)).toEqual(['screening', 'round_1', 'round_2'])
    expect(application!.stage_notes.map((note) => note.state)).toEqual(['round_1'])
    expect(application!.state_events.map((event) => event.state)).toEqual(['screening'])
    expect(application!.correspondence.map((entry) => entry.state)).toEqual(['round_2'])
  })

  it('refuses a version-4 document that still uses a version-3 id', () => {
    const raw = JSON.parse(serializeTrackerDocument(createDemoDocument())) as Record<string, unknown>
    const applications = raw.applications as Record<string, unknown>[]
    applications[0] = { ...applications[0], state: 'interview_1', state_history: undefined }

    expect(migrateDocument(raw)).toBe(raw)
    expect(validateTrackerDocument(raw).ok).toBe(false)
  })
})

describe('a tracker\'s own stages', () => {
  it('starts with the defaults and stores nothing for them', () => {
    const document = createEmptyDocument()

    expect(document.stages).toBeUndefined()
    expect(documentStages(document).stages.map(({ label }) => label)).toEqual([
      'Headhunted', 'Applied', 'Recruiter messaged', 'Online assessment', 'Screening call',
      'Take-home assessment', 'Round 1', 'Round 2', 'Offer', 'Accepted',
    ])
  })

  it('renames a stage without touching any application', () => {
    const document = addApplication(createEmptyDocument(), { company: 'Northwind', state: 'screening' }, AT)
    const renamed = renameStage(document, 'screening', '  Phone screen ')

    expect(documentStages(renamed).label('screening')).toBe('Phone screen')
    expect(renamed.applications).toEqual(document.applications)
    expect(renamed.indexes.search_text[document.applications[0]!.id]).toContain('phone screen')
    expect(statusLabel({ state: 'screening', outcome: 'rejected' }, documentStages(renamed)))
      .toBe('Phone screen — Rejected')
  })

  it('treats an unchanged label as a no-op and a blank one as the default', () => {
    const document = renameStage(createEmptyDocument(), 'offer', 'Offer letter')

    expect(renameStage(document, 'offer', 'Offer letter')).toBe(document)
    const reset = renameStage(document, 'offer', '   ')
    expect(documentStages(reset).label('offer')).toBe('Offer')
    // Back to the defaults, so back to storing nothing.
    expect(reset.stages).toBeUndefined()
  })

  it('adds rounds after the last one and before Offer', () => {
    const document = addRound(addRound(createEmptyDocument()))
    const stages = documentStages(document)

    expect(stages.ids.slice(6)).toEqual(['round_1', 'round_2', 'round_3', 'round_4', 'offer', 'accepted'])
    expect(stages.label('round_4')).toBe('Round 4')
  })

  it('never takes away the two rounds every tracker has', () => {
    const document = createEmptyDocument()

    expect(keepRounds(document, 0)).toBe(document)
  })

  it('takes away an added round only while nothing is filed under it, and keeps the ones before it', () => {
    const added = addRound(addRound(createEmptyDocument()))
    expect(documentStages(keepRounds(added, 2)).rounds).toBe(2)

    applyStages(documentStages(added))
    const held = addApplication(added, { company: 'Northwind', state: 'round_3' }, AT)
    expect(stageInUse(held, 'round_3')).toBe(true)
    expect(stageInUse(held, 'round_4')).toBe(false)
    // Round 4 is free and goes; Round 3 holds Northwind and stays.
    expect(documentStages(keepRounds(held, 2)).rounds).toBe(3)
    expect(keepRounds(keepRounds(held, 2), 2).stages).toEqual(keepRounds(held, 2).stages)
  })

  it('counts a move through a round, not only being at it, as something filed there', () => {
    const added = addRound(createEmptyDocument())
    applyStages(documentStages(added))
    const document = addApplication(added, { company: 'Northwind', state: 'round_3' }, AT)
    const moved = {
      ...document,
      applications: document.applications.map((application) => ({
        ...application,
        state: 'offer' as const,
        state_history: [...application.state_history, { state: 'offer' as const, outcome: 'active' as const, at: LATER }],
      })),
    }

    expect(stageInUse(moved, 'round_3')).toBe(true)
  })

  it('survives a save and a reload, and survives renaming the tracker', () => {
    const document = renameTracker(addRound(renameStage(createEmptyDocument(), 'round_1', 'Technical')), 'Autumn')
    const reloaded = parseTrackerDocument(serializeTrackerDocument(document))

    expect(reloaded.name).toBe('Autumn')
    expect(reloaded.stages).toEqual(document.stages)
    expect(documentStages(reloaded).label('round_1')).toBe('Technical')
    expect(documentStages(reloaded).rounds).toBe(3)
  })

  it('validates applications against the document\'s own rounds, not the tracker on screen', () => {
    const withRound = addRound(createEmptyDocument())
    applyStages(documentStages(withRound))
    const raw = JSON.parse(serializeTrackerDocument(
      addApplication(withRound, { company: 'Northwind', state: 'round_3' }, AT),
    )) as Record<string, unknown>
    applyStages(DEFAULT_STAGE_CONFIG)

    expect(validateTrackerDocument(raw).ok).toBe(true)
    expect(validateTrackerDocument({ ...raw, stages: undefined }).ok).toBe(false)
  })

  it('refuses a stage list naming a stage that cannot exist, or one twice', () => {
    expect(validateTrackerDocument({
      schema_version: DATA_VERSION, applications: [], stages: [{ id: 'interview_1', label: 'Old' }],
    }).ok).toBe(false)
    expect(validateTrackerDocument({
      schema_version: DATA_VERSION,
      applications: [],
      stages: [{ id: 'offer', label: 'A' }, { id: 'offer', label: 'B' }],
    }).ok).toBe(false)
  })

  it('reads labels and membership from the tracker on screen', () => {
    const document = addRound(renameStage(createEmptyDocument(), 'screening', 'Phone screen'))

    expect(isStateId('round_3')).toBe(false)
    applyStages(documentStages(document))
    expect(isStateId('round_3')).toBe(true)
    expect(stateLabel('screening')).toBe('Phone screen')
  })
})
