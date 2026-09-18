import { ArrowLeft, ChevronDown, FileUp, Phone, PhoneOff, Sparkles } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TopBar } from '../components/Chrome'
import { clientsFromFile, loadBriefing, loadClients, loadStatus, type Block, type BriefingResponse, type ClientOption, type Finding, type Line, type Phrase } from './api'

// The 60-second briefing (PLAN.md section 2) as a reading feed: one column, large type, read top to
// bottom. The advisor is fed, never searches. Sources open inline under a line, on demand.

type Step = { key: Block; label: string; accent: string }
const STEPS: Step[] = [
  { key: 'open', label: 'Sagen Sie', accent: 'bg-brand' },
  { key: 'mention', label: 'Unbedingt ansprechen', accent: 'bg-risk' },
  { key: 'ask', label: 'Nachfragen', accent: 'bg-warn' },
  { key: 'avoid', label: 'Nicht ansprechen', accent: 'bg-muted' },
]

const READ_WPM = 180
const money = (v: number) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'")
const date = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso)
const words = (t: string) => t.split(/\s+/).filter(Boolean).length
const cleanTitle = (t: string) => t.replace(/^[A-Z]+-\d+(?:-\d+)?: /, '')

// "Wunsch …, Portfolio hält 3.3% Energie. Kleinste Lösung: …" → headline + rest
function split(text: string): [string, string] {
  const i = text.search(/[.;] (?=[A-ZÄÖÜ«])/)
  return i > 20 ? [text.slice(0, i + 1), text.slice(i + 2)] : [text, '']
}

// Numbers, amounts and arrows are what the advisor must catch at a glance.
function Emph({ text }: { text: string }) {
  const parts = text.split(/((?:CHF|USD|EUR)\s[\d']+|[+−-]?\d+(?:[.,]\d+)?\s?(?:%|Pp\.)|→)/g)
  return <>{parts.map((p, i) => (i % 2 ? <strong key={i} className="font-semibold text-ink">{p}</strong> : <Fragment key={i}>{p}</Fragment>))}</>
}

export function BriefingPage() {
  const [options, setOptions] = useState<ClientOption[]>([])
  const [ref, setRef] = useState(() => decodeURIComponent(location.hash.slice(1)) || 'CASE-004')
  const [phrase, setPhrase] = useState<Phrase>('vorlage')
  const [status, setStatus] = useState({ openai: false, apertus: false })
  const [data, setData] = useState<BriefingResponse | null>(null)
  const [loading, setLoading] = useState<'vorlage' | 'ki' | null>('vorlage')
  const [error, setError] = useState<string | null>(null)
  const [callStart, setCallStart] = useState<number | null>(null)

  useEffect(() => { void loadClients().then(setOptions).catch((e: Error) => setError(e.message)); void loadStatus().then(setStatus) }, [])
  useEffect(() => {
    const onHash = () => { const r = decodeURIComponent(location.hash.slice(1)); if (r) setRef(r) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const option = options.find((o) => o.ref === ref)

  const load = useCallback(async (o: ClientOption, p: Phrase) => {
    setError(null); setLoading('vorlage'); setCallStart(null)
    try {
      setData(await loadBriefing(o, 'vorlage'))
      if (p !== 'vorlage') { setLoading('ki'); setData(await loadBriefing(o, p)) }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(null)
    }
  }, [])
  useEffect(() => { if (option) { history.replaceState(null, '', `#${option.ref}`); void load(option, phrase) } }, [option, phrase, load])

  const onFile = async (file: File) => {
    try {
      const fresh = clientsFromFile(await file.text())
      if (!fresh.length) throw new Error('Die Datei enthält keine Kunden mit ClientRef.')
      setOptions((prev) => [...fresh, ...prev.filter((p) => !fresh.some((f) => f.ref === p.ref))])
      setRef(fresh[0].ref)
    } catch (e) {
      setError(`Datei nicht lesbar: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const findings = useMemo(() => new Map((data?.findings ?? []).map((f) => [f.id, f])), [data])
  const b = data?.briefing

  // During a simulated call the feed walks through the four steps, each for its own reading time.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!callStart) return
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [callStart])
  const elapsed = callStart ? (now - callStart) / 1000 : 0
  const slots = useMemo(() => {
    if (!b) return []
    let t = 0
    return STEPS.map((s) => { const len = Math.max(4, (b.blocks[s.key].reduce((n, l) => n + words(l.text), 0) / READ_WPM) * 60); const slot = { key: s.key, from: t, to: t + len }; t += len; return slot })
  }, [b])
  const active = callStart ? (slots.find((s) => elapsed < s.to)?.key ?? null) : null
  const refs = useRef<Partial<Record<Block, HTMLElement | null>>>({})
  useEffect(() => { if (active) refs.current[active]?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [active])

  return (
    <div className="flex h-full flex-col bg-[#f4f5f7]">
      <TopBar />
      <div className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-white px-4 text-[13px]">
        <a href="/" className="flex items-center gap-1 text-muted hover:text-brand"><ArrowLeft size={15} /> Arbeitsplatz</a>
        <label className="relative flex items-center">
          <select value={ref} onChange={(e) => setRef(e.target.value)} className="appearance-none rounded border border-line bg-white py-1 pl-2.5 pr-8">
            {!option && <option value={ref}>{ref}</option>}
            {options.map((o) => <option key={o.ref} value={o.ref}>{o.name} · {o.ref}{o.raw ? ' · Datei' : ''}</option>)}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2" />
        </label>
        <label className="flex cursor-pointer items-center gap-1 text-muted hover:text-brand">
          <FileUp size={15} /> Kundendatei
          <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
        </label>
        <div className="ml-auto flex items-center gap-1">
          {(['vorlage', 'openai', 'apertus'] as Phrase[]).map((p) => (
            <button key={p} onClick={() => setPhrase(p)} disabled={p !== 'vorlage' && !status[p]} title={p !== 'vorlage' && !status[p] ? 'Kein Schlüssel in .env.local' : undefined}
              className={`rounded px-2.5 py-1 ${phrase === p ? 'bg-brand text-white' : 'text-muted hover:bg-stripe'} disabled:cursor-not-allowed disabled:opacity-40`}>
              {p === 'vorlage' ? 'Ohne KI' : p === 'openai' ? 'KI: OpenAI' : 'KI: Apertus'}
            </button>
          ))}
          <button onClick={() => setCallStart((s) => (s ? null : Date.now()))} className={`ml-3 flex items-center gap-1.5 rounded px-3 py-1 font-medium text-white ${callStart ? 'bg-risk' : 'bg-ok'}`}>
            {callStart ? <><PhoneOff size={15} /> Beenden</> : <><Phone size={15} /> Anruf starten</>}
          </button>
        </div>
      </div>

      {b && (
        <div className="h-1 shrink-0 bg-track/50">
          <div className="h-full bg-brand transition-[width] duration-300" style={{ width: `${callStart ? Math.min(100, (elapsed / b.budget) * 100) : 0}%` }} />
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[780px] px-6 pb-24 pt-8">
          {error && <p className="mb-6 rounded border-l-4 border-risk bg-white px-4 py-3 text-[15px]">{error}</p>}
          {!b && !error && <Loading />}

          {b && data && (
            <>
              <header className="mb-8">
                <h1 className="text-[30px] font-light leading-tight">{data.client.name}</h1>
                <p className="mt-1 text-[15px] text-muted">
                  {data.client.profile} · {data.client.currency} {money(data.client.aum)}{data.client.strategy ? ` · ${data.client.strategy}` : ''} · Lesezeit {b.seconds} Sekunden
                  {loading === 'ki' && <span className="ml-2 inline-flex items-center gap-1 text-brand"><Sparkles size={14} className="animate-pulse" /> KI formuliert …</span>}
                  {loading !== 'ki' && b.phrasedBy !== 'vorlage' && <span className="ml-2 inline-flex items-center gap-1 text-brand"><Sparkles size={14} /> KI-formuliert, alle Zahlen geprüft</span>}
                </p>
                {data.llmError && <p className="mt-1 text-[13px] text-risk">{data.llmError}</p>}
              </header>

              {b.reasons[0] && (
                <section className="mb-8 rounded-lg bg-white px-6 py-5 shadow-card">
                  <div className="text-[12px] font-medium uppercase tracking-wider text-muted">Worum es vermutlich geht</div>
                  <p className="mt-1.5 text-[22px] leading-snug"><Emph text={b.reasons[0].text} /></p>
                  {b.reasons.length > 1 && <p className="mt-2 text-[15px] text-muted">oder: {b.reasons.slice(1).map((r) => r.text).join(' · ')}</p>}
                  {b.persona && (
                    <p className="mt-4 border-t border-line pt-3 text-[15px] leading-relaxed">
                      <span className="text-muted">Der Kunde: </span>{b.persona.text}
                      {b.persona.tone.length > 0 && <span className="ml-1 font-medium text-brand-dark">→ {b.persona.tone.join(', ')}</span>}
                    </p>
                  )}
                </section>
              )}

              {STEPS.map((step, i) => {
                const lines = b.blocks[step.key]
                if (!lines.length) return null
                const dim = active && active !== step.key
                return (
                  <section key={step.key} ref={(el) => { refs.current[step.key] = el }} className={`relative mb-8 pl-6 transition-opacity duration-500 ${dim ? 'opacity-30' : ''}`}>
                    <span className={`absolute left-0 top-1 h-[calc(100%-4px)] w-1 rounded-full ${step.accent} ${active === step.key ? '' : 'opacity-60'}`} />
                    <div className="mb-3 flex items-baseline gap-2 text-[13px] font-semibold uppercase tracking-wider text-muted">
                      <span>{i + 1}</span><span>{step.label}</span>
                    </div>
                    {step.key === 'open'
                      ? <p className="text-[26px] font-light leading-snug">«{lines[0].text}»</p>
                      : <ul className="space-y-5">{lines.map((l) => <FeedLine key={l.id} line={l} findings={findings} />)}</ul>}
                  </section>
                )
              })}

              {b.questions.length > 0 && (
                <section className="mb-8 mt-12">
                  <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-muted">Wenn der Kunde fragt</h2>
                  <div className="space-y-3">
                    {b.questions.map((q) => (
                      <div key={q.id} className="rounded-lg bg-white px-5 py-4 shadow-card">
                        <p className="text-[17px] font-medium">«{q.q}»</p>
                        <p className="mt-1 text-[16px] leading-relaxed text-ink/85"><Emph text={q.a} /></p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="mb-8">
                <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-muted">Nach dem Anruf</h2>
                <ol className="space-y-3">
                  {b.actions.map((a, i) => (
                    <li key={a.id} className="flex gap-3 text-[17px] leading-snug">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ok/15 text-[13px] font-semibold text-ok">{i + 1}</span>
                      <span><Emph text={a.text} /></span>
                    </li>
                  ))}
                </ol>
              </section>

              {b.rejected.length > 0 && (
                <p className="mb-8 text-[13px] text-muted">
                  {b.rejected.length} KI-Formulierung{b.rejected.length > 1 ? 'en' : ''} verworfen, weil sie Zahlen enthielt{b.rejected.length > 1 ? 'en' : ''}, die nicht in den Daten stehen ({b.rejected.flatMap((r) => r.numbers).join(', ')}). Dort steht die geprüfte Vorlage.
                </p>
              )}

              <AllFindings findings={data.findings} origin={data.origin} />
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function FeedLine({ line, findings }: { line: Line; findings: Map<string, Finding> }) {
  const [open, setOpen] = useState(false)
  const [head, rest] = split(line.text)
  const sources = line.findings.map((id) => findings.get(id)).filter((f): f is Finding => !!f)
  return (
    <li>
      <p className="text-[19px] leading-snug"><Emph text={head} /></p>
      {rest && <p className="mt-1 text-[16px] leading-relaxed text-ink/75"><Emph text={rest} /></p>}
      {sources.length > 0 && (
        <button onClick={() => setOpen((v) => !v)} className="mt-0.5 text-[12px] text-muted/70 hover:text-brand">{open ? 'Quelle ausblenden' : 'Quelle'}</button>
      )}
      {open && <div className="mt-2 space-y-2">{sources.slice(0, 4).map((f) => <Source key={f.id} f={f} />)}</div>}
    </li>
  )
}

const KIND: Record<Finding['kind'], string> = { fact: 'Fakt', interpretation: 'Einschätzung', action: 'Massnahme' }

function Source({ f }: { f: Finding }) {
  return (
    <div className="rounded-md border border-line bg-white px-4 py-3 text-[14px] leading-relaxed">
      <div className="font-medium">{cleanTitle(f.title)} <span className="ml-1 text-[12px] font-normal text-muted">{KIND[f.kind]}</span></div>
      {f.detail && <div className="text-ink/80">{f.detail}</div>}
      {f.evidence.slice(0, 4).map((e, i) => (
        <div key={i} className="mt-1 text-ink/70">
          <span className="text-muted">{e.source}{e.date ? `, ${date(e.date)}` : ''}:</span> {e.quote ? `«${e.quote}»` : e.ref}
        </div>
      ))}
    </div>
  )
}

function AllFindings({ findings, origin }: { findings: Finding[]; origin: BriefingResponse['origin'] }) {
  const order = { risk: 0, warn: 1, info: 2, ok: 3 }
  const dot = { risk: 'bg-risk', warn: 'bg-warn', info: 'bg-muted/50', ok: 'bg-ok' }
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity])
  return (
    <details className="mt-12 rounded-lg bg-white px-5 py-4 shadow-card">
      <summary className="cursor-pointer text-[15px] text-muted">Alle {findings.length} Befunde aus den Daten ansehen</summary>
      <ul className="mt-3 space-y-2">
        {sorted.map((f) => (
          <li key={f.id} className="flex gap-2.5 text-[14px] leading-snug">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[f.severity]}`} />
            <span>{cleanTitle(f.title)}{f.detail ? <span className="text-muted"> – {f.detail}</span> : null}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-muted">Aus der Engine: {origin.engine.join(', ') || '–'}. Übergangslösung bis zur Engine: {origin.stopgap.join(', ') || '–'}.</p>
    </details>
  )
}

function Loading(): ReactNode {
  return (
    <div className="space-y-6">
      {[40, 90, 75, 60].map((w, i) => <div key={i} className="skeleton h-6 rounded" style={{ width: `${w}%` }} />)}
    </div>
  )
}
