import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App'
import { loadTrackerDocument } from '../domain/storage'
import { prepareTrackerDatabase } from '../domain/database'
import { createApplication } from '../domain/mutations'
import { serializeTrackerDocument } from '../domain/export'
import { packTrackerArchive } from '../domain/archive'
import { seedFullDemo } from './fixture'
import { testTrackerStore } from './trackerStore'

function exportedJson(company: string): string {
  return serializeTrackerDocument(
    prepareTrackerDatabase([
      createApplication({
        company,
        role: 'Engineer',
        url: '',
        source: '',
        state: 'applied',
        next_action: '',
        next_action_at: null,
        deadline_at: null,
        notes: '',
      }),
    ]),
  )
}

/*
 * jsdom builds neither DataTransfer nor ClipboardEvent's files, so both are supplied as
 * the shape the handler reads: a `types` list and a `files` list.
 */
function fileTransfer(files: File[]): unknown {
  return { types: ['Files'], files, dropEffect: '' }
}

function jsonFile(text: string, name = 'job-applications.json'): File {
  return new File([text], name, { type: 'application/json' })
}

async function renderLoadedApp() {
  render(<App />)
  await waitFor(
    () => expect(screen.queryByText('Loading tracker data…')).not.toBeInTheDocument(),
    { timeout: 5000 },
  )
}

function drop(files: File[]) {
  fireEvent.drop(window, { dataTransfer: fileTransfer(files) })
}

function dragOver(files: File[] = [jsonFile('{}')]) {
  fireEvent.dragEnter(window, { dataTransfer: fileTransfer(files) })
}

let confirmSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  seedFullDemo()
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('dropping a file on the app', () => {
  it('replaces the tracker and re-renders it, without touching the Import button', async () => {
    await renderLoadedApp()
    expect(screen.getByText('19 of 19 applications shown')).toBeInTheDocument()

    drop([jsonFile(exportedJson('Dropped Industries'))])

    await waitFor(() => expect(screen.getByText('1 of 1 applications shown')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Open Dropped Industries/ })).toBeInTheDocument()
    expect(loadTrackerDocument(testTrackerStore).applications).toHaveLength(1)
  })

  it('asks before replacing, and does nothing when the answer is no', async () => {
    confirmSpy.mockReturnValue(false)
    await renderLoadedApp()

    drop([jsonFile(exportedJson('Dropped Industries'))])

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    expect(screen.getByText('19 of 19 applications shown')).toBeInTheDocument()
  })

  it('takes a zip archive with its attachments', async () => {
    await renderLoadedApp()
    const archive = packTrackerArchive(
      prepareTrackerDatabase([
        createApplication({
          company: 'Zipped Co',
          role: '',
          url: '',
          source: '',
          state: 'applied',
          next_action: '',
          next_action_at: null,
          deadline_at: null,
          notes: '',
        }),
      ]),
      [],
    )

    drop([new File([archive as BlobPart], 'job-applications.zip', { type: 'application/zip' })])

    await waitFor(() => expect(screen.getByText('1 of 1 applications shown')).toBeInTheDocument())
  })

  it('says what is wrong with a file it cannot read, and keeps the data', async () => {
    await renderLoadedApp()

    drop([jsonFile('{ not json at all', 'broken.json')])

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Import failed/))
    expect(screen.getByText('19 of 19 applications shown')).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('names what it accepts when the wrong kind of file lands on it', async () => {
    await renderLoadedApp()

    drop([new File(['hello'], 'notes.txt', { type: 'text/plain' })])

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/\.json or \.zip/))
    expect(screen.getByText('19 of 19 applications shown')).toBeInTheDocument()
  })

  it('shows a drop target while a file is over the page, and takes it away after', async () => {
    await renderLoadedApp()
    expect(screen.queryByText(/Drop to import/)).not.toBeInTheDocument()

    dragOver()
    expect(screen.getByText(/Drop to import/)).toBeInTheDocument()

    fireEvent.dragLeave(window, { dataTransfer: fileTransfer([jsonFile('{}')]) })
    await waitFor(() => expect(screen.queryByText(/Drop to import/)).not.toBeInTheDocument())
  })

  /*
   * The board drags cards and the notes panel drags tabs. Neither carries files, and a
   * drop overlay thrown up over a card being moved would cover the column it is aimed at.
   */
  it('ignores the app dragging its own things around', async () => {
    await renderLoadedApp()

    fireEvent.dragEnter(window, { dataTransfer: { types: ['text/plain'], files: [] } })
    expect(screen.queryByText(/Drop to import/)).not.toBeInTheDocument()

    fireEvent.drop(window, { dataTransfer: { types: ['text/plain'], files: [] } })
    await waitFor(() => expect(screen.getByText('19 of 19 applications shown')).toBeInTheDocument())
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})

describe('pasting a file into the app', () => {
  it('imports a copied export', async () => {
    await renderLoadedApp()

    fireEvent.paste(window, { clipboardData: { files: [jsonFile(exportedJson('Pasted Ltd'))] } })

    await waitFor(() => expect(screen.getByText('1 of 1 applications shown')).toBeInTheDocument())
  })

  /*
   * The listener is on the window, so it sees every paste in the app — including the ones
   * into a note. Deciding that pasted text was really a command would be the worst kind
   * of surprise, so only a pasted file is an import.
   */
  it('leaves pasted text alone', async () => {
    await renderLoadedApp()

    fireEvent.paste(window, {
      clipboardData: { files: [], getData: () => exportedJson('Pasted Ltd') },
    })

    await waitFor(() => expect(screen.getByText('19 of 19 applications shown')).toBeInTheDocument())
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})
