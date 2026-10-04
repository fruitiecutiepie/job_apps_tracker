import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ReplaceTrackerDialog, type TrackerReplacement } from './ReplaceTrackerDialog'

function body(replacement: TrackerReplacement): string {
  render(<ReplaceTrackerDialog onChoose={() => {}} replacement={replacement} />)
  return screen.getByRole('alertdialog').querySelector('#replace-tracker-body')!.textContent ?? ''
}

/*
 * Removing a tracker means different things depending on where it lives, and the copy
 * says which first: nothing is lost with a folder, and only a tracker kept nowhere but
 * the browser is gone for good.
 */
describe('the question before removing a tracker', () => {
  it('says a tracker with a folder loses nothing', () => {
    expect(body({ kind: 'remove', name: 'test_job', current: 1, backedUp: true, folder: 'test_job' })).toBe(
      "test_job stays in your test_job folder, with its 1 application. Removing it only takes it off this browser's list, and From a folder… opens it again.",
    )
  })

  it('says a tracker whose last export has everything can be opened again from it', () => {
    expect(body({ kind: 'remove', name: 'Autumn search', current: 3, backedUp: true, folder: null })).toBe(
      "Autumn search's 3 applications are also in the file you last exported or imported. Removing it clears them from this browser, and From a file… opens that file again.",
    )
  })

  it('says plainly when removing deletes for good', () => {
    expect(body({ kind: 'remove', name: 'Untitled tracker', current: 1, backedUp: false, folder: null })).toBe(
      "Untitled tracker's 1 application is only in this browser. Removing it deletes it for good, so save a copy first if you might want it back.",
    )
  })
})

describe('the question before a dropped file replaces a tracker', () => {
  const importing = {
    kind: 'import' as const, fileName: 'other.json', incoming: 1, attachments: 0, current: 1,
  }

  /*
   * Where a browser holds several trackers, replacing opens the file in this tab and closes
   * the tracker that was here; it never writes over one. So the first question says what
   * closing would lose, and only asks again when it would lose something.
   */
  it('says replacing closes the tracker, and loses nothing when it saves to a folder', () => {
    expect(body({ ...importing, backedUp: true, folder: 'test_job', openAsNewBeside: 'test_job' })).toBe(
      'other.json has 1 application. Open it as a tracker of its own beside test_job, or open it in place of test_job, which closes. Replacing loses nothing: test_job stays in your test_job folder, and From a folder… opens it again.',
    )
  })

  it('says replacing loses nothing when the last export has everything', () => {
    expect(body({ ...importing, backedUp: true, folder: null, openAsNewBeside: 'first' })).toBe(
      'other.json has 1 application. Open it as a tracker of its own beside first, or open it in place of first, which closes. Replacing loses nothing: first has not changed since you last exported or imported it.',
    )
  })

  it('adds nothing to the first question where closing would lose something', () => {
    expect(body({ ...importing, backedUp: false, folder: null, openAsNewBeside: 'first' })).toBe(
      'other.json has 1 application. Open it as a tracker of its own beside first, or open it in place of first, which closes.',
    )
  })

  it('asks about a copy, once replacing is chosen, when the applications are only here', () => {
    render(<ReplaceTrackerDialog onChoose={() => {}} replacement={{ ...importing, current: 3, backedUp: false, folder: null, openAsNewBeside: 'first' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Replace first' }))
    const question = screen.getByRole('alertdialog', { name: 'Close first?' })
    expect(question).toHaveTextContent(
      "other.json opens in place of first, which closes. first's 3 applications are only in this browser, so save a copy first if you might want them back.",
    )
    expect(screen.getByRole('button', { name: 'Save a copy, then replace' })).toHaveFocus()
  })

  it('goes ahead without a second question when replacing loses nothing', () => {
    const chosen: string[] = []
    render(<ReplaceTrackerDialog onChoose={(choice) => chosen.push(choice)} replacement={{ ...importing, backedUp: true, folder: 'test_job', openAsNewBeside: 'test_job' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Replace test_job' }))
    expect(chosen).toEqual(['proceed'])
  })

  it('says the dev server\'s file is written over, and that nothing else holds it', () => {
    expect(body({ ...importing, incoming: 2, attachments: 1, current: 19, backedUp: false, folder: null, openAsNewBeside: null })).toBe(
      'other.json has 2 applications and 1 attachment. Importing it replaces the 19 applications in your tracker. Nothing else holds them, so save a copy first if you might want them back.',
    )
  })
})
