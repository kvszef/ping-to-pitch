import { useEffect, useMemo, useState } from 'react'
import { MONTH_EN, STATIC_EN, staticEn } from './i18n-static'

export type Language = 'de' | 'en'

// How a text gets into English, in this order:
//   1. fixed labels: the hand-written dictionary (i18n-static.ts), seeded below: instant, offline, no flash
//   2. text that is not German (the server and the engine answer in the advisor's language): shown as it is
//   3. German leftovers (sample clients, a source that is not bilingual yet): one /api/translate call per
//      string, cached for the lifetime of the tab. Without a model they stay German.
const cache = new Map<string, string>(Object.entries(STATIC_EN))

// ---- does this text still need translating? ----------------------------------------------------
// Counted on whole words, outside «…» (quotes from the data are never translated): German function and
// app words against English ones, plus lower-case words with an umlaut. Capitalised words with an umlaut
// do not count, they are mostly names in English sentences too (Zürcher Kantonalbank, Münchener Rück).
const GERMAN = new Set(('und oder aber der die das den dem des ein eine einen einem einer eines kein keine keinen keiner nicht nichts '
  + 'für mit ohne über unter vom zum zur von bei beim seit nach vor aus auf durch gegen bis ist sind wird werden wurde wurden hat haben hatte '
  + 'kann soll sollte muss möchte ich sie wir ihr ihre ihren ihrem sich noch nur auch schon bereits mehr weniger sehr als wie wenn dass weil im um zu '
  + 'hier heute jetzt dieser diese dieses diesem diesen liegt liegen fehlt fehlen beträgt gilt offen offene offener offenen neu neue neuer neuen '
  + 'letzte letzter letzten davon dazu dabei damit daher gemäss laut rund statt sowie alle allen wieder gegenüber '
  + 'kunde kunden berater vorschlag vorschläge vorschlägen vermögen gespräch notiz regelverletzung regelverletzungen warnung warnungen fehler anteil '
  + 'klumpenrisiko hausmeinung bandbreite jahresbeginn monat monate monaten wertentwicklung liquidität währung währungen fremdwährung').split(' '))
const ENGLISH = new Set(('the of and is are was were with without for from by at on to not no this that these has have had above below since than its their '
  + 'your you we be been will would should can per as or if it a client advisor proposal month months year share risk note call last open draft '
  + 'band house view bond bonds cash liquidity currency assets rejected accepted').split(' '))

export function looksGerman(text: string): boolean {
  let de = 0, en = 0
  for (const word of text.replace(/«[^»]*»/g, ' ').split(/[^\p{L}]+/u)) {
    if (!word) continue
    const w = word.toLowerCase()
    if (GERMAN.has(w)) de++
    else if (ENGLISH.has(w)) en++
    else if (word[0] === w[0] && /[äöüß]/.test(w)) de++ // written in lower case: not a name
  }
  return de > 0 && de >= en
}

// What is known without asking anyone: the cache, a fixed pattern (i18n-static.ts), or the text itself when it is not German.
function known(text: string): string | undefined {
  if (!text) return text
  const hit = cache.get(text)
  if (hit !== undefined) return hit
  const out = staticEn(text) ?? (looksGerman(text) ? undefined : text)
  if (out !== undefined) cache.set(text, out)
  return out
}

async function translateBatch(texts: string[], language: Language): Promise<string[]> {
  if (language === 'de' || !texts.length) return texts
  const missing = [...new Set(texts.filter((t) => known(t) === undefined))]
  if (missing.length) {
    try {
      const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: missing, language }) })
      const d = await r.json() as { texts?: string[] }
      if (Array.isArray(d.texts) && d.texts.length === missing.length) missing.forEach((t, i) => cache.set(t, d.texts![i] || t))
    } catch { /* offline or unconfigured: fall back to the German original below */ }
  }
  return texts.map((t) => cache.get(t) ?? t)
}

// Texts in the display language. German is returned as it is. In English everything already known (see
// the list on top) is there on the first render, synchronously; only German leftovers are fetched, shown
// as they are meanwhile and swapped when the answer arrives. Never touches the engine or the model's
// grounding: it only re-words text that is already computed and shown.
export function useTranslated(texts: string[], language: Language): string[] {
  const key = `${language}|${texts.join('\u0000')}`
  const [arrived, setArrived] = useState<string | null>(null)
  const waiting = language !== 'de' && texts.some((t) => known(t) === undefined)

  useEffect(() => {
    if (!waiting) return
    let stale = false
    translateBatch(texts, language).then(() => { if (!stale) setArrived(key) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, waiting])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (language === 'de' ? texts : texts.map((t) => known(t) ?? t)), [key, arrived])
}

// Whether these texts are already there in the display language (German always is). Not reactive on
// its own: read it in a component that also calls useTranslated, which re-renders when they arrive.
export const isTranslated = (texts: string[], language: Language) => language === 'de' || texts.every((t) => known(t) !== undefined)

// Single-string convenience wrapper over useTranslated.
export function useTranslatedText(text: string, language: Language): string {
  return useTranslated([text], language)[0]
}

// Chart axis/point labels are "Monat Jahr" (e.g. "Juli 2025"), built by the engine's own German
// month names (engine/format.ts, src/data/facts.ts): a fixed 12-word vocabulary, swapped locally.
export function monthLabel(label: string, language: Language): string {
  if (language === 'de') return label
  const [month, ...rest] = label.split(' ')
  return MONTH_EN[month] ? [MONTH_EN[month], ...rest].join(' ') : label
}
