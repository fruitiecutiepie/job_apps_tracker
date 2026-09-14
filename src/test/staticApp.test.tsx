import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'

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
    expect(screen.getByRole('heading', { name: 'Your applications, on your machine' })).toBeInTheDocument()
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

  it('puts the intro away once the viewer starts fresh', async () => {
    const user = userEvent.setup()
    await renderStaticApp()

    await user.click(screen.getByRole('button', { name: 'Start fresh' }))
    expect(
      screen.queryByRole('heading', { name: 'Your applications, on your machine' }),
    ).not.toBeInTheDocument()
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
    const link = screen.getByRole('link', { name: 'Look around the demo' })
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
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Open .* in an editor/ })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('link', { name: 'Look around the demo' })).not.toBeInTheDocument()
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
