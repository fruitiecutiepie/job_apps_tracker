import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_STATS_SETTINGS,
  STATS_SETTINGS_KEY,
  loadStatsSettings,
  parseStatsSettings,
  saveStatsSettings,
} from './statsSettings'
import { IDLE_THRESHOLD_DAYS } from './views/idle'

afterEach(() => {
  localStorage.removeItem(STATS_SETTINGS_KEY)
})

describe('statistics settings', () => {
  it('defaults the quiet threshold to the Idle one, so the two cannot start apart', () => {
    expect(DEFAULT_STATS_SETTINGS).toEqual({
      quietDays: IDLE_THRESHOLD_DAYS,
      minStageDecided: 5,
      minSourceApplications: 3,
    })
  })

  it('reads nothing stored, or nothing readable, as the defaults', () => {
    expect(parseStatsSettings(null)).toEqual(DEFAULT_STATS_SETTINGS)
    expect(parseStatsSettings('not json')).toEqual(DEFAULT_STATS_SETTINGS)
    expect(parseStatsSettings('[1, 2]')).toEqual(DEFAULT_STATS_SETTINGS)
  })

  it('keeps the good fields of a stored value and drops only the bad ones', () => {
    const stored = JSON.stringify({ quietDays: 14, minStageDecided: 0, minSourceApplications: 2.5 })
    expect(parseStatsSettings(stored)).toEqual({
      quietDays: 14,
      minStageDecided: DEFAULT_STATS_SETTINGS.minStageDecided,
      minSourceApplications: DEFAULT_STATS_SETTINGS.minSourceApplications,
    })
  })

  it('stores only what differs from the defaults, and nothing once it all matches', () => {
    saveStatsSettings({ ...DEFAULT_STATS_SETTINGS, quietDays: 21 })
    expect(JSON.parse(localStorage.getItem(STATS_SETTINGS_KEY)!)).toEqual({ quietDays: 21 })
    expect(loadStatsSettings()).toEqual({ ...DEFAULT_STATS_SETTINGS, quietDays: 21 })

    saveStatsSettings({ ...DEFAULT_STATS_SETTINGS })
    expect(localStorage.getItem(STATS_SETTINGS_KEY)).toBeNull()
  })
})
