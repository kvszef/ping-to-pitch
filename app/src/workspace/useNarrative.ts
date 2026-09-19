import { useEffect, useState } from 'react'
import type { Language } from '../data/useTranslate'
import { digestText, plainNarrative, type Digest } from './digest'
import { grounded } from './grounding'

// The overview as one running text in the tone that fits the client (server/ai/narrative.ts). The model
// only phrases: its text is shown only if every number in it stands in the overview. Otherwise, and
// without a model or network, the plain points are shown as sentences (plainNarrative).
// The client's name is not sent.

const WAIT_MS = 400 // the brief still grows while it loads: ask once it has settled
const cache = new Map<string, string>()

export function useNarrative(d: Digest, language: Language, t: (german: string) => string) {
  const bullets = d.sections.flatMap((s) => s.bullets)
  const fallback = plainNarrative(d, t)
  const key = `${d.ref}|${language}|${d.tone.register ?? ''}|${bullets.map((b) => `${b.id}:${b.figure ?? ''}:${b.text}`).join('|')}`
  const [state, setState] = useState<{ key: string; text: string } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!bullets.length || cache.has(key)) { setLoading(false); return }
    let stale = false
    setLoading(true)
    const timer = setTimeout(() => {
      const body = {
        register: d.tone.register, hints: d.tone.hints, facts: d.facts.map(([l, v]) => [t(l), v]), language,
        sections: d.sections.map((s) => ({ group: t(s.group), points: s.bullets.map((b) => ({ figure: b.figure, text: t(b.text), source: t(b.source) })) })),
      }
      fetch('/api/narrative', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
        .then((out: { text?: unknown }) => {
          const text = typeof out.text === 'string' ? out.text.trim().replace(/ß/g, 'ss') : ''
          if (!grounded(text, digestText(d, t))) return
          cache.set(key, text)
          if (!stale) setState({ key, text })
        })
        .catch(() => { /* keep the plain points */ })
        .finally(() => { if (!stale) setLoading(false) })
    }, WAIT_MS)
    return () => { stale = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const written = cache.get(key) ?? (state?.key === key ? state.text : undefined)
  return { text: written ?? fallback, byModel: written !== undefined, loading: loading && written === undefined }
}
