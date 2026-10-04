import { describe, expect, it } from 'vitest'

import { packTrackerArchive } from './archive'
import { createEmptyDocument, refreshTrackerDatabase } from './database'
import { serializeTrackerDocument } from './export'
import { holdsTheSameApplications, readTrackerImport } from './import'
import { addApplication, renameTracker } from './mutations'
import { validateTrackerDocument } from './validation'

/*
 * A tracker's name is part of the document, so it has to survive everything the document
 * goes through: a save, an export, an import, and a file written before names existed.
 */
describe('a tracker\'s name in its document', () => {
  it('names a tracker, and un-names it with a blank name', () => {
    const named = renameTracker(createEmptyDocument(), '  Autumn search ')
    expect(named.name).toBe('Autumn search')
    expect('name' in renameTracker(named, '   ')).toBe(false)
  })

  it('writes nothing when the name is what it already was', () => {
    const named = renameTracker(createEmptyDocument(), 'Autumn search')
    expect(renameTracker(named, 'Autumn search')).toBe(named)
  })

  it('survives the rebuild every save does', () => {
    const named = renameTracker(createEmptyDocument(), 'Autumn search')
    expect(refreshTrackerDatabase(named).name).toBe('Autumn search')
  })

  it('travels in an export and comes back with an import, zip and JSON alike', () => {
    const named = renameTracker(createEmptyDocument(), 'Autumn search')
    const zipped = readTrackerImport(packTrackerArchive(named, []))
    const json = readTrackerImport(new TextEncoder().encode(serializeTrackerDocument(named)))
    expect(zipped.ok && zipped.document.name).toBe('Autumn search')
    expect(json.ok && json.document.name).toBe('Autumn search')
  })

  it('leaves a file written before trackers had names valid, and unnamed', () => {
    const before = JSON.parse(serializeTrackerDocument(createEmptyDocument())) as Record<string, unknown>
    expect('name' in before).toBe(false)
    const result = validateTrackerDocument(before)
    expect(result.ok && 'name' in result.value).toBe(false)
  })

  it('refuses a name that is not text', () => {
    const document = { ...JSON.parse(serializeTrackerDocument(createEmptyDocument())), name: 42 }
    const result = validateTrackerDocument(document)
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual({ path: 'name', message: 'must be a string' })
  })

  it('is described by the schema the document embeds', () => {
    const properties = createEmptyDocument().schema.properties as Record<string, { type?: string }>
    expect(properties.name?.type).toBe('string')
  })
})

/*
 * Dropping a tracker's own file back onto it would change nothing. Asking whether to
 * replace or add would be a question with no right answer, so it is detected and skipped.
 */
describe('a file holding what the tracker already holds', () => {
  const input = {
    company: 'Northwind', role: '', url: '', source: '', state: 'applied' as const,
    next_action: '', next_action_at: null, deadline_at: null, notes: '',
  }

  it('is recognised, through a save and a reload as written', () => {
    const tracker = renameTracker(addApplication(createEmptyDocument(), input), 'test_job_apps')
    const fromDisk = readTrackerImport(new TextEncoder().encode(serializeTrackerDocument(tracker)))
    expect(fromDisk.ok && holdsTheSameApplications(fromDisk.document, tracker)).toBe(true)
  })

  it('is recognised whatever the file is named, the name not being an application', () => {
    const tracker = renameTracker(addApplication(createEmptyDocument(), input), 'test_job_apps')
    expect(holdsTheSameApplications(renameTracker(tracker, ''), tracker)).toBe(true)
  })

  it('is not mistaken for one holding different applications', () => {
    const tracker = addApplication(createEmptyDocument(), input)
    const more = addApplication(tracker, { ...input, company: 'Halcyon' })
    expect(holdsTheSameApplications(more, tracker)).toBe(false)
    expect(holdsTheSameApplications(addApplication(createEmptyDocument(), { ...input, company: 'Halcyon' }), tracker)).toBe(false)
  })
})
