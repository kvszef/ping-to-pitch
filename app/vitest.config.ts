import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so tests run without the API plugin and without any keys.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'engine/**/*.test.ts', 'server/**/*.test.ts'],
    // Tests lesen die Case-Dateien, nicht die Datenbank: sonst hinge jeder Lauf an einer laufenden
    // MCP Toolbox, und jeder der Worker zöge die 11 MB der Nachschlagedaten noch einmal über HTTP.
    // Das Zusammensetzen der Kundensätze prüft server/database.test.ts ohne Netz.
    env: { DATA_SOURCE: 'dateien' },
  },
})
