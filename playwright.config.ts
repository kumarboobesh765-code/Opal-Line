import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4198'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // One worker: the backend rate-limits /auth/login (20 requests / 15 min / IP),
  // so the suite must not parallelise authentication traffic.
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    storageState: 'e2e/.auth/state.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
