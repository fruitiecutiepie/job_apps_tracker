import { describe, expect, it } from 'vitest'

import { packTrackerArchive } from './archive'
import { createEmptyDocument, refreshTrackerDatabase } from './database'
import { serializeTrackerDocument } from './export'
import { readTrackerImport } from './import'
import { renameTracker } from './mutations'
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
