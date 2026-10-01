import { useCallback, useState } from 'react'

import { IDLE_THRESHOLD_DAYS } from './views/idle'

/**
 * The three numbers Statistics answers its questions with, which a reader may disagree
 * with: when a quiet application counts as ghosted, and how many applications a stage or a
 * source needs before it is compared with the others.
 *
 * Per-machine interface state, like the theme, and kept in `localStorage` for the same
 * reason: it is how you like the answers worked out, not part of the record, and the
 * tracker document's shape is closed — an extra top-level key would be discarded on load.
 * It is never exported with the data.
 */
export interface StatsSettings {
  /**
   * Days without a stage change before a live application counts as quiet. This is also
   * the Idle threshold on the board and the table: two measures of the same silence would
   * let a card read Idle while Statistics said nobody had gone quiet.
   */
  quietDays: number
  /** Decided applications a stage needs before it can be named as where you lose most. */
  minStageDecided: number
  /** Applications a source needs before it is compared with the others. */
  minSourceApplications: number
}

export type StatsSettingId = keyof StatsSettings

export const DEFAULT_STATS_SETTINGS: Readonly<StatsSettings> = Object.freeze({
  quietDays: IDLE_THRESHOLD_DAYS,
  minStageDecided: 5,
  minSourceApplications: 3,
})

/**
 * Inclusive bounds. A floor of one, since zero days quiet would mark every live application
 * and a minimum of zero would compare a source holding nothing. The ceilings are well past
 * any sensible answer and exist so a stray keystroke cannot store an absurd one.
 */
export const STATS_SETTING_LIMITS: Readonly<Record<StatsSettingId, { min: number; max: number }>> =
  Object.freeze({
    quietDays: { min: 1, max: 365 },
    minStageDecided: { min: 1, max: 100 },
    minSourceApplications: { min: 1, max: 100 },
  })

export const STATS_SETTINGS_KEY = 'job-applications-tracker:stats-settings'

function validSetting(id: StatsSettingId, value: unknown): value is number {
  const { min, max } = STATS_SETTING_LIMITS[id]
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/**
 * Reconciled field by field rather than trusted: a value that is missing, malformed or out
 * of range falls back to its default and leaves the others alone, so one bad entry cannot
 * cost the reader the two settings that were fine.
 */
export function parseStatsSettings(raw: string | null): StatsSettings {
  let stored: Record<string, unknown> = {}
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (parsed && typeof parsed === 'object') stored = parsed as Record<string, unknown>
  } catch {
    // Unreadable is the same as absent.
  }

  const settings = { ...DEFAULT_STATS_SETTINGS }
  for (const id of Object.keys(DEFAULT_STATS_SETTINGS) as StatsSettingId[]) {
    if (validSetting(id, stored[id])) settings[id] = stored[id]
  }
  return settings
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function loadStatsSettings(): StatsSettings {
  try {
    return parseStatsSettings(storage()?.getItem(STATS_SETTINGS_KEY) ?? null)
  } catch {
    return { ...DEFAULT_STATS_SETTINGS }
  }
}

/** Only what differs from the defaults is stored, so a changed default reaches everyone who never touched it. */
export function saveStatsSettings(settings: StatsSettings): void {
  const changed = Object.fromEntries(
    (Object.keys(DEFAULT_STATS_SETTINGS) as StatsSettingId[])
      .filter((id) => settings[id] !== DEFAULT_STATS_SETTINGS[id])
      .map((id) => [id, settings[id]]),
  )
  try {
    const store = storage()
    if (!store) return
    if (Object.keys(changed).length === 0) store.removeItem(STATS_SETTINGS_KEY)
    else store.setItem(STATS_SETTINGS_KEY, JSON.stringify(changed))
  } catch {
    // A blocked store keeps the setting for this session only, which is still a working page.
  }
}

export function useStatsSettings(): [StatsSettings, (id: StatsSettingId, value: number) => void] {
  const [settings, setSettings] = useState<StatsSettings>(loadStatsSettings)

  const change = useCallback((id: StatsSettingId, value: number) => {
    if (!validSetting(id, value)) return
    setSettings((current) => {
      if (current[id] === value) return current
      const next = { ...current, [id]: value }
      saveStatsSettings(next)
      return next
    })
  }, [])

  return [settings, change]
}
