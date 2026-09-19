import { useEffect, useState } from 'react'

export type Language = 'de' | 'en'

// Condenses the profile tile's text (persona, call reasons, raw notes) into a couple of fluent
// sentences via the model, in the advisor's chosen language. Offline/error fallback: the plain
// facts, joined, so the tile never goes blank when the model is unreachable.
export function useSummary(persona: string | undefined, reasons: string[], notes: { text: string; date: string }[], language: Language) {
  const fallback = [persona, reasons.join(' · '), ...notes.map((n) => n.text)].filter(Boolean).join(' ')
  const [text, setText] = useState(fallback)
  const [loading, setLoading] = useState(false)
  const key = `${persona ?? ''}|${reasons.join('·')}|${notes.map((n) => n.text).join('·')}|${language}`

  useEffect(() => {
    if (!persona && !reasons.length && !notes.length) { setText(''); setLoading(false); return }
    let stale = false
    setText(fallback)
    setLoading(true)
    fetch('/api/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona, reasons, notes, language }) })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((d: { text?: string }) => { if (!stale && typeof d.text === 'string' && d.text) setText(d.text) })
      .catch(() => { /* keep the fallback */ })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { text, loading }
}
