import { defineConfig, devices } from '@playwright/test'

const configuredBaseUrl = process.env.PRODUCTION_E2E_BASE_URL?.trim()

if (!configuredBaseUrl) {
  throw new Error('PRODUCTION_E2E_BASE_URL is required for the read-only production audit.')
}

const baseURL = configuredBaseUrl.endsWith('/') ? configuredBaseUrl : `${configuredBaseUrl}/`
const productionUrl = new URL(baseURL)

if (
  productionUrl.protocol !== 'https:' ||
  ['localhost', '127.0.0.1', '::1'].includes(productionUrl.hostname)
) {
  throw new Error('PRODUCTION_E2E_BASE_URL must be an HTTPS production URL.')
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'production-rankings.spec.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'production-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
})
