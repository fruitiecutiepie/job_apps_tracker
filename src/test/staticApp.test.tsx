import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'

import { prepareTrackerDatabase } from '../domain/database'
import { serializeTrackerDocument } from '../domain/export'
import { createApplication } from '../domain/mutations'
import { FakeDirectory, looseFile } from '../backend/fakeDirectory'
import type { FileHandleLike } from '../backend/fileSystem'
import { readTrackerImport } from '../domain/import'

/**
 * The static build, exercised as the app rather than as the backend.
 *
 * The backend is chosen when its module first evaluates, so the env has to be stubbed and
 * the module graph reset before `App` is imported — importing it at the top of the file
 * would pin the dev-server backend every other suite uses.
 */
async function renderStaticApp(profile: 'live' | 'demo' = 'live'): Promise<void> {
  vi.resetModules()
  // Which tracker opens comes from the URL, so each render starts on a bare one.
  window.history.replaceState(null, '', '/')
  vi.stubEnv('VITE_TRACKER_BACKEND', 'browser')
  /*
   * The suite runs under the demo profile by default, so the tracker build has to say so
   * explicitly — otherwise every one of these would be testing the demo.
   */
  vi.stubEnv('VITE_TRACKER_PROFILE', profile)
  const { default: App } = (await import('../App')) as { default: ComponentType }
  render(<App />)
  await waitFor(
    () => expect(screen.queryByText('Loading tracker data…')).not.toBeInTheDocument(),
    { timeout: 5000 },
  )
}

async function addApplication(
  user: ReturnType<typeof userEvent.setup>,
  company: string,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Add application' }))
  const dialog = screen.getByRole('dialog', { name: 'Add application' })
  await user.type(within(dialog).getByLabelText('Company'), company)
  await user.click(within(dialog).getByRole('button', { name: 'Add application' }))
}

/** A one-application export, as a file to hand the import input. */
function trackerFile(company: string): File {
  const document = prepareTrackerDatabase([
    createApplication({
      company,
      role: '',
      url: '',
      source: '',
      state: 'applied',
      next_action: '',
      next_action_at: null,
      deadline_at: null,
      notes: '',
    }),
  ])
  return new File([serializeTrackerDocument(document)], `${company}.json`, { type: 'application/json' })
}

/*
 * A drop the way Chrome and Edge deliver one: the file, and on its transfer item a way to
 * ask for the browser's handle on it — which is what lets the app tell the same file on
 * disk from one that merely reads alike.
 */
function dropWithHandle(handle: FileHandleLike, contents: string, name = handle.name): void {
  const file = new File([contents], name, { type: 'application/json' })
  const dataTransfer = {
    types: ['Files'],
    files: [file],
    items: [{ kind: 'file', getAsFileSystemHandle: async () => handle }],
  }
  fireEvent.dragEnter(window, { dataTransfer })
  fireEvent.drop(window, { dataTransfer })
}

/** Looked up where it is used: the app remounts across a reload. */
function topbar(): HTMLElement {
  const header = document.querySelector<HTMLElement>('header.topbar')
  if (!header) throw new Error('No topbar rendered')
  return header
}

describe('the static build', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_TRACKER_BACKEND', 'browser')
    vi.stubEnv('VITE_TRACKER_PROFILE', 'live')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('opens on an empty tracker, not on the demo data', async () => {
    await renderStaticApp()
    expect(screen.getByText('0 of 0 applications shown')).toBeInTheDocument()
    // Set once the backend has said which tracker this is, which can be a render after load.
    await waitFor(() => expect(document.title).toBe('Untitled tracker — Job applications'))
  })

  it('explains where the data goes before there is any', async () => {
    await renderStaticApp()
    expect(screen.getByRole('heading', { name: 'Track your job applications' })).toBeInTheDocument()
    // The reason a copy matters is said before anyone is asked to make one.
    expect(
      screen.getByText(/Clearing your browsing data or closing a private window deletes them/),
    ).toHaveTextContent(/so export a backup now and then/)
    expect(screen.getByRole('button', { name: /Import a file/ })).toBeInTheDocument()
  })

  /*
   * jsdom has no File System Access API, which is the same position a viewer on Firefox
   * or Safari is in: the site must still work and must say so rather than imply a folder.
   */
  it('says the data is only in this browser when no folder can be chosen', async () => {
    await renderStaticApp()
    expect(screen.getByText('Saved in this browser')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Choose a folder/ })).not.toBeInTheDocument()
  })

  it('starts by adding an application, and goes once there is one', async () => {
    const user = userEvent.setup()
    await renderStaticApp()

    await user.click(screen.getByRole('button', { name: 'Add your first application' }))
    const dialog = screen.getByRole('dialog', { name: 'Add application' })
    await user.type(within(dialog).getByLabelText('Company'), 'Northwind')
    await user.click(within(dialog).getByRole('button', { name: 'Add application' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Track your job applications' }),
      ).not.toBeInTheDocument(),
    )
  })

  /*
   * A browser with no folder support saves every change to its own storage and cannot do
   * better, so what gets lost is the export nobody remembered to make. The pill turns into
   * that export the moment a change exists only here.
   */
  it('turns the storage pill into Export once a change is only in this browser', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    const banner = topbar()
    expect(within(banner).getByText('Saved in this browser')).toBeInTheDocument()

    await addApplication(user, 'Northwind')
    const exportButton = await within(banner).findByRole('button', { name: 'Export a backup' })
    expect(exportButton).toHaveAttribute('title', expect.stringMatching(/^Changes since .+ are only in this browser/))

    // jsdom has no object URLs, and following the download link would navigate.
    const objectUrls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
    URL.createObjectURL = vi.fn(() => 'blob:tracker')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      await user.click(exportButton)
      await waitFor(() => expect(within(banner).getByText('Saved in this browser')).toBeInTheDocument())
      expect(click).toHaveBeenCalledTimes(1)
    } finally {
      click.mockRestore()
      Object.assign(URL, objectUrls)
    }
  })

  /*
   * An empty tracker has nothing to lose, so an import there simply happens. One that
   * holds only what the last import brought is backed up by that file, so the question is
   * a plain one; add something after it and the copy is offered again.
   */
  /*
   * An empty tracker has nothing to lose, so an import there simply happens. Over one that
   * holds applications, the file is first offered as a tracker of its own; replacing is
   * the second answer, and leads on to the copy only when something would be lost.
   */
  it('offers a dropped file as a new tracker first, and asks about a copy only to replace', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const { navigation } = await import('../backend/trackerAddress')
    const { backend } = await import('../backend')
    const open = vi.spyOn(navigation, 'open').mockImplementation(() => {})

    await user.upload(input, trackerFile('Imported Ltd'))
    await waitFor(() => expect(screen.getByText('1 of 1 applications shown')).toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    // Everything here is in the file it came from, so replacing needs no second question.
    await user.upload(input, trackerFile('Second Import'))
    let question = await screen.findByRole('alertdialog', { name: 'Open Second Import.json?' })
    expect(within(question).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Open as a new tracker',
      'Replace Imported Ltd',
      'Cancel',
    ])
    expect(within(question).getByRole('button', { name: 'Open as a new tracker' })).toHaveFocus()
    await user.click(within(question).getByRole('button', { name: 'Open as a new tracker' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringMatching(/^\?tracker=/)))
    expect((await backend.storage!.listTrackers()).map((tracker) => tracker.name).sort())
      .toEqual(['Imported Ltd', 'Second Import'])
    expect(screen.getByRole('button', { name: /Open Imported Ltd/ })).toBeInTheDocument()

    // Something typed since is only in this browser: closing it asks about a copy first.
    await addApplication(user, 'Typed Since')
    await within(topbar()).findByRole('button', { name: 'Export a backup' })
    const here = backend.storage!.state().tracker!.id
    open.mockClear()
    await user.upload(input, trackerFile('Third Import'))
    question = await screen.findByRole('alertdialog', { name: 'Open Third Import.json?' })
    await user.click(within(question).getByRole('button', { name: 'Replace Imported Ltd' }))
    question = await screen.findByRole('alertdialog', { name: 'Remove Imported Ltd from this browser?' })
    expect(question).toHaveTextContent('Its 2 applications are only in this browser and will be deleted.')
    expect(within(question).getByRole('button', { name: 'Download a copy, then replace' })).toHaveFocus()
    await user.click(within(question).getByRole('button', { name: 'Discard and replace' }))

    // The file opens as a tracker of its own in this tab; the one that was here is closed.
    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringMatching(/^\?tracker=/)))
    const listed = await backend.storage!.listTrackers()
    expect(listed.map((tracker) => tracker.name).sort()).toEqual(['Second Import', 'Third Import'])
    expect(listed.some((tracker) => tracker.id === here)).toBe(false)
  })

  /*
   * The drop target says what a drop will do. Here a file over a tracker with applications
   * is asked about rather than replacing it, so "replaces everything" would be false.
   */
  it('says what a dropped file will do, which here is not replacing everything', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    const files = { types: ['Files'], files: [trackerFile('Dropped')] }

    fireEvent.dragEnter(window, { dataTransfer: files })
    expect(screen.getByText('Drop to open it here')).toBeInTheDocument()
    fireEvent.dragLeave(window, { dataTransfer: files })

    await addApplication(user, 'Northwind')
    await waitFor(() => expect(screen.getByText('1 of 1 applications shown')).toBeInTheDocument())
    fireEvent.dragEnter(window, { dataTransfer: files })
    expect(screen.getByText('Drop to open — as a new tracker, or in place of this one')).toBeInTheDocument()
    expect(screen.queryByText(/replaces everything/)).not.toBeInTheDocument()
  })

  /*
   * A browser can hold several trackers, a tab holds one, and the tab says which: the
   * switcher's name and the tab's title are both the imported file's.
   */
  it('names the tab and the switcher after the file it was imported from', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await user.upload(input, trackerFile('job-search-2026'))

    await waitFor(() => expect(document.title).toBe('job-search-2026 — Job applications'))
    const trigger = within(topbar()).getByRole('button', { name: /^Tracker: job-search-2026/ })
    await user.click(trigger)
    const list = screen.getByRole('list', { name: /Trackers in this browser/ })
    const current = within(list).getByRole('link', { name: /job-search-2026/ })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveTextContent('1 application')
    const starting = screen.getByRole('group', { name: 'New or existing tracker' })
    expect(within(starting).getByRole('link', { name: 'Blank tracker' })).toHaveAttribute('href', '?tracker=new')
    // No folder in a browser that cannot open one; a file works everywhere.
    expect(within(starting).queryByRole('button', { name: /From a folder/ })).not.toBeInTheDocument()
    expect(within(starting).getByRole('button', { name: /From a file/ })).toBeInTheDocument()
  })

  it('renames the tracker from the switcher, and exports under the new name', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    await addApplication(user, 'Northwind')

    await user.click(within(topbar()).getByRole('button', { name: /^Tracker: Untitled tracker/ }))
    // The pencil at the end of the row, named for the tracker it renames.
    await user.click(screen.getByRole('button', { name: 'Rename Untitled tracker' }))
    const field = screen.getByRole('textbox', { name: 'New name for Untitled tracker' })
    expect(field).toHaveValue('Untitled tracker')
    await user.clear(field)
    expect(screen.getByRole('button', { name: 'Save the name for Untitled tracker' })).toBeDisabled()
    await user.type(field, 'Autumn search{Enter}')

    await waitFor(() => expect(document.title).toBe('Autumn search — Job applications'))
    const list = screen.getByRole('list', { name: /Trackers in this browser/ })
    await waitFor(() => expect(within(list).getByRole('link', { name: /Autumn search/ })).toBeInTheDocument())

    const objectUrls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
    URL.createObjectURL = vi.fn(() => 'blob:tracker')
    URL.revokeObjectURL = vi.fn()
    const downloads: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
    try {
      await user.click(within(topbar()).getByRole('button', { name: 'Export a backup' }))
      await waitFor(() => expect(downloads).toHaveLength(1))
      expect(downloads[0]).toMatch(/^Autumn search \d{4}-\d{2}-\d{2}\.zip$/)
    } finally {
      click.mockRestore()
      Object.assign(URL, objectUrls)
    }
  })

  /*
   * New tracker, from a file: the file becomes a tracker beside this one, so nothing is
   * replaced and nothing is asked, and the tab goes to it.
   */
  it('starts a new tracker from a file without touching this one', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    await addApplication(user, 'Stays here')
    const { navigation } = await import('../backend/trackerAddress')
    const { backend } = await import('../backend')
    const open = vi.spyOn(navigation, 'open').mockImplementation(() => {})

    await user.click(within(topbar()).getByRole('button', { name: /^Tracker:/ }))
    await user.click(screen.getByRole('button', { name: /From a file/ }))
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    await user.upload(inputs[inputs.length - 1], trackerFile('last-year'))

    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringMatching(/^\?tracker=/)))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    const listed = await backend.storage!.listTrackers()
    expect(listed.map((tracker) => tracker.name).sort()).toEqual(['Untitled tracker', 'last-year'])
    expect(screen.getByText('1 of 1 applications shown')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open Stays here/ })).toBeInTheDocument()
  })

  /*
   * Each row carries its own Rename and Remove, so a tracker can be tidied without being
   * opened. Removing one this tab is not holding leaves the tab where it is.
   */
  it('removes another tracker from its row, staying in this one', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    await addApplication(user, 'Stays here')
    const { navigation } = await import('../backend/trackerAddress')
    const { backend } = await import('../backend')
    const open = vi.spyOn(navigation, 'open').mockImplementation(() => {})
    await user.click(within(topbar()).getByRole('button', { name: /^Tracker:/ }))
    await user.click(screen.getByRole('button', { name: /From a file/ }))
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    await user.upload(inputs[inputs.length - 1], trackerFile('last-year'))
    await waitFor(() => expect(open).toHaveBeenCalled())
    open.mockClear()

    await user.click(within(topbar()).getByRole('button', { name: /^Tracker:/ }))
    await user.click(await screen.findByRole('button', { name: 'Remove last-year from this browser' }))
    // It came from a file the viewer holds, so the question is a plain one.
    const question = await screen.findByRole('alertdialog', { name: 'Remove last-year from this browser?' })
    await user.click(within(question).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Removed last-year from this browser.'))
    expect(open).not.toHaveBeenCalled()
    expect((await backend.storage!.listTrackers()).map((tracker) => tracker.name)).toEqual(['Untitled tracker'])
    expect(screen.getByRole('button', { name: /Open Stays here/ })).toBeInTheDocument()
  })

  /*
   * Export is on each tracker's row, and a file comes in as a tracker of its own, so the
   * topbar's menu — which would act on one of several without saying which — offers
   * neither. It stays for Archive all ended, which acts on the tracker on screen. There is
   * no Import on a row: replacing one tracker of several from a file was hard to predict.
   */
  it('keeps Export on the tracker rows, with no Import there or in the topbar menu', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    await user.click(within(topbar()).getByRole('button', { name: 'More actions' }))
    const menu = within(topbar())
    expect(menu.getByRole('button', { name: /^Archive all ended/ })).toBeInTheDocument()
    expect(menu.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument()
    expect(menu.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(within(topbar()).getByRole('button', { name: /^Tracker:/ }))
    const row = screen.getByRole('link', { name: /Untitled tracker/ }).closest('li')!
    expect(within(row).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Rename Untitled tracker',
      'Export Untitled tracker',
      'Remove Untitled tracker from this browser',
    ])
  })

  it('exports another tracker from its row, staying in this one', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    await addApplication(user, 'Stays here')
    const { navigation } = await import('../backend/trackerAddress')
    const { backend } = await import('../backend')
    vi.spyOn(navigation, 'open').mockImplementation(() => {})
    await user.click(within(topbar()).getByRole('button', { name: /^Tracker:/ }))
    await user.click(screen.getByRole('button', { name: /From a file/ }))
    const inputs = () => document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    await user.upload(inputs()[inputs().length - 1], trackerFile('last-year'))
    await waitFor(async () => expect(await backend.storage!.listTrackers()).toHaveLength(2))

    const other = (await backend.storage!.listTrackers()).find((tracker) => tracker.name === 'last-year')!

    // And out of it, under its own name, while this tab stays where it is.
    const objectUrls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
    URL.createObjectURL = vi.fn(() => 'blob:tracker')
    URL.revokeObjectURL = vi.fn()
    const downloads: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
    try {
      await user.click(within(topbar()).getByRole('button', { name: /^Tracker:/ }))
      await user.click(await screen.findByRole('button', { name: `Export ${other.name}` }))
      await waitFor(() => expect(downloads).toHaveLength(1))
      expect(downloads[0]).toMatch(/^last-year \d{4}-\d{2}-\d{2}\.zip$/)
    } finally {
      click.mockRestore()
      Object.assign(URL, objectUrls)
    }
    expect(screen.getByRole('button', { name: /Open Stays here/ })).toBeInTheDocument()
  })

  /*
   * A file another tracker here was opened from is offered as that tracker: switching to it
   * is the likelier meaning, and opening it again as a new one is still there.
   */
  it('offers to switch to the tracker a dropped file was opened from', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    await addApplication(user, 'Stays here')
    const { backend } = await import('../backend')
    const { navigation } = await import('../backend/trackerAddress')
    const open = vi.spyOn(navigation, 'open').mockImplementation(() => {})
    const exported = await trackerFile('last-year').text()
    const original = looseFile('last-year.json', exported)
    const result = readTrackerImport(new TextEncoder().encode(exported))
    if (!result.ok) throw new Error('fixture')
    const earlier = await backend.storage!.createTracker(result.document, [], 'last-year.json', original)

    dropWithHandle(original, exported, 'last-year.json')
    const question = await screen.findByRole('alertdialog', { name: 'last-year is already in this browser' })
    expect(question).toHaveTextContent('last-year was opened from this file.')
    expect(within(question).getByRole('button', { name: 'Switch to last-year' })).toHaveFocus()
    await user.click(within(question).getByRole('button', { name: 'Switch to last-year' }))
    expect(open).toHaveBeenCalledWith(`?tracker=${earlier.id}`)
  })

  it('says where each tracker lives, so two of one name can be told apart', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    await addApplication(user, 'Stays here')
    const { backend } = await import('../backend')
    const exported = await trackerFile('Autumn search').text()
    const result = readTrackerImport(new TextEncoder().encode(exported))
    if (!result.ok) throw new Error('fixture')
    await backend.storage!.createTracker(result.document, [], 'Autumn search.json')
    await backend.storage!.createTracker(result.document, [], 'Autumn search 2026-10-01.zip')

    await user.click(within(topbar()).getByRole('button', { name: /^Tracker:/ }))
    const list = screen.getByRole('list', { name: /Trackers in this browser/ })
    await waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(3))
    const lines = within(list).getAllByRole('link').map((link) => link.textContent)
    expect(lines).toContain('Autumn search1 application · from Autumn search.json')
    expect(lines).toContain('Autumn search1 application · from Autumn search 2026-10-01.zip')
    expect(lines).toContain('Untitled tracker1 application · only in this browser')
  })

  it('keeps reminding after a reload, since forgetting happens between visits', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    await addApplication(user, 'Northwind')
    await within(topbar()).findByRole('button', { name: 'Export a backup' })

    cleanup()
    const { default: App } = (await import('../App')) as { default: ComponentType }
    render(<App />)
    await waitFor(
      () => expect(within(topbar()).getByRole('button', { name: 'Export a backup' })).toBeInTheDocument(),
      { timeout: 5000 },
    )
  })

  it('auto-saves an added application and has it back after a reload', async () => {
    const user = userEvent.setup()
    await renderStaticApp()

    await addApplication(user, 'Northwind')
    await waitFor(() => expect(screen.getByText('1 of 1 applications shown')).toBeInTheDocument())

    // Remounting without resetting the module graph is what a reload looks like: the
    // backend, and the storage behind it, are the same ones the first render wrote to.
    cleanup()
    const { default: App } = (await import('../App')) as { default: ComponentType }
    render(<App />)
    await waitFor(
      () => expect(screen.getByRole('button', { name: /Open Northwind/ })).toBeInTheDocument(),
      { timeout: 5000 },
    )
  })

  it('points anyone still deciding at the demo', async () => {
    await renderStaticApp()
    const link = screen.getByRole('link', { name: 'Try the demo' })
    expect(link).toHaveAttribute('href', '/demo/')
  })

  it('shows no demo banner, because this is not the demo', async () => {
    await renderStaticApp()
    expect(screen.queryByText(/This is the demo/)).not.toBeInTheDocument()
  })

  it('offers no external editor, which a static site cannot reach', async () => {
    const user = userEvent.setup()
    await renderStaticApp()

    await addApplication(user, 'Northwind')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Open Northwind/ })).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: 'Add prep notes for Northwind' }))
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Prep' })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: /Open .* in an editor/ })).not.toBeInTheDocument()
  })
})

/*
 * Where a folder can be written it is offered, but never as the price of starting: the
 * browser copy is the default, and the topbar asks for a folder once there is something
 * only this browser holds.
 */
describe('the static build, in a browser that can write a folder', () => {
  // Assigned rather than stubbed: unstubbing every global would take setup's with it.
  beforeEach(() => {
    Object.assign(window, { showDirectoryPicker: vi.fn() })
  })

  afterEach(() => {
    cleanup()
    Reflect.deleteProperty(window, 'showDirectoryPicker')
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('offers one way to bring data in beside starting', async () => {
    await renderStaticApp()
    const intro = screen.getByRole('region', { name: 'Track your job applications' })
    const actions = within(intro).getAllByRole('button').map((button) => button.textContent?.trim())
    // One way to bring data in: a folder both opens and saves, so Import would repeat it.
    expect(actions).toEqual(['Add your first application', 'Choose a folder'])
    expect(within(intro).getByRole('button', { name: 'Add your first application' })).toHaveClass('button--primary')
    expect(intro).toHaveTextContent(/deletes them, so keep them in a folder on your computer as well\./)
    expect(intro).toHaveTextContent(/A folder with your tracker in it opens it; an empty folder starts saving there\./)
  })

  /*
   * Removing a tracker deletes it from this browser and never touches a connected
   * folder's files, so the folder is the copy and the question is a plain one.
   */
  it('removes a tracker from the browser, leaving its folder its file', async () => {
    const user = userEvent.setup()
    const folder = new FakeDirectory('job-apps')
    Object.assign(window, { showDirectoryPicker: vi.fn(async () => folder) })
    await renderStaticApp()
    const { navigation } = await import('../backend/trackerAddress')
    const open = vi.spyOn(navigation, 'open').mockImplementation(() => {})

    await user.click(screen.getByRole('button', { name: /Choose a folder/ }))
    await within(topbar()).findByRole('button', { name: 'Saved to job-apps' })
    await addApplication(user, 'Northwind')
    await waitFor(() => expect(folder.readText('tracker.json')).toContain('Northwind'))
    // The change has landed, so the pill says so rather than still reading as in progress.
    await within(topbar()).findByRole('button', { name: 'Saved to job-apps' })

    await user.click(within(topbar()).getByRole('button', { name: /^Tracker: job-apps/ }))
    await user.click(screen.getByRole('button', { name: 'Remove job-apps from this browser' }))
    const question = await screen.findByRole('alertdialog', { name: 'Remove job-apps from this browser?' })
    expect(question).toHaveTextContent('It stays in your job-apps folder.')
    expect(within(question).queryByRole('button', { name: /Discard/ })).not.toBeInTheDocument()
    await user.click(within(question).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(open).toHaveBeenCalledWith('?tracker=new'))
    expect(folder.readText('tracker.json')).toContain('Northwind')
  })

  /*
   * Another tracker's folder is its copy only while nothing is waiting to reach it. With a
   * backlog its permission lapsed, and what was typed since is in this browser alone, so
   * removing it offers the copy rather than saying the folder keeps everything.
   */
  it('offers a copy before removing a tracker whose folder fell behind', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    const { backend } = await import('../backend')
    const current = backend.storage!.state().tracker!
    vi.spyOn(backend.storage!, 'listTrackers').mockResolvedValue([
      { id: current.id, name: current.name, applications: 0, openedAt: '' },
      {
        id: 'lapsed',
        name: 'Spring search',
        applications: 2,
        openedAt: '',
        folder: 'job-apps',
        unbackedSince: '2026-09-01T09:00:00.000Z',
      },
    ])

    await user.click(within(topbar()).getByRole('button', { name: /^Tracker:/ }))
    await user.click(await screen.findByRole('button', { name: 'Remove Spring search from this browser' }))
    const question = await screen.findByRole('alertdialog', { name: 'Remove Spring search from this browser?' })
    expect(question).not.toHaveTextContent('It stays in your job-apps folder.')
    expect(within(question).getByRole('button', { name: 'Download a copy, then remove' })).toBeInTheDocument()
  })

  it('keeps the new name in its field when another tracker refuses it', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    const { backend } = await import('../backend')
    const current = backend.storage!.state().tracker!
    vi.spyOn(backend.storage!, 'listTrackers').mockResolvedValue([
      { id: current.id, name: current.name, applications: 0, openedAt: '' },
      { id: 'other', name: 'Spring search', applications: 2, openedAt: '', folder: 'job-apps' },
    ])
    vi.spyOn(backend.storage!, 'renameOtherTracker').mockRejectedValue(new Error('not allowed'))

    await user.click(within(topbar()).getByRole('button', { name: /^Tracker:/ }))
    await user.click(await screen.findByRole('button', { name: 'Rename Spring search' }))
    const field = screen.getByRole('textbox', { name: 'New name for Spring search' })
    await user.clear(field)
    await user.type(field, 'Autumn search{Enter}')

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Could not rename Spring search/))
    expect(screen.getByRole('textbox', { name: 'New name for Spring search' })).toHaveValue('Autumn search')
  })

  /*
   * A folder another tracker already writes to is opened as that tracker, not connected a
   * second time; two trackers writing one file would each undo the other.
   */
  it('opens the tracker a picked folder already belongs to', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    // Which tracker holds a folder is the backend's to find out, and its tests do.
    const { backend } = await import('../backend')
    const { navigation } = await import('../backend/trackerAddress')
    vi.spyOn(backend.storage!, 'connect').mockResolvedValue({
      outcome: 'already-open',
      tracker: { id: 'holder', name: 'job-apps', applications: 3, openedAt: '' },
    })
    const open = vi.spyOn(navigation, 'open').mockImplementation(() => {})

    await user.click(screen.getByRole('button', { name: /Choose a folder/ }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('?tracker=holder'))
    expect(screen.queryByText(/now saved to that folder/)).not.toBeInTheDocument()
  })

  it('offers a folder among the ways to start a new tracker', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    await user.click(within(topbar()).getByRole('button', { name: /^Tracker:/ }))
    const starting = screen.getByRole('group', { name: 'New or existing tracker' })
    expect(within(starting).getAllByRole('link').concat(within(starting).getAllByRole('button')).map((item) => item.textContent?.trim()))
      .toEqual(['Blank tracker', 'From a folder…', 'From a file…'])
  })

  /*
   * A folder holding a different tracker, picked while this one has applications, opens as
   * its own tracker rather than replacing these. The backend decides that and its tests say
   * so; this is the app going there.
   */
  it('opens a folder holding a different tracker as its own, not over this one', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    const { backend } = await import('../backend')
    const { navigation } = await import('../backend/trackerAddress')
    vi.spyOn(backend.storage!, 'connect').mockResolvedValue({
      outcome: 'opened',
      tracker: { id: 'from-the-folder', name: 'last-year', applications: 4, openedAt: '' },
    })
    const open = vi.spyOn(navigation, 'open').mockImplementation(() => {})

    await user.click(screen.getByRole('button', { name: /Choose a folder/ }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('?tracker=from-the-folder'))
    expect(screen.queryByText(/now saved to that folder/)).not.toBeInTheDocument()
  })

  /*
   * Replacing never writes over a tracker: the dropped file opens in this tab and the
   * tracker that was here closes. A folder-saved one loses nothing by closing — its folder
   * is never touched — so nothing further is asked.
   */
  it('replaces a folder-saved tracker by closing it, leaving its folder exactly as it was', async () => {
    const user = userEvent.setup()
    const folder = new FakeDirectory('test_job')
    Object.assign(window, { showDirectoryPicker: vi.fn(async () => folder) })
    await renderStaticApp()
    const { backend } = await import('../backend')
    const { navigation } = await import('../backend/trackerAddress')
    const open = vi.spyOn(navigation, 'open').mockImplementation(() => {})
    await user.click(screen.getByRole('button', { name: /Choose a folder/ }))
    await within(topbar()).findByRole('button', { name: 'Saved to test_job' })
    await addApplication(user, 'Northwind')
    await waitFor(() => expect(folder.readText('tracker.json')).toContain('Northwind'))
    const before = folder.readText('tracker.json')
    const closing = backend.storage!.state().tracker!.id

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await user.upload(input, trackerFile('Dropped'))
    const question = await screen.findByRole('alertdialog', { name: 'Open Dropped.json?' })
    // Connecting the folder named the tracker after it.
    expect(question).toHaveTextContent('Replacing removes test_job from this browser. Its test_job folder keeps everything.')
    await user.click(within(question).getByRole('button', { name: 'Replace test_job' }))

    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringMatching(/^\?tracker=/)))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(folder.readText('tracker.json')).toBe(before)
    const names: string[] = []
    for await (const name of folder.keys()) names.push(name)
    expect(names).toEqual(['tracker.json'])
    const listed = await backend.storage!.listTrackers()
    expect(listed.map((tracker) => tracker.name)).toEqual(['Dropped'])
    expect(listed.some((tracker) => tracker.id === closing)).toBe(false)
  })

  /*
   * A file is matched by being the same file on disk — the browser compares the two —
   * never by reading alike. Dropping a folder-saved tracker's own tracker.json back onto it
   * changes nothing, so nothing is asked.
   */
  it('does nothing with a drop of the file this tracker saves to', async () => {
    const user = userEvent.setup()
    const folder = new FakeDirectory('test_job')
    Object.assign(window, { showDirectoryPicker: vi.fn(async () => folder) })
    await renderStaticApp()
    await user.click(screen.getByRole('button', { name: /Choose a folder/ }))
    await within(topbar()).findByRole('button', { name: 'Saved to test_job' })
    await addApplication(user, 'Northwind')
    await waitFor(() => expect(folder.readText('tracker.json')).toContain('Northwind'))

    dropWithHandle(await folder.getFileHandle('tracker.json'), folder.readText('tracker.json')!)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'tracker.json is the file test_job already saves to, so there is nothing to import.',
    ))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('asks as usual about a different file that merely reads the same', async () => {
    const user = userEvent.setup()
    const folder = new FakeDirectory('test_job')
    Object.assign(window, { showDirectoryPicker: vi.fn(async () => folder) })
    await renderStaticApp()
    await user.click(screen.getByRole('button', { name: /Choose a folder/ }))
    await within(topbar()).findByRole('button', { name: 'Saved to test_job' })
    await addApplication(user, 'Northwind')
    await waitFor(() => expect(folder.readText('tracker.json')).toContain('Northwind'))

    const sameWords = folder.readText('tracker.json')!
    dropWithHandle(looseFile('copy-of-tracker.json', sameWords), sameWords)
    expect(await screen.findByRole('alertdialog', { name: 'Open copy-of-tracker.json?' })).toBeInTheDocument()
  })

  it('says nothing when the folder picker is dismissed', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    await user.click(screen.getByRole('button', { name: /Choose a folder/ }))

    expect((window as unknown as { showDirectoryPicker: () => void }).showDirectoryPicker).toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(within(topbar()).getByRole('button', { name: 'Saved in this browser' })).toBeInTheDocument()
  })

  it('asks for a folder in the top bar once a change is only in this browser', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    const quiet = within(topbar()).getByRole('button', { name: 'Saved in this browser' })
    expect(quiet).not.toHaveClass('storage-status--attention')

    await addApplication(user, 'Northwind')
    const pill = await within(topbar()).findByRole('button', { name: 'Save to a folder' })
    expect(pill).toHaveClass('storage-status--attention')
    expect(pill).toHaveAttribute(
      'title',
      expect.stringMatching(/^Changes since .+ are only in this browser, and clearing your browsing data would delete them\./),
    )
  })
})

/*
 * The backend's tests prove another tab's write or removal is announced. These prove the
 * app acts on the announcement: a newer document replaces what is on screen without a
 * reload, and a removed tracker sends this tab where the removing tab went rather than
 * leaving it to write the tracker back on its next keystroke.
 */
describe('the static build, when another tab changes this tracker', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.resetModules()
    vi.restoreAllMocks()
  })

  async function renderHearing() {
    vi.resetModules()
    window.history.replaceState(null, '', '/')
    vi.stubEnv('VITE_TRACKER_BACKEND', 'browser')
    vi.stubEnv('VITE_TRACKER_PROFILE', 'live')
    const { backend } = await import('../backend')
    const { navigation } = await import('../backend/trackerAddress')
    let hear: (change: import('../backend').ExternalChange) => void = () => {}
    const subscribe = backend.subscribeChanges!.bind(backend)
    vi.spyOn(backend, 'subscribeChanges').mockImplementation((listener) => {
      hear = listener
      return subscribe(listener)
    })
    const open = vi.spyOn(navigation, 'open').mockImplementation(() => {})
    const { default: App } = (await import('../App')) as { default: ComponentType }
    render(<App />)
    await waitFor(
      () => expect(screen.queryByText('Loading tracker data…')).not.toBeInTheDocument(),
      { timeout: 5000 },
    )
    return { hear: (change: import('../backend').ExternalChange) => act(() => hear(change)), open }
  }

  it('shows a document another tab stored, without a reload', async () => {
    const { hear } = await renderHearing()
    expect(screen.getByText('0 of 0 applications shown')).toBeInTheDocument()

    const document = JSON.parse(await trackerFile('Halcyon').text())
    hear({ kind: 'document', document: { ...prepareTrackerDatabase(document.applications) } })

    expect(screen.getByText('1 of 1 applications shown')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open Halcyon/ })).toBeInTheDocument()
  })

  it('goes where the other tab went when this tracker is removed there', async () => {
    const { hear, open } = await renderHearing()

    hear({ kind: 'removed', next: { id: 'next-one', name: 'Next one', applications: 2, openedAt: '' } })
    expect(open).toHaveBeenCalledWith('?tracker=next-one')

    hear({ kind: 'removed', next: null })
    expect(open).toHaveBeenLastCalledWith('?tracker=new')
  })
})

describe('the hosted demo', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_TRACKER_BACKEND', 'browser')
    vi.stubEnv('VITE_TRACKER_PROFILE', 'demo')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('opens on the nineteen examples rather than on nothing', async () => {
    await renderStaticApp('demo')
    expect(screen.getByText('18 of 19 applications shown')).toBeInTheDocument()
  })

  it('says what it is, and offers the way out', async () => {
    await renderStaticApp('demo')
    expect(screen.getByText(/This is the demo/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open my tracker' })).toHaveAttribute('href', '/')
  })

  it('does not talk anyone out of the demo they are already looking at', async () => {
    await renderStaticApp('demo')
    expect(screen.queryByRole('link', { name: 'Try the demo' })).not.toBeInTheDocument()
  })

  it('can be reset, which the real tracker cannot', async () => {
    const user = userEvent.setup()
    await renderStaticApp('demo')

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('button', { name: /Reset demo data/ })).toBeInTheDocument()
  })

  /*
   * An emptied demo stays emptied. Reseeding on reload would throw away whatever someone
   * had been doing in it, and would make the demo the one place in the app where a save
   * does not stick.
   */
  it('stays empty once the examples are cleared', async () => {
    await renderStaticApp('demo')
    const { backend } = await import('../backend')
    const loaded = await backend.loadDocument()
    await backend.saveDocument({ ...loaded, applications: [] })

    cleanup()
    const { default: App } = (await import('../App')) as { default: ComponentType }
    render(<App />)
    await waitFor(
      () => expect(screen.getByText('0 of 0 applications shown')).toBeInTheDocument(),
      { timeout: 5000 },
    )
  })
})
