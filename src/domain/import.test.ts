import { describe, expect, it } from 'vitest'

import { packTrackerArchive } from './archive'
import { prepareTrackerDatabase } from './database'
import { describeImportErrors, readTrackerImport } from './import'
import { createApplication } from './mutations'
import { serializeTrackerDocument } from './export'

function oneApplication(company = 'Northwind') {
  return prepareTrackerDatabase([
    createApplication({
      company,
      role: 'Engineer',
      url: '',
      source: '',
      state: 'applied',
      next_action: '',
      next_action_at: null,
      deadline_at: null,
      notes: '',
    }),
  ])
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('reading an imported file', () => {
  it('accepts a JSON export and hands back the document', () => {
    const result = readTrackerImport(bytesOf(serializeTrackerDocument(oneApplication())))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format).toBe('json')
    expect(result.files).toEqual([])
    expect(result.document.applications.map((one) => one.company)).toEqual(['Northwind'])
  })

  it('accepts a zip archive and hands back its attachments too', () => {
    const archive = packTrackerArchive(oneApplication(), [
      {
        applicationId: '11111111-1111-7111-8111-111111111111',
        attachmentId: '22222222-2222-7222-8222-222222222222',
        data: bytesOf('resume'),
      },
    ])

    const result = readTrackerImport(archive)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format).toBe('zip')
    expect(result.files).toHaveLength(1)
  })

  it('still accepts the legacy schema_version 1 shape', () => {
    const legacy = JSON.stringify({ schema_version: 1, applications: [] })
    expect(readTrackerImport(bytesOf(legacy)).ok).toBe(true)
  })

  /*
   * Every one of these is a file someone can plausibly hand the app — the wrong file from
   * a Downloads folder, an export edited by hand, a half-written download. None may throw,
   * because all three entry points have to put the reason on screen rather than crash.
   */
  it('reports rather than throws when the bytes are not a tracker export', () => {
    expect(readTrackerImport(bytesOf('this is not JSON'))).toMatchObject({ ok: false })
    expect(readTrackerImport(new Uint8Array())).toMatchObject({ ok: false })
    expect(readTrackerImport(bytesOf('{"applications":"nope"}'))).toMatchObject({ ok: false })
    expect(readTrackerImport(bytesOf(JSON.stringify({ schema_version: 2, applications: [] })))).toMatchObject({
      ok: false,
    })
  })

  it('says which field is wrong, not just that something is', () => {
    const broken = JSON.stringify({
      applications: [{ id: 'not-a-uuid', company: '', state: 'invented_state' }],
    })
    const result = readTrackerImport(bytesOf(broken))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.length).toBeGreaterThan(0)
    expect(describeImportErrors(result.errors)).toMatch(/applications/)
  })

  it('reports a zip that is not a tracker archive', () => {
    const notATracker = packTrackerArchive(oneApplication(), [])
    // Corrupt the central directory so unpacking fails rather than validating.
    const corrupted = notATracker.slice(0, Math.floor(notATracker.length / 2))
    expect(readTrackerImport(corrupted).ok).toBe(false)
  })
})

describe('describing what was wrong', () => {
  it('leads with the first few problems and counts the rest', () => {
    const errors = Array.from({ length: 5 }, (_, index) => ({
      path: `applications[${index}]`,
      message: 'is invalid',
    }))
    expect(describeImportErrors(errors)).toBe(
      'applications[0]: is invalid; applications[1]: is invalid; applications[2]: is invalid (and 2 more)',
    )
  })

  it('does not prefix a whole-document problem with a path nobody typed', () => {
    expect(describeImportErrors([{ path: '$', message: 'the file is empty' }])).toBe('the file is empty')
  })
})
