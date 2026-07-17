import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4175'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/chat.spec.ts',
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4175 --strictPort',
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_WEBCHAT_UI_ENABLED: 'true',
        VITE_WEBCHAT_API_URL: 'http://127.0.0.1:4176/api/chat',
      },
    },
    {
      command: 'node e2e/mock-webchat-server.mjs',
      url: 'http://127.0.0.1:4176/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
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
