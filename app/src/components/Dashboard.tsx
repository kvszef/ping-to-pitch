import { ArrowDown, ArrowUp, ChevronRight, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Client } from '../types'
import { useLanguage } from '../data/useLanguage'
import { useTranslated } from '../data/useTranslate'
import { ClientUpload } from './ClientUpload'

// The client list: every client as one row that opens the client, with search, real filters and
// sorting. Every number on this page is counted from the loaded clients (nothing is made up), and
// open findings show as a quiet mark per client instead of red counters.

type SortKey = 'name' | 'aum' | 'last'
type Filter = 'all' | 'open' | 'overdue'

const amount = (aum: string) => { const n = Number(aum.replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : 0 }
const currencyOf = (aum: string) => aum.trim().split(/\s+/)[0] ?? ''
// "07.09.2026" -> sortable number; unknown dates sort last.
const day = (d: string) => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d.trim()); return m ? Number(m[3] + m[2] + m[1]) : 0 }
const thousands = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'")
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')

export function Dashboard({ clients, onUploaded, onOpen }: { clients: Client[]; onUploaded: () => void; onOpen?: (ref: string) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<{ key: SortKey; up: boolean }>({ key: 'name', up: true })
  const language = useLanguage()
  const [tTitle, tSearch, tNone, tAll, tOpen, tOverdue, tClient, tAssets, tStrategy, tLast, tFindings, tTotal, tNever, tOpenClient, tNoFindings] = useTranslated([
    'Meine Kunden', 'Name oder Kundennummer', 'Keine Kunden gefunden für', 'Alle', 'Mit offenen Punkten', 'Letzte Beratung über 12 Monate her',
    'Kunde', 'Vermögen', 'Strategie · Dienstleistung', 'Letzte Beratung', 'Offene Punkte', 'Gesamtvermögen', 'noch nie', 'Kunde öffnen', 'keine',
  ], language)

  // "Over 12 months" is measured against the newest consultation date in the data, never the wall clock (dates are shifted).
  const newest = useMemo(() => Math.max(0, ...clients.map((c) => day(c.lastConsultation))), [clients])
  const overdue = (c: Client) => { const d = day(c.lastConsultation); return !d || (newest > 0 && newest - d > 10000) }
  const counts = useMemo(() => ({ all: clients.length, open: clients.filter((c) => c.errors + c.warnings > 0).length, overdue: clients.filter(overdue).length }), [clients, newest]) // eslint-disable-line react-hooks/exhaustive-deps
  // One total only when every client is held in the same currency.
  const currencies = useMemo(() => [...new Set(clients.map((c) => currencyOf(c.aum)).filter((x) => /^[A-Z]{3}$/.test(x)))], [clients])
  const total = currencies.length === 1 ? clients.reduce((n, c) => n + amount(c.aum), 0) : 0

  const q = query.trim().toLowerCase()
  const rows = useMemo(() => {
    const kept = clients.filter((c) => (filter === 'open' ? c.errors + c.warnings > 0 : filter === 'overdue' ? overdue(c) : true) && (!q || c.name.toLowerCase().includes(q) || c.ref.toLowerCase().includes(q)))
    const by = sort.key === 'name' ? (a: Client, b: Client) => a.name.localeCompare(b.name, 'de') : sort.key === 'aum' ? (a: Client, b: Client) => amount(a.aum) - amount(b.aum) : (a: Client, b: Client) => day(a.lastConsultation) - day(b.lastConsultation)
    return [...kept].sort((a, b) => (sort.up ? by(a, b) : by(b, a)))
  }, [clients, filter, q, sort, newest]) // eslint-disable-line react-hooks/exhaustive-deps

  const GRID = 'grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.1fr)_minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,0.9fr)_1.25rem] items-center gap-x-4'
  const head = (key: SortKey, label: string, right = false) => (
    <button type="button" onClick={() => setSort((s) => (s.key === key ? { key, up: !s.up } : { key, up: key === 'name' }))}
      className={`flex items-center gap-1 text-[10px] uppercase tracking-wide hover:text-ink ${right ? 'justify-end' : ''} ${sort.key === key ? 'text-ink' : ''}`}>
      {label}{sort.key === key && (sort.up ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
    </button>
  )
  const chip = (id: Filter, label: string) => (
    <button type="button" key={id} onClick={() => setFilter(id)} aria-pressed={filter === id}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors ${filter === id ? 'bg-brand text-white' : 'bg-white/70 text-ink/70 hover:bg-brand-soft/60 hover:text-ink'}`}>
      {label}<span className={`tabular-nums text-[10px] ${filter === id ? 'text-white/80' : 'text-muted'}`}>{counts[id]}</span>
    </button>
  )

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top_left,rgba(89,151,237,0.28),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(105,212,214,0.22),transparent_55%)] p-3">
      <section className="mx-auto flex max-w-[1180px] flex-col rounded-2xl bg-white/55 shadow-[0_8px_32px_rgba(31,56,88,0.10)] ring-1 ring-white/70 backdrop-blur-xl">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-5 pb-3 pt-4">
          <div>
            <h2 className="text-[20px] leading-tight">{tTitle} <span className="ml-1 text-[13px] tabular-nums text-muted">{clients.length}</span></h2>
            {total > 0 && <p className="mt-0.5 text-[11px] text-muted">{tTotal} <span className="tabular-nums text-ink/80">{currencies[0]} {thousands(total)}</span></p>}
          </div>
          <div className="flex items-center gap-2">
            <ClientUpload variant="box" onLoaded={() => { setQuery(''); setFilter('all'); onUploaded() }} />
            <label className="flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-xs ring-1 ring-black/5 focus-within:ring-brand/50">
              <Search size={13} className="shrink-0 text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tSearch} aria-label={tSearch} className="w-44 bg-transparent outline-none placeholder:text-muted" />
            </label>
          </div>
        </header>

        <div className="flex flex-wrap gap-1.5 px-5 pb-3">{chip('all', tAll)}{chip('open', tOpen)}{chip('overdue', tOverdue)}</div>

        <div className={`${GRID} border-y border-line/60 px-5 py-2 text-muted`}>
          {head('name', tClient)}
          <div className="flex justify-end">{head('aum', tAssets, true)}</div>
          <span className="text-[10px] uppercase tracking-wide">{tStrategy}</span>
          {head('last', tLast)}
          <span className="text-[10px] uppercase tracking-wide">{tFindings}</span>
          <span />
        </div>

        <ul className="px-2 py-1.5">
          {rows.map((c) => (
            <li key={c.ref}>
              <button type="button" onClick={() => onOpen?.(c.ref)} title={tOpenClient}
                className={`${GRID} group w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/80 focus-visible:bg-white/80 focus-visible:outline-none`}>
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft/70 text-[11px] text-brand-dark">{initials(c.name)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] text-ink group-hover:text-brand-dark">{c.name}</span>
                    <span className="block truncate text-[11px] text-muted">{c.ref} · {c.profile}</span>
                  </span>
                </span>
                <span className="truncate text-right text-[13px] tabular-nums">{c.aum}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px]">{c.strategy}</span>
                  <span className="block truncate text-[11px] text-muted">{c.service}</span>
                </span>
                <span className={`truncate text-[12px] tabular-nums ${!day(c.lastConsultation) ? 'text-muted' : overdue(c) ? 'text-warn' : ''}`}>{day(c.lastConsultation) ? c.lastConsultation : tNever}</span>
                <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-muted">
                  {c.errors + c.warnings === 0 ? <span className="text-muted/70">{tNoFindings}</span> : <>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.errors ? 'bg-risk/80' : 'bg-warn/80'}`} />
                    {c.errors + c.warnings}
                  </>}
                </span>
                <ChevronRight size={14} className="text-muted/50 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="py-10 text-center text-xs text-muted">{q ? `${tNone} «${query.trim()}».` : '–'}</li>}
        </ul>
      </section>
    </main>
  )
}
