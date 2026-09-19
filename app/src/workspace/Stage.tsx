import { Ear, Pin, Sparkles, Timer } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SeverityIcon } from '../cards/ui'
import { newsFeed } from '../data/mock'
import type { Card, Client, NewsItem, Severity } from '../types'
import { briefFor, readSeconds, type BriefItem } from './brief'
import { topicsFor } from './brain'
import { AUTO_MS, Bars, Spark, WidgetRail, type Widget } from './Widgets'
import { usePaced, Wave } from './CallIsland'
import type { Hint, ModuleSpec, Slot, TranscriptLine } from './types'

// The one window of the conversation workspace. The 60-second brief as a column of tiles: the tile
// in the middle is in focus, the others recede while scrolling. Tiles can be pinned to the top, open
// their supporting card in place, and are pulled into focus when the conversation touches their
// topic. The dark dock at the bottom says what to tell the client (live tracks during a call).

type Tile = { id: string; group: string; topics: string[]; words: string; seconds: number; severity?: Severity; item?: BriefItem; news?: NewsItem[]; card?: Card; chart?: ModuleSpec }

const BUDGET = 60
const tokens = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3).map((w) => w.slice(0, 6))

function buildTiles(client: Client): Tile[] {
  const items = briefFor(client)
  const tiles: Tile[] = items.map((item) => ({ id: item.id, group: item.group, topics: item.topics ?? [], words: `${item.figure ?? ''} ${item.text}`, seconds: readSeconds(item), severity: item.severity, item }))

  const news = newsFeed.filter((n) => n.affects[client.ref]).slice(0, 3)
  if (news.length) {
    const at = Math.max(0, tiles.findIndex((t) => t.group === 'Verlauf'))
    const words = news.map((n) => `${n.title} ${n.affects[client.ref].meaning}`).join(' ')
    tiles.splice(at === 0 ? tiles.length : at, 0, { id: 'news', group: 'Markt heute', topics: [], words, seconds: news.length * 3, severity: news[0].affects[client.ref].severity, news })
  }
  const proposal = client.briefing.find((c) => c.type === 'proposal')
  if (proposal && proposal.type === 'proposal') tiles.push({ id: 'proposal', group: 'Anlagevorschlag', topics: [], words: `${proposal.summary} ${proposal.trades.map((t) => t.name).join(' ')}`, seconds: 6, card: proposal })
  const charts = topicsFor(client).filter((t) => t.module)
  for (const t of tiles) t.chart ??= charts.find((c) => t.topics.includes(c.id))?.module?.spec
  return tiles
}

const firstNumber = (text: string) => /[−+-]?\d[\d'.,]*\s?%?/.exec(text)?.[0]

function toWidget(t: Tile, clientRef: string, auto: boolean, now: number): Widget {
  const news = t.news?.[0]
  const proposal = t.card?.type === 'proposal' ? t.card : undefined
  return {
    id: t.id, group: t.group, severity: t.severity, chart: t.chart, auto, until: now + AUTO_MS, born: now, hot: now,
    main: t.item?.figure ?? (t.item ? firstNumber(t.item.text) : news ? news.affects[clientRef].tag : proposal?.effects[0] ? `${proposal.effects[0].before} → ${proposal.effects[0].after}` : undefined),
    text: t.item?.text ?? (news ? news.title : proposal ? proposal.summary : t.group),
    source: t.item?.source ?? (news ? news.source : 'Anlagevorschlag'),
  }
}

function score(tile: Tile, hint: Hint): number {
  if (tile.topics.includes(hint.topicId)) return 10
  const have = new Set(tokens(tile.words + ' ' + tile.group))
  return tokens(`${hint.label} ${hint.text} ${hint.trigger}`).filter((w) => have.has(w)).length
}

function TileBody({ tile, clientRef }: { tile: Tile; clientRef: string }) {
  if (tile.item) return (
    <div className="flex items-center gap-4">
      <p className="min-w-0 flex-1 text-[16px] leading-snug">
        {tile.item.figure && <span className="mr-2 text-[24px] leading-none tabular-nums text-brand-dark">{tile.item.figure}</span>}
        {tile.item.text}
      </p>
      {tile.chart && <div className="w-32 shrink-0">{tile.chart.type === 'verlauf' ? <Spark spec={tile.chart} /> : <Bars spec={tile.chart} />}</div>}
    </div>
  )
  if (tile.news) return (
    <ul className="space-y-1.5">
      {tile.news.map((n) => (
        <li key={n.id} className="flex items-baseline gap-2.5 text-[14px] leading-snug">
          <span className="shrink-0 text-[11px] tabular-nums text-muted">{n.time}</span>
          <span className="min-w-0 flex-1">{n.title}</span>
          <span className="shrink-0 rounded-full bg-pill px-2 py-px text-[11px]">{n.affects[clientRef].tag}</span>
        </li>
      ))}
    </ul>
  )
  if (tile.card?.type === 'proposal') return (
    <div>
      <p className="mb-2 text-[15px] leading-snug">{tile.card.summary}</p>
      <ul className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
        {tile.card.effects.slice(0, 4).map((e) => (
          <li key={e.label} className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${e.ok ? 'bg-ok' : 'bg-risk'}`} />
            <span className="min-w-0 flex-1 truncate">{e.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{e.before} → <span className="text-ink">{e.after}</span></span>
          </li>
        ))}
      </ul>
    </div>
  )
  return null
}

export function Stage({ client, hints, ideas, said, thinking, onUse, inCall, recording, lines, note, customer, onEnd }: {
  client: Client; hints: Hint[]; ideas: Hint[]; said: string[]; thinking: boolean; onUse: (idea: Hint) => void
  inCall: boolean; recording: boolean; lines: TranscriptLine[]; note: string | null; customer: Slot | null; advisor: Slot | null; onEnd: () => void
}) {
  const base = useMemo(() => buildTiles(client), [client])
  const [extra, setExtra] = useState<Tile[]>([])
  const [widgets, setWidgets] = useState<Widget[]>([])
  const [now, setNow] = useState(() => Date.now())
  const hasAuto = widgets.some((w) => w.auto)
  // Conversation widgets stay for a while; the clock only runs while one of them is on screen.
  useEffect(() => {
    if (!hasAuto) return
    const t = setInterval(() => { const n = Date.now(); setNow(n); setWidgets((ws) => ws.map((w) => (w.auto && w.until <= n && !w.leaving ? { ...w, leaving: true } : w)).filter((w) => !w.leaving || w.until > n - 400)) }, 1000)
    return () => clearInterval(t)
  }, [hasAuto])
  const MAX_WIDGETS = 4
  const pin = (tile: Tile, auto: boolean) => setWidgets((ws) => {
    const n = Date.now()
    const had = ws.find((w) => w.id === tile.id)
    const next = had ? { ...had, auto: had.auto && auto, until: n + AUTO_MS, hot: n, leaving: false } : toWidget(tile, client.ref, auto, n)
    const rest = ws.filter((w) => w.id !== tile.id)
    const list = [next, ...rest]
    while (list.length > MAX_WIDGETS) { const i = list.map((w) => w.auto).lastIndexOf(true); list.splice(i >= 0 ? i : list.length - 1, 1) }
    return list
  })
  // Removing plays the shrink animation first, then the widget goes.
  const unpin = (id: string) => {
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, leaving: true } : w)))
    setTimeout(() => setWidgets((ws) => ws.filter((w) => !(w.id === id && w.leaving))), 320)
  }
  const pinnedIds = new Set(widgets.filter((w) => !w.leaving).map((w) => w.id))
  const [flash, setFlash] = useState<string | null>(null)
  const [focusIdx, setFocusIdx] = useState(0)
  const tiles = useMemo(() => [...base, ...extra], [base, extra])
  const flowing = tiles

  const box = useRef<HTMLDivElement>(null)
  const frame = useRef(0)

  // Focus effect: tiles away from the middle of the window dim; nothing moves or changes size.
  const paint = useCallback(() => {
    const el = box.current
    if (!el) return
    const mid = el.scrollTop + el.clientHeight / 2
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let best = 0, bestD = Infinity
    el.querySelectorAll<HTMLElement>('[data-tile]').forEach((t, i) => {
      const d = Math.abs(t.offsetTop + t.offsetHeight / 2 - mid) / el.clientHeight
      if (d < bestD) { bestD = d; best = i }
      const k = Math.min(1, d * 1.6)
      t.style.opacity = reduce ? '' : String(1 - k * 0.55)
    })
    setFocusIdx(best)
  }, [])
  const onScroll = () => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(paint) }
  useLayoutEffect(paint, [paint, flowing.length])

  const focus = useCallback((id: string) => {
    const t = box.current?.querySelector<HTMLElement>(`[data-tile="${id}"]`)
    t?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  // The conversation steers: a new hint from the call or the chat pulls its tile into focus.
  const lead = hints[0]
  useEffect(() => {
    if (!lead || lead.origin === 'kundendaten') return
    const ranked = tiles.map((t) => ({ t, s: score(t, lead) })).sort((a, b) => b.s - a.s)[0]
    let tile = ranked && ranked.s >= 2 ? ranked.t : null
    if (!tile) {
      const id = `x-${lead.id}`
      const text = lead.why || lead.text
      tile = { id, group: 'Aus dem Gespräch', topics: [lead.topicId], words: `${lead.label} ${text}`, seconds: readSeconds({ id: '', group: 'Aus dem Chat', text, source: '' }), severity: lead.severity, item: { id, group: 'Aus dem Chat', text, source: lead.trigger } }
      const added = tile
      setExtra((x) => [...x, added])
    }
    const target = tile.id
    pin(tile, true)
    setFlash(target)
    const t1 = setTimeout(() => focus(target), 60)
    const t2 = setTimeout(() => setFlash(null), 2400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [lead?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Up and down walk through the tiles (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const next = flowing[Math.max(0, Math.min(flowing.length - 1, focusIdx + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) focus(next.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flowing, focusIdx, focus])

  const total = tiles.reduce((n, t) => n + t.seconds, 0)
  const done = flowing.slice(0, focusIdx + 1).reduce((n, t) => n + t.seconds, 0)
  const togglePin = (t: Tile) => (pinnedIds.has(t.id) ? unpin(t.id) : pin(t, false))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-6 pt-3 text-[11px] tabular-nums text-muted">
        <Timer size={12} />
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-track">
          <div className={`h-full rounded-full transition-[width] duration-500 ${total > BUDGET ? 'bg-warn' : 'bg-brand-dark'}`} style={{ width: `${Math.min(100, (done / BUDGET) * 100)}%` }} />
        </div>
        <span>{Math.round(done)} / {Math.round(total)} s</span>
      </div>

      <div className="flex min-h-0 flex-1">
      <div ref={box} onScroll={onScroll} className="relative min-h-0 min-w-0 max-w-[720px] flex-[3] snap-y snap-proximity overflow-y-auto px-6 [scrollbar-width:none]">
        <div className="h-[30%]" aria-hidden />
        {flowing.map((t) => (
          <article key={t.id} data-tile={t.id} onClick={() => focus(t.id)}
            className={`group relative mb-3 snap-center rounded-xl bg-white p-4 shadow-card ring-1 transition-[box-shadow,ring-color] duration-500 ${flash === t.id ? 'ring-2 ring-brand' : 'ring-black/5'}`}>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted">
              {t.severity && <SeverityIcon severity={t.severity} size={11} />}
              <span>{t.group}</span>
              {flash === t.id && <span className="flex items-center gap-1 text-brand"><Sparkles size={11} /> Im Gespräch</span>}
              <span className="ml-auto flex items-center gap-1">
                <button onClick={(e) => { e.stopPropagation(); togglePin(t) }} aria-label={pinnedIds.has(t.id) ? 'Lösen' : 'Anheften'} title={pinnedIds.has(t.id) ? 'Lösen' : 'Rechts anheften'} className={`flex h-6 w-6 items-center justify-center rounded-full transition-opacity hover:bg-pill hover:text-ink focus-visible:opacity-100 ${pinnedIds.has(t.id) ? 'text-brand opacity-100' : 'opacity-0 group-hover:opacity-100'}`}><Pin size={12} className={pinnedIds.has(t.id) ? 'fill-current' : ''} /></button>
              </span>
            </div>
            <TileBody tile={t} clientRef={client.ref} />
            {t.item && <p className="mt-1.5 text-[10px] text-muted">{t.item.source}</p>}
          </article>
        ))}
        <div className="h-[45%]" aria-hidden />
      </div>
      <WidgetRail widgets={widgets} now={now} onKeep={(id) => setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, auto: false } : w)))} onRemove={unpin}
        onFocus={focus} onHold={(id) => setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, until: Date.now() + AUTO_MS } : w)))} />
      </div>

      <Dock ideas={ideas} said={said} thinking={thinking} onUse={onUse} inCall={inCall} recording={recording} lines={lines} note={note} customer={customer} onEnd={onEnd} name={client.name} />
    </div>
  )
}

// The black dock: the three best sentences to say next, side by side. Say one (or click it) and the
// transcript marks it, brings its tile forward and the next three follow. During the call the live
// answer to the client's last statement sits on top.
function Dock({ ideas, said, thinking, onUse, inCall, recording, lines, note, customer, onEnd, name }: {
  ideas: Hint[]; said: string[]; thinking: boolean; onUse: (idea: Hint) => void; inCall: boolean; recording: boolean; lines: TranscriptLine[]; note: string | null
  customer: Slot | null; onEnd: () => void; name: string
}) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!inCall) return
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => { clearInterval(t); setSeconds(0) }
  }, [inCall])
  // 1, 2, 3 mark a suggestion as said (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return
      const idea = ideas[Number(e.key) - 1]
      if (idea) onUse(idea)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ideas, onUse])
  const answer = usePaced(customer, 7000)
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  const last = lines[lines.length - 1]

  return (
    // Labels sit in the border, like a fieldset legend, so the content keeps the full height.
    <div className="relative m-3 mt-4 shrink-0 rounded-[26px] bg-[#0d0f12]/95 text-white shadow-[0_12px_40px_rgba(0,0,0,0.35)] ring-1 ring-white/10">
      <div className="absolute left-5 top-0 flex -translate-y-1/2 items-center gap-2 rounded-full bg-[#0d0f12] px-3 py-1 text-[11px] text-white/50 ring-1 ring-white/15">
        {inCall ? <><Wave /> <span className="text-white">{name}</span> <span className="tabular-nums">{clock}</span>{!recording && <span>· keine Aufzeichnung</span>}</>
          : <span className="uppercase tracking-wide text-[#7db8ff]">Einstieg</span>}
        {thinking && <Sparkles size={11} aria-label="Wird aktualisiert" className="animate-pulse" />}
      </div>
      {inCall && <button onClick={onEnd} className="absolute right-5 top-0 -translate-y-1/2 rounded-full bg-risk px-3 py-1 text-[11px] text-white ring-4 ring-[#0d0f12] hover:scale-105">Beenden</button>}
      {note && <p className="px-5 pt-4 text-[11px] text-[#ff9b8f]">{note}</p>}

      {inCall && answer && (
        <div key={answer.topic + answer.heard} className="island-swap relative mx-3 mt-5 rounded-[16px] border border-white/15 px-4 pb-3 pt-3.5">
          <span className="absolute left-3 top-0 -translate-y-1/2 bg-[#0d0f12] px-1.5 text-[10px] uppercase tracking-wide text-[#7db8ff]">Ihre Antwort</span>
          <p className="truncate text-[12px] italic text-white/45"><Ear size={11} className="mr-1 inline" />«{answer.heard}»</p>
          <p className="mt-0.5 text-[16px] leading-snug">{answer.text}</p>
        </div>
      )}

      <div className="grid gap-2.5 px-3 pb-3 pt-5 md:grid-cols-3">
        {ideas.map((idea, n) => {
          const done = said.includes(idea.id)
          return (
            <button key={idea.id} onClick={() => onUse(idea)} title={idea.why}
              className={`island-swap group relative rounded-[16px] border px-3.5 pb-3 pt-3.5 text-left transition-[background-color,border-color,opacity] duration-300 ${done ? 'border-white/10 opacity-45' : 'border-white/20 hover:border-[#69d4d6]/60 hover:bg-white/[0.06]'}`}>
              <span className="absolute left-3 top-0 flex max-w-[calc(100%-1.5rem)] -translate-y-1/2 items-center gap-1.5 bg-[#0d0f12] px-1.5 text-[10px] uppercase tracking-wide text-[#69d4d6]">
                <span className="tabular-nums text-white/60">{done ? '✓' : n + 1}</span>
                <span className="truncate">{idea.label}</span>
              </span>
              <span className="block text-[14px] leading-snug">{idea.text}</span>
            </button>
          )
        })}
      </div>
      {inCall && last && <p key={lines.length} className="island-swap truncate px-5 pb-3 text-[12px] text-white/40"><span className="mr-1.5 text-white/60">{last.speaker}</span>{last.text}</p>}
    </div>
  )
}
