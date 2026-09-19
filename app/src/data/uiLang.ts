import type { Lang } from '../../engine/lang.ts'

// The language UI-side text is composed in when the caller names none: the advisor's setting in the
// browser, German everywhere else (tests, the server importing fromRaw/facts), like the engine's own
// default. No React and no imports with side effects here: fromRaw.ts and facts.ts are also loaded by
// the server. Same storage key as workspace/settings.ts.
const KEY = 'uro.berater.einstellungen'

export function uiLang(): Lang {
  // Through globalThis: this file is also type-checked for the server, which has no DOM types.
  const g = globalThis as { document?: unknown; localStorage?: { getItem(key: string): string | null } }
  if (!g.document || !g.localStorage) return 'de'
  try {
    return (JSON.parse(g.localStorage.getItem(KEY) ?? '{}') as { language?: unknown }).language === 'de' ? 'de' : 'en'
  } catch {
    return 'en'
  }
}

/** `lang=de|en` for a GET request, with the right separator for the path it is appended to. */
export const withLang = (path: string, lang: Lang): string => `${path}${path.includes('?') ? '&' : '?'}lang=${lang}`
