import { render, screen } from '@testing-library/react'
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
  /*
   * With a folder connected the applications are in the folder too, so "not saved anywhere
   * else" would be false. What is true is that the import overwrites the folder as well.
   */
  it('says a connected folder is overwritten too, not that nothing else holds the data', () => {
    const text = body({
      kind: 'import', incoming: 1, attachments: 0, current: 1, backedUp: false, folder: 'test_job', openAsNewBeside: null,
    })
    expect(text).toBe(
      'The file has 1 application. Importing it replaces the 1 application you have now, here and in your test_job folder, so neither keeps the old one. Save a copy first if you might want it back.',
    )
  })

  it('says the dev server\'s file is the only copy, not the browser', () => {
    expect(body({
      kind: 'import', incoming: 2, attachments: 1, current: 19, backedUp: false, folder: null, openAsNewBeside: null,
    })).toBe(
      'The file has 2 applications and 1 attachment. Importing it replaces the 19 applications you have now. Nothing else holds them, so save a copy first if you might want them back.',
    )
  })
})
