import { useSyncExternalStore } from 'react'
import { getSettings, migrateLanguage, subscribeSettings } from '../workspace/settings'
import type { Language } from './useTranslate'

export { migrateLanguage }

const read = (): Language => (getSettings().language === 'de' ? 'de' : 'en')

// The advisor's language for components and hooks outside the call workspace (App, Dashboard, cards,
// the data hooks that ask the server in that language). Reads the one settings store
// (workspace/settings.ts), so a switch in the top bar or in the settings panel arrives at once.
export function useLanguage(): Language {
  return useSyncExternalStore(subscribeSettings, read, read)
}
