import { CircleCheck, FileUp, LoaderCircle, TriangleAlert, X, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// "Fremddepot (PDF)": the advisor uploads a statement from another bank. The server reads it, builds a
// virtual portfolio labelled ex-custody and attaches it to the open client (POST /api/import/pdf?ref=…);
// the briefing then reloads with it. The parse report shows what was read and whether it adds up.

type Summary = { importId: string; nr: string; bank?: string; asOf?: string; currency?: string; value?: number; positions: number; reconciles?: boolean }
type Row = { name: string; isin?: string; currency: string; value: number; weight: number; assetClass: string; matchedBy: string }
type Report = {
  bank?: string; currency: string; asOf?: string; positions: number; matched: number; total: number; statedTotal?: number; difference?: number
  reconciles: boolean; rows: Row[]; issues: string[]; byMatch: Record<string, number>
}

const amount = (n: number | undefined) => (n === undefined ? '–' : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'"))
const share = (f: number) => `${(f * 100).toFixed(1)}%`
const day = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '')
const CLASS: Record<string, string> = { Shares: 'Aktien', Bonds: 'Obligationen', Liquidity: 'Liquidität', 'Real estate': 'Immobilien', 'Specialties andCommodities': 'Alternative Anlagen', 'Not classified': 'Nicht klassifiziert' }
const MATCH: Record<string, string> = { reference: 'Stammdaten', isin: 'ISIN, andere Währung', issuer: 'Emittent, geschätzt', statement: 'aus Auszug geschätzt', account: 'Konto' }

async function call(path: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(path, init)
    if (!(r.headers.get('content-type') ?? '').includes('json')) return null
    const data = (await r.json()) as Record<string, unknown>
    return r.ok ? data : { error: typeof data.error === 'string' ? data.error : 'Fehler' }
  } catch { return null }
}

export function ExCustodyUpload({ clientRef, onChanged }: { clientRef: string; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [open, setOpen] = useState(false)
  const [attached, setAttached] = useState<Summary[]>([])

  useEffect(() => {
    let stale = false
    void call(`/api/import/${encodeURIComponent(clientRef)}`).then((d) => {
      if (stale) return
      setAttached(Array.isArray(d?.portfolios) ? (d.portfolios as Summary[]) : [])
      setReport(null); setError(null); setOpen(false)
    })
    return () => { stale = true }
  }, [clientRef])

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError(null); setReport(null)
    const d = await call(`/api/import/pdf?ref=${encodeURIComponent(clientRef)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file })
    setBusy(false)
    if (!d) return setError('Import nicht erreichbar. Läuft der Server?')
    if (typeof d.error === 'string') return setError(d.error)
    const r = d.report as Report
    setReport(r)
    const a = d.attached as { portfolios?: Summary[]; warning?: string; error?: string } | undefined
    if (a?.portfolios) { setAttached(a.portfolios); onChanged() }
    if (a?.warning) setError(a.warning)
    if (!r.positions) setError('Keine Positionen erkannt, nichts übernommen.')
  }

  const remove = async (importId: string) => {
    const d = await call('/api/import/detach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: clientRef, importId }) })
    if (d && Array.isArray(d.portfolios)) { setAttached(d.portfolios as Summary[]); setReport(null); setOpen(false); onChanged() }
  }

  const Icon = busy ? LoaderCircle : FileUp
  return (
    <span className="relative flex flex-wrap items-center gap-2 text-xs">
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex shrink-0 items-center gap-1.5 rounded-sm bg-pill px-2.5 py-1 hover:bg-track" title="Vermögensausweis einer anderen Bank als PDF laden">
        <Icon size={13} className={busy ? 'animate-spin' : ''} /> Fremddepot (PDF)
      </button>
      <input ref={input} type="file" accept=".pdf,application/pdf" data-testid="excustody-file" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />

      {attached.map((p) => (
        <span key={p.importId} className="flex items-center gap-1.5 rounded-sm border border-dashed border-brand px-2 py-[3px] text-brand" title={`Vermögen bei ${p.bank ?? 'einer anderen Bank'}, aus dem Auszug${p.asOf ? ` vom ${day(p.asOf)}` : ''} übernommen`}>
          <span className="font-semibold">{p.nr} (ex-custody)</span>
          {p.bank && <span>· {p.bank}</span>}
          <span>· {p.currency ?? 'CHF'} {amount(p.value)}</span>
          <button type="button" aria-label={`${p.nr} entfernen`} onClick={() => void remove(p.importId)} className="ml-0.5 hover:text-risk"><X size={12} /></button>
        </span>
      ))}

      {report && (
        <button type="button" role="status" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 hover:underline">
          {report.reconciles ? <CircleCheck size={13} className="shrink-0 text-ok" /> : <TriangleAlert size={13} className="shrink-0 text-warn" />}
          {report.positions} Positionen gelesen, {report.matched} aus unseren Stammdaten,{' '}
          {report.reconciles ? `Summe stimmt (${report.currency} ${amount(report.statedTotal)})` : report.statedTotal === undefined ? 'keine Gesamtsumme zum Abgleich' : `Summe weicht um ${amount(report.difference)} ab`}
        </button>
      )}
      {error && <span role="alert" className="flex items-center gap-1 text-risk"><XCircle size={13} className="shrink-0" /> {error}</span>}

      {open && report && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-96 w-[640px] max-w-[90vw] overflow-auto rounded-sm border border-line bg-white p-3 text-[11px] text-ink shadow-lg">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold">Fremddepot (ex-custody){report.bank ? ` · ${report.bank}` : ''}{report.asOf ? ` · Stand ${day(report.asOf)}` : ''}</div>
              <div className="text-muted">Gelesen: {report.currency} {amount(report.total)} · auf dem Auszug: {report.statedTotal === undefined ? '–' : `${report.currency} ${amount(report.statedTotal)}`}</div>
            </div>
            <button type="button" aria-label="Schliessen" onClick={() => setOpen(false)} className="hover:text-risk"><X size={14} /></button>
          </div>
          {report.issues.length > 0 && <ul className="mb-2 list-disc pl-4 text-muted">{report.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-line text-left text-muted"><th className="py-1 pr-2 font-normal">Position</th><th className="pr-2 font-normal">Whg</th><th className="pr-2 text-right font-normal">Wert</th><th className="pr-2 text-right font-normal">Anteil</th><th className="pr-2 font-normal">Anlageklasse</th><th className="font-normal">Zuordnung</th></tr></thead>
            <tbody>
              {report.rows.map((r, i) => (
                <tr key={`${r.isin ?? r.name}-${i}`} className="border-b border-line/60">
                  <td className="py-1 pr-2">{r.name}{r.isin && <span className="block text-muted">{r.isin}</span>}</td>
                  <td className="pr-2">{r.currency}</td>
                  <td className="pr-2 text-right tabular-nums">{amount(r.value)}</td>
                  <td className="pr-2 text-right tabular-nums">{share(r.weight)}</td>
                  <td className="pr-2">{CLASS[r.assetClass] ?? r.assetClass}</td>
                  <td className={r.matchedBy === 'reference' || r.matchedBy === 'account' ? '' : 'italic text-muted'}>{MATCH[r.matchedBy] ?? r.matchedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </span>
  )
}
