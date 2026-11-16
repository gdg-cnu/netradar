import { defineConfig } from '@playwright/test'

// Exercise the real HTTP/auth client branch with isolated, intercepted test services.
// This suite does not authenticate against Kakao or write to a real Supabase project.
export default defineConfig({
  testDir: './tests/live',
  outputDir: './.cache/test-results-live',
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5175',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  projects: [
    { name: 'live-desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'live-mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js build --mode test --outDir .cache/e2e-live && node node_modules/vite/bin/vite.js preview --outDir .cache/e2e-live --host 127.0.0.1 --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
    env: {
      VITE_API_MODE: 'live',
      VITE_API_BASE_URL: 'http://127.0.0.1:5175/api/v1',
      VITE_SUPABASE_URL: 'https://netradar-test.invalid',
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_frontend_test_only',
      VITE_TERMS_URL: 'https://netradar-test.invalid/terms',
      VITE_PRIVACY_URL: 'https://netradar-test.invalid/privacy',
      VITE_PLACE_SEARCH_SOURCE: 'sample',
      VITE_ROUTE_ESTIMATE_SOURCE: 'sample',
    },
  },
})
