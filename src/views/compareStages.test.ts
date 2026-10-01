import { describe, expect, it } from 'vitest'

import { createDemoDocument } from '../domain/demo'
import type { Application } from '../domain'
import { compareStages, defaultCompareStage } from './compareStages'

const demo = () => createDemoDocument().applications
const byCompany = (applications: Application[], company: string) =>
  applications.find((application) => application.company === company)!

describe('compareStages', () => {
  it('lists a stage for every note written, whatever state the application is in now', () => {
    const stages = compareStages(demo())
    const offer = stages.find((stage) => stage.state === 'offer')!
    // Halcyon Maps is at Interview 2 and wrote for Offer ahead of it.
    expect(offer.entries.map((entry) => entry.application.company)).toEqual(['Lumen Pantry', 'Halcyon Maps'])
    expect(offer.entries.map((entry) => entry.isHere)).toEqual([true, false])
  })

  it('counts a live application at a stage with nothing written as a gap, and nothing else', () => {
    const stages = compareStages(demo())
    const messaged = stages.find((stage) => stage.state === 'recruiter_messaged')!
    expect(messaged.entries.map((entry) => [entry.application.company, entry.hasNote])).toEqual([
      ['Paper Kite', false],
      ['Atlas Thread', true],
    ])
    // A rejected or finished application at a stage is not heading into it: Bright Harbor
    // was turned down at the online assessment, and the accepted job has nothing ahead.
    const assessment = stages.find((stage) => stage.state === 'online_assessment')
    expect(assessment?.entries.map((entry) => entry.application.company) ?? []).not.toContain('Bright Harbor')
    expect(stages.some((stage) => stage.state === 'accepted')).toBe(false)
  })

  it('counts a note holding only captures as written', () => {
    const halcyon = byCompany(demo(), 'Halcyon Maps')
    const onlyHeard: Application = {
      ...halcyon,
      state: 'applied',
      stage_notes: [{ ...halcyon.stage_notes.find((note) => note.state === 'interview_2')!, body: '' }],
    }
    const [stage] = compareStages([onlyHeard]).filter((item) => item.state === 'interview_2')
    expect(stage!.entries[0]!.hasNote).toBe(true)
  })

  it('walks the stages in pipeline order', () => {
    const states = compareStages(demo()).map((stage) => stage.state)
    expect(states).toEqual([
      'headhunted',
      'applied',
      'recruiter_messaged',
      'online_assessment',
      'recruiter_interview',
      'take_home_assessment',
      'interview_1',
      'interview_2',
      'offer',
    ])
  })
})

describe('defaultCompareStage', () => {
  it('opens on the stage with the most to compare, the later one on a tie', () => {
    // Recruiter messaged, Interview 1 and Offer each hold two; Offer is furthest along.
    expect(defaultCompareStage(compareStages(demo()))).toBe('offer')
  })

  it('is null when there is nothing to compare', () => {
    expect(defaultCompareStage([])).toBeNull()
  })
})
