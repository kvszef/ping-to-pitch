import { Maximize2, MessageSquare, Pin, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SeverityIcon } from '../cards/ui'
import type { Severity } from '../types'
import { monthLabel, useTranslated, type Language } from '../data/useTranslate'
import { ModuleView } from './modules'
import { useFlip } from './motion'
import type { ModuleSpec } from './types'

// The graph column on the right: what the agent shows for the moment ("Gespräch") and what the
// advisor pinned. Widgets grow in, shrink out, and the others glide to their new place.

// ask: the question behind a pinned chat answer; such widgets span the column and offer a follow-up.
export type Widget = { id: string; group: string; main?: string; text?: string; source: string; severity?: Severity; chart?: ModuleSpec; pinned: boolean; leaving?: boolean; ask?: string }

const MARK = '#3f7fd9' // brand-dark: the brand blue fails 3:1 contrast on white

// Every small chart opens large on click: an overlay with the full chart module (axes, values, note).
// The click stays here, so the card or tile underneath does not also react.
function Zoomable({ spec, children, language }: { spec: ModuleSpec; children: ReactNode; language: Language }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  const [title, expandLabel, closeLabel] = useTranslated([spec.title, 'Gross anzeigen', 'Schliessen'], language)
  return (
    <>
      <div role="button" tabIndex={0} aria-label={`${title} ${expandLabel}`} title={expandLabel}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen(true) } }}
        className="group/zoom relative cursor-zoom-in rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand">
        {children}
        <Maximize2 size={11} className="pointer-events-none absolute right-0 top-0 text-muted opacity-0 transition-opacity group-hover/zoom:opacity-100" />
      </div>
      {open && createPortal(
        <div onClick={() => setOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-6 backdrop-blur-sm">
          <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} className="anim-rise relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <button onClick={() => setOpen(false)} aria-label="Schliessen" title={closeLabel} className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-pill hover:text-ink"><X size={16} /></button>
            <ModuleView spec={spec} detail="detailliert" language={language} />
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

export function Spark({ spec, tall = false, language = 'de' }: { spec: Extract<ModuleSpec, { type: 'verlauf' }>; tall?: boolean; language?: Language }) {
  const v = spec.points.map((p) => p.value)
  if (v.length < 2) return null
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1
  const xy = v.map((y, i) => [(i / (v.length - 1)) * 100, 30 - ((y - lo) / span) * 26])
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lx, ly] = xy[xy.length - 1]
  const first = monthLabel(spec.points[0].label, language), last = monthLabel(spec.points[v.length - 1].label, language)
  return (
    <Zoomable spec={spec} language={language}>
      <div title={`${spec.title}: ${first} ${v[0]} → ${last} ${v[v.length - 1]}`}>
        <div className="relative">
          <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={`${tall ? 'h-20' : 'h-10'} w-full overflow-visible`}>
            <polygon points={`0,32 ${line} 100,32`} fill={MARK} opacity="0.1" />
            <polyline points={line} fill="none" stroke={MARK} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          {/* The end dot sits outside the stretched SVG, so it stays round at any widget width. */}
          <span className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[1.5px] ring-white" style={{ left: `${lx}%`, top: `${(ly / 32) * 100}%`, background: MARK }} />
        </div>
        <div className="flex justify-between text-[9px] tabular-nums text-muted"><span>{first}</span><span>{last}</span></div>
      </div>
    </Zoomable>
  )
}

export function Bars({ spec, rows = 4, language = 'de' }: { spec: Extract<ModuleSpec, { type: 'balken' }>; rows?: number; language?: Language }) {
  const bars = spec.bars.slice(0, rows)
  const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1)
  const labels = useTranslated(bars.map((b) => b.label), language)
  return (
    <Zoomable spec={spec} language={language}>
      <ul className="space-y-1">
        {bars.map((b, i) => (
          <li key={b.label} title={`${labels[i] || b.label}: ${b.value}${spec.unit}`} className="grid grid-cols-[1fr_auto] items-center gap-x-2 text-[10px]">
            <span className="truncate text-muted">{labels[i] || b.label}</span>
            <span className="tabular-nums">{b.value}{spec.unit}</span>
            <span className="col-span-2 h-1.5 rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: `${(Math.abs(b.value) / max) * 100}%`, background: MARK }} /></span>
          </li>
        ))}
      </ul>
    </Zoomable>
  )
}

export function WidgetRail({ widgets, hot, onTalk, onPin, onRemove, onFocus, onAsk, language }: {
  widgets: Widget[]; hot: string | null; onTalk?: (w: Widget) => void; onPin: (id: string) => void; onRemove: (id: string) => void; onFocus: (id: string) => void; onAsk?: (w: Widget) => void; language: Language
}) {
  const rail = useRef<HTMLDivElement>(null)
  useFlip(rail, widgets.map((w) => `${w.id}${w.leaving ? '-' : ''}`).join('|'))
  const chrome = useTranslated(['Hier erscheinen die passenden Grafiken zum Gespräch. Kacheln lassen sich auch anheften.', 'Gespräch', 'Mehr dazu fragen', 'Mehr', 'Behalten', 'Lösen', 'Ausblenden', 'Antwortvorschlag zu dieser Grafik zeigen'], language)
  const groups = useTranslated(widgets.map((w) => w.group), language)
  const texts = useTranslated(widgets.map((w) => w.text ?? ''), language)
  const asks = useTranslated(widgets.map((w) => w.ask ?? ''), language)
  const sources = useTranslated(widgets.map((w) => w.source), language)
  return (
    <div ref={rail} className="grid auto-rows-min grid-cols-2 content-start gap-2.5">
      {widgets.length === 0 && (
        <div className="col-span-full rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[11px] leading-snug text-muted">
          <Pin size={14} className="mx-auto mb-1.5" />
          {chrome[0]}
        </div>
      )}
      {widgets.map((w, i) => {
        return (
          <article key={w.id} data-flip={w.id} onClick={() => onFocus(w.id)}
            className={`${w.leaving ? 'widget-out' : 'widget-in'} ${w.ask ? 'col-span-2' : ''} group relative cursor-pointer overflow-hidden rounded-2xl bg-white p-3.5 shadow-card ring-1 transition-shadow duration-500 ${hot === w.id ? 'ring-2 ring-brand' : 'ring-black/5'}`}>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] text-muted">
              {w.severity && <SeverityIcon severity={w.severity} size={10} />}
              <span className="truncate">{groups[i] || w.group}</span>
              {/* Came up in the conversation. During a call it is a button: it shows the answer that belongs to this widget. */}
              {!w.pinned && (onTalk
                ? <button onClick={(e) => { e.stopPropagation(); onTalk(w) }} title={chrome[7]} className={`flex items-center gap-0.5 rounded-full px-1.5 py-px ${hot === w.id ? 'bg-brand text-white' : 'bg-brand-soft/50 text-brand-dark hover:bg-brand-soft'}`}><Sparkles size={10} /> {chrome[1]}</button>
                : <span className="flex items-center gap-0.5 text-brand"><Sparkles size={10} /> {chrome[1]}</span>)}
              <span className="ml-auto flex gap-0.5">
                {w.ask && onAsk && <button onClick={(e) => { e.stopPropagation(); onAsk(w) }} aria-label="Mehr dazu fragen" title={chrome[2]} className="flex h-5 items-center gap-0.5 rounded-full px-1.5 hover:bg-pill hover:text-ink"><MessageSquare size={10} /> {chrome[3]}</button>}
                {!w.pinned && <button onClick={(e) => { e.stopPropagation(); onPin(w.id) }} aria-label="Behalten" title={chrome[4]} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-pill hover:text-ink"><Pin size={10} /></button>}
                {/* Also shown for an unpinned, agent-picked widget: without it there was no way to close one the agent kept re-suggesting. */}
                <button onClick={(e) => { e.stopPropagation(); onRemove(w.id) }} aria-label={w.pinned ? 'Lösen' : 'Ausblenden'} title={w.pinned ? chrome[5] : chrome[6]} className="flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-pill hover:text-ink group-hover:opacity-100"><X size={10} /></button>
              </span>
            </div>
            {w.main && <div className="text-[26px] leading-tight tabular-nums text-ink">{w.main}</div>}
            {w.chart && <div className="my-1.5">{w.chart.type === 'verlauf' ? <Spark spec={w.chart} language={language} /> : <Bars spec={w.chart} language={language} />}</div>}
            {w.ask && <p className="mb-1 truncate text-[10px] text-muted">{asks[i] || w.ask}</p>}
            {w.text && <p className={`${w.ask ? 'line-clamp-6' : 'line-clamp-2'} text-[11px] leading-snug text-ink/80`}>{texts[i] || w.text}</p>}
            <p className="mt-1 truncate text-[9px] text-muted">{sources[i] || w.source}</p>
          </article>
        )
      })}
    </div>
  )
}
