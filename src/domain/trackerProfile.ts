export type TrackerProfile = 'live' | 'demo'

export function trackerProfile(): TrackerProfile {
  return import.meta.env.VITE_TRACKER_PROFILE === 'demo' ? 'demo' : 'live'
}

export function isDemoTrackerProfile(): boolean {
  return trackerProfile() === 'demo'
}

export function trackerDatabasePath(profile: TrackerProfile = trackerProfile()): string {
  return profile === 'demo' ? 'data/demo/tracker.json' : 'data/tracker.json'
}
