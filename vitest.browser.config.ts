/**
 * The browser suite: the tests that a real browser is the only thing that can answer.
 *
 * Separate from `vite.config.ts` rather than a Vitest project inside it, for two reasons.
 * `pnpm test` keeps exactly the behaviour it had — the jsdom suite is the backbone here and
 * is not worth disturbing to add a second kind of test beside it. And the plugin list below
 * is short enough to read, which matters because of what is deliberately missing from it.
 *
 * `trackerDbPlugin` is not here. It is what serves `/__db`, and it reads and writes the
 * user's real `data/tracker.json` — a GET alone rewrites the file when the document
 * normalises. The tests mount the panel directly and never fetch, so nothing should ask for
 * that route; leaving the plugin out means a request that escapes anyway gets a 404 rather
 * than a write. The `fetch` stub in the setup file is the third line of the same defence.
 */

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.browser.test.tsx'],
    /*
     * The static build's backend for every file in the suite. It is chosen when
     * `backend/index.ts` first evaluates, and any test file that imports a module reaching
     * it — a view's helpers will do — evaluates it before the test body runs, so a
     * `vi.stubEnv` in the body arrives too late and the app quietly talks to the dev
     * server's `/__db`, which this suite has no handler for on purpose. Set here it is true
     * before anything loads. The browser backend keeps its document in the page's own
     * IndexedDB, so nothing it does reaches the user's `data/tracker.json`.
     *
     * The profile is deliberately not set here. It is read when it is asked for rather than
     * when a module loads, so `mountDemoApp` stubs it for the one file that wants the
     * demo's examples; set suite-wide it would seed nineteen applications into a test that
     * is checking a first visit opens empty.
     */
    env: {
      VITE_TRACKER_BACKEND: 'browser',
    },
    setupFiles: './src/test/setup.browser.ts',
    /*
     * Preflight first, then the lock. The order is the point: the preflight says what the
     * machine is doing before anything has been waited for, so a browser that turns out to
     * be slow to start is readable rather than a mystery. Then the same machine-wide lock
     * the jsdom suite takes, for the reason AGENTS.md gives — this repo is a dozen
     * worktrees on one laptop, and three browsers are heavier company than another jsdom
     * run, not lighter.
     */
    globalSetup: ['./vite/machine-preflight.ts', './vite/suite-lock.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      /*
       * Wider than the 760px breakpoint where the panel stops laying panes side by side.
       * The default browser viewport is phone-sized, which would put every test on the
       * stacked side of that query and quietly test the wrong layout. The test that wants
       * the narrow one asks for it with `page.viewport`.
       */
      viewport: { width: 1280, height: 800 },
      /*
       * All three, because layout is the subject and the three engines are where layout
       * differs. Touch is covered inside the tests rather than by a fourth instance:
       * per-instance context options are not expressible here, and Playwright's Firefox
       * does not support touch emulation at all, so asking for it provider-wide would cost
       * a whole engine to gain what a dispatched `pointerType: 'touch'` already gives.
       */
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
      /*
       * Three minutes to hand the session over, against a default of one. This is the
       * machine rather than the code, and it was measured rather than guessed: launching
       * each browser and rendering a bare `<h1>` took 37s in Chromium, 24s in WebKit and
       * 106s in Firefox on this laptop under load. A budget under that reports a browser
       * that was merely slow to start as a browser that could not be reached.
       */
      connectTimeout: 180_000,
      /*
       * Screenshot baselines are committed, so a layout change shows up as a failing test
       * with a diff rather than going unnoticed — the way the website locks in its designs.
       * Kept per browser and platform, since each draws text its own way: Chromium and WebKit
       * on macOS, Firefox on Linux (see scripts/test-browser). A real change moves far more
       * than 0.1% of a picture; antialiasing between runs does not. Update them on purpose
       * with `pnpm test:browser -u`, then look at the new images before committing them.
       */
      expect: {
        toMatchScreenshot: {
          comparatorName: 'pixelmatch',
          comparatorOptions: { allowedMismatchedPixelRatio: 0.001 },
          resolveScreenshotPath: ({ root, testFileName, arg, browserName, platform, ext }) =>
            `${root}/src/test/screenshots/${testFileName}/${arg}-${browserName}-${platform}${ext}`,
        },
      },
    },
    // One file at a time. A browser costs more than a jsdom environment to stand up, and
    // wall clock on this machine is a property of the machine rather than of the code.
    fileParallelism: false,
    /*
     * Four times the jsdom suite's budget, and for a different reason than that one has.
     * The first test in a browser pays for the first paint of the panel as well as its own
     * work, and three browsers doing that at once on a loaded laptop measured 39s where
     * the same test alone measured 3s. The budget has to cover the slow case or it reports
     * a browser starting up as a test that failed.
     */
    testTimeout: 120_000,
  },
})
