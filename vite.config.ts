import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/USTSACMLand/' : '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
    css: true,
    globals: true,
  },
}))
