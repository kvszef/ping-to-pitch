import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so tests run without the API plugin and without any keys.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'engine/**/*.test.ts', 'server/**/*.test.ts'],
  },
})
