import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig(({ mode }) => ({
  base: '/',
  plugins: [react()],
  ...(mode === 'e2e'
    ? {
        server: {
          proxy: {
            '/functions/v1/webchat-attachment': {
              target: 'http://127.0.0.1:4176',
              changeOrigin: false,
            },
          },
        },
      }
    : {}),
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
    css: true,
    globals: true,
    // Lazy route imports become timing-dependent when high-core development
    // machines start every jsdom suite at once. Keep the release gate bounded
    // and reproducible across local workstations and GitHub runners.
    maxWorkers: 4,
    // Interaction-heavy pagination and form suites legitimately cross the
    // five-second Vitest default under runner contention.
    testTimeout: 10_000,
  },
}))
