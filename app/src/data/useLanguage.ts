import { useEffect, useState } from 'react'
import type { Language } from './useTranslate'

const KEY = 'uro.berater.einstellungen'

function readLanguage(): Language {
  try {
    if (typeof window === 'undefined') return 'de'
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { language?: unknown }
    return parsed.language === 'en' ? 'en' : 'de'
  } catch {
    return 'de'
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
