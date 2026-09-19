import { useSyncExternalStore } from 'react'
import type { Settings } from './types'

const KEY = 'uro.berater.einstellungen'

export const defaults: Settings = { provider: 'openai', language: 'en', record: true, detail: 'kurz', autoModules: true, confidence: 70, chatOpen: false, clientsOpen: true, graphsOpen: true }

// English is the default; German only when chosen. English became the default on 19.09.2026. A 'de'
// saved before that was never a choice (the settings used to be written whole on first use), so it is
// flipped once; after that the toggle decides.
export function migrateLanguage() {
  try {
    if (typeof window === 'undefined' || localStorage.getItem(`${KEY}.english-default`)) return
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>
    localStorage.setItem(KEY, JSON.stringify({ ...stored, language: 'en' }))
    localStorage.setItem(`${KEY}.english-default`, '1')
  } catch { /* storage not available */ }
}

function load(): Settings {
  migrateLanguage()
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return defaults
  }
}

// One store for the whole tab: the language switch in the top bar, the settings panel and every hook
// that asks the server in the advisor's language see the same value at the same moment. (Each
// useSettings() used to hold its own copy, so a switch in the top bar never reached the workspace.)
let current: Settings | null = null
const listeners = new Set<() => void>()
const tellDocument = (s: Settings) => { if (typeof document !== 'undefined') document.documentElement.lang = s.language === 'de' ? 'de-CH' : 'en-GB' }

export function getSettings(): Settings {
  if (!current) { current = load(); tellDocument(current) }
  return current
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...getSettings(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* Speicher nicht verfügbar */ }
  tellDocument(current)
  listeners.forEach((tell) => tell())
}

// Another tab changed the settings: read them again.
const onStorage = (e: StorageEvent) => { if (e.key === KEY) { current = load(); tellDocument(current); listeners.forEach((tell) => tell()) } }

export function subscribeSettings(tell: () => void) {
  if (!listeners.size && typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  listeners.add(tell)
  return () => { listeners.delete(tell); if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', onStorage) }
}

export function useSettings() {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, getSettings)
  return [settings, updateSettings] as const
}
