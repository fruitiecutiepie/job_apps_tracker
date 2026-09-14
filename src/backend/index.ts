import { browserBackend } from './browserBackend'
import { serverBackend } from './serverBackend'
import type { TrackerBackend } from './types'

/**
 * Which backend this build talks to, decided at build time rather than sniffed at runtime.
 * The dev server is the default so that local development, and every existing test,
 * behaves exactly as it did before the second backend existed. The static Pages build
 * opts in with `VITE_TRACKER_BACKEND=browser`.
 */
export const backend: TrackerBackend =
  import.meta.env.VITE_TRACKER_BACKEND === 'browser' ? browserBackend() : serverBackend()

export function isBrowserBackend(): boolean {
  return import.meta.env.VITE_TRACKER_BACKEND === 'browser'
}

export * from './types'
export { browserBackend } from './browserBackend'
export { serverBackend } from './serverBackend'
