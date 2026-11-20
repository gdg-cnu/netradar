import { defineConfig } from '@playwright/test'

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const python = process.env.NETRADAR_TEST_PYTHON ?? 'python3'

export default defineConfig({
  testDir: './tests/server-v2',
  outputDir: './.cache/test-results-server-v2',
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5177',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  projects: [
    { name: 'server-desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'server-mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: [
    {
      command: `${quote(python)} tests/server-v2/backend_server.py`,
      url: 'http://127.0.0.1:8177/health',
      reuseExistingServer: false,
    },
    {
      command:
        'node node_modules/vite/bin/vite.js build --mode test --outDir .cache/e2e-server-v2 && node node_modules/vite/bin/vite.js preview --outDir .cache/e2e-server-v2 --host 127.0.0.1 --port 5177 --strictPort',
      url: 'http://127.0.0.1:5177',
      reuseExistingServer: false,
      env: {
        VITE_API_MODE: 'demo',
        VITE_DEMO_VERSION: 'v2',
        VITE_V2_DATA_SOURCE: 'api',
        VITE_API_BASE_URL: 'http://127.0.0.1:5177/api/v1',
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_ANON_KEY: '',
      },
    },
  ],
})
