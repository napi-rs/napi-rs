import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vite'

// Unlike examples/napi, this config deliberately sets NO COOP/COEP headers:
// the single-thread wasm32-wasip1 build must work without cross-origin isolation.
export default defineConfig({
  test: {
    include: ['browser/**/*.spec.js'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
