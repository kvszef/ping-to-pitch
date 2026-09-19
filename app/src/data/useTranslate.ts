import { useEffect, useState } from 'react'

export type Language = 'de' | 'en'

// In-memory cache, shared across every call site and the lifetime of the tab: the same German
// string translates to the same English one everywhere, so we only ever ask the model once per string.
const cache = new Map<string, string>()

async function translateBatch(texts: string[], language: Language): Promise<string[]> {
  if (language === 'de' || !texts.length) return texts
  const missing = [...new Set(texts.filter((t) => t && !cache.has(t)))]
  if (missing.length) {
    try {
      const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: missing, language }) })
      const d = await r.json() as { texts?: string[] }
      if (Array.isArray(d.texts) && d.texts.length === missing.length) missing.forEach((t, i) => cache.set(t, d.texts![i] || t))
    } catch { /* offline or unconfigured: fall back to the German original below */ }
  }
  return texts.map((t) => cache.get(t) ?? t)
}

// Translates a batch of German UI strings for display, all in one request. German stays instant (no
// call, no flicker); English shows the originals first, then swaps in translations as they arrive.
// Never touches the engine or the model's grounding: it translates already-computed, already-shown text.
export function useTranslated(texts: string[], language: Language): string[] {
  const key = `${language}|${texts.join('\u0000')}`
  const [state, setState] = useState<{ key: string; texts: string[] }>({ key, texts })

  useEffect(() => {
    if (language === 'de') { setState({ key, texts }); return }
    let stale = false
    translateBatch(texts, language).then((t) => { if (!stale) setState({ key, texts: t }) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state.key === key ? state.texts : texts
}

// Single-string convenience wrapper over useTranslated.
export function useTranslatedText(text: string, language: Language): string {
  return useTranslated([text], language)[0]
}

// Chart axis/point labels are "Monat Jahr" (e.g. "Juli 2025"), built by the engine's own German
// month names (engine/format.ts, src/data/facts.ts). Translating these through the model would be
// slow and pointless — it's a fixed 12-word vocabulary — so this swaps them locally and instantly.
const MONTH_EN: Record<string, string> = {
  Januar: 'January', 'Jan.': 'Jan', Februar: 'February', 'Feb.': 'Feb', März: 'March', April: 'April', 'Apr.': 'Apr',
  Mai: 'May', Juni: 'June', Juli: 'July', August: 'August', 'Aug.': 'Aug', September: 'September', 'Sept.': 'Sep',
  Oktober: 'October', 'Okt.': 'Oct', November: 'November', Dezember: 'December', 'Dez.': 'Dec',
}
export function monthLabel(label: string, language: Language): string {
  if (language === 'de') return label
  const [month, ...rest] = label.split(' ')
  return MONTH_EN[month] ? [MONTH_EN[month], ...rest].join(' ') : label
}
