/**
 * The one suite that takes real screenshots, apart from the browser suite because it needs
 * Chromium launched with flags no other test should run under: a fake capture device, and
 * the share-this-tab prompt accepted without a person to press it. Headless Chromium cannot
 * capture a real tab, so without the fake device `getDisplayMedia` refuses outright.
 *
 * Like the browser suite it never reaches a server: it mounts the feedback widget alone.
 */
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.capture.test.tsx'],
    globalSetup: ['./vite/machine-preflight.ts', './vite/suite-lock.ts'],
    setupFiles: './src/test/setup.browser.ts',
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-accept-this-tab-capture'],
        },
      }),
      viewport: { width: 1280, height: 800 },
      instances: [{ browser: 'chromium' }],
    },
    testTimeout: 60_000,
  },
})
