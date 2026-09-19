import { AlertTriangle, Phone, Plus, Search, XCircle } from 'lucide-react'
import { useState } from 'react'
import type { Client } from '../types'
import { SeverityIcon } from '../cards/ui'
import { ClientUpload } from './ClientUpload'

const tabs = [['Kunden', 0], ['Neukunden', 6], ['Beratungen', 215], ['01 - Liquidität > 10%', 112], ['02 - Fälligkeiten', 0], ['03 - Letzte Beratung > 12 Monate', 191], ['04 - Regelverletzungen (dringend)', 28], ['05 - Geburtstage', 13]] as const
const columns = ['KundenNr.', 'Name', 'Kundenprofil', 'Anlass', 'Geburtstag', 'Letzte Profilierung', 'Letzte Beratung']

const PAGE_SIZE = 10

export function Dashboard({ clients, onUploaded }: { clients: Client[]; onUploaded: () => void }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const q = query.trim().toLowerCase()
  // Nothing pre-loaded: like an inbound call, the advisor only sees a client once they search for the name.
  const found = q ? clients.filter((c) => c.name.toLowerCase().includes(q) || c.ref.toLowerCase().includes(q)) : []
  const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const rows = found.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)

  return (
    <>
      <div className="flex shrink-0 items-center justify-between bg-band px-3 py-3">
        <div>
          <div className="text-[17px]">Willkommen zurück, Hans Muster</div>
          <div className="mt-1 text-[11px]">Pendente Beratungen: 215 <span className="mx-1 text-muted">|</span> Restriktionen <span className="mx-1 text-muted">|</span> Warnungen: 21</div>
        </div>
        <div className="text-[16px]">CHF 52'618'933.52</div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto p-2">
        <section className="bg-white p-4 shadow-card">
          <h2 className="mb-5 text-[16px]">Meine Kunden</h2>
          <div className="mb-5 flex items-center justify-between gap-4">
            <div className="flex flex-wrap gap-x-7 gap-y-2">
              {tabs.map(([label, count], i) => (
                <span key={label} className={`flex items-center gap-1.5 pb-1.5 text-xs ${i === 0 ? 'border-b-2 border-brand px-5 text-brand' : ''}`}>
                  {label}
                  <span className={`rounded-full px-1.5 text-[10px] text-white ${i === 0 ? 'bg-brand' : 'bg-ink'}`}>{i === 0 ? clients.length : count}</span>
                </span>
              ))}
              <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-pill"><Plus size={12} /></span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ClientUpload variant="box" onLoaded={() => { setQuery(''); setPage(0); onUploaded() }} />
              <label className="flex shrink-0 items-center border border-line text-xs focus-within:border-brand">
                <span className="border-r border-line p-1.5"><Search size={12} /></span>
                <input autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} placeholder="Name oder KundenNr. …" aria-label="Kunden suchen" className="w-48 px-2 py-1 outline-none" />
              </label>
            </div>
          </div>

          <table className="w-full text-xs">
            <thead>
              <tr className="border-b-2 border-ink/70 text-left">
                <th className="w-8 py-2 pl-3"><XCircle size={12} className="fill-ink text-white" /></th>
                <th className="w-8"><AlertTriangle size={12} className="fill-ink text-white" /></th>
                {columns.map((c, i) => <th key={c} className={`py-2 font-medium ${i > 3 ? 'text-right pr-3' : ''}`}>{c} <span className="text-muted">⇅</span></th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.ref} className={i % 2 ? 'bg-stripe' : ''}>
                  <td className="py-2.5 pl-3">{c.errors > 0 && <SeverityIcon severity="risk" size={12} />}</td>
                  <td>{c.warnings > 0 && <SeverityIcon severity="warn" size={12} />}</td>
                  <td>{c.ref}</td>
                  <td className="text-brand">{c.name}</td>
                  <td>{c.profile}</td>
                  <td>{c.context}</td>
                  <td className="pr-3 text-right">{c.birthday}</td>
                  <td className="pr-3 text-right">{c.lastProfiling}</td>
                  <td className="pr-3 text-right">{c.lastConsultation}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-muted">
                  {q ? (
                    <>Keine Kunden gefunden für «{query.trim()}».</>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Phone size={18} className="text-muted/60" />
                      <span>Kunde am Telefon? Namen oder KundenNr. oben eingeben, um die Akte zu öffnen.</span>
                    </div>
                  )}
                </td></tr>
              )}
            </tbody>
          </table>

          {q && (
            <div className="mt-5 flex items-center justify-center gap-3 text-xs text-muted">
              <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="enabled:hover:text-brand disabled:cursor-default disabled:opacity-50">« Vorherige</button>
              {Array.from({ length: pages }, (_, i) => (
                <button type="button" key={i} onClick={() => setPage(i)} aria-current={i === current ? 'page' : undefined} className={`rounded-sm px-2 py-0.5 ${i === current ? 'bg-brand text-white' : 'hover:bg-pill'}`}>{i + 1}</button>
              ))}
              <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="enabled:hover:text-brand disabled:cursor-default disabled:opacity-50">Nächste »</button>
              <span className="ml-2 tabular-nums">{found.length} {found.length === 1 ? 'Kunde' : 'Kunden'}</span>
            </div>
          )}
        </section>
      </main>
    </>
  )
}
