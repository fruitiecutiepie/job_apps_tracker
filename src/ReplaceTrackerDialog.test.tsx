import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ReplaceTrackerDialog, type ExistingTracker, type TrackerReplacement } from './ReplaceTrackerDialog'

function shown(replacement: TrackerReplacement | ExistingTracker): { title: string; body: string } {
  render(<ReplaceTrackerDialog onChoose={() => {}} replacement={replacement} />)
  const dialog = screen.getByRole('alertdialog')
  return {
    title: dialog.querySelector('#replace-tracker-title')!.textContent ?? '',
    body: dialog.querySelector('#replace-tracker-body')!.textContent ?? '',
  }
}

/*
 * Every body says only the effect of the action about to be taken: what will be lost, or
 * that nothing will. The buttons already name the choices, so the copy does not restate
 * them, nor counts and file names the reader is already looking at.
 */
describe('the question before removing a tracker', () => {
  const removing = { kind: 'remove' as const, name: 'test_job_apps', current: 3 }

  it('says a folder-saved tracker stays in its folder', () => {
    expect(shown({ ...removing, backedUp: true, folder: 'test_job' })).toEqual({
      title: 'Remove test_job_apps from this browser?',
      body: 'It stays in your test_job folder.',
    })
  })

  it('says the last export has everything, where it does', () => {
    expect(shown({ ...removing, backedUp: true, folder: null }).body).toBe('Your last export or import has all of it.')
  })

  it('says plainly what will be deleted, and nothing else', () => {
    expect(shown({ ...removing, backedUp: false, folder: null }).body).toBe(
      'Its 3 applications are only in this browser and will be deleted.',
    )
  })
})

describe('the question before a dropped file replaces a tracker', () => {
  const importing = { kind: 'import' as const, fileName: 'tracker.json', current: 1 }

  /*
   * Replace goes ahead without a second question whenever nothing would be lost, so the
   * first question's one line is what says what replacing does, and why it is safe.
   */
  it('says replacing closes a folder-saved tracker, which stays in its folder', () => {
    expect(shown({ ...importing, backedUp: true, folder: 'test_job', openAsNewBeside: 'test_job_apps' })).toEqual({
      title: 'Open tracker.json?',
      body: 'Replacing closes test_job_apps; it stays in your test_job folder.',
    })
  })

  it('says the last export has everything, where it does', () => {
    expect(shown({ ...importing, backedUp: true, folder: null, openAsNewBeside: 'first' }).body).toBe(
      'Replacing closes first; your last export or import has all of it.',
    )
  })

  it('says only that replacing closes it where closing would lose something, and asks after', () => {
    expect(shown({ ...importing, backedUp: false, folder: null, openAsNewBeside: 'first' }).body).toBe(
      'Replacing closes first.',
    )
  })

  it('asks about a copy, once replacing is chosen, saying what would be lost', () => {
    render(<ReplaceTrackerDialog onChoose={() => {}} replacement={{ ...importing, current: 3, backedUp: false, folder: null, openAsNewBeside: 'first' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Replace first' }))
    const question = screen.getByRole('alertdialog', { name: 'Close first?' })
    expect(question.querySelector('#replace-tracker-body')!.textContent).toBe('Its 3 applications are only in this browser.')
    expect(screen.getByRole('button', { name: 'Save a copy, then replace' })).toHaveFocus()
  })

  it('goes ahead without a second question when replacing loses nothing', () => {
    const chosen: string[] = []
    render(<ReplaceTrackerDialog onChoose={(choice) => chosen.push(choice)} replacement={{ ...importing, backedUp: true, folder: 'test_job', openAsNewBeside: 'test_job' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Replace test_job' }))
    expect(chosen).toEqual(['proceed'])
  })

  it('says on the dev server that its one file is the only copy', () => {
    expect(shown({ ...importing, current: 19, backedUp: false, folder: null, openAsNewBeside: null })).toEqual({
      title: 'Replace your tracker?',
      body: 'Its 19 applications are saved nowhere else.',
    })
  })
})

describe('the question when a file already is a tracker here', () => {
  it('says why, in one line, for a folder\'s own file', () => {
    expect(shown({ kind: 'existing', name: 'test_job_apps', file: 'tracker.json', folder: 'test_job' })).toEqual({
      title: 'test_job_apps is already in this browser',
      body: 'tracker.json is the file it saves to.',
    })
  })

  it('says why, in one line, for the file a tracker was opened from', () => {
    expect(shown({ kind: 'existing', name: 'last-year', file: 'last-year.json', folder: null }).body).toBe(
      'It was opened from last-year.json.',
    )
  })
})
