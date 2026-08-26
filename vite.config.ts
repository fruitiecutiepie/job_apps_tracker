import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

import { trackerDbPlugin } from './vite/tracker-db-plugin'

export default defineConfig({
  plugins: [react(), trackerDbPlugin()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    /*
     * Vitest defaults a test to 5s, which is the wrong budget for this suite. The panel
     * autosaves `AUTOSAVE_MS` after the typing stops, so the tests that wait for a write
     * to land give `waitFor` 3-4s on its own — leaving barely a second for the render,
     * the typing and the assertions wrapped around it. The smoke journey needs 2.3s of
     * that even on an idle machine, so it was failing perhaps one run in five: not
     * because anything was wrong, but because the inner wait and the outer limit were
     * set against each other. Fake timers cannot shorten the wait, for the reason
     * AGENTS.md gives about Testing Library's `waitFor`.
     */
    testTimeout: 15_000,
    css: true,
    env: {
      VITE_TRACKER_PROFILE: 'demo',
    },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.claude/**', '**/dist/**'],
  },
})
