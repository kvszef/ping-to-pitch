import { BarChart3, Ear, PanelRightClose, PanelRightOpen, Pin, Sparkles, Timer } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SeverityIcon } from '../cards/ui'
import type { Client } from '../types'
import type { Screen } from './brain'
import { usePaced, Wave } from './CallIsland'
import { ChatPanel } from './ChatPanel'
import { Smooth, useFlip, usePresence } from './motion'
import { bestTile, widgetMain, type Plan, type Tile } from './screen'
import type { ChatEntry, Detail, Hint, TranscriptLine } from './types'
import { useSummary } from './useSummary'
import { Bars, Spark, WidgetRail, type Widget } from './Widgets'

// The conversation workspace as one window, 2:1.
//   left   the 60-second brief as tiles (scrolls; the tile in the middle is in focus), and during a
//          call the dock underneath: three talking points, the live answer and the transcript. Before
//          a call the brief's own "Einstieg" line already covers the opener, so the dock stays hidden.
//   right  the graphs the agent picked plus the advisor's pins, and under them the chat, collapsed
//          to one line, growing upward over the graphs when needed
// The agent's plan decides order, focus, graphs and talking points; this component only shows it,
// and every change is animated (heights follow content, moved elements glide).

const BUDGET = 60
// One frosted-glass look for the four parts of the page.
export const GLASS = 'rounded-2xl bg-white/55 shadow-[0_8px_32px_rgba(31,56,88,0.10)] ring-1 ring-white/70 backdrop-blur-xl'

function TileBody({ tile, text, clientRef, chart, fresh }: { tile: Tile; text?: string; clientRef: string; chart?: Screen['charts'][number]; fresh?: Set<string> }) {
  if (tile.item) return (
    <div className="flex items-center gap-4">
      <p className="min-w-0 flex-1 text-[16px] leading-snug">
        {tile.item.figure && <span className="mr-2 text-[24px] leading-none tabular-nums text-brand-dark">{tile.item.figure}</span>}
        {text && tile.item.figure && text.startsWith(tile.item.figure) ? text.slice(tile.item.figure.length).replace(/^[\s,:]+/, '') : text ?? tile.item.text}
      </p>
      {chart && <div className="w-32 shrink-0">{chart.spec.type === 'verlauf' ? <Spark spec={chart.spec} /> : <Bars spec={chart.spec} />}</div>}
    </div>
  )
  if (tile.news) return (
    <ul className="divide-y divide-black/5">
      {tile.news.map((n) => {
        const hit = n.affects[clientRef]
        return (
          <li key={n.id} className={`${fresh?.has(n.id) ? 'news-in' : ''} flex items-start gap-3 py-2 first:pt-0 last:pb-0`}>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${hit.severity === 'risk' ? 'bg-risk' : hit.severity === 'warn' ? 'bg-warn' : hit.severity === 'ok' ? 'bg-ok' : 'bg-brand'}`} />
            <div className="min-w-0 flex-1">
              <a href={(n as { url?: string }).url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block text-[14px] leading-snug hover:text-brand-dark">{n.title}</a>
              <p className="mt-0.5 text-[12px] leading-snug text-ink/70">{hit.meaning}</p>
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
      <p className="mb-2 text-[15px] leading-snug">{text ?? tile.card.summary}</p>
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

// Who the client is, in a few facts: stays above the scrolling tiles, so the advisor always sees the person.
function Profile({ client, compact = false }: { client: Client; compact?: boolean }) {
  const context = client.briefing.find((c) => c.type === 'context')
  const persona = client.briefing.find((c) => c.type === 'profile')
  const fact = (label: string) => context?.type === 'context' ? context.facts.find((f) => f.label === label)?.value : undefined
  const facts = [
    ['Vermögen', client.aum], ['Profil', client.profile], ['Strategie', client.strategy], ['Dienstleistung', client.service],
    ['Alter', fact('Alter')], ['ESG', fact('ESG-Profil')], ['Letzte Beratung', client.lastConsultation], ['Regelverletzungen', client.errors + client.warnings ? `${client.errors} Fehler · ${client.warnings} Warnungen` : undefined],
  ].filter((f): f is [string, string] => !!f[1] && f[1] !== '–')
  const notes = context?.type === 'context' ? context.notes.slice(0, 2) : []
  const reasons = (client.findings ?? []).filter((f) => f.check === 'profile.call-reason').map((f) => f.title).slice(0, 2)
  // The engine's facts are precise but wordy; the model condenses them to a glance, in the advisor's language.
  // Only German ships today (see useSummary) — the language is already a parameter, ready for a picker later.
  const summary = useSummary(persona?.type === 'profile' ? persona.persona : undefined, reasons, notes, 'de')
  return (
    <section className={`shrink-0 px-4 py-3 ${GLASS}`}>
      <dl className={compact ? 'flex flex-wrap gap-x-4 gap-y-0.5' : 'grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4'}>
        {facts.map(([label, value]) => (
          <div key={label} className={compact ? 'flex min-w-0 items-baseline gap-1' : 'min-w-0'}><dt className="text-[10px] uppercase tracking-wide text-muted">{label}</dt><dd className="truncate text-[13px]" title={value}>{value}</dd></div>
        ))}
      </dl>
      {summary.text && (
        <p className={`mt-3 border-t border-black/5 pt-2 text-[13px] leading-snug ${summary.loading ? 'animate-pulse' : ''}`} title={[persona?.type === 'profile' ? persona.persona : '', reasons.join(' · '), ...notes.map((n) => n.text)].filter(Boolean).join(' — ')}>
          {summary.text}
        </p>
      )}
    </section>
  )
}

export function Stage({ client, screen, plan, thinking, inCall, recording, lines, pending, note, hints, freshNews, lead, actions, chat, busy, detail, chatSuggestions, onAsk, onShowChart, graphsOpen, onGraphs }: {
  client: Client; screen: Screen; plan: Plan; thinking: boolean
  inCall: boolean; recording: boolean; lines: TranscriptLine[]; pending: string[]; note: string | null; hints: Hint[]; freshNews: Set<string>
  lead: ReactNode; actions: ReactNode
  chat: ChatEntry[]; busy: boolean; detail: Detail; chatSuggestions: string[]; onAsk: (text: string) => void; onShowChart: (id: string) => void
  graphsOpen: boolean; onGraphs: (open: boolean) => void
}) {
  const byId = useMemo(() => new Map(screen.tiles.map((t) => [t.id, t])), [screen.tiles])
  const chartById = useMemo(() => new Map(screen.charts.map((c) => [c.id, c])), [screen.charts])
  const ordered = plan.order.map((id) => byId.get(id)).filter((t): t is Tile => !!t)
  const tiles = ordered.length ? ordered : screen.tiles

  // ---- tiles: focus by scrolling, dimming away from the middle, gliding when the order changes ----
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const [focusIdx, setFocusIdx] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  useFlip(box, plan.order.join('|'))
  const paint = useCallback(() => {
    const el = box.current
    if (!el) return
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
  useLayoutEffect(paint, [paint, tiles.length])
  const focus = useCallback((id: string, glow = false) => {
    box.current?.querySelector<HTMLElement>(`[data-tile="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (glow) { setFlash(id); setTimeout(() => setFlash((f) => (f === id ? null : f)), 2400) }
  }, [])
  // The agent's focus, and a chat answer's topic, bring their tile to the middle.
  useEffect(() => { if (plan.focus) { const id = plan.focus; const t = setTimeout(() => focus(id, plan.by === 'agent' || inCall), 80); return () => clearTimeout(t) } }, [plan.focus, plan]) // eslint-disable-line react-hooks/exhaustive-deps
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
  // Never an empty column: without the agent's picks, the graph (or figure) of the tile in focus.
  const focusTile = plan.focus ? byId.get(plan.focus) : undefined
  const picks = plan.widgets.length ? plan.widgets : focusTile ? [focusTile.chart ? `chart:${focusTile.chart}` : `tile:${focusTile.id}`] : []
  const wanted = useMemo(() => [...pins, ...picks.filter((w) => !pins.includes(w))], [pins, picks.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const [shown, setShown] = useState<Widget[]>([])
  const toWidget = useCallback((key: string): Widget | null => {
    const pinned = pins.includes(key)
    if (key.startsWith('chart:')) { const c = chartById.get(key.slice(6)); return c ? { id: key, group: c.title, chart: c.spec, source: c.note, pinned } : null }
    const t = byId.get(key.slice(5))
    if (!t) return null
    const chart = t.chart ? chartById.get(t.chart)?.spec : undefined
    return { id: key, group: t.group, severity: t.severity, main: widgetMain(t, client.ref), chart, text: plan.texts[t.id] ?? t.item?.text ?? t.news?.[0].title ?? (t.card?.type === 'proposal' ? t.card.summary : undefined), source: t.item?.source ?? (t.news ? t.news[0].source : 'Anlagevorschlag'), pinned }
  }, [pins, byId, chartById, client.ref, plan.texts])
  useEffect(() => {
    const next = wanted.map(toWidget).filter((w): w is Widget => !!w)
    setShown((prev) => {
      const gone = prev.filter((p) => !p.leaving && !next.some((n) => n.id === p.id)).map((p) => ({ ...p, leaving: true }))
      return [...next, ...gone]
    })
    const t = setTimeout(() => setShown((s) => s.filter((w) => !w.leaving)), 320)
    return () => clearTimeout(t)
  }, [wanted, toWidget])
  const pinnedTile = (id: string) => pins.includes(`tile:${id}`)
  const togglePin = (key: string) => setPins((p) => (p.includes(key) ? p.filter((x) => x !== key) : [key, ...p]))

  const dock = usePresence(inCall, 450)
  // Open graph column: 2/5 of the row (the text side gets 3/5), measured so the width can animate.
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
  const openWidth = Math.round((rowWidth - 12) * 0.4)
  const graphs = usePresence(graphsOpen, 450)
  const total = tiles.reduce((n, t) => n + t.seconds, 0)
  const done = tiles.slice(0, focusIdx + 1).reduce((n, t) => n + t.seconds, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The graph column folds away when not needed; the text side then takes the width. */}
      <div ref={row} className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className={`flex shrink-0 items-center gap-3 px-4 py-2 ${GLASS}`}>
            {lead}
            <div className="flex min-w-0 flex-1 items-center gap-2 text-[11px] tabular-nums text-muted" title="Lesezeit des Briefings">
              <Timer size={12} className="shrink-0" />
              <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-track">
                <div className={`h-full rounded-full transition-[width] duration-500 ${total > BUDGET ? 'bg-warn' : 'bg-brand-dark'}`} style={{ width: `${Math.min(100, (done / BUDGET) * 100)}%` }} />
              </div>
              <span className="shrink-0">{Math.round(done)}/{Math.round(total)} s</span>
              {thinking && <Sparkles size={12} aria-label="Agent arbeitet" className="shrink-0 animate-pulse text-brand" />}
            </div>
            {actions}
          </div>
          <Profile client={client} compact={inCall} />
          <div ref={box} onScroll={onScroll} className={`relative min-h-0 flex-1 snap-y snap-proximity overflow-y-auto px-3 [scrollbar-width:none] ${GLASS}`}>
            <div className="h-2" aria-hidden />
            {tiles.map((t) => (
              <article key={t.id} data-tile={t.id} data-flip={t.id} onClick={() => focus(t.id)}
                className={`group relative mb-3 snap-center rounded-xl bg-white/85 p-4 shadow-card ring-1 transition-[box-shadow] duration-500 ${flash === t.id ? 'ring-2 ring-brand' : 'ring-black/5'}`}>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted">
                  {t.severity && <SeverityIcon severity={t.severity} size={11} />}
                  <span>{t.group}</span>
                  {t.news && <span className="flex items-center gap-1 rounded-full bg-risk/10 px-1.5 text-[10px] uppercase tracking-wide text-risk"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-risk" /> Live</span>}
                  {flash === t.id && <span className="flex items-center gap-1 text-brand"><Sparkles size={11} /> Im Gespräch</span>}
                  <button onClick={(e) => { e.stopPropagation(); togglePin(`tile:${t.id}`) }} aria-label={pinnedTile(t.id) ? 'Lösen' : 'Anheften'} title={pinnedTile(t.id) ? 'Lösen' : 'Rechts anheften'}
                    className={`ml-auto flex h-6 w-6 items-center justify-center rounded-full transition-opacity hover:bg-pill hover:text-ink focus-visible:opacity-100 ${pinnedTile(t.id) ? 'text-brand opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <Pin size={12} className={pinnedTile(t.id) ? 'fill-current' : ''} />
                  </button>
                </div>
                <TileBody tile={t} text={plan.texts[t.id]} clientRef={client.ref} chart={t.chart ? chartById.get(t.chart) : undefined} fresh={freshNews} />
                {t.item && <p className="mt-1.5 text-[10px] text-muted">{t.item.source}</p>}
              </article>
            ))}
            <div className="h-[40%]" aria-hidden />
          </div>
          <Smooth className="shrink-0">
            <div className={`transition-[opacity,transform] duration-[450ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none ${dock.visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}>
              <Dock plan={plan} inCall={dock.mounted} recording={recording} lines={lines} pending={pending} note={note} name={client.name} />
            </div>
          </Smooth>
        </div>

        {/* Width in pixels, so it can animate (fr to px cannot); the panel keeps its open width while the
            column narrows, so the graphs do not reflow mid-animation. */}
        <div className="relative min-h-0 shrink-0 overflow-hidden transition-[width] duration-500 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none" style={{ width: graphsOpen ? openWidth : 44 }}>
          {graphs.mounted && (
            <div style={{ width: openWidth }} className={`absolute inset-y-0 right-0 origin-right transition-[opacity,transform] duration-[450ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none ${graphs.visible ? 'scale-100 opacity-100' : 'pointer-events-none scale-[0.97] opacity-0'}`}>
              <div className={`absolute inset-0 overflow-y-auto p-3 pb-16 [scrollbar-width:none] ${GLASS}`}>
                <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted">
                  <span className="flex items-center gap-1.5"><BarChart3 size={12} /> Grafiken</span>
                  <button onClick={() => onGraphs(false)} aria-label="Grafiken einklappen" title="Grafiken einklappen" className="flex h-6 w-6 items-center justify-center rounded-full normal-case hover:bg-pill hover:text-ink"><PanelRightClose size={14} /></button>
                </div>
                <WidgetRail widgets={shown} hot={plan.focus ? `tile:${plan.focus}` : null} onPin={(id) => togglePin(id)} onRemove={(id) => setPins((p) => p.filter((x) => x !== id))}
                  onFocus={(id) => { if (id.startsWith('tile:')) focus(id.slice(5)) }} />
              </div>
              <ChatPanel name={client.name} chat={chat} busy={busy} detail={detail} suggestions={chatSuggestions} onAsk={onAsk} onShow={onShowChart} />
            </div>
          )}
            <button onClick={() => onGraphs(true)} aria-label="Grafiken und Chat öffnen" title="Grafiken und Chat öffnen"
              className={`absolute inset-y-0 right-0 flex w-11 flex-col transition-opacity duration-300 ${graphsOpen ? 'pointer-events-none opacity-0' : 'opacity-100 delay-200'} items-center gap-2.5 py-4 text-muted transition-colors hover:text-ink ${GLASS}`}>
              <PanelRightOpen size={15} />
              <BarChart3 size={15} strokeWidth={1.5} />
              {shown.filter((w) => !w.leaving).length > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] tabular-nums text-white">{shown.filter((w) => !w.leaving).length}</span>}
              <span className="whitespace-nowrap text-[11px] [writing-mode:vertical-rl]">Grafiken · Chat</span>
            </button>
        </div>
      </div>
    </div>
  )
}

// The dark dock under the tiles, live calls only: the answer to the client's last concern and the
// live transcript. Hidden before a call starts: the brief's own "Einstieg" line is the opener already.
function Dock({ plan, inCall, recording, lines, pending, note, name }: {
  plan: Plan; inCall: boolean; recording: boolean; lines: TranscriptLine[]; pending: string[]; note: string | null; name: string
}) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!inCall) return
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => { clearInterval(t); setSeconds(0) }
  }, [inCall])
  const answer = usePaced(plan.answer, 6000)
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  // Before a call starts, the talk track's own "Einstieg" line already covers the opener; the three
  // talking-point chips only earn their place once there's a live conversation to react to.
  if (!inCall) return null

  return (
    <div data-dock className={`relative mt-2 ${GLASS}`}>
      <div className="absolute left-4 top-0 flex -translate-y-1/2 items-center gap-2 rounded-full bg-white px-2.5 py-0.5 text-[11px] text-muted shadow-sm ring-1 ring-black/5">
        {inCall ? <><Wave /> <span className="text-ink">{name}</span> <span className="tabular-nums">{clock}</span>{!recording && <span>· keine Aufzeichnung</span>}</>
          : <span className="uppercase tracking-wide text-brand-dark">Einstieg</span>}
      </div>
      {note && <p className="px-4 pt-4 text-[11px] text-risk">{note}</p>}

      {inCall && answer && (
        <div key={answer.heard} className="island-swap relative mx-3 mt-5 rounded-xl border border-brand/30 bg-brand-soft/20 px-4 pb-2.5 pt-3">
          <span className="absolute left-3 top-0 -translate-y-1/2 rounded-full bg-white px-1.5 text-[10px] uppercase tracking-wide text-brand-dark">Ihre Antwort</span>
          <p className="truncate text-[12px] italic text-muted"><Ear size={11} className="mr-1 inline" />«{answer.heard}»</p>
          <p className="mt-0.5 text-[15px] leading-snug">{answer.text}</p>
        </div>
      )}

      {inCall && <Transcript lines={lines} pending={pending} />}
    </div>
  )
}

// The live transcript under the talking points: who said what, newest at the bottom, scrolls itself.
export function Transcript({ lines, pending = [], tall = false }: { lines: TranscriptLine[]; pending?: string[]; tall?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }) }, [lines.length, pending.length])
  return (
    <div className="relative mx-3 mb-3 mt-2 rounded-xl border border-line bg-white/50">
      <span className="absolute left-3 top-0 -translate-y-1/2 rounded-full bg-white px-1.5 text-[10px] uppercase tracking-wide text-muted">Transkript</span>
      <div ref={box} className={`${tall ? 'max-h-[50vh]' : 'max-h-36'} min-h-[3.5rem] space-y-1.5 overflow-y-auto px-3.5 pb-2.5 pt-3.5 text-[13px] leading-snug [scrollbar-width:thin]`}>
        {lines.length + pending.length === 0 && <p className="text-[12px] text-muted">Wartet auf das Gespräch …</p>}
        {lines.map((l, i) => (
          <p key={i} className={`anim-rise flex gap-2 ${l.speaker === 'Berater' ? 'text-ink/65' : ''}`}>
            <span className={`mt-px w-14 shrink-0 text-[10px] uppercase tracking-wide ${l.speaker === 'Kunde' ? 'text-brand-dark' : 'text-muted'}`}>{l.speaker}</span>
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
