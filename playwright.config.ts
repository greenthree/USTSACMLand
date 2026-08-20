import { defineConfig, devices } from '@playwright/test'

export function resolveE2EPort(
  rawPort: string | undefined = process.env.E2E_PORT || process.env.PLAYWRIGHT_PORT,
): number {
  if (!rawPort || rawPort.trim() === '') {
    return 4273
  }
  const trimmed = rawPort.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid E2E port "${rawPort}": must be a decimal integer between 1 and 65535.`)
  }
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid E2E port "${rawPort}": must be between 1 and 65535.`)
  }
  return parsed
}

const port = resolveE2EPort()
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/production-rankings.spec.ts', '**/chat.spec.ts'],
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: {
    command: `npm run dev -- --mode e2e --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'wide-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
})
