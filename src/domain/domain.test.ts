import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  STATE_CONFIG,
  STATE_IDS,
  addAttachment,
  createApplication,
  createAttachmentMetadata,
  createDemoDocument,
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
  removeAttachment,
  saveTrackerDocument,
  serializeTrackerDocument,
  unpackTrackerArchive,
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
    expect(application.state_history).toEqual([{ state: 'applied', at: REFERENCE.toISOString() }])
    expect(application.attachments).toEqual([])
    expect(() => createApplication({ company: 'Northwind', url: 'ftp://example.com' }, REFERENCE))
      .toThrow(/URL/i)
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
    expect(indexes.stats_current.applied).toBe(1)
    expect(indexes.stats_ever_reached.applied).toBeGreaterThanOrEqual(1)
    expect(indexesAreStale(document.applications, indexes)).toBe(false)
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

  it('seeds only absent storage and preserves subsequent saved data', () => {
    const storage = new MemoryStorage()
    const seeded = loadTrackerDocument(storage, REFERENCE)
    expect(seeded.applications).toHaveLength(19)

    const changed: TrackerDocument = {
      ...seeded,
      applications: seeded.applications.slice(1),
    }
    saveTrackerDocument(changed, storage)
    const loaded = loadTrackerDocument(storage, new Date('2030-01-01T00:00:00Z'))
    expect(loaded.applications).toEqual(changed.applications)
  })

  it('leaves invalid stored data untouched', () => {
    const storage = new MemoryStorage()
    storage.setItem('job-applications-tracker:v1', '{invalid')

    expect(() => loadTrackerDocument(storage, REFERENCE)).toThrow()
    expect(storage.getItem('job-applications-tracker:v1')).toBe('{invalid')
  })

  it('round-trips the canonical export document', () => {
    const document = createDemoDocument(REFERENCE)
    const roundTrip = parseTrackerDocument(serializeTrackerDocument(document))
    expect(roundTrip.applications).toEqual(document.applications)
    expect(roundTrip.indexes.stats_current).toEqual(document.indexes.stats_current)
  })
})
