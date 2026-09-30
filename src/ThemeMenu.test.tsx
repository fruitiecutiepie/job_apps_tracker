import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeMenu } from './ThemeMenu'
import { THEME_STORAGE_KEY } from './theme'

// A matchMedia whose answer the test can flip, and which tells its listeners when it does,
// the way the OS switching to dark at sunset reaches the page.
function controllableSystem(dark: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    get matches() {
      return dark
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', () => query)
  return {
    set(next: boolean) {
      dark = next
      listeners.forEach((listener) => listener())
    },
  }
}

function openMenu() {
  return userEvent.click(screen.getByRole('button', { name: /^Theme:/ }))
}

describe('ThemeMenu', () => {
  beforeEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY)
    delete document.documentElement.dataset.theme
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('follows the system on a first visit and writes nothing down', () => {
    controllableSystem(true)
    render(<ThemeMenu />)

    expect(screen.getByRole('button', { name: 'Theme: System (dark)' })).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('keeps following the system when it changes after load', () => {
    const system = controllableSystem(false)
    render(<ThemeMenu />)
    expect(screen.getByRole('button', { name: 'Theme: System (light)' })).toBeInTheDocument()

    act(() => system.set(true))

    expect(screen.getByRole('button', { name: 'Theme: System (dark)' })).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('pins a picked theme and hands back to the system on System', async () => {
    controllableSystem(false)
    render(<ThemeMenu />)
    await openMenu()

    const group = screen.getByRole('group', { name: 'Theme' })
    expect(screen.getByRole('radio', { name: /System/ })).toBeChecked()

    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    // Still open: a pick is not a dismissal, or the arrow keys would close it.
    expect(group).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: /System/ }))
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('restores a stored choice', () => {
    controllableSystem(true)
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    render(<ThemeMenu />)

    expect(screen.getByRole('button', { name: 'Theme: Light' })).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('says what System would give while another theme is pinned', async () => {
    controllableSystem(false)
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    render(<ThemeMenu />)
    await openMenu()

    expect(screen.getByRole('radio', { name: 'System, currently light' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    controllableSystem(false)
    render(<ThemeMenu />)
    await openMenu()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('group', { name: 'Theme' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Theme:/ })).toHaveFocus()
  })
})
