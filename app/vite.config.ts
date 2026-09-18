import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import { api } from './server/api.ts'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), api(loadEnv(mode, process.cwd(), ''))],
}))
