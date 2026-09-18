import { AlertTriangle, Briefcase, Menu, Plus, Search, Users, XCircle, Ban } from 'lucide-react'
import type { Client } from '../types'
import { SeverityIcon } from '../cards/ui'
import { SubBar } from './Chrome'

const tabs = [['Kunden', 0], ['Neukunden', 6], ['Beratungen', 215], ['01 - Liquidity > 10%', 112], ['02 - Maturities', 0], ['03 - Last Consultation > 12 Months', 191], ['04 - Rule Violations (urgent)', 28], ['05 - Birthdays', 13]] as const
const columns = ['KundenNr.', 'Name', 'Kundenprofil', 'Anlass', 'Geburtstag', 'Letzte Profilierung', 'Letzte Beratung']

export function Dashboard({ clients, onOpen }: { clients: Client[]; onOpen: (ref: string) => void }) {
  return (
    <>
      <SubBar title="Kundenberater-Dashboard" items={[
        { label: 'Beratermappe', icon: Briefcase },
        { label: 'Kundenliste', icon: Users, active: true },
        { label: 'Regelverletzungen', icon: Ban, badge: clients.reduce((n, c) => n + c.errors, 0), badgeTone: 'red' },
        { label: 'Warnungen', icon: AlertTriangle, badge: clients.reduce((n, c) => n + c.warnings, 0), badgeTone: 'red' },
        { label: '', icon: Menu },
      ]} />
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
            <label className="flex shrink-0 items-center border border-line text-xs">
              <span className="border-r border-line p-1.5"><Search size={12} /></span>
              <input placeholder="Suche" className="w-24 px-2 outline-none" />
            </label>
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
              {clients.map((c, i) => (
                <tr key={c.ref} onClick={() => onOpen(c.ref)} className={`cursor-pointer hover:bg-brand-soft/30 ${i % 2 ? 'bg-stripe' : ''}`}>
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
            </tbody>
          </table>

          <div className="mt-5 flex items-center justify-center gap-3 text-xs text-muted">
            « Vorherige <span className="rounded-sm bg-brand px-2 py-0.5 text-white">1</span> Nächste »
          </div>
        </section>
      </main>
    </>
  )
}
