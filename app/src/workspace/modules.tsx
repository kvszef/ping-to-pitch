import { AlertTriangle } from 'lucide-react'
import { useState, type ComponentType } from 'react'
import type { Detail, ModuleOf, ModuleSpec } from './types'

// Grafikmodule, die das LLM bei ausreichender Konfidenz aktiviert. Neues Modul: Variante in
// types.ts ergänzen, Komponente hier anlegen, eine Zeile im Register.

const MARK = '#3f7fd9'
const fmt = (n: number) => n.toLocaleString('de-CH', { maximumFractionDigits: 1 })

function Frame({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <figure className="mt-2 border border-line bg-white p-3">
      <figcaption className="mb-2 text-xs font-medium">{title}</figcaption>
      {children}
      <p className="mt-2 text-[11px] leading-snug text-muted">{note}</p>
    </figure>
  )
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="mt-2 w-full text-[11px]">
      <thead><tr className="border-b border-line text-left">{head.map((h, i) => <th key={h} className={`py-1 font-medium ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className={i % 2 ? 'bg-stripe' : ''}>{r.map((c, j) => <td key={j} className={`py-1 ${j ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr>)}</tbody>
    </table>
  )
}

function Balken({ spec, detail }: { spec: ModuleOf<'balken'>; detail: Detail }) {
  const scale = Math.max(...spec.bars.map((b) => Math.max(b.value, b.max ?? 0)), 1) * 1.08
  return (
    <Frame title={spec.title} note={spec.note}>
      <div className="space-y-2">
        {spec.bars.map((b) => {
          const out = (b.min !== undefined && b.value < b.min) || (b.max !== undefined && b.value > b.max)
          return (
            <div key={b.label} className="group grid grid-cols-[88px_1fr_64px] items-center gap-2 text-[11px]" title={`${b.label}: ${fmt(b.value)}${spec.unit}${b.max !== undefined ? ` · Band ${fmt(b.min ?? 0)}–${fmt(b.max)}${spec.unit}` : ''}`}>
              <span className="truncate">{b.label}</span>
              <div className="relative h-3">
                {b.max !== undefined && <div className="absolute inset-y-0 rounded-sm bg-track/60" style={{ left: `${((b.min ?? 0) / scale) * 100}%`, width: `${((b.max - (b.min ?? 0)) / scale) * 100}%` }} />}
                <div className="absolute inset-y-[3px] left-0 rounded-r-[4px] transition-[width] duration-700 ease-out group-hover:brightness-90" style={{ width: `${(b.value / scale) * 100}%`, background: MARK }} />
              </div>
              <span className="flex items-center justify-end gap-1 tabular-nums">{out && <AlertTriangle size={11} className="fill-warn text-ink" aria-label="ausserhalb des Bands" />}{fmt(b.value)}{spec.unit}</span>
            </div>
          )
        })}
      </div>
      {spec.bars.some((b) => b.max !== undefined) && <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted"><span className="h-2 w-4 rounded-sm bg-track/60" /> Mandatsband <AlertTriangle size={10} className="ml-2 fill-warn text-ink" /> ausserhalb des Bands</div>}
      {detail === 'detailliert' && <DataTable head={['', 'Ist', 'Min.', 'Max.']} rows={spec.bars.map((b) => [b.label, `${fmt(b.value)}${spec.unit}`, b.min !== undefined ? `${fmt(b.min)}${spec.unit}` : '–', b.max !== undefined ? `${fmt(b.max)}${spec.unit}` : '–'])} />}
    </Frame>
  )
}

function Verlauf({ spec, detail }: { spec: ModuleOf<'verlauf'>; detail: Detail }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 320, H = 110, px = 6, py = 12
  const vals = spec.points.map((p) => p.value)
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1
  const x = (i: number) => px + (i / (vals.length - 1)) * (W - 2 * px)
  const y = (v: number) => py + (1 - (v - lo) / span) * (H - 2 * py)
  const path = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = vals.length - 1
  const shown = hover ?? last
  const change = ((vals[last] - vals[0]) / vals[0]) * 100

  return (
    <Frame title={spec.title} note={spec.note}>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="tabular-nums"><span className="text-[15px]">{fmt(vals[shown])}</span> {spec.unit} <span className="text-muted">· {spec.points[shown].label}</span></span>
        <span className="tabular-nums text-muted">12 Monate: {change >= 0 ? '+' : ''}{fmt(change)}%</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={spec.title}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(last, Math.round(((e.clientX - r.left) / r.width * W - px) / (W - 2 * px) * last)))) }}>
        <line x1={px} x2={W - px} y1={H - py} y2={H - py} stroke="#dcdcdc" />
        <path d={`${path} L${x(last)},${H - py} L${x(0)},${H - py} Z`} fill={MARK} opacity="0.1" />
        <path d={path} fill="none" stroke={MARK} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={py / 2} y2={H - py} stroke="#6f6f6f" strokeDasharray="2 2" />}
        <circle cx={x(shown)} cy={y(vals[shown])} r="4" fill={MARK} stroke="#fff" strokeWidth="2" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted"><span>{spec.points[0].label}</span><span>{spec.points[last].label}</span></div>
      {detail === 'detailliert' && <DataTable head={['Monat', spec.unit]} rows={spec.points.map((p) => [p.label, fmt(p.value)])} />}
    </Frame>
  )
}

const registry: { [T in ModuleSpec['type']]: ComponentType<{ spec: ModuleOf<T>; detail: Detail }> } = { balken: Balken, verlauf: Verlauf }

export function ModuleView({ spec, detail }: { spec: ModuleSpec; detail: Detail }) {
  const Component = registry[spec.type] as ComponentType<{ spec: ModuleSpec; detail: Detail }>
  return <Component spec={spec} detail={detail} />
}
