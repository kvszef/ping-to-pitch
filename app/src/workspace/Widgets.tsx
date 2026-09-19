import { Pin, Sparkles, X } from 'lucide-react'
import { useRef } from 'react'
import { SeverityIcon } from '../cards/ui'
import type { Severity } from '../types'
import { useFlip } from './motion'
import type { ModuleSpec } from './types'

// The graph column on the right: what the agent shows for the moment ("Gespräch") and what the
// advisor pinned. Widgets grow in, shrink out, and the others glide to their new place.

export type Widget = { id: string; group: string; main?: string; text?: string; source: string; severity?: Severity; chart?: ModuleSpec; pinned: boolean; leaving?: boolean }

const MARK = '#3f7fd9' // brand-dark: the brand blue fails 3:1 contrast on white

export function Spark({ spec, tall = false }: { spec: Extract<ModuleSpec, { type: 'verlauf' }>; tall?: boolean }) {
  const v = spec.points.map((p) => p.value)
  if (v.length < 2) return null
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1
  const xy = v.map((y, i) => [(i / (v.length - 1)) * 100, 30 - ((y - lo) / span) * 26])
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lx, ly] = xy[xy.length - 1]
  return (
    <div title={`${spec.title}: ${spec.points[0].label} ${v[0]} → ${spec.points[v.length - 1].label} ${v[v.length - 1]}`}>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={`${tall ? 'h-20' : 'h-10'} w-full overflow-visible`}>
        <polygon points={`0,32 ${line} 100,32`} fill={MARK} opacity="0.1" />
        <polyline points={line} fill="none" stroke={MARK} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <circle cx={lx} cy={ly} r="2.5" fill={MARK} stroke="white" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[9px] tabular-nums text-muted"><span>{spec.points[0].label}</span><span>{spec.points[v.length - 1].label}</span></div>
    </div>
  )
}

export function Bars({ spec, rows = 4 }: { spec: Extract<ModuleSpec, { type: 'balken' }>; rows?: number }) {
  const bars = spec.bars.slice(0, rows)
  const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1)
  return (
    <ul className="space-y-1">
      {bars.map((b) => (
        <li key={b.label} title={`${b.label}: ${b.value}${spec.unit}`} className="grid grid-cols-[1fr_auto] items-center gap-x-2 text-[10px]">
          <span className="truncate text-muted">{b.label}</span>
          <span className="tabular-nums">{b.value}{spec.unit}</span>
          <span className="col-span-2 h-1.5 rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: `${(Math.abs(b.value) / max) * 100}%`, background: MARK }} /></span>
        </li>
      ))}
    </ul>
  )
}

export function WidgetRail({ widgets, hot, onPin, onRemove, onFocus }: {
  widgets: Widget[]; hot: string | null; onPin: (id: string) => void; onRemove: (id: string) => void; onFocus: (id: string) => void
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
            className={`${w.leaving ? 'widget-out' : 'widget-in'} group relative cursor-pointer overflow-hidden rounded-2xl bg-white p-3.5 shadow-card ring-1 transition-shadow duration-500 ${hot === w.id ? 'ring-2 ring-brand' : 'ring-black/5'}`}>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] text-muted">
              {w.severity && <SeverityIcon severity={w.severity} size={10} />}
              <span className="truncate">{w.group}</span>
              {!w.pinned && <span className="flex items-center gap-0.5 text-brand"><Sparkles size={10} /> Gespräch</span>}
              <span className="ml-auto flex gap-0.5">
                {!w.pinned && <button onClick={(e) => { e.stopPropagation(); onPin(w.id) }} aria-label="Behalten" title="Behalten" className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-pill hover:text-ink"><Pin size={10} /></button>}
                {/* Also shown for an unpinned, agent-picked widget: without it there was no way to close one the agent kept re-suggesting. */}
                <button onClick={(e) => { e.stopPropagation(); onRemove(w.id) }} aria-label={w.pinned ? 'Lösen' : 'Ausblenden'} title={w.pinned ? 'Lösen' : 'Ausblenden'} className="flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-pill hover:text-ink group-hover:opacity-100"><X size={10} /></button>
              </span>
            </div>
            {w.main && <div className="text-[26px] leading-tight tabular-nums text-ink">{w.main}</div>}
            {w.chart && <div className="my-1.5">{w.chart.type === 'verlauf' ? <Spark spec={w.chart} /> : <Bars spec={w.chart} />}</div>}
            {w.text && <p className="line-clamp-2 text-[11px] leading-snug text-ink/80">{w.text}</p>}
            <p className="mt-1 truncate text-[9px] text-muted">{w.source}</p>
          </article>
        )
      })}
    </div>
  )
}
