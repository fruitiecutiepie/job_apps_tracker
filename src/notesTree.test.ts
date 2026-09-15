import { describe, expect, it } from 'vitest'

import { createApplication } from './domain/mutations'
import type { Application, StateId } from './domain'
import { buildNotesTree, MATCHES_SHOWN } from './notesTree'

function application(
  company: string,
  notes: Partial<Record<StateId, { body?: string; heard?: string[] }>>,
  role: string | null = 'Engineer',
): Application {
  const base = createApplication({ company, role: role ?? undefined, state: 'applied' }, '2026-01-01T00:00:00.000Z', company)
  return {
    ...base,
    stage_notes: Object.entries(notes).map(([state, note]) => ({
      state: state as StateId,
      body: note?.body ?? '',
      heard: (note?.heard ?? []).map((body, index) => ({ id: `${company}${index}`, body, at: base.created_at })),
      created_at: base.created_at,
      updated_at: base.created_at,
    })),
  }
}

const halcyon = application('Halcyon Maps', {
  interview_2: { body: '## Leadership themes', heard: ['Team is 40 engineers'] },
  offer: { body: 'Confirm the level' },
  interview_1: { body: '   ' },
})
const atlas = application('Atlas Thread', { interview_2: { body: 'Ask about governance' } }, 'Design Systems Lead')
const heardOnly = application('Echo', { interview_2: { body: '', heard: ['They said this'] } })

const shape = (tree: ReturnType<typeof buildNotesTree>) =>
  tree.map((group) => [group.label, group.notes.map((note) => note.company)])

describe('buildNotesTree', () => {
  it('groups notes by the stage they prepare for, in pipeline order', () => {
    expect(shape(buildNotesTree([halcyon, atlas], ''))).toEqual([
      ['Interview 2', ['Atlas Thread', 'Halcyon Maps']],
      ['Offer', ['Halcyon Maps']],
    ])
  })

  it('leaves out a stage whose note holds nothing', () => {
    // Halcyon's Interview 1 is whitespace, so the stage is not a place to go back to.
    expect(shape(buildNotesTree([halcyon], '')).map(([label]) => label)).not.toContain('Interview 1')
  })

  it('keeps a stage that only holds what you were told', () => {
    expect(shape(buildNotesTree([heardOnly], ''))).toEqual([['Interview 2', ['Echo']]])
  })

  it('says what is in a note, so a row can be read before it is opened', () => {
    const [{ notes }] = buildNotesTree([halcyon], '')

    expect(notes[0]).toMatchObject({
      company: 'Halcyon Maps',
      role: 'Engineer',
      written: true,
      captured: 1,
      ref: { applicationId: 'Halcyon Maps', state: 'interview_2' },
    })
  })

  it('filters to the notes holding a query, and drops the stages left empty', () => {
    expect(shape(buildNotesTree([halcyon, atlas], 'governance'))).toEqual([
      ['Interview 2', ['Atlas Thread']],
    ])
  })

  it('matches a company or a role as well as the words in a note', () => {
    expect(shape(buildNotesTree([halcyon, atlas], 'design systems'))).toEqual([
      ['Interview 2', ['Atlas Thread']],
    ])
    expect(shape(buildNotesTree([halcyon, atlas], 'halcyon'))).toEqual([
      ['Interview 2', ['Halcyon Maps']],
      ['Offer', ['Halcyon Maps']],
    ])
  })

  it('shows the words around each hit, so a row can be read before it is opened', () => {
    const long = application('Long', {
      applied: { body: '## Questions to ask\n\n- How is **design system** work resourced?\n- Who owns the design system roadmap?' },
    })

    const [{ notes }] = buildNotesTree([long], 'design system')

    expect(notes[0].matches).toHaveLength(2)
    expect(notes[0].matches[0].snippet).toContain('design system work resourced')
    // As prose: the markers are how a note is written, not what it says.
    expect(notes[0].matches[0].snippet).not.toMatch(/[#*`]/)
    expect(notes[0].matches.every((match) => match.where === 'written')).toBe(true)
  })

  it('says which half of a note each hit is in', () => {
    const heard = application('Heard', { applied: { body: 'Nothing here', heard: ['They mentioned the rebrand budget'] } })

    const [{ notes }] = buildNotesTree([heard], 'budget')

    expect(notes[0].matches).toEqual([
      { where: 'captured', snippet: 'They mentioned the rebrand budget' },
    ])
  })

  it('caps the hits it lists, a row being a way in rather than the note itself', () => {
    const many = application('Many', { applied: { body: Array.from({ length: 30 }, () => 'needle').join(' ') } })

    const [{ notes }] = buildNotesTree([many], 'needle')

    expect(notes[0].matches).toHaveLength(MATCHES_SHOWN)
    expect(notes[0].hits).toBe(30)
  })

  it('lists no hits for a row that matched on its company rather than its words', () => {
    const [{ notes }] = buildNotesTree([atlas], 'atlas')

    expect(notes[0].matches).toEqual([])
    expect(notes[0].hits).toBe(0)
  })

  it('returns nothing at all when nothing matches', () => {
    expect(buildNotesTree([halcyon, atlas], 'nowhere')).toEqual([])
  })
})
