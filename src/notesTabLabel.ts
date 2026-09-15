/**
 * What a tab says, decided by everything open beside it rather than by the note alone.
 *
 * A tab's job is to tell itself apart from the other tabs on screen, and the panel's strips
 * are narrow — several panes wide, each holding several stages of the same application.
 * Written in full, every tab in such a pane begins with the same company and the same role,
 * and the stage that actually distinguishes them is the part that falls off the end.
 *
 * So each part is printed only where it separates something: the company when more than one
 * is open, the role when one of those companies has two of them open, the stage always. The
 * full name is not lost — it is the tab's accessible name, and its tooltip — it is just not
 * printed when it would be the same words three times over.
 *
 * Given every tab in the panel, not one pane's worth. Asked pane by pane, two panes holding
 * one company each would both find nothing to separate and both drop the name, leaving
 * "Interview 2" beside "Offer" with nothing on screen saying whose.
 */

export interface TabSubject {
  company: string
  role: string
  stage: string
}

export function tabLabels(subjects: readonly TabSubject[]): string[] {
  const companies = new Set(subjects.map((subject) => subject.company))
  const showCompany = companies.size > 1

  /*
   * Per company rather than across everything: two roles at one company is what makes a
   * role worth printing, and a panel holding one role each for three companies is not
   * ambiguous at all. Kept for every company so a tab can ask about its own.
   */
  const rolesPerCompany = new Map<string, Set<string>>()
  for (const subject of subjects) {
    const roles = rolesPerCompany.get(subject.company) ?? new Set<string>()
    roles.add(subject.role)
    rolesPerCompany.set(subject.company, roles)
  }

  return subjects.map((subject) => {
    const showRole = (rolesPerCompany.get(subject.company)?.size ?? 0) > 1
    return [showCompany ? subject.company : '', showRole ? subject.role : '', subject.stage]
      .filter(Boolean)
      .join(' · ')
  })
}
