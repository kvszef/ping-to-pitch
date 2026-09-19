import { BarChart3, Ear, FileText, LayoutList, PanelRightClose, PanelRightOpen, Pin, Sparkles, Timer } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { SeverityIcon } from '../cards/ui'
import type { Client } from '../types'
import { isTranslated, useTranslated, type Language } from '../data/useTranslate'
import type { Screen } from './brain'
import { Wave } from './CallIsland'
import { ChatPanel, FOLLOW_UPS } from './ChatPanel'
import { TextView } from './TextView'
import { digestFor } from './digest'
import { Smooth, useFlip, usePresence } from './motion'
import { useReveal } from './reveal'
import { bestTile, sameTile, widgetMain, type Brought, type Plan, type Tile } from './screen'
import type { ChatEntry, Detail, Hint, TranscriptLine } from './types'
import { useSummary } from './useSummary'
import { Bars, Spark, WidgetRail, type Widget } from './Widgets'

// The conversation workspace as one window, 2:1.
//   left   the 60-second brief as tiles (scrolls; the tile in the middle is in focus). It holds still
//          during a call: everything the conversation brings up appears on the right.
//   right  during a call the live answer on top, then the graphs and tiles the agent picked plus the
//          advisor's pins, and under them the transcript and the chat (collapsed to one line, growing
//          upward over the graphs when needed). Only while this column is folded away does the dock
//          under the brief carry the live answer and the transcript instead.
// The agent's plan decides order, focus, graphs and talking points; this component only shows it,
// and every change is animated (heights follow content, moved elements glide).

const BUDGET = 60
// One frosted-glass look for the four parts of the page.
export const GLASS = 'rounded-2xl bg-white/55 shadow-[0_8px_32px_rgba(31,56,88,0.10)] ring-1 ring-white/70 backdrop-blur-xl'

function TileBody({ tile, text, clientRef, chart, fresh, language, onReady }: { tile: Tile; text?: string; clientRef: string; chart?: Screen['charts'][number]; fresh?: Set<string>; language: Language; onReady?: () => void }) {
  const itemText = text && tile.item?.figure && text.startsWith(tile.item.figure) ? text.slice(tile.item.figure.length).replace(/^[\s,:]+/, '') : text ?? tile.item?.text ?? ''
  const newsTexts = useTranslated((tile.news ?? []).flatMap((n) => [n.title, n.affects[clientRef].meaning]), language)
  const [main, proposalSummary] = useTranslated([itemText, tile.card?.type === 'proposal' ? tile.card.summary : ''], language)
  const effectLabels = useTranslated(tile.card?.type === 'proposal' ? tile.card.effects.slice(0, 4).map((e) => e.label) : [], language)
  // Ready once every text of this tile is there in the display language; until then the tile stays blurred (reveal.ts).
  const ready = isTranslated([itemText, tile.card?.type === 'proposal' ? tile.card.summary : '', ...(tile.news ?? []).flatMap((n) => [n.title, n.affects[clientRef].meaning])], language)
  useEffect(() => { if (ready) onReady?.() }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps
  if (tile.item) return (
    <div className="flex items-center gap-4">
      <p className="min-w-0 flex-1 text-[16px] leading-snug">
        {tile.item.figure && <span className="mr-2 text-[24px] leading-none tabular-nums text-brand-dark">{tile.item.figure}</span>}
        {main}
      </p>
      {chart && <div className="w-32 shrink-0">{chart.spec.type === 'verlauf' ? <Spark spec={chart.spec} language={language} /> : <Bars spec={chart.spec} language={language} />}</div>}
    </div>
  )
  if (tile.news) return (
    <ul className="divide-y divide-black/5">
      {tile.news.map((n, i) => {
        const hit = n.affects[clientRef]
        return (
          <li key={n.id} className={`${fresh?.has(n.id) ? 'news-in' : ''} flex items-start gap-3 py-2 first:pt-0 last:pb-0`}>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${hit.severity === 'risk' ? 'bg-risk' : hit.severity === 'warn' ? 'bg-warn' : hit.severity === 'ok' ? 'bg-ok' : 'bg-brand'}`} />
            <div className="min-w-0 flex-1">
              <a href={(n as { url?: string }).url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block text-[14px] leading-snug hover:text-brand-dark">{newsTexts[i * 2] || n.title}</a>
              <p className="mt-0.5 text-[12px] leading-snug text-ink/70">{newsTexts[i * 2 + 1] || hit.meaning}</p>
              <p className="mt-0.5 text-[10px] text-muted">{n.source} · {n.time}</p>
            </div>
            <span className="shrink-0 rounded-full bg-pill px-2 py-0.5 text-[11px] tabular-nums">{hit.tag}</span>
          </li>
        )
      })}
    </ul>
  )
  if (tile.card?.type === 'proposal') return (
    <div>
      <p className="mb-2 text-[15px] leading-snug">{text ?? proposalSummary}</p>
      <ul className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
        {tile.card.effects.slice(0, 4).map((e, i) => (
          <li key={e.label} className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${e.ok ? 'bg-ok' : 'bg-risk'}`} />
            <span className="min-w-0 flex-1 truncate">{effectLabels[i] || e.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{e.before} → <span className="text-ink">{e.after}</span></span>
          </li>
        ))}
      </ul>
    </div>
  )
  return null
}

// Who the client is, in a few facts: the first card of the scrolling brief, set apart from the tiles (the assets
// as a big figure, never dimmed), but not fixed, so the advisor can scroll past it to the brief.
function Profile({ client, compact = false, language }: { client: Client; compact?: boolean; language: Language }) {
  const context = client.briefing.find((c) => c.type === 'context')
  const persona = client.briefing.find((c) => c.type === 'profile')
  const fact = (label: string) => context?.type === 'context' ? context.facts.find((f) => f.label === label)?.value : undefined
  const facts = [
    ['Profil', client.profile], ['Strategie', client.strategy], ['Dienstleistung', client.service],
    ['Alter', fact('Alter')], ['ESG', fact('ESG-Profil')], ['Letzte Beratung', client.lastConsultation], ['Regelverletzungen', client.errors + client.warnings ? `${client.errors} Fehler · ${client.warnings} Warnungen` : undefined],
  ].filter((f): f is [string, string] => !!f[1] && f[1] !== '–')
  const notes = context?.type === 'context' ? context.notes.slice(0, 2) : []
  const reasons = (client.findings ?? []).filter((f) => (f.check === 'profile.call-reason' || (f.check === 'cio.house-view' && !!f.numbers?.changed))).map((f) => f.title).slice(0, 2)
  // The engine's facts are precise but wordy; the model condenses them to a glance, in the advisor's language.
  const summary = useSummary(persona?.type === 'profile' ? persona.persona : undefined, reasons, notes, language)
  const labels = useTranslated(facts.map(([label]) => label), language)
  const aumLabel = useTranslated(['Vermögen'], language)[0]
  return (
    <section className="mb-3 snap-start rounded-xl bg-gradient-to-br from-brand-soft/70 to-white/90 px-4 py-3.5 shadow-card ring-1 ring-brand/25">
      <div className={`flex ${compact ? 'items-baseline gap-4' : 'flex-col gap-3'}`}>
        {client.aum && client.aum !== '–' && (
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-wide text-muted">{aumLabel}</div>
            <div className={`${compact ? 'text-[20px]' : 'text-[28px]'} leading-tight tabular-nums text-brand-dark`}>{client.aum}</div>
          </div>
        )}
        <dl className={`min-w-0 flex-1 ${compact ? 'flex flex-wrap gap-x-4 gap-y-0.5' : 'grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4'}`}>
          {facts.map(([label, value], i) => (
            <div key={label} className={compact ? 'flex min-w-0 items-baseline gap-1' : 'min-w-0'}><dt className="text-[10px] uppercase tracking-wide text-muted">{labels[i]}</dt><dd className="truncate text-[14px] text-ink" title={value}>{value}</dd></div>
          ))}
        </dl>
      </div>
      {summary.text && (
        <p className={`mt-3 border-t border-brand/15 pt-2 text-[14px] leading-snug transition-[filter] duration-500 ${summary.loading ? 'tile-wait' : ''}`} title={[persona?.type === 'profile' ? persona.persona : '', reasons.join(' · '), ...notes.map((n) => n.text)].filter(Boolean).join(' — ')}>
          {summary.text}
        </p>
      )}
    </section>
  )
}

export function Stage({ client, screen, plan, brought, thinking, inCall, recording, lines, pending, note, hints, freshNews, lead, actions, chat, busy, detail, chatSuggestions, onAsk, onShowChart, graphsOpen, onGraphs, graphWidth, onGraphWidth, language }: {
  client: Client; screen: Screen; plan: Plan; brought: Brought[]; thinking: boolean
  inCall: boolean; recording: boolean; lines: TranscriptLine[]; pending: string[]; note: string | null; hints: Hint[]; freshNews: Set<string>
  lead: ReactNode; actions: ReactNode
  chat: ChatEntry[]; busy: boolean; detail: Detail; chatSuggestions: string[]; onAsk: (text: string) => void; onShowChart: (id: string) => void
  graphsOpen: boolean; onGraphs: (open: boolean) => void; graphWidth?: number; onGraphWidth: (width: number) => void; language: Language
}) {
  const byId = useMemo(() => new Map(screen.tiles.map((t) => [t.id, t])), [screen.tiles])
  const chartById = useMemo(() => new Map(screen.charts.map((c) => [c.id, c])), [screen.charts])
  const ordered = plan.order.map((id) => byId.get(id)).filter((t): t is Tile => !!t)
  const [focusIdx, setFocusIdx] = useState(0)
  // The feed is a 60-second brief that only grows at the bottom: a card already shown keeps its
  // place, a repeat of one already there is skipped. The agent's order is the priority, so the
  // brief fills up to ~60 s and stops. A call does not move it: what the conversation is about shows
  // in the graph column. Only switching to another client starts a fresh feed.
  const source = ordered.length ? ordered : screen.tiles
  const feed = useRef<{ ref: string; ids: string[] }>({ ref: '', ids: [] })
  if (feed.current.ref !== client.ref) feed.current = { ref: client.ref, ids: [] }
  {
    let ids = feed.current.ids.filter((id) => byId.has(id))
    const cardsOf = () => ids.map((id) => byId.get(id)!)
    const secondsOf = () => cardsOf().reduce((n, t) => n + t.seconds, 0)
    for (const t of source) {
      if (cardsOf().some((s) => s.id === t.id || sameTile(s, t))) continue
      if (!ids.length || secondsOf() + t.seconds <= BUDGET) ids = [...ids, t.id]
    }
    if (ids.join('|') !== feed.current.ids.join('|')) feed.current = { ref: client.ref, ids }
  }
  const grown = feed.current.ids.map((id) => byId.get(id)).filter((t): t is Tile => !!t)
  const tiles = grown.length ? grown : source.slice(0, 1)
  // The same brief as one text with bullet points (TextView.tsx), for reading or saving as a PDF.
  const [asText, setAsText] = useState(false)
  const digest = useMemo(() => digestFor(client, tiles, screen.charts, plan.texts), [client, tiles.map((t) => t.id).join('|'), screen.charts, plan.texts]) // eslint-disable-line react-hooks/exhaustive-deps
  const groupLabels = useTranslated(tiles.map((t) => t.group), language)
  const sourceLabels = useTranslated(tiles.map((t) => t.item?.source ?? ''), language)
  const graphsChrome = useTranslated(['Grafiken', 'Grafiken · Chat', 'Als Text anzeigen (Kopieren, PDF)', 'Als Kacheln anzeigen'], language)

  // ---- tiles: focus by scrolling, dimming away from the middle, gliding when the order changes ----
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const [flash, setFlash] = useState<string | null>(null)
  // How far the advisor has scrolled through the brief, 0–1: drives the reading bar in the header.
  const [readShare, setReadShare] = useState(0)
  const feedKey = tiles.map((t) => t.id).join('|')
  const reveal = useReveal(client.ref, tiles.map((t) => t.id))
  useFlip(box, feedKey)
  const paint = useCallback(() => {
    const el = box.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    setReadShare(max > 1 ? Math.min(1, el.scrollTop / max) : 1)
    const mid = el.scrollTop + el.clientHeight / 2
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let best = 0, bestD = Infinity
    el.querySelectorAll<HTMLElement>('[data-tile]').forEach((t, i) => {
      const d = Math.abs(t.offsetTop + t.offsetHeight / 2 - mid) / el.clientHeight
      if (d < bestD) { bestD = d; best = i }
      t.style.opacity = reduce ? '' : String(1 - Math.min(1, d * 1.6) * 0.55)
    })
    setFocusIdx(best)
  }, [])
  const onScroll = () => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(paint) }
  useLayoutEffect(paint, [paint, feedKey])
  const focus = useCallback((id: string, glow = false) => {
    const el = box.current?.querySelector<HTMLElement>(`[data-tile="${id}"]`)
    // The first tile scrolls to the very top, so the client card above it is in view again.
    if (el && el === box.current?.querySelector('[data-tile]')) box.current?.scrollTo({ top: 0, behavior: 'smooth' })
    else el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (glow) { setFlash(id); setTimeout(() => setFlash((f) => (f === id ? null : f)), 2400) }
  }, [])
  // The agent's focus, and a chat answer's topic, bring their tile to the middle. Not during a call:
  // then the brief holds still and the tile shows up in the graph column instead.
  useEffect(() => { if (plan.focus && !inCall) { const id = plan.focus; const t = setTimeout(() => focus(id, plan.by === 'agent'), 80); return () => clearTimeout(t) } }, [plan.focus, plan, inCall]) // eslint-disable-line react-hooks/exhaustive-deps
  const chatHint = hints.find((h) => h.origin === 'chat')
  useEffect(() => { if (chatHint) { const t = bestTile(screen.tiles, `${chatHint.label} ${chatHint.text}`, chatHint.topicId); if (t) focus(t.id, true) } }, [chatHint?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const next = tiles[Math.max(0, Math.min(tiles.length - 1, focusIdx + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) focus(next.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tiles, focusIdx, focus])

  // ---- widgets: the agent's picks plus the advisor's pins; leaving ones shrink out first ----
  const [pins, setPins] = useState<string[]>([])
  // An agent pick the advisor closed: stays hidden even though the agent keeps suggesting it,
  // until the advisor pins it back. Without this, closing an unpinned widget was a no-op — the
  // agent's own picks (including the single fallback graph below) always re-filled the column.
  const [dismissed, setDismissed] = useState<string[]>([])
  // Nothing enters the column on its own, and the agent's plan never fills it. It holds exactly two
  // things: what the advisor pinned, and `brought`: during a call, the one graph or tile per question
  // of the client (Workspace decides that). What has come up stays where it is: the next one is added
  // below, nothing is swapped out, changes place or changes its text until the advisor closes it.
  const stay = useMemo(() => (inCall ? brought.map((b) => b.widget) : []), [inCall, brought])
  const answers = useMemo(() => Object.fromEntries(brought.map((b) => [b.widget, b.answer])) as Record<string, Plan['answer']>, [brought])
  const held = useRef<{ ref: string; texts: Record<string, string | undefined> }>({ ref: '', texts: {} })
  if (!inCall || held.current.ref !== client.ref) held.current = { ref: client.ref, texts: {} }
  // The widget whose answer the advisor asked for ("Antwort zeigen").
  const [talk, setTalk] = useState<string | null>(null)
  if (talk && !stay.includes(talk)) setTalk(null)
  const wanted = useMemo(() => [...pins, ...stay.filter((w) => !pins.includes(w) && !dismissed.includes(w))], [pins, dismissed, stay.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const [shown, setShown] = useState<Widget[]>([])
  const toWidget = useCallback((key: string): Widget | null => {
    const pinned = pins.includes(key)
    if (key.startsWith('chat:')) {
      const i = chat.findIndex((e) => e.id === key.slice(5))
      const a = chat[i]
      if (a?.role !== 'ki') return null
      const q = chat.slice(0, i).reverse().find((e) => e.role === 'berater')
      return { id: key, group: 'Aus dem Chat', text: a.text, chart: a.module ?? a.offered?.spec, source: a.sources.join(' · ') || 'Chat', pinned, ask: q?.text ?? a.text.slice(0, 80) }
    }
    if (key.startsWith('chart:')) { const c = chartById.get(key.slice(6)); return c ? { id: key, group: c.title, chart: c.spec, source: c.note, pinned } : null }
    const t = byId.get(key.slice(5))
    if (!t) return null
    const chart = t.chart ? chartById.get(t.chart)?.spec : undefined
    const isHeld = stay.includes(key)
    if (isHeld && !(key in held.current.texts)) held.current.texts[key] = plan.texts[t.id]
    return { id: key, group: t.group, severity: t.severity, main: widgetMain(t, client.ref), chart, text: (isHeld ? held.current.texts[key] : plan.texts[t.id]) ?? t.item?.text ?? t.news?.[0].title ?? (t.card?.type === 'proposal' ? t.card.summary : undefined), source: t.item?.source ?? (t.news ? t.news[0].source : 'Anlagevorschlag'), pinned }
  }, [pins, byId, chartById, client.ref, plan.texts, chat, stay])
  useEffect(() => {
    const next = wanted.map(toWidget).filter((w): w is Widget => !!w)
    const nextById = new Map(next.map((w) => [w.id, w]))
    setShown((prev) => {
      // A removed widget stays in its current slot (marked leaving) instead of jumping to the end
      // of the grid first: that jump used to fight the FLIP glide on the same transform, which is
      // what made un-pinning look glitchy. Only a genuinely new widget is appended at the end.
      const kept = prev.flatMap((p) => {
        const fresh = nextById.get(p.id)
        if (fresh) return [fresh]
        return p.leaving ? [p] : [{ ...p, leaving: true }]
      })
      const seen = new Set(kept.map((w) => w.id))
      return [...kept, ...next.filter((w) => !seen.has(w.id))]
    })
    const t = setTimeout(() => setShown((s) => s.filter((w) => !w.leaving)), 320)
    return () => clearTimeout(t)
  }, [wanted, toWidget])
  // A widget added during a call lands at the bottom: scroll the column just far enough to show it.
  const rail = useRef<HTMLDivElement>(null)
  const lastHeld = stay[stay.length - 1]
  useEffect(() => {
    if (!inCall || !lastHeld) return
    const t = setTimeout(() => rail.current?.querySelector<HTMLElement>(`[data-flip="${CSS.escape(lastHeld)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 360)
    return () => clearTimeout(t)
  }, [inCall, lastHeld])
  const pinnedTile = (id: string) => pins.includes(`tile:${id}`)
  const togglePin = (key: string) => { setPins((p) => (p.includes(key) ? p.filter((x) => x !== key) : [key, ...p])); setDismissed((d) => d.filter((x) => x !== key)) }
  const removeWidget = (key: string) => { setPins((p) => p.filter((x) => x !== key)); setDismissed((d) => (d.includes(key) ? d : [...d, key])) }

  const dock = usePresence(inCall && !graphsOpen, 450)
  // Open graph column: 2/5 of the row by default (the text side gets 3/5), measured so the width can
  // animate; the advisor can drag it wider or narrower (the handle below), clamped and remembered.
  const row = useRef<HTMLDivElement>(null)
  const [rowWidth, setRowWidth] = useState(1200)
  useLayoutEffect(() => {
    const el = row.current
    if (!el) return
    const watch = new ResizeObserver(() => setRowWidth(el.clientWidth))
    watch.observe(el)
    setRowWidth(el.clientWidth)
    return () => watch.disconnect()
  }, [])
  const MIN_GRAPH_WIDTH = 260
  const maxGraphWidth = Math.max(MIN_GRAPH_WIDTH, Math.round(rowWidth * 0.7))
  const defaultWidth = Math.round((rowWidth - 12) * 0.4)
  const openWidth = Math.min(maxGraphWidth, Math.max(MIN_GRAPH_WIDTH, graphWidth ?? defaultWidth))
  const [dragging, setDragging] = useState(false)
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startWidth = openWidth
    const onMove = (ev: PointerEvent) => {
      // The panel is anchored to the right edge, so dragging left (negative dx) widens it.
      const next = Math.min(maxGraphWidth, Math.max(MIN_GRAPH_WIDTH, startWidth + (startX - ev.clientX)))
      onGraphWidth(next)
    }
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const graphs = usePresence(graphsOpen, 450)
  // Reading time of the brief as it stands (kept at ~60 s above) and how much of it is scrolled past.
  const total = tiles.reduce((n, t) => n + t.seconds, 0)
  const done = readShare * total

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The graph column folds away when not needed; the text side then takes the width. */}
      <div ref={row} className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className={`flex shrink-0 items-center gap-3 px-4 py-2 ${GLASS}`}>
            {lead}
            <div className="flex min-w-0 flex-1 items-center gap-2 text-[11px] tabular-nums text-muted" title={`Gelesen: ${Math.round(done)} von ${Math.round(total)} s Lesezeit (Ziel: höchstens ${BUDGET} s)`}>
              <Timer size={12} className="shrink-0" />
              <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-track">
                <div className={`h-full rounded-full transition-[width] duration-300 ${total > BUDGET ? 'bg-warn' : 'bg-brand-dark'}`} style={{ width: `${total > 0 ? Math.min(100, (done / total) * 100) : 0}%` }} />
              </div>
              <span className="shrink-0">{Math.round(done)} / {Math.round(total)} s gelesen</span>
              {thinking && <Sparkles size={12} aria-label="Agent arbeitet" className="shrink-0 animate-pulse text-brand" />}
            </div>
            <button onClick={() => setAsText((v) => !v)} aria-pressed={asText} aria-label={asText ? graphsChrome[3] : graphsChrome[2]} title={asText ? graphsChrome[3] : graphsChrome[2]}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${asText ? 'bg-brand text-white' : 'bg-pill hover:bg-track'}`}>{asText ? <LayoutList size={13} /> : <FileText size={13} />}</button>
            {actions}
          </div>
          <div ref={box} onScroll={onScroll} className={`relative min-h-0 flex-1 overflow-y-auto px-3 [scrollbar-width:none] ${GLASS}`}>
            <div className="h-2" aria-hidden />
            {!asText && <Profile client={client} compact={inCall} language={language} />}
            {asText && <TextView digest={digest} asOf={client.facts?.asOf} language={language} />}
            {!asText && tiles.map((t, i) => (
              // Tiles are revealed strictly top to bottom; one that is not ready yet stays blurred in place (reveal.ts).
              <article key={`${client.ref}:${t.id}`} data-tile={t.id} data-flip={t.id} onClick={() => focus(t.id)} aria-busy={i >= reveal.shown}
                className={`${i < reveal.shown ? '' : 'tile-wait'} group relative mb-3 rounded-xl bg-white/85 p-4 shadow-card ring-1 transition-[box-shadow,filter] duration-500 ${flash === t.id ? 'ring-2 ring-brand' : 'ring-black/5'}`}>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted">
                  {t.severity && <SeverityIcon severity={t.severity} size={11} />}
                  <span>{groupLabels[i]}</span>
                  {t.news && <span className="flex items-center gap-1 rounded-full bg-risk/10 px-1.5 text-[10px] uppercase tracking-wide text-risk"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-risk" /> Live</span>}
                  {flash === t.id && <span className="flex items-center gap-1 text-brand"><Sparkles size={11} /> Im Gespräch</span>}
                  <button onClick={(e) => { e.stopPropagation(); togglePin(`tile:${t.id}`) }} aria-label={pinnedTile(t.id) ? 'Lösen' : 'Anheften'} title={pinnedTile(t.id) ? 'Lösen' : 'Rechts anheften'}
                    className={`ml-auto flex h-6 w-6 items-center justify-center rounded-full transition-opacity hover:bg-pill hover:text-ink focus-visible:opacity-100 ${pinnedTile(t.id) ? 'text-brand opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <Pin size={12} className={pinnedTile(t.id) ? 'fill-current' : ''} />
                  </button>
                </div>
                <TileBody tile={t} text={plan.texts[t.id]} clientRef={client.ref} chart={t.chart ? chartById.get(t.chart) : undefined} fresh={freshNews} language={language} onReady={() => reveal.markReady(t.id)} />
                {t.item && <p className="mt-1.5 text-[10px] text-muted">{sourceLabels[i] || t.item.source}</p>}
              </article>
            ))}
            <div className="h-[40%]" aria-hidden />
          </div>
          <Smooth className="shrink-0">
            <div className={`transition-[opacity,transform] duration-[450ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none ${dock.visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}>
              <Dock answer={talk ? answers[talk] ?? null : null} language={language} inCall={dock.mounted} transcript recording={recording} lines={lines} pending={pending} note={note} name={client.name} />
            </div>
          </Smooth>
        </div>

        {/* Drag to resize the graph column; only while it is open (the folded 44px strip is fixed).
            A hairline by default, so it reads as a seam rather than a control; it only announces
            itself as draggable on hover or while active. */}
        {graphsOpen && (
          <button onPointerDown={startResize} aria-label="Breite der Grafikspalte ziehen" title="Ziehen zum Grössern/Verkleinern"
            className="group relative my-2 w-3 shrink-0 cursor-col-resize touch-none">
            <span className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded-full transition-colors duration-150 ${dragging ? 'bg-brand' : 'bg-black/10 group-hover:bg-brand/50'}`} />
            <span className={`absolute left-1/2 top-1/2 h-8 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-[opacity,background-color] duration-150 ${dragging ? 'bg-brand opacity-100' : 'bg-brand/60 opacity-0 group-hover:opacity-100'}`} />
            <span className="sr-only">Grafikspalte grösser oder kleiner ziehen</span>
          </button>
        )}
        {/* Width in pixels, so it can animate (fr to px cannot); the panel keeps its open width while the
            column narrows, so the graphs do not reflow mid-animation. */}
        <div className={`relative min-h-0 shrink-0 overflow-hidden ${dragging ? '' : 'transition-[width] duration-500 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none'}`} style={{ width: graphsOpen ? openWidth : 44 }}>
          {graphs.mounted && (
            <div style={{ width: openWidth }} className={`absolute inset-y-0 right-0 origin-right transition-[opacity,transform] duration-[450ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none ${graphs.visible ? 'scale-100 opacity-100' : 'pointer-events-none scale-[0.97] opacity-0'}`}>
              <div ref={rail} className={`absolute inset-0 overflow-y-auto scroll-pb-72 p-3 ${inCall ? 'pb-[17rem]' : 'pb-20'} [scrollbar-width:none] ${GLASS}`}>
                <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted">
                  <span className="flex items-center gap-1.5"><BarChart3 size={12} /> {graphsChrome[0]}</span>
                  <button onClick={() => onGraphs(false)} aria-label="Grafiken einklappen" title="Grafiken einklappen" className="flex h-6 w-6 items-center justify-center rounded-full normal-case hover:bg-pill hover:text-ink"><PanelRightClose size={14} /></button>
                </div>
                {inCall && <div className="mb-3 mt-3"><Dock answer={talk ? answers[talk] ?? null : null} language={language} inCall transcript={false} recording={recording} lines={lines} pending={pending} note={note} name={client.name} /></div>}
                <WidgetRail widgets={shown} hot={talk} onTalk={inCall ? (w) => { setTalk(w.id); if (!answers[w.id]) onAsk(FOLLOW_UPS[2].ask(w.group)) } : undefined} onPin={(id) => togglePin(id)} onRemove={removeWidget}
                  onFocus={(id) => { if (id.startsWith('tile:')) focus(id.slice(5)) }} onAsk={(w) => { if (w.ask) onAsk(FOLLOW_UPS[0].ask(w.ask)) }} language={language} />
              </div>
              <ChatPanel above={inCall ? <Transcript lines={lines} pending={pending} language={language} /> : null} name={client.name} chat={chat} busy={busy} detail={detail} suggestions={chatSuggestions} onAsk={onAsk} onShow={onShowChart}
                pinned={pins.filter((p) => p.startsWith('chat:')).map((p) => p.slice(5))} onPin={(id) => togglePin(`chat:${id}`)} language={language} />
            </div>
          )}
            <button onClick={() => onGraphs(true)} aria-label="Grafiken und Chat öffnen" title="Grafiken und Chat öffnen"
              className={`absolute inset-y-0 right-0 flex w-11 flex-col transition-opacity duration-300 ${graphsOpen ? 'pointer-events-none opacity-0' : 'opacity-100 delay-200'} items-center gap-2.5 py-4 text-muted transition-colors hover:text-ink ${GLASS}`}>
              <PanelRightOpen size={15} />
              <BarChart3 size={15} strokeWidth={1.5} />
              {shown.filter((w) => !w.leaving).length > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] tabular-nums text-white">{shown.filter((w) => !w.leaving).length}</span>}
              <span className="whitespace-nowrap text-[11px] [writing-mode:vertical-rl]">{graphsChrome[1]}</span>
            </button>
        </div>
      </div>
    </div>
  )
}

// The call card, live calls only: who is on the line, the answer to the client's last concern and,
// where asked for, the live transcript. It tops the graph column; under the brief it only appears
// while that column is folded away.
function Dock({ answer, language, inCall, transcript, recording, lines, pending, note, name }: {
  answer: Plan['answer']; language: Language; inCall: boolean; transcript: boolean; recording: boolean; lines: TranscriptLine[]; pending: string[]; note: string | null; name: string
}) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!inCall) return
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => { clearInterval(t); setSeconds(0) }
  }, [inCall])
  const [yourAnswer, hint, noRecording] = useTranslated(['Ihre Antwort', 'Fragt der Kunde nach etwas, erscheint darunter die eine passende Grafik. Ein Klick auf «Antwort zeigen» bei der Grafik zeigt hier den Antwortvorschlag dazu.', 'keine Aufzeichnung'], language)
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  // Before a call starts, the talk track's own "Einstieg" line already covers the opener; the three
  // talking-point chips only earn their place once there's a live conversation to react to.
  if (!inCall) return null

  return (
    <div data-dock className={`relative mt-2 ${GLASS}`}>
      <div className="absolute left-4 top-0 flex -translate-y-1/2 items-center gap-2 rounded-full bg-white px-2.5 py-0.5 text-[11px] text-muted shadow-sm ring-1 ring-black/5">
        {inCall ? <><Wave /> <span className="text-ink">{name}</span> <span className="tabular-nums">{clock}</span>{!recording && <span>· {noRecording}</span>}</>
          : <span className="uppercase tracking-wide text-brand-dark">Einstieg</span>}
      </div>
      {note && <p className="px-4 pt-4 text-[11px] text-risk">{note}</p>}

      {inCall && answer && (
        <div key={answer.heard} className={`island-swap relative mx-3 mt-5 rounded-xl border border-brand/30 bg-brand-soft/20 px-4 pb-2.5 pt-3 ${transcript ? '' : 'mb-3'}`}>
          <span className="absolute left-3 top-0 -translate-y-1/2 rounded-full bg-white px-1.5 text-[10px] uppercase tracking-wide text-brand-dark">{yourAnswer}</span>
          <p className="truncate text-[12px] italic text-muted"><Ear size={11} className="mr-1 inline" />«{answer.heard}»</p>
          <p className="mt-0.5 text-[15px] leading-snug">{answer.text}</p>
        </div>
      )}

      {inCall && !answer && !transcript && <p className="px-4 pb-3 pt-5 text-[12px] leading-snug text-muted">{hint}</p>}
      {inCall && transcript && <Transcript lines={lines} pending={pending} language={language} />}
    </div>
  )
}

// The live transcript under the talking points: who said what, newest at the bottom, scrolls itself.
export function Transcript({ lines, pending = [], tall = false, language = 'de' }: { lines: TranscriptLine[]; pending?: string[]; tall?: boolean; language?: Language }) {
  const [title, waiting, clientLabel, advisorLabel] = useTranslated(['Transkript', 'Wartet auf das Gespräch …', 'Kunde', 'Berater'], language)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }) }, [lines.length, pending.length])
  return (
    <div className="relative mx-3 mb-3 mt-2 rounded-xl border border-line bg-white/50">
      <span className="absolute left-3 top-0 -translate-y-1/2 rounded-full bg-white px-1.5 text-[10px] uppercase tracking-wide text-muted">{title}</span>
      <div ref={box} className={`${tall ? 'max-h-[50vh]' : 'max-h-36'} min-h-[3.5rem] space-y-1.5 overflow-y-auto px-3.5 pb-2.5 pt-3.5 text-[13px] leading-snug [scrollbar-width:thin]`}>
        {lines.length + pending.length === 0 && <p className="text-[12px] text-muted">{waiting}</p>}
        {lines.map((l, i) => (
          <p key={i} className={`anim-rise flex gap-2 ${l.speaker === 'Berater' ? 'text-ink/65' : ''}`}>
            <span className={`mt-px w-14 shrink-0 text-[10px] uppercase tracking-wide ${l.speaker === 'Kunde' ? 'text-brand-dark' : 'text-muted'}`}>{l.speaker === 'Kunde' ? clientLabel : advisorLabel}</span>
            <span className="min-w-0 flex-1">{l.text}</span>
          </p>
        ))}
        {pending.map((t, i) => (
          <p key={`p${i}`} className="anim-rise flex gap-2 text-ink/60">
            <span className="mt-px w-14 shrink-0 animate-pulse text-[10px] uppercase tracking-wide text-muted">…</span>
            <span className="min-w-0 flex-1">{t}</span>
          </p>
        ))}
      </div>
    </div>
  )
}
