import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import { api } from './server/api.ts'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), api(loadEnv(mode, process.cwd(), ''))],
  // The client's phone reaches the dev server through a cloudflared tunnel (HTTPS is needed for the mic).
  // Stage mode (`npm run stage`): no hot reload and no file watching, so a saved file never reloads
  // the pages or restarts the server in the middle of a call. Restart it to pick up new code.
  server: { allowedHosts: ['.trycloudflare.com'], ...(mode === 'stage' ? { hmr: false, ws: false, watch: null } : {}) },
  // call.html is the client's phone page for the internet call.
  build: { rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), call: resolve(import.meta.dirname, 'call.html') } } },
}))
