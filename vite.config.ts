import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

import { trackerDbPlugin } from './vite/tracker-db-plugin'

export default defineConfig({
  plugins: [react(), trackerDbPlugin()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    env: {
      VITE_TRACKER_PROFILE: 'demo',
    },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.claude/**', '**/dist/**'],
  },
})
