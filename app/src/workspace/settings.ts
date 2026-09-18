import { useEffect, useState } from 'react'
import type { Settings } from './types'

const KEY = 'uro.berater.einstellungen'

export const defaults: Settings = { provider: 'openai', focus: 50, record: true, detail: 'standard', autoModules: true, confidence: 70 }

function load(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return defaults
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load)
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { /* Speicher nicht verfügbar */ }
  }, [settings])
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }))
  return [settings, update] as const
}
