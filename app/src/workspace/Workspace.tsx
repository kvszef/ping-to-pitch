import { Activity, ArrowRight, BarChart3, Headset, MessageSquare, Mic, MicOff, Phone, PhoneCall, PhoneOff, Settings as SettingsIcon, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SeverityIcon, Source } from '../cards/ui'
import { Pill } from '../components/Chrome'
import { topics as topicData, transcripts } from '../data/workspace'
import type { Client, Signal } from '../types'
import { answer, detectTopics, hintFor, openingHints, question } from './brain'
import { LiveIsland } from './CallIsland'
import { ModuleView } from './modules'
import { SettingsPanel } from './SettingsPanel'
import { useSettings } from './settings'
import type { ChatEntry, Hint, Origin, Slot, Topic, TranscriptLine } from './types'

type Props = {
  clients: Client[]
  signals: Signal[]
  initialRef?: string
  initialCall?: boolean
  onSimulateCall: () => void
  onOpenBriefing: (ref: string) => void
}

type PaneId = 'assistent' | 'chat'
const originLabel: Record<Origin, string> = { gespraech: 'Aus dem Gespräch', chat: 'Aus dem Berater-Chat', kundendaten: 'Aus den Kundendaten' }
const rank = { risk: 0, warn: 1, info: 2, ok: 3 }

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null }
const SpeechRecognitionCtor = (window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition

export function Workspace({ clients, signals, initialRef, initialCall, onSimulateCall, onOpenBriefing }: Props) {
  const [settings, update] = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ref, setRef] = useState(initialRef ?? clients[0].ref)
  const [inCall, setInCall] = useState(!!initialCall)
  const [mic, setMic] = useState(false)
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [hints, setHints] = useState<Hint[]>([])
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [hovered, setHovered] = useState<PaneId | null>(null)
  const client = clients.find((c) => c.ref === ref) ?? clients[0]
  const [customerSlot, setCustomerSlot] = useState<Slot | null>(null)
  const [advisorSlot, setAdvisorSlot] = useState<Slot | null>(null)

  const addHints = (found: Topic[], origin: Origin, trigger: string) =>
    setHints((h) => [...found.map((t) => hintFor(t, origin, trigger)), ...h.filter((x) => !found.some((t) => t.id === x.topicId))])

  // Gesprochenes fliesst in beide Module: Hinweis für den Kunden, Einblick für den Berater.
  const hear = async (line: TranscriptLine) => {
    setLines((l) => [...l, line])
    const found = detectTopics(client.ref, line.text)
    if (!found.length) return
    // Zwei getrennte Spuren: Aussagen des Kunden führen zu einer Antwort, Aussagen des Beraters zum nächsten Schritt.
    if (line.speaker === 'Berater') return setAdvisorSlot({ heard: line.text, text: found[0].next, topic: found[0].id })
    setCustomerSlot({ heard: line.text, text: found[0].say, topic: found[0].id })
    addHints(found, 'gespraech', `Kunde: «${line.text}»`)
    const { entry } = await answer(client, line.text, settings, 'gespraech')
    setChat((c) => (c.some((e) => e.role === 'ki' && e.text === (entry as { text: string }).text) ? c : [...c, entry]))
  }
  const hearRef = useRef(hear)
  hearRef.current = hear

  useEffect(() => {
    setLines([]); setChat([]); setHints(openingHints(client)); setMic(false); setCustomerSlot(null); setAdvisorSlot(null)
  }, [client.ref]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!inCall || !settings.record || mic) return
    const script = transcripts[client.ref] ?? []
    let i = 0
    const timer = setInterval(() => {
      if (i >= script.length) return clearInterval(timer)
      hearRef.current(script[i++])
    }, 4500)
    return () => clearInterval(timer)
  }, [inCall, settings.record, mic, client.ref])

  useEffect(() => {
    if (!mic || !inCall || !settings.record || !SpeechRecognitionCtor) return
    const rec = new (SpeechRecognitionCtor as new () => Recognition)()
    rec.lang = 'de-CH'; rec.continuous = true; rec.interimResults = false
    rec.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) hearRef.current({ speaker: 'Kunde', text: e.results[i][0].transcript.trim() }) }
    rec.onend = () => setMic(false)
    rec.start()
    return () => { rec.onend = null; rec.stop() }
  }, [mic, inCall, settings.record])

  async function ask(text: string) {
    if (!text.trim() || busy) return
    setChat((c) => [...c, question(text)])
    setBusy(true)
    const { entry, topics } = await answer(client, text, settings)
    setChat((c) => [...c, entry])
    addHints(topics, 'chat', `Frage des Beraters: «${text}»`)
    if (topics[0] && !settings.record) setAdvisorSlot({ heard: text, text: topics[0].next, topic: topics[0].id })
    setBusy(false)
  }

  const select = (r: string) => { setRef(r); setInCall(false) }
  const topSignal = (r: string) => signals.flatMap((s) => s.affected.filter((a) => a.ref === r).map((a) => ({ ...a, title: s.title }))).sort((a, b) => rank[a.severity] - rank[b.severity])[0]
  const open = useMemo(() => (topicData[client.ref] ?? []).filter((t) => !chat.some((e) => e.role === 'ki' && e.text === t.insight[settings.detail])), [client.ref, chat, settings.detail])

  const base = { assistent: 1 + (100 - settings.focus) / 50, chat: 1 + settings.focus / 50 }
  const grow = (id: PaneId) => base[id] * (hovered === id ? 1.7 : 1)

  return (
    <>
      <div className="flex shrink-0 items-center justify-between bg-band px-3 py-3">
        <div>
          <div className="text-[17px]">Anrufe &amp; Signale</div>
          <div className="mt-1 text-[11px]">Marktsignale: {signals.length} <span className="mx-1 text-muted">|</span> Kontaktvorschläge: {signals.reduce((n, s) => n + s.affected.length, 0)} <span className="mx-1 text-muted">|</span> Aufzeichnung: {settings.record ? 'ein' : 'aus'} <span className="mx-1 text-muted">|</span> Detailgrad: {settings.detail}</div>
        </div>
        <div className="flex gap-2">
          <Pill icon={PhoneCall} onClick={onSimulateCall}>Anruf simulieren</Pill>
          <Pill icon={SettingsIcon} onClick={() => setSettingsOpen(true)}>Einstellungen</Pill>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2.5 p-2">
        <aside className="flex w-[280px] shrink-0 flex-col gap-2.5">
          <section className="flex min-h-0 flex-1 flex-col bg-white shadow-card">
            <PaneTitle icon={Users} title="Kunden" />
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {clients.map((c, i) => {
                const s = topSignal(c.ref)
                return (
                  <li key={c.ref}>
                    <button onClick={() => select(c.ref)} className={`flex w-full items-start gap-2 border-l-[3px] px-3 py-2 text-left transition-colors duration-200 ${c.ref === ref ? 'border-brand bg-brand-soft/30' : `border-transparent hover:bg-brand-soft/20 ${i % 2 ? 'bg-stripe' : ''}`}`}>
                      <span className="mt-0.5">{s ? <SeverityIcon severity={s.severity} size={12} /> : <span className="block w-3" />}</span>
                      <span className="min-w-0"><span className="block">{c.name} <span className="text-[11px] text-muted">· {c.profile}</span></span><span className="block truncate text-[11px] text-muted">{s?.title ?? 'Kein offenes Signal'}</span></span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
          <section className="flex min-h-0 flex-1 flex-col bg-white shadow-card">
            <PaneTitle icon={Activity} title="Marktsignale" />
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {signals.map((s, i) => {
                const hit = s.affected.some((a) => a.ref === ref)
                return (
                  <li key={s.id} className={`border-l-[3px] px-3 py-2 transition-all duration-300 ${hit ? 'border-brand' : 'border-transparent opacity-50'} ${i % 2 ? 'bg-stripe' : ''}`}>
                    <div className="flex items-start justify-between gap-2"><span className="text-xs leading-snug">{s.title}</span><span className="shrink-0 rounded-sm bg-pill px-1.5 py-px text-[10px]">{s.reach}</span></div>
                    <div className="mt-0.5 text-[11px] text-muted">{s.time} <Source>{s.source}</Source></div>
                  </li>
                )
              })}
            </ul>
          </section>
        </aside>

        <Pane id="assistent" grow={grow('assistent')} dim={hovered === 'chat'} setHovered={setHovered} icon={Headset} title="Gesprächsassistent" sub="Was Sie dem Kunden sagen können"
          actions={<>
            {inCall && settings.record && !!SpeechRecognitionCtor && <button onClick={() => setMic((m) => !m)} className={`flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] ${mic ? 'bg-risk text-white' : 'bg-pill hover:bg-track'}`}>{mic ? <Mic size={12} /> : <MicOff size={12} />} Mikrofon</button>}
            <button onClick={() => setInCall((v) => !v)} className={`flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-white ${inCall ? 'bg-risk' : 'bg-brand hover:bg-brand-dark'}`}>{inCall ? <><PhoneOff size={12} /> Gespräch beenden</> : <><Phone size={12} /> Gespräch starten</>}</button>
          </>}>
          <div className="mb-3 flex items-center gap-2 text-[11px] text-muted">
            <span className={`h-2 w-2 rounded-full ${inCall ? 'animate-pulse bg-risk' : 'bg-track'}`} />
            {inCall ? `Gespräch mit ${client.name} läuft · ${settings.record ? (mic ? 'Mikrofon wird transkribiert' : 'Transkription aktiv') : 'keine Aufzeichnung'}` : `Vorbereitung für ${client.name}`}
            <button onClick={() => onOpenBriefing(client.ref)} className="ml-auto inline-flex items-center gap-1 text-brand hover:underline">Briefing <ArrowRight size={11} /></button>
          </div>

          {hints[0] && (
            <div key={hints[0].id} className="anim-rise border-l-4 border-brand bg-brand-soft/25 p-4">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted"><SeverityIcon severity={hints[0].severity} size={11} /> Jetzt ansprechen · {originLabel[hints[0].origin]}</div>
              <p className="text-[17px] leading-snug">{hints[0].text}</p>
              <p className="mt-2 text-[11px] text-muted">{hints[0].why}</p>
              <p className="mt-1 truncate text-[11px] italic text-muted">{hints[0].trigger}</p>
            </div>
          )}
          <ul className="mt-2">
            {hints.slice(1).map((h, i) => (
              <li key={h.id} className={`anim-rise flex items-start gap-2 px-2 py-2 ${i % 2 ? '' : 'bg-stripe'}`}>
                <span className="mt-0.5"><SeverityIcon severity={h.severity} size={12} /></span>
                <span className="min-w-0 leading-snug">{h.text}<span className="block text-[11px] text-muted">{originLabel[h.origin]} · {h.why}</span></span>
              </li>
            ))}
          </ul>

          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">Transkript</div>
            {!settings.record
              ? <p className="text-[11px] leading-snug text-muted">Aufzeichnung ausgeschaltet. Es wird nichts transkribiert – die Hinweise stützen sich auf den Berater-Chat und die Kundendaten.</p>
              : lines.length === 0
                ? <p className="text-[11px] text-muted">{inCall ? 'Warte auf das Gespräch …' : 'Noch kein Gespräch. Das Transkript erscheint hier, sobald ein Gespräch läuft.'}</p>
                : <ul className="space-y-1 text-xs">{lines.slice(-5).map((l, i) => <li key={i} className="anim-rise leading-snug"><span className={`mr-1.5 text-[10px] uppercase ${l.speaker === 'Kunde' ? 'text-brand-dark' : 'text-muted'}`}>{l.speaker}</span>{l.text}</li>)}</ul>}
          </div>
        </Pane>

        <Pane id="chat" grow={grow('chat')} dim={hovered === 'assistent'} setHovered={setHovered} icon={MessageSquare} title="Berater-Chat" sub="Einblicke für Sie, mit Zugriff auf die Kundendaten"
          footer={
            <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('q') as HTMLInputElement; ask(f.value); f.value = '' }} className="flex border-t border-line text-xs">
              <input name="q" autoComplete="off" placeholder={`Frage zu ${client.name} stellen …`} className="min-w-0 flex-1 px-3 py-2.5 outline-none" />
              <button className="bg-brand px-4 text-white hover:bg-brand-dark">Senden</button>
            </form>
          }>
          {open.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {open.map((t) => <button key={t.id} onClick={() => ask(t.label)} className="rounded-sm bg-pill px-2 py-1 text-[11px] transition-colors hover:bg-brand hover:text-white">{t.label}</button>)}
            </div>
          )}
          <ChatLog chat={chat} busy={busy} detail={settings.detail} onShow={(id) => setChat((c) => c.map((e) => (e.id === id && e.role === 'ki' && e.offered ? { ...e, module: e.offered.spec, offered: undefined } : e)))} />
        </Pane>
      </div>

      {inCall && <LiveIsland key={client.ref} client={client} recording={settings.record} customer={customerSlot} advisor={advisorSlot} onEnd={() => setInCall(false)} />}
      <SettingsPanel open={settingsOpen} settings={settings} update={update} onClose={() => setSettingsOpen(false)} />
    </>
  )
}

function PaneTitle({ icon: Icon, title, sub, actions }: { icon: typeof Users; title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-4">
      <h3 className="flex min-w-0 items-baseline gap-2 text-[15px]"><Icon size={16} strokeWidth={1.5} className="shrink-0 self-center" /><span className="whitespace-nowrap">{title}</span>{sub && <span className="truncate text-[11px] text-muted">{sub}</span>}</h3>
      {actions && <div className="flex shrink-0 gap-1.5">{actions}</div>}
    </div>
  )
}

function Pane({ id, grow, dim, setHovered, icon, title, sub, actions, footer, children }: { id: PaneId; grow: number; dim: boolean; setHovered: (p: PaneId | null) => void; icon: typeof Users; title: string; sub: string; actions?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section
      onMouseEnter={() => setHovered(id)} onMouseLeave={() => setHovered(null)}
      style={{ flexGrow: grow }}
      className={`flex min-w-0 basis-0 flex-col bg-white shadow-card transition-[flex-grow,opacity,box-shadow] duration-[650ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none ${dim ? 'opacity-70' : 'hover:shadow-[0_2px_14px_rgba(0,0,0,0.22)]'}`}>
      <PaneTitle icon={icon} title={title} sub={sub} actions={actions} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      {footer}
    </section>
  )
}

function ChatLog({ chat, busy, detail, onShow }: { chat: ChatEntry[]; busy: boolean; detail: 'kurz' | 'standard' | 'detailliert'; onShow: (id: string) => void }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [chat, busy])
  if (!chat.length && !busy) return <p className="text-[11px] leading-snug text-muted">Stellen Sie eine Frage oder wählen Sie ein Thema. Themen, die im Gespräch fallen, erscheinen hier automatisch als Einblick.</p>
  return (
    <div className="space-y-2.5 text-xs">
      {chat.map((e) => e.role === 'berater'
        ? <div key={e.id} className="anim-rise ml-auto w-fit max-w-[85%] bg-brand px-2.5 py-1.5 leading-snug text-white">{e.text}</div>
        : (
          <div key={e.id} className="anim-rise bg-stripe px-3 py-2.5">
            {e.origin === 'gespraech' && <div className="mb-1 text-[10px] uppercase tracking-wide text-brand-dark">Im Gespräch erkannt</div>}
            <p className="leading-relaxed">{e.text}</p>
            {e.sources.length > 0 && <p className="mt-1.5 text-[11px] text-muted">Quellen: {e.sources.join(' · ')}</p>}
            {e.module && <ModuleView spec={e.module} detail={detail} />}
            {e.offered && <button onClick={() => onShow(e.id)} className="mt-2 inline-flex items-center gap-1.5 rounded-sm bg-pill px-2 py-1 text-[11px] hover:bg-brand hover:text-white"><BarChart3 size={12} /> Grafik anzeigen · Konfidenz {e.offered.confidence}%</button>}
          </div>
        ))}
      {busy && <div className="text-muted">Die KI prüft die Kundendaten …</div>}
      <div ref={end} />
    </div>
  )
}
