import { useEffect, useState } from 'react'
import type { NewsAgentItem, NewsAgentResult } from '../../server/ai/news-agent-types'
import { useLanguage } from './useLanguage'
import type { Language } from './useTranslate'
import { withLang } from './uiLang'

export type { NewsAgentItem }

const NO_ITEMS: NewsAgentItem[] = []
const NO_IDS: Set<string> = new Set()

type State = { ref: string | null; language?: Language; items: NewsAgentItem[]; fetchedAt: string | null; fresh: Set<string> }

// What makes two refreshes "the same" for consumers: ids in order plus the model's annotations.
const signature = (items: NewsAgentItem[]) => items.map((i) => `${i.id}|${i.tone ?? ''}|${i.why ?? ''}`).join('\n')

// Two sources, one list: the news agent (Yahoo Finance, Bing) and the engine's matched news (N1,
// /api/news/:ref). Same headline twice is kept once; newest first.
const key = (title: string) => title.toLowerCase().replace(/[^a-z0-9äöü]+/g, ' ').trim().slice(0, 48)
async function loadNews(ref: string, language: Language, signal: AbortSignal): Promise<NewsAgentResult> {
  const get = async (url: string) => {
    try { const r = await fetch(url, { signal }); return r.ok ? (await r.json()) as Partial<NewsAgentResult> : {} } catch { return {} }
  }
  const [agent, engine] = await Promise.all([get(withLang(`/api/news-agent?ref=${encodeURIComponent(ref)}`, language)), get(withLang(`/api/news/${encodeURIComponent(ref)}`, language))])
  const seen = new Set<string>()
  const items = [...(engine.items ?? []), ...(agent.items ?? [])].filter((i) => i?.affects?.[ref] && !seen.has(key(i.title)) && seen.add(key(i.title)))
    .sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''))
  if (!items.length && !agent.items && !engine.items) throw new Error('news: no source answered')
  return { items, fetchedAt: agent.fetchedAt ?? engine.fetchedAt ?? new Date().toISOString() }
}

/**
 * Live news for one client's holdings, polled every `intervalMs` while mounted.
 * `items` keeps its reference while nothing changed, so consumers can memoise on it.
 * `fresh` holds the ids that arrived with the latest refresh (on the first load: all of them),
 * and is empty again after the next refresh that brings nothing new.
 * What a story means for the client is written in the advisor's language: another language loads afresh.
 */
export function useNews(ref: string | null, intervalMs = 60_000, lang?: Language) {
  const [state, setState] = useState<State>({ ref: null, items: NO_ITEMS, fetchedAt: null, fresh: NO_IDS })
  const own = useLanguage()
  const language = lang ?? own

  useEffect(() => {
    if (!ref) return
    let stopped = false
    let ctrl: AbortController | null = null
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return
      ctrl?.abort()
      ctrl = new AbortController()
      try {
        const res = await loadNews(ref, language, ctrl.signal)
        if (stopped) return
        const next = Array.isArray(res.items) ? res.items : NO_ITEMS
        setState((s) => {
          const base = s.ref === ref && s.language === language ? s : { ref, language, items: NO_ITEMS, fetchedAt: null, fresh: NO_IDS }
          const known = new Set(base.items.map((i) => i.id))
          const added = next.filter((i) => !known.has(i.id)).map((i) => i.id)
          const fresh = added.length ? new Set(added) : NO_IDS
          const items = base.items.length && signature(base.items) === signature(next) ? base.items : next.length ? next : NO_ITEMS
          if (s.ref === ref && s.language === language && items === s.items && fresh === s.fresh && res.fetchedAt === s.fetchedAt) return s
          return { ref, language, items, fetchedAt: res.fetchedAt ?? null, fresh }
        })
      } catch {
        // Network or server error: keep what we have, the next tick tries again.
        if (!stopped) setState((s) => (s.ref === ref && s.language === language ? s : { ref, language, items: NO_ITEMS, fetchedAt: null, fresh: NO_IDS }))
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), Math.max(5_000, intervalMs))
    return () => { stopped = true; clearInterval(timer); ctrl?.abort() }
  }, [ref, intervalMs, language])

  const current = state.ref === ref && ref !== null && state.language === language
  return {
    items: current ? state.items : NO_ITEMS,
    fetchedAt: current ? state.fetchedAt : null,
    loading: !!ref && !current,
    fresh: current ? state.fresh : NO_IDS,
  }
}
