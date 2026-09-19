import { Maximize2, MessageSquare, Pin, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SeverityIcon } from '../cards/ui'
import type { Severity } from '../types'
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
function Zoomable({ spec, children }: { spec: ModuleSpec; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <>
      <div role="button" tabIndex={0} aria-label={`${spec.title} gross anzeigen`} title="Gross anzeigen"
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen(true) } }}
        className="group/zoom relative cursor-zoom-in rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand">
        {children}
        <Maximize2 size={11} className="pointer-events-none absolute right-0 top-0 text-muted opacity-0 transition-opacity group-hover/zoom:opacity-100" />
      </div>
      {open && createPortal(
        <div onClick={() => setOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-6 backdrop-blur-sm">
          <div role="dialog" aria-label={spec.title} onClick={(e) => e.stopPropagation()} className="anim-rise relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <button onClick={() => setOpen(false)} aria-label="Schliessen" className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-pill hover:text-ink"><X size={16} /></button>
            <ModuleView spec={spec} detail="detailliert" />
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

export function Spark({ spec, tall = false }: { spec: Extract<ModuleSpec, { type: 'verlauf' }>; tall?: boolean }) {
  const v = spec.points.map((p) => p.value)
  if (v.length < 2) return null
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1
  const xy = v.map((y, i) => [(i / (v.length - 1)) * 100, 30 - ((y - lo) / span) * 26])
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lx, ly] = xy[xy.length - 1]
  return (
    <Zoomable spec={spec}>
      <div title={`${spec.title}: ${spec.points[0].label} ${v[0]} → ${spec.points[v.length - 1].label} ${v[v.length - 1]}`}>
        <div className="relative">
          <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={`${tall ? 'h-20' : 'h-10'} w-full overflow-visible`}>
            <polygon points={`0,32 ${line} 100,32`} fill={MARK} opacity="0.1" />
            <polyline points={line} fill="none" stroke={MARK} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          {/* The end dot sits outside the stretched SVG, so it stays round at any widget width. */}
          <span className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[1.5px] ring-white" style={{ left: `${lx}%`, top: `${(ly / 32) * 100}%`, background: MARK }} />
        </div>
        <div className="flex justify-between text-[9px] tabular-nums text-muted"><span>{spec.points[0].label}</span><span>{spec.points[v.length - 1].label}</span></div>
      </div>
    </Zoomable>
  )
}

export function Bars({ spec, rows = 4 }: { spec: Extract<ModuleSpec, { type: 'balken' }>; rows?: number }) {
  const bars = spec.bars.slice(0, rows)
  const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1)
  return (
    <Zoomable spec={spec}>
      <ul className="space-y-1">
        {bars.map((b) => (
          <li key={b.label} title={`${b.label}: ${b.value}${spec.unit}`} className="grid grid-cols-[1fr_auto] items-center gap-x-2 text-[10px]">
            <span className="truncate text-muted">{b.label}</span>
            <span className="tabular-nums">{b.value}{spec.unit}</span>
            <span className="col-span-2 h-1.5 rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: `${(Math.abs(b.value) / max) * 100}%`, background: MARK }} /></span>
          </li>
        ))}
      </ul>
    </Zoomable>
  )
}

export function WidgetRail({ widgets, hot, onPin, onRemove, onFocus, onAsk }: {
  widgets: Widget[]; hot: string | null; onPin: (id: string) => void; onRemove: (id: string) => void; onFocus: (id: string) => void; onAsk?: (w: Widget) => void
}) {
  const rail = useRef<HTMLDivElement>(null)
  useFlip(rail, widgets.map((w) => `${w.id}${w.leaving ? '-' : ''}`).join('|'))
  return (
    <div ref={rail} className="grid auto-rows-min grid-cols-2 content-start gap-2.5">
      {widgets.length === 0 && (
        <div className="col-span-full rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[11px] leading-snug text-muted">
          <Pin size={14} className="mx-auto mb-1.5" />
          Hier erscheinen die passenden Grafiken zum Gespräch. Kacheln lassen sich auch anheften.
        </div>
      )}
      {widgets.map((w) => {
        return (
          <article key={w.id} data-flip={w.id} onClick={() => onFocus(w.id)}
            className={`${w.leaving ? 'widget-out' : 'widget-in'} ${w.ask ? 'col-span-2' : ''} group relative cursor-pointer overflow-hidden rounded-2xl bg-white p-3.5 shadow-card ring-1 transition-shadow duration-500 ${hot === w.id ? 'ring-2 ring-brand' : 'ring-black/5'}`}>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] text-muted">
              {w.severity && <SeverityIcon severity={w.severity} size={10} />}
              <span className="truncate">{w.group}</span>
              {!w.pinned && <span className="flex items-center gap-0.5 text-brand"><Sparkles size={10} /> Gespräch</span>}
              <span className="ml-auto flex gap-0.5">
                {w.ask && onAsk && <button onClick={(e) => { e.stopPropagation(); onAsk(w) }} aria-label="Mehr dazu fragen" title="Mehr dazu fragen" className="flex h-5 items-center gap-0.5 rounded-full px-1.5 hover:bg-pill hover:text-ink"><MessageSquare size={10} /> Mehr</button>}
                {!w.pinned && <button onClick={(e) => { e.stopPropagation(); onPin(w.id) }} aria-label="Behalten" title="Behalten" className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-pill hover:text-ink"><Pin size={10} /></button>}
                {/* Also shown for an unpinned, agent-picked widget: without it there was no way to close one the agent kept re-suggesting. */}
                <button onClick={(e) => { e.stopPropagation(); onRemove(w.id) }} aria-label={w.pinned ? 'Lösen' : 'Ausblenden'} title={w.pinned ? 'Lösen' : 'Ausblenden'} className="flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-pill hover:text-ink group-hover:opacity-100"><X size={10} /></button>
              </span>
            </div>
            {w.main && <div className="text-[26px] leading-tight tabular-nums text-ink">{w.main}</div>}
            {w.chart && <div className="my-1.5">{w.chart.type === 'verlauf' ? <Spark spec={w.chart} /> : <Bars spec={w.chart} />}</div>}
            {w.ask && <p className="mb-1 truncate text-[10px] text-muted">{w.ask}</p>}
            {w.text && <p className={`${w.ask ? 'line-clamp-6' : 'line-clamp-2'} text-[11px] leading-snug text-ink/80`}>{w.text}</p>}
            <p className="mt-1 truncate text-[9px] text-muted">{w.source}</p>
          </article>
        )
      })}
    </div>
  )
}
