import { useEffect, useState } from 'react'
import type { Language } from './useTranslate'

const KEY = 'uro.berater.einstellungen'

// English is the default (same as `defaults.language` in workspace/settings.ts); German only when chosen.
// English became the default on 19.09.2026. A 'de' saved before that was never a choice (the settings
// are written whole on first use), so it is flipped once; after that the toggle decides.
export function migrateLanguage() {
  try {
    if (typeof window === 'undefined' || localStorage.getItem(`${KEY}.english-default`)) return
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>
    localStorage.setItem(KEY, JSON.stringify({ ...stored, language: 'en' }))
    localStorage.setItem(`${KEY}.english-default`, '1')
  } catch { /* storage not available */ }
}

function readLanguage(): Language {
  migrateLanguage()
  try {
    if (typeof window === 'undefined') return 'en'
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { language?: unknown }
    return parsed.language === 'de' ? 'de' : 'en'
  } catch {
    return 'en'
  }
}

// Lightweight standalone read of the same settings key the call-workspace's useSettings hook
// writes to, for components outside that tree (App/Dashboard/Chrome) that need the language
// preference but not the rest of Settings. Polls rather than listening for the `storage` event,
// because that event only fires in OTHER tabs, never in the tab that made the change.
export function useLanguage(): Language {
  const [language, setLanguage] = useState<Language>(readLanguage)
  useEffect(() => {
    const id = setInterval(() => {
      setLanguage((prev) => { const next = readLanguage(); return next === prev ? prev : next })
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return language
}
