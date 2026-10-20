/**
 * Selects the static build's backend for a test file that mounts the whole app.
 *
 * The backend is chosen when `backend/index.ts` first evaluates, and any module reaching it —
 * a view's helpers will do — evaluates it the moment it is imported. So this has to run
 * before them: import `./test/appHarness` (which imports this first) ahead of anything else
 * in a file that mounts the app. A stub in a test body, or in `mountDemoApp`, arrives too
 * late and the app quietly talks to the dev server's `/__db`, which this suite has no handler
 * for on purpose.
 *
 * It is not set in `vitest.browser.config.ts` because that would apply to every file: the
 * Prep panel's tests render differently on the static backend (no external editor, so no
 * "Open in Editor"), and their committed screenshots are of the dev server's.
 */

import { vi } from 'vitest'

vi.stubEnv('VITE_TRACKER_BACKEND', 'browser')
