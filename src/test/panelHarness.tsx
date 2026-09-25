/**
 * Mounting the prep notes panel for the browser suite.
 *
 * Shared because more than one browser test needs the same thing and the mount is not
 * incidental: the panel's height comes from the shell column above it rather than from a
 * viewport measurement, so a bare mount would size itself correctly whatever the chain above
 * it did — and prove nothing. Every test that measures the panel has to mount it inside the
 * page structure it actually lives in.
 *
 * Stub callbacks throughout. Nothing here loads or stores a note, which is deliberate: the
 * dev server's `/__db` reads and writes the real tracker file, and a suite that measures
 * pixels has no business anywhere near it.
 */

import { render } from '@testing-library/react'

import { createDemoDocument } from '../domain/demo'
import type { Application } from '../domain'
import { StageNotesPanel } from '../StageNotesPanel'
import { openingLayout } from '../notesArrangement'
import type { LayoutNode } from '../notesLayout'

/** Two companies with notes between them, which is all any of these tests needs. */
export const COMPANIES = ['Halcyon Maps', 'Echo Robotics']

/** Wider than the 760px breakpoint where panes stop being laid out in a row. */
export const WIDE = { width: 1280, height: 800 }

export function fixtureApplications(): Application[] {
  return createDemoDocument().applications.filter((application) =>
    COMPANIES.includes(application.company),
  )
}

export function renderPanel(
  applications = fixtureApplications(),
  /** The arrangement to mount, for a test that needs one the opening fan cannot express. */
  layoutFor?: (halcyon: Application) => LayoutNode,
) {
  const halcyon = applications.find((application) => application.company === 'Halcyon Maps')!
  const layout = layoutFor?.(halcyon) ?? openingLayout(halcyon, halcyon.state)
  render(
    <div className="app-shell">
      <header className="topbar">
        <span>Chrome above the panel</span>
      </header>
      <main>
        <div className="context-bar">
          <h1>Prep notes</h1>
        </div>
        <section className="view-surface view-surface--panel">
          <section aria-label="Prep" className="panel-view">
            <StageNotesPanel
              applications={applications}
              initial={{ layout, focusedGroupId: layout.id }}
              onArrange={() => {}}
              onCapture={async () => {}}
              onEmpty={() => {}}
              onExternalChange={async () => {}}
              onOpenApplication={() => {}}
              onRevise={async () => {}}
              onSaveDrafts={async () => true}
              request={null}
            />
          </section>
        </section>
      </main>
    </div>,
  )
  return { halcyon }
}
