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

describe('the question before an import replaces a tracker', () => {
  const importing = {
    kind: 'import' as const, fileName: 'other.json', incoming: 1, attachments: 0, current: 1,
  }

  /*
   * Two files are in play — the one being imported and the last export — so neither is
   * called "the file": the import goes by its name, and the backup by what it is.
   */
  /*
   * Where nothing would be lost, Replace goes ahead with no second question, so the first
   * one is the only place to say why that is safe.
   */
  it('says up front that replacing loses nothing when the last export has everything', () => {
    expect(body({ ...importing, backedUp: true, folder: null, openAsNewBeside: 'first' })).toBe(
      'other.json has 1 application. Open it as a tracker of its own beside first, or replace what first holds with it. Replacing loses nothing: first has not changed since you last exported or imported it.',
    )
  })

  it('says a connected folder is overwritten too, and keeps a copy there first', () => {
    expect(body({ ...importing, backedUp: true, folder: 'test_job', openAsNewBeside: 'test_job' })).toContain(
      'Replacing keeps a copy of what test_job holds now in your test_job folder first.',
    )
  })

  it('says the copy goes into the folder when a folder-saved tracker is replaced', () => {
    expect(body({ ...importing, backedUp: true, folder: 'test_job', openAsNewBeside: null })).toBe(
      'other.json has 1 application. Importing it replaces the 1 application in your tracker, here and in your test_job folder. A copy of what your tracker holds now is saved in that folder first.',
    )
  })

  it('says, once replacing is chosen, when the applications are only in this browser', () => {
    render(<ReplaceTrackerDialog onChoose={() => {}} replacement={{ ...importing, current: 3, backedUp: false, folder: null, openAsNewBeside: 'first' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Replace first' }))
    expect(screen.getByRole('alertdialog', { name: 'Replace first?' })).toHaveTextContent(
      'other.json has 1 application. Importing it replaces the 3 applications in first. They are only in this browser, so save a copy first if you might want them back.',
    )
  })

  it('says the dev server\'s file is the only copy, not the browser', () => {
    expect(body({ ...importing, incoming: 2, attachments: 1, current: 19, backedUp: false, folder: null, openAsNewBeside: null })).toBe(
      'other.json has 2 applications and 1 attachment. Importing it replaces the 19 applications in your tracker. Nothing else holds them, so save a copy first if you might want them back.',
    )
  })

  it('names the file in the first question, and adds nothing where replacing would lose something', () => {
    expect(body({ ...importing, backedUp: false, folder: null, openAsNewBeside: 'first' })).toBe(
      'other.json has 1 application. Open it as a tracker of its own beside first, or replace what first holds with it.',
    )
  })
})
