import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import { api } from './server/api.ts'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), api(loadEnv(mode, process.cwd(), ''))],
  // The client's phone reaches the dev server through a cloudflared tunnel (HTTPS is needed for the mic).
  server: { allowedHosts: ['.trycloudflare.com'] },
  // call.html is the client's phone page for the internet call.
  build: { rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), call: resolve(import.meta.dirname, 'call.html') } } },
}))
