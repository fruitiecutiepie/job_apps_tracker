import { isDemoTrackerProfile } from '../domain/trackerProfile'
import type { FeedbackContext } from './report'

/**
 * What a report says about where it came from. Every field is about the page and the
 * browser; none is about the tracker's contents. The path leaves out the query string,
 * which is where a tracker's id sits.
 */
export function collectContext(view: string): FeedbackContext {
  const hosted = import.meta.env.VITE_TRACKER_BACKEND === 'browser'
  return {
    view,
    build: `${hosted ? 'hosted' : 'local'}${isDemoTrackerProfile() ? ' demo' : ''}`,
    path: window.location.pathname,
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    pixelRatio: window.devicePixelRatio || 1,
  }
}

/** The context as the panel lists it, so the sender sees exactly what goes. */
export function describeContext(context: FeedbackContext): Array<[label: string, value: string]> {
  return [
    ['Page', context.view],
    ['Build', context.build],
    ['Browser', context.userAgent],
    ['Language', context.language],
    ['Window', `${context.viewport} at ${context.pixelRatio}×`],
  ]
}

export function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
}
