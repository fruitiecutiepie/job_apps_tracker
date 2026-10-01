import { useEffect, useState } from 'react'

/**
 * The reader's colour scheme, as a preference rather than a colour: `system` follows the
 * operating system and goes on following it, while `light` and `dark` pin one.
 *
 * `system` is the absence of a choice, so it is stored as the absence of a key and of a
 * `data-theme` attribute. The stylesheet already answers the OS through
 * `prefers-color-scheme` wherever `data-theme` is missing, which makes following the system
 * a matter of getting out of its way. The hook this replaced wrote whatever it detected on
 * first load back to storage, so the first visit pinned that day's OS setting for good and
 * the app stopped noticing when the system went dark at sunset.
 *
 * Like the notes arrangement, this is per-machine interface state in `localStorage` and never
 * part of the document. `index.html` reads the same key before first paint, so a pinned
 * theme does not flash the system one while the bundle loads.
 */
export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'theme'

export const THEME_OPTIONS: readonly { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

function applyThemePreference(preference: ThemePreference) {
  const root = document.documentElement
  if (preference === 'system') delete root.dataset.theme
  else root.dataset.theme = preference
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Storage can be unavailable (private windows, blocked site data). The attribute above
    // still applies for this visit, which is all a failed write can cost.
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/**
 * The preference, a setter, and what the OS is asking for right now — tracked live, so the
 * control can say which theme "System" would give, including while another one is pinned.
 */
export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void, ResolvedTheme] {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)

  useEffect(() => {
    applyThemePreference(preference)
  }, [preference])

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY)
    const onChange = () => setSystem(query.matches ? 'dark' : 'light')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return [preference, setPreference, system]
}
