import path from 'node:path'

export type TrackerProfile = 'live' | 'demo'

export function resolveTrackerProfile(env: NodeJS.ProcessEnv = process.env): TrackerProfile {
  return env.VITE_TRACKER_PROFILE === 'demo' ? 'demo' : 'live'
}

export function resolveTrackerDataDir(root: string, profile: TrackerProfile): string {
  return profile === 'demo' ? path.join(root, 'data', 'demo') : path.join(root, 'data')
}

export function trackerFilePaths(root: string, profile: TrackerProfile) {
  const dataDir = resolveTrackerDataDir(root, profile)
  return {
    dataDir,
    dbPath: path.join(dataDir, 'tracker.json'),
    tmpPath: path.join(dataDir, 'tracker.json.tmp'),
  }
}
