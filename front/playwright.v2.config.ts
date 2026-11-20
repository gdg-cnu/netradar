import { defineConfig } from '@playwright/test'

// Explicitly isolated frontend v2 preview. It does not exercise production APIs.
export default defineConfig({
  testDir: './tests/v2',
  outputDir: './.cache/test-results-v2',
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5176',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // 서비스 워커가 page.route 응답 가로채기를 우회하지 않도록 기본 차단합니다(PWA 테스트만 허용).
    serviceWorkers: 'block',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  projects: [
    { name: 'v2-desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'v2-mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'v2-small-mobile',
      use: { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true },
    },
    { name: 'v2-landscape', use: { viewport: { width: 844, height: 390 } } },
  ],
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js build --mode test --outDir .cache/e2e-v2 && node node_modules/vite/bin/vite.js preview --outDir .cache/e2e-v2 --host 127.0.0.1 --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: false,
    env: {
      VITE_API_MODE: 'demo',
      VITE_DEMO_VERSION: 'v2',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
})
