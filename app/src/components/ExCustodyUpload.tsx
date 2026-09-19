import { CircleCheck, FileUp, LoaderCircle, TriangleAlert, X, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { pick as inLang } from '../../engine/lang.ts'
import { tr } from '../data/i18n-static'
import { withLang } from '../data/uiLang'
import { useLanguage } from '../data/useLanguage'

// "Fremddepot (PDF)": the advisor uploads a statement from another bank. The server reads it, builds a
// virtual portfolio labelled ex-custody and attaches it to the open client (POST /api/import/pdf?ref=…);
// the briefing then reloads with it. The parse report shows what was read and whether it adds up.
// Every request names the advisor's language, so the server's report and warnings come back in it.

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
// The data's own class names are English already; only the odd one is tidied.
const CLASS_EN: Record<string, string> = { 'Specialties andCommodities': 'Alternative investments' }
const MATCH: Record<string, string> = { reference: 'Stammdaten', isin: 'ISIN, andere Währung', issuer: 'Emittent, geschätzt', statement: 'aus Auszug geschätzt', account: 'Konto' }

async function call(path: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(path, init)
    if (!(r.headers.get('content-type') ?? '').includes('json')) return null
    const data = (await r.json()) as Record<string, unknown>
    return r.ok ? data : { error: typeof data.error === 'string' ? data.error : 'Error' }
  } catch { return null }
}

export function ExCustodyUpload({ clientRef, onChanged }: { clientRef: string; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [open, setOpen] = useState(false)
  const [attached, setAttached] = useState<Summary[]>([])
  const language = useLanguage()
  const t = inLang(language)

  useEffect(() => {
    let stale = false
    void call(withLang(`/api/import/${encodeURIComponent(clientRef)}`, language)).then((d) => {
      if (stale) return
      setAttached(Array.isArray(d?.portfolios) ? (d.portfolios as Summary[]) : [])
      setReport(null); setError(null); setOpen(false)
    })
    return () => { stale = true }
  }, [clientRef, language])

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError(null); setReport(null)
    const d = await call(withLang(`/api/import/pdf?ref=${encodeURIComponent(clientRef)}`, language), { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file })
    setBusy(false)
    if (!d) return setError(t('Import nicht erreichbar. Läuft der Server?', 'Import not reachable. Is the server running?'))
    if (typeof d.error === 'string') return setError(d.error)
    const r = d.report as Report
    setReport(r)
    const a = d.attached as { portfolios?: Summary[]; warning?: string; error?: string } | undefined
    if (a?.portfolios) { setAttached(a.portfolios); onChanged() }
    if (a?.warning) setError(a.warning)
    if (!r.positions) setError(t('Keine Positionen erkannt, nichts übernommen.', 'No positions recognised, nothing taken over.'))
  }

  const remove = async (importId: string) => {
    const d = await call('/api/import/detach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: clientRef, importId, language }) })
    if (d && Array.isArray(d.portfolios)) { setAttached(d.portfolios as Summary[]); setReport(null); setOpen(false); onChanged() }
  }

  const Icon = busy ? LoaderCircle : FileUp
  return (
    <span className="relative flex flex-wrap items-center gap-2 text-xs">
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex shrink-0 items-center gap-1.5 rounded-sm bg-pill px-2.5 py-1 hover:bg-track" title={t('Vermögensausweis einer anderen Bank als PDF laden', 'Load a statement of assets from another bank as a PDF')}>
        <Icon size={13} className={busy ? 'animate-spin' : ''} /> {t('Fremddepot (PDF)', 'External custody account (PDF)')}
      </button>
      <input ref={input} type="file" accept=".pdf,application/pdf" data-testid="excustody-file" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />

      {attached.map((p) => (
        <span key={p.importId} className="flex items-center gap-1.5 rounded-sm border border-dashed border-brand px-2 py-[3px] text-brand" title={t(`Vermögen bei ${p.bank ?? 'einer anderen Bank'}, aus dem Auszug${p.asOf ? ` vom ${day(p.asOf)}` : ''} übernommen`, `Assets at ${p.bank ?? 'another bank'}, taken from the statement${p.asOf ? ` of ${day(p.asOf)}` : ''}`)}>
          <span className="font-semibold">{p.nr} (ex-custody)</span>
          {p.bank && <span>· {p.bank}</span>}
          <span>· {p.currency ?? 'CHF'} {amount(p.value)}</span>
          <button type="button" aria-label={t(`${p.nr} entfernen`, `Remove ${p.nr}`)} onClick={() => void remove(p.importId)} className="ml-0.5 hover:text-risk"><X size={12} /></button>
        </span>
      ))}

      {report && (
        <button type="button" role="status" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 hover:underline">
          {report.reconciles ? <CircleCheck size={13} className="shrink-0 text-ok" /> : <TriangleAlert size={13} className="shrink-0 text-warn" />}
          {t(`${report.positions} Positionen gelesen, ${report.matched} aus unseren Stammdaten,`, `${report.positions} positions read, ${report.matched} from our master data,`)}{' '}
          {report.reconciles ? t(`Summe stimmt (${report.currency} ${amount(report.statedTotal)})`, `total adds up (${report.currency} ${amount(report.statedTotal)})`) : report.statedTotal === undefined ? t('keine Gesamtsumme zum Abgleich', 'no total to reconcile against') : t(`Summe weicht um ${amount(report.difference)} ab`, `total is off by ${amount(report.difference)}`)}
        </button>
      )}
      {error && <span role="alert" className="flex items-center gap-1 text-risk"><XCircle size={13} className="shrink-0" /> {error}</span>}

      {open && report && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-96 w-[640px] max-w-[90vw] overflow-auto rounded-sm border border-line bg-white p-3 text-[11px] text-ink shadow-lg">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold">{t('Fremddepot (ex-custody)', 'External custody account (ex-custody)')}{report.bank ? ` · ${report.bank}` : ''}{report.asOf ? ` · ${t('Stand', 'as of')} ${day(report.asOf)}` : ''}</div>
              <div className="text-muted">{t('Gelesen:', 'Read:')} {report.currency} {amount(report.total)} · {t('auf dem Auszug:', 'on the statement:')} {report.statedTotal === undefined ? '–' : `${report.currency} ${amount(report.statedTotal)}`}</div>
            </div>
            <button type="button" aria-label={t('Schliessen', 'Close')} onClick={() => setOpen(false)} className="hover:text-risk"><X size={14} /></button>
          </div>
          {report.issues.length > 0 && <ul className="mb-2 list-disc pl-4 text-muted">{report.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-line text-left text-muted"><th className="py-1 pr-2 font-normal">Position</th><th className="pr-2 font-normal">{t('Whg', 'Ccy')}</th><th className="pr-2 text-right font-normal">{t('Wert', 'Value')}</th><th className="pr-2 text-right font-normal">{t('Anteil', 'Share')}</th><th className="pr-2 font-normal">{t('Anlageklasse', 'Asset class')}</th><th className="font-normal">{t('Zuordnung', 'Matched by')}</th></tr></thead>
            <tbody>
              {report.rows.map((r, i) => (
                <tr key={`${r.isin ?? r.name}-${i}`} className="border-b border-line/60">
                  <td className="py-1 pr-2">{r.name}{r.isin && <span className="block text-muted">{r.isin}</span>}</td>
                  <td className="pr-2">{r.currency}</td>
                  <td className="pr-2 text-right tabular-nums">{amount(r.value)}</td>
                  <td className="pr-2 text-right tabular-nums">{share(r.weight)}</td>
                  <td className="pr-2">{language === 'de' ? CLASS[r.assetClass] ?? r.assetClass : CLASS_EN[r.assetClass] ?? r.assetClass}</td>
                  <td className={r.matchedBy === 'reference' || r.matchedBy === 'account' ? '' : 'italic text-muted'}>{tr(MATCH[r.matchedBy] ?? r.matchedBy, language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </span>
  )
}
