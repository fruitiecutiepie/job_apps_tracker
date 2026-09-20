import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

import { trackerDbPlugin } from './vite/tracker-db-plugin'

/*
 * The static build talks to browser storage, so the filesystem middleware must not be
 * registered for it: `vite preview` serves that middleware too, and a preview that can
 * still reach `data/tracker.json` would not be the thing GitHub Pages runs.
 */
const staticBuild = process.env.VITE_TRACKER_BACKEND === 'browser'

export default defineConfig({
  // A project page is served from a subpath, so the asset URLs have to carry it.
  base: process.env.VITE_BASE_PATH ?? '/',
  /*
   * The demo is a second build of the same app, written under the first so one Pages
   * artifact carries both. It must not empty `dist`, or it would delete the tracker it
   * was built beside.
   */
  build: process.env.VITE_OUT_DIR
    ? { outDir: process.env.VITE_OUT_DIR, emptyOutDir: false }
    : {},
  plugins: staticBuild ? [react()] : [react(), trackerDbPlugin()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    /*
     * Holds one suite run at a time across every checkout on this machine. See the file
     * for why a wall-clock budget and a shared laptop do not otherwise get along.
     */
    globalSetup: './vite/suite-lock.ts',
    /*
     * Vitest defaults a test to 5s, which is the wrong budget for this suite. The panel
     * autosaves `AUTOSAVE_MS` after the typing stops, so the tests that wait for a write
     * to land give `waitFor` 3-4s on its own — leaving barely a second for the render,
     * the typing and the assertions wrapped around it. Fake timers cannot shorten the
     * wait, for the reason AGENTS.md gives about Testing Library's `waitFor`.
     *
     * The smoke journey outgrew even this and carries its own budget, for the reason
     * given where it sets one.
     */
    testTimeout: 15_000,
    css: true,
    env: {
      VITE_TRACKER_PROFILE: 'demo',
    },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    /*
     * The browser suite runs under `vitest.browser.config.ts`, in a real browser. Its
     * files match the `include` above, so without this they would also be started here
     * and fail on the browser context they expect and jsdom cannot give them.
     */
    exclude: [
      '**/node_modules/**',
      '**/.claude/**',
      '**/dist/**',
      'src/**/*.browser.test.tsx',
    ],
  },
})
