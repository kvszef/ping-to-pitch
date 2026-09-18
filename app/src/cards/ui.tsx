import type { ReactNode } from 'react'
import type { Kind, Severity } from '../types'

export function Shell({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-white p-4 ${className}`}>
      {title && <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>}
      {children}
    </section>
  )
}

const kindStyle: Record<Kind, string> = {
  fact: 'bg-slate-100 text-slate-600',
  interpretation: 'bg-violet-100 text-violet-700',
  action: 'bg-emerald-100 text-emerald-700',
}

export function KindTag({ kind }: { kind: Kind }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${kindStyle[kind]}`}>{kind}</span>
}

export const toneText: Record<Severity, string> = {
  risk: 'text-risk',
  warn: 'text-warn',
  ok: 'text-ok',
  info: 'text-brand',
}

export const toneDot: Record<Severity, string> = {
  risk: 'bg-risk',
  warn: 'bg-warn',
  ok: 'bg-ok',
  info: 'bg-brand',
}

export function Source({ children }: { children: ReactNode }) {
  return <span className="text-[11px] text-muted">· {children}</span>
}
