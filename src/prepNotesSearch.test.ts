import { describe, expect, it } from 'vitest'

import { createApplication } from './domain/mutations'
import type { Application, StateId } from './domain'
import { searchPrepNotes, SNIPPET_CHARS } from './prepNotesSearch'

function application(
  company: string,
  notes: Partial<Record<StateId, { body?: string; heard?: string[] }>>,
  role = 'Engineer',
): Application {
  const base = createApplication({ company, role, state: 'applied' }, '2026-01-01T00:00:00.000Z', company)
  return {
    ...base,
    stage_notes: Object.entries(notes).map(([state, note]) => ({
      state: state as StateId,
      body: note?.body ?? '',
      heard: (note?.heard ?? []).map((body, index) => ({
        id: `${company}-${state}-${index}`,
        body,
        at: base.created_at,
      })),
      created_at: base.created_at,
      updated_at: base.created_at,
    })),
  }
}

const acme = application('Acme', {
  applied: { body: 'Ask about the rebrand project and the design system' },
  interview_1: { body: 'Nothing relevant here', heard: ['They mentioned the rebrand budget'] },
})
const globex = application('Globex', { offer: { body: 'Equity refresh policy to confirm' } })

describe('searchPrepNotes', () => {
  it('finds nothing for a blank query rather than everything', () => {
    expect(searchPrepNotes([acme, globex], '')).toEqual([])
    expect(searchPrepNotes([acme, globex], '   ')).toEqual([])
  })

  it('finds a note by its written text, whatever the case', () => {
    const [found, ...rest] = searchPrepNotes([acme, globex], 'REBRAND PROJECT')

    expect(rest).toEqual([])
    expect(found.ref).toEqual({ applicationId: 'Acme', state: 'applied' })
    expect(found.company).toBe('Acme')
    expect(found.role).toBe('Engineer')
    expect(found.snippet).toContain('rebrand project')
  })

  it('finds a note by a line captured in it, and says which it was', () => {
    const found = searchPrepNotes([acme, globex], 'budget')

    expect(found).toHaveLength(1)
    expect(found[0].ref.state).toBe('interview_1')
    expect(found[0].where).toBe('captured')
  })

  it('counts every hit in a note, not just the first', () => {
    const repeated = application('Repeat', { applied: { body: 'one two one two one' } })

    expect(searchPrepNotes([repeated], 'one')[0].matches).toBe(3)
  })

  it('puts the notes with the most hits first, then reads company by company', () => {
    const many = application('Zeta', { applied: { body: 'match match match' } })
    const one = application('Alpha', { applied: { body: 'match' } })
    const alsoOne = application('Beta', { applied: { body: 'match' } })

    expect(searchPrepNotes([one, many, alsoOne], 'match').map((hit) => hit.company))
      .toEqual(['Zeta', 'Alpha', 'Beta'])
  })

  it('returns a snippet around the hit rather than the whole note', () => {
    const long = application('Long', { applied: { body: `${'a'.repeat(400)} needle ${'b'.repeat(400)}` } })

    const [hit] = searchPrepNotes([long], 'needle')
    expect(hit.snippet).toContain('needle')
    expect(hit.snippet.length).toBeLessThanOrEqual(SNIPPET_CHARS + 'needle'.length + 2)
    // Marked as cut on both sides, since the note runs past the snippet either way.
    expect(hit.snippet.startsWith('…')).toBe(true)
    expect(hit.snippet.endsWith('…')).toBe(true)
  })

  it('does not mark a snippet as cut when it is the whole note', () => {
    const [hit] = searchPrepNotes([globex], 'equity')

    expect(hit.snippet).toBe('Equity refresh policy to confirm')
  })

  it('reads a snippet as prose rather than as the Markdown it was written in', () => {
    const marked = application('Marked', {
      applied: { body: '## Questions to ask\n\n- How is **design system** work resourced?\n- And the `rota`?' },
    })

    const [hit] = searchPrepNotes([marked], 'design system')
    // The words as they read on the page: the markers are how the note is written, not
    // what it says, and a result is a line of prose.
    expect(hit.snippet).toContain('design system work resourced')
    expect(hit.snippet).not.toMatch(/[#*`]/)
    expect(hit.snippet).not.toContain('\n')
  })

  it('skips an application whose notes are all empty', () => {
    expect(searchPrepNotes([application('Empty', { applied: { body: '' } })], 'anything')).toEqual([])
  })
})
