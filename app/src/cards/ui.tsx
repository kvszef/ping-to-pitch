import { AlertTriangle, CircleCheck, Info, XCircle, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Kind, Severity } from '../types'

export function Panel({ title, icon: Icon, children, className = '' }: { title?: string; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <section className={`bg-white p-5 shadow-card ${className}`}>
      {title && (
        <h3 className="mb-3 flex items-center gap-1.5 text-[15px]">
          {Icon && <Icon size={16} strokeWidth={1.5} />} {title}
        </h3>
      )}
      {children}
    </section>
  )
}

const kindStyle: Record<Kind, string> = {
  fact: 'bg-pill/50 text-ink',
  interpretation: 'bg-brand-soft/60 text-brand-dark',
  action: 'bg-teal/30 text-ink',
}

export function KindTag({ kind }: { kind: Kind }) {
  return <span className={`mr-1 px-1.5 py-px text-[10px] uppercase tracking-wide ${kindStyle[kind]}`}>{kind}</span>
}

export const toneText: Record<Severity, string> = {
  risk: 'text-risk',
  warn: 'text-ink',
  ok: 'text-ok',
  info: 'text-brand',
}

export function SeverityIcon({ severity, size = 14 }: { severity: Severity; size?: number }) {
  if (severity === 'risk') return <XCircle size={size} className="shrink-0 fill-risk text-white" />
  if (severity === 'warn') return <AlertTriangle size={size} className="shrink-0 fill-warn text-white" />
  if (severity === 'ok') return <CircleCheck size={size} className="shrink-0 fill-ok text-white" />
  return <Info size={size} className="shrink-0 fill-brand text-white" />
}

export function Source({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap text-[11px] text-muted">· {children}</span>
}
