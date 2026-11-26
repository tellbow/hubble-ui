import { defineConfig, devices } from '@playwright/test';

// The backend runs in its e2e mode: no cluster, flows and namespaces come from
// e2e/fixtures, picked by the ?e2e=preset=… a test opens the page with.
export default defineConfig({
  testDir: './e2e/specs',
  // Every page load resets the backend's fake cluster: one test at a time.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:12000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'go run -mod=vendor .',
      cwd: 'backend',
      port: 8090,
      env: {
        E2E_TEST_MODE: 'true',
        E2E_LOGFILES_BASEPATH: `${__dirname}/e2e/fixtures`,
        EVENTS_SERVER_PORT: '8090',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
    {
      command: 'npm run build:webpack && node e2e/serve.mjs',
      url: 'http://127.0.0.1:12000',
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
