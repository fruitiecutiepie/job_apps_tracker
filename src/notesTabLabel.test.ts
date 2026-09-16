import { describe, expect, it } from 'vitest'

import { tabLabels, type TabSubject } from './notesTabLabel'

const tab = (company: string, role: string, stage: string): TabSubject => ({ company, role, stage })

describe('what a tab says', () => {
  it('names only the stage when a strip holds one application', () => {
    // The company and the role are the same on every tab, so printing them tells the
    // reader nothing and costs the width that the stages are competing for.
    expect(
      tabLabels([
        tab('Halcyon Maps', 'Engineering Manager', 'Recruiter interview'),
        tab('Halcyon Maps', 'Engineering Manager', 'Interview 1'),
        tab('Halcyon Maps', 'Engineering Manager', 'Offer'),
      ]),
    ).toEqual(['Recruiter interview', 'Interview 1', 'Offer'])
  })

  it('names the company as soon as a second one is open beside it', () => {
    expect(
      tabLabels([
        tab('Halcyon Maps', 'Engineering Manager', 'Offer'),
        tab('Canva', 'Senior Software Engineer', 'Recruiter interview'),
      ]),
    ).toEqual(['Halcyon Maps · Offer', 'Canva · Recruiter interview'])
  })

  it('names the role only where one company has two of them open', () => {
    // The one case the role settles. Canva's two roles carry theirs; Halcyon's single
    // role does not, even though it shares the strip with them.
    expect(
      tabLabels([
        tab('Canva', 'Senior Software Engineer', 'Recruiter interview'),
        tab('Canva', 'Frontend Engineer', 'Recruiter interview'),
        tab('Halcyon Maps', 'Engineering Manager', 'Offer'),
      ]),
    ).toEqual([
      'Canva · Senior Software Engineer · Recruiter interview',
      'Canva · Frontend Engineer · Recruiter interview',
      'Halcyon Maps · Offer',
    ])
  })

  it('keeps the role when two roles at one company are all that is open', () => {
    // The company is shared and drops out; the roles are what tell these apart.
    expect(
      tabLabels([
        tab('Canva', 'Senior Software Engineer', 'Offer'),
        tab('Canva', 'Frontend Engineer', 'Offer'),
      ]),
    ).toEqual(['Senior Software Engineer · Offer', 'Frontend Engineer · Offer'])
  })

  it('counts what is open in every pane, not only in this one', () => {
    /*
     * Two panes side by side, one company each. Asked pane by pane, neither pane has a
     * second company in it and both drop the name — so the screen reads "Interview 2" and
     * "Offer" with nothing anywhere saying whose. What a tab competes with is everything
     * else on screen, not everything else in its own strip.
     */
    expect(
      tabLabels([
        tab('Halcyon Maps', 'Engineering Manager', 'Interview 2'),
        tab('Lumen Pantry', 'Head of Growth', 'Offer'),
      ]),
    ).toEqual(['Halcyon Maps · Interview 2', 'Lumen Pantry · Offer'])
  })

  it('says the stage alone for a strip of one', () => {
    expect(tabLabels([tab('Halcyon Maps', 'Engineering Manager', 'Offer')])).toEqual(['Offer'])
  })

  it('never says nothing', () => {
    // Two tabs for one stage of one role cannot happen in a pane — a note is open at most
    // once in it — but a label that came back empty would be a tab with no name at all.
    expect(tabLabels([tab('', '', 'Offer')])).toEqual(['Offer'])
  })
})
