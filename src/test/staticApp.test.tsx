import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'

import { prepareTrackerDatabase } from '../domain/database'
import { serializeTrackerDocument } from '../domain/export'
import { createApplication } from '../domain/mutations'
import { FakeDirectory } from '../backend/fakeDirectory'

/**
 * The static build, exercised as the app rather than as the backend.
 *
 * The backend is chosen when its module first evaluates, so the env has to be stubbed and
 * the module graph reset before `App` is imported — importing it at the top of the file
 * would pin the dev-server backend every other suite uses.
 */
async function renderStaticApp(profile: 'live' | 'demo' = 'live'): Promise<void> {
  vi.resetModules()
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
  it('asks about replacing only as much as there is to lose', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!

    await user.upload(input, trackerFile('Imported Ltd'))
    await waitFor(() => expect(screen.getByText('1 of 1 applications shown')).toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await user.upload(input, trackerFile('Second Import'))
    let question = await screen.findByRole('alertdialog', { name: 'Replace your tracker?' })
    expect(question).toHaveTextContent('Your last backup already has them.')
    expect(within(question).queryByRole('button', { name: 'Discard and import' })).not.toBeInTheDocument()
    await user.click(within(question).getByRole('button', { name: 'Cancel' }))

    await addApplication(user, 'Typed Since')
    await within(topbar()).findByRole('button', { name: 'Export a backup' })
    await user.upload(input, trackerFile('Second Import'))
    question = await screen.findByRole('alertdialog', { name: 'Replace your tracker?' })
    expect(question).toHaveTextContent('They are not saved anywhere else')
    expect(within(question).getByRole('button', { name: 'Discard and import' })).toBeInTheDocument()
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

  it('offers a folder beside starting, not in place of it', async () => {
    await renderStaticApp()
    const intro = screen.getByRole('region', { name: 'Track your job applications' })
    const actions = within(intro).getAllByRole('button').map((button) => button.textContent?.trim())
    expect(actions).toEqual(['Add your first application', 'Import a file', 'Save to a folder'])
    expect(within(intro).getByRole('button', { name: 'Add your first application' })).toHaveClass('button--primary')
    expect(intro).toHaveTextContent(/deletes them, so save to a folder to keep a copy on your computer\./)
  })

  /*
   * Starting fresh with a folder connected lets go of the folder rather than emptying it.
   * The file there is the viewer's, so it is the copy, and the question is a plain one.
   */
  it('starts fresh by leaving the connected folder its file', async () => {
    const user = userEvent.setup()
    const folder = new FakeDirectory('job-apps')
    Object.assign(window, { showDirectoryPicker: vi.fn(async () => folder) })
    await renderStaticApp()

    await user.click(screen.getByRole('button', { name: /Save to a folder/ }))
    await within(topbar()).findByRole('button', { name: 'Saving to job-apps' })
    await addApplication(user, 'Northwind')
    await waitFor(() => expect(folder.readText('tracker.json')).toContain('Northwind'))

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('button', { name: 'Start fresh' }))
    const question = await screen.findByRole('alertdialog', { name: 'Start a fresh tracker?' })
    expect(question).toHaveTextContent('Your job-apps folder keeps its copy')
    expect(within(question).queryByRole('button', { name: /Discard/ })).not.toBeInTheDocument()
    await user.click(within(question).getByRole('button', { name: 'Start fresh' }))

    await waitFor(() => expect(screen.getByText('0 of 0 applications shown')).toBeInTheDocument())
    expect(folder.readText('tracker.json')).toContain('Northwind')
    expect(within(topbar()).getByRole('button', { name: 'Saved in this browser' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Your job-apps folder still has the old one.')
  })

  it('says nothing when the folder picker is dismissed', async () => {
    const user = userEvent.setup()
    await renderStaticApp()
    await user.click(screen.getByRole('button', { name: /Save to a folder/ }))

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
    expect(screen.getByText('19 of 19 applications shown')).toBeInTheDocument()
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
