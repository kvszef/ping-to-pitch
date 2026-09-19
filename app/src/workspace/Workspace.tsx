import { Mic, MicOff, PanelLeftClose, Phone, PhoneCall, PhoneOff, Search, Settings as SettingsIcon, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBriefing } from '../data/useBriefing'
import { sortCards } from '../data/source'
import { useNews } from '../data/useNews'
import { useTranslated } from '../data/useTranslate'
import * as deskLine from '../phone/deskLine'
import { usePhoneAudio } from '../phone/usePhoneAudio'
import { demoCalls, lineDelay, type DemoLine } from '../data/demoCalls'
import { useOutbound } from '../data/useOutbound'
import type { Card, CardOf, Client, Signal } from '../types'
import { AfterCall, type EndedCall } from './AfterCall'
import { activeProvider, agentStep, answer, demoScript, fetchStatus, question, screenFor, topicsFor, type AgentEvent, type Segment, type Status } from './brain'
import { sinceCallStart } from './callNote'
import { localPlan, nameIn, rebasePlan, type Brought, type Plan, type Suggestion } from './screen'
import { SettingsPanel } from './SettingsPanel'
import { useSettings } from './settings'
import { Stage, Transcript } from './Stage'
import type { ChatEntry, Hint, TranscriptLine } from './types'
import { canListen, useCallAudio } from './useCallAudio'

// Marks talk-track lines the live agent has heard addressed, for a struck-through checkmark in the UI.
const markCovered = (card: CardOf<'talktrack'>, covered: Set<string>): CardOf<'talktrack'> => {
  const mark = (l: typeof card.open) => (covered.has(l.text) ? { ...l, covered: true } : l)
  return { ...card, open: mark(card.open), mention: card.mention.map(mark), ask: card.ask.map(mark) }
}

const stem = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3).map((w) => w.slice(0, 6)))
// A spoken line counts as the talking point when it shares at least half of its content words.
const sameSentence = (idea: string, spoken: string) => { const a = stem(idea), b = stem(spoken); let n = 0; a.forEach((w) => { if (b.has(w)) n++ }); return a.size > 0 && n / a.size >= 0.5 }

type Props = {
  clients: Client[]
  signals: Signal[]
  initialRef?: string
  initialCall?: boolean
  initialDemo?: string
  onSimulateCall: (demoId: string) => void
  callbacks?: Callback[]
  onCallbackDone?: (id: string) => void
  onCallState?: (state: { inCall: boolean; name: string } | null) => void
  onOpenBriefing: (ref: string) => void
}

const rank = { risk: 0, warn: 1, info: 2, ok: 3 }
// Why the client is probably calling, from the engine's profile check.
const callReasons = (client: Client) => (client.findings ?? []).filter((f) => (f.check === 'profile.call-reason' || (f.check === 'cio.house-view' && !!f.numbers?.changed))).map((f) => f.title).join('; ') || undefined
const providerLabel = { openai: 'OpenAI', apertus: 'Apertus', beispiel: 'Beispielmodus' }
const TODAY = 6 // how many of today's ranked clients show their reason
// A call that came in while the advisor was on another call.
export type Callback = { id: string; ref?: string; demo?: string; label: string; reason: string; at: string }

export function Workspace({ clients, signals, initialRef, initialCall, initialDemo, onSimulateCall, callbacks = [], onCallbackDone, onCallState }: Props) {
  const [settings, update] = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ref, setRef] = useState(initialRef ?? clients[0].ref)
  // An inbound demo call starts without a known caller; the name in the transcript picks the client.
  const [inCall, setInCall] = useState(!!initialCall)
  const [mic, setMic] = useState(false)
  const [status, setStatus] = useState<Status>({ openai: false, apertus: false, elevenlabs: false })
  const [note, setNote] = useState<string | null>(null)
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [hints, setHints] = useState<Hint[]>([])
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [demoMenu, setDemoMenu] = useState(false)
  const [menuAt, setMenuAt] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 })
  useEffect(() => {
    if (!demoMenu) return
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as HTMLElement).closest('[data-demo-menu], [aria-label="Demo-Anruf"]')) setDemoMenu(false) }
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', close)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', close) }
  }, [demoMenu])
  const [rosterQuery, setRosterQuery] = useState('')
  const [identifying, setIdentifying] = useState(!!initialCall && !initialRef)

  // The client, enriched with the engine's briefing once the server answered.
  const listed = clients.find((c) => c.ref === ref) ?? clients[0]
  const engine = useBriefing(listed.ref)
  // Live during a call: which talk-track lines the agent has heard addressed, and its current
  // read on which insight cards matter most right now (server/ai/insights.ts ranks them pre-call;
  // this re-ranks live from the transcript). Reset whenever the advisor moves to another client.
  const [liveCovered, setLiveCovered] = useState<Set<string>>(new Set())
  const [liveOrder, setLiveOrder] = useState<Card['type'][]>([])
  useEffect(() => { setLiveCovered(new Set()); setLiveOrder([]) }, [listed.ref])
  const client = useMemo(() => {
    const base = engine.findings.length || engine.cards.length
      ? { ...listed, briefing: engine.cards.length ? engine.cards : listed.briefing, findings: engine.findings.length ? engine.findings : undefined }
      : listed
    if (!liveCovered.size && !liveOrder.length) return base
    const briefing = base.briefing.map((c): Card => c.type === 'talktrack' ? markCovered(c, liveCovered) : c)
    return { ...base, briefing: sortCards(briefing, liveOrder) }
  }, [listed, engine.cards, engine.findings, liveCovered, liveOrder])
  // The elements the agent can show for this client, and its current plan.
  // Live news on the client's holdings (polled); the tiles and the agent see it.
  const news = useNews(identifying ? null : client.ref)
  const screen = useMemo(() => screenFor(client, news.items), [client, news.items])
  const [plan, setPlan] = useState<Plan>(() => localPlan(screen.tiles, []))
  // What the client's questions brought into the graph column during this call (see drain).
  const [brought, setBrought] = useState<Brought[]>([])
  useEffect(() => { setBrought([]) }, [inCall, client.ref])
  const [thinking, setThinking] = useState(false)

  // ---- the conversation ------------------------------------------------------------------------
  // Transcript lines show at once. The agent runs beside the conversation, never in front of it:
  // whatever arrives while it thinks is collected and sent in its next step. Its plan is moved onto
  // the current tiles when the engine's later tiers arrived meanwhile.
  const linesRef = useRef<TranscriptLine[]>([])
  const [pending, setPending] = useState<string[]>([]) // heard, speaker not assigned yet
  const saidRef = useRef<{ ids: string[]; texts: string[] }>({ ids: [], texts: [] })
  const planRef = useRef(plan)
  planRef.current = plan
  const latest = useRef({ client, screen, settings, status, inCall })
  latest.current = { client, screen, settings, status, inCall }
  type Inbox = { segments: Segment[]; unknown: string[]; said: string[]; start: boolean }
  const empty = (): Inbox => ({ segments: [], unknown: [], said: [], start: false })
  const inbox = useRef<Inbox>(empty())
  const running = useRef(false)

  const drain = async () => {
    if (running.current) return
    running.current = true
    setThinking(true)
    while (inbox.current.segments.length || inbox.current.said.length || inbox.current.start) {
      const job = inbox.current
      inbox.current = empty()
      const { client: c, screen: on, settings: st, status: su, inCall: live } = latest.current
      const knownCount = job.segments.length - job.unknown.length
      const before = linesRef.current.slice(0, linesRef.current.length - knownCount)
      const event: AgentEvent = job.segments.length ? { type: 'transcript', segments: job.segments }
        : job.said.length ? { type: 'said', text: job.said.join(' · ') }
        : { type: 'start', call: live ? callReasons(c) : undefined }
      const r = await agentStep(c, on, before, saidRef.current.texts, event, st, su)
      if (latest.current.client.ref !== c.ref) continue // the advisor moved on to another client
      if (job.unknown.length) {
        // Microphone lines: the agent assigned the roles; they replace the "…" placeholders.
        setPending((p) => p.filter((t) => !job.unknown.includes(t)))
        const assigned = r.lines.filter((l) => job.unknown.includes(l.text))
        const lines = assigned.length ? assigned : job.unknown.map((text) => ({ speaker: 'Kunde' as const, text }))
        linesRef.current = [...linesRef.current, ...lines]
        setLines(linesRef.current)
      }
      const spoken = r.lines.filter((l) => l.speaker === 'Berater').flatMap((l) => planRef.current.suggestions.filter((s) => sameSentence(s.text, l.text)))
      if (spoken.length) mark(spoken)
      const now = latest.current.screen
      setPlan(now === on ? r.plan : rebasePlan(r.plan, now.tiles, now.charts))
      // The graph column takes nothing from the plan. One thing only reaches it from here: during a
      // call, when the CLIENT said something of substance, the single graph or tile the agent picked
      // for it, together with the answer that belongs to it. No client line (call start, the advisor
      // speaking, a clicked talking point) or mere small talk brings nothing.
      const clientSaid = [...job.segments.filter((x) => x.speaker === 'Kunde').map((x) => x.text), ...r.lines.filter((l) => l.speaker === 'Kunde').map((l) => l.text)]
      const pick = r.plan.widgets[0]
      if (live && pick && clientSaid.length && (r.plan.answer || clientSaid.some((t) => t.trim().split(/\s+/).length >= 4))) {
        const answer = r.plan.answer
        setBrought((b) => (b.some((x) => x.widget === pick) ? b.map((x) => (x.widget === pick && answer ? { ...x, answer } : x)) : [...b, { widget: pick, answer }]))
      }
      if (r.covered?.length) setLiveCovered((prev) => new Set([...prev, ...r.covered!]))
      // The brief holds still during a call (what the conversation brings up shows in the graph column),
      // so the agent's live card re-ranking (r.cardOrder -> setLiveOrder) is not applied.
    }
    setThinking(false)
    running.current = false
  }

  const mark = (list: Suggestion[]) => {
    saidRef.current = { ids: [...saidRef.current.ids, ...list.map((s) => s.id)], texts: [...saidRef.current.texts, ...list.map((s) => s.text)] }
  }

  // Who is calling: until a name is heard, an unknown caller; then the client opens and the call goes on.
  const keepCall = useRef(false)
  const hear = (segments: Segment[]) => {
    const known = segments.filter((s) => s.speaker === 'Kunde' || s.speaker === 'Berater')
    const unknown = segments.filter((s) => !(s.speaker === 'Kunde' || s.speaker === 'Berater')).map((s) => s.text)
    if (known.length) { linesRef.current = [...linesRef.current, ...known.map((s) => ({ speaker: s.speaker as TranscriptLine['speaker'], text: s.text }))]; setLines(linesRef.current) }
    if (unknown.length) setPending((p) => [...p, ...unknown])
    if (identifyingRef.current) {
      const found = nameIn(segments.filter((s) => s.speaker !== 'Berater').map((s) => s.text).join(' '), clients)
      if (found) { keepCall.current = true; setIdentifying(false); setRef(found) }
    }
    inbox.current.segments.push(...segments)
    inbox.current.unknown.push(...unknown)
    void drain()
  }
  const identifyingRef = useRef(identifying)
  identifyingRef.current = identifying
  const hearRef = useRef(hear)
  hearRef.current = hear

  useEffect(() => { fetchStatus().then(setStatus) }, [])

  // After the call: what was heard since it began becomes a draft note the advisor confirms
  // (AfterCall.tsx). Must stay above the client-change effect below, which clears the transcript:
  // picking another client ends the call and switches client in one step, and effects run in order.
  const [ended, setEnded] = useState<EndedCall | null>(null)
  const callFor = useRef<{ ref: string; name: string } | null>(null)
  const heardBefore = useRef<TranscriptLine[]>([])
  useEffect(() => { if (inCall) callFor.current = identifying ? null : { ref: client.ref, name: client.name } }, [inCall, identifying, client.ref, client.name])
  useEffect(() => {
    if (inCall) { heardBefore.current = linesRef.current; return }
    const who = callFor.current
    callFor.current = null
    const heard = [...sinceCallStart(heardBefore.current, linesRef.current), ...pending.map((text) => ({ speaker: 'Unbekannt', text }))]
    if (who && heard.length >= 2) setEnded({ ref: who.ref, name: who.name, lines: heard })
  }, [inCall]) // eslint-disable-line react-hooks/exhaustive-deps

  // New client: a fresh start, except when the caller was just recognised mid-call (the call goes on).
  useEffect(() => {
    if (keepCall.current) { keepCall.current = false; saidRef.current = { ids: [], texts: [] }; setChat([]); setHints([]); return }
    linesRef.current = []; saidRef.current = { ids: [], texts: [] }; inbox.current = empty()
    setLines([]); setPending([]); setChat([]); setHints([]); setMic(false); setNote(null)
  }, [client.ref])
  // New tiles (client, engine tiers) or the model became reachable: before a call a fresh plan;
  // during a call the running plan is only moved onto the new tiles, the conversation keeps steering.
  const planned = useRef<string | null>(null)
  useEffect(() => {
    if (inCall && planned.current === client.ref) { setPlan((p) => rebasePlan(p, screen.tiles, screen.charts)); return }
    planned.current = client.ref
    setPlan(localPlan(screen.tiles, saidRef.current.ids))
    inbox.current.start = true
    void drain()
  }, [screen, status.openai, status.apertus]) // eslint-disable-line react-hooks/exhaustive-deps

  // An internet call from the client's phone (Arash, phone/): both sides are transcribed from their own
  // streams, so neither the demo script nor the laptop microphone runs alongside it.
  const line = deskLine.useDeskLine()
  const phone = line.state !== 'idle' && line.ref === client.ref
  const phoneCall = line.state === 'connected' && line.ref === client.ref ? line : null
  const wasConnected = useRef(false)
  useEffect(() => {
    if (phoneCall) wasConnected.current = true
    else if (wasConnected.current) { wasConnected.current = false; setInCall(false) } // the client hung up
  }, [phoneCall])
  usePhoneAudio(phoneCall, inCall && settings.record, !!status.transcribe, (segments) => hearRef.current(segments), (error) => setNote(error))
  // During an internet call the mic button mutes the advisor's own microphone.
  const [phoneMuted, setPhoneMuted] = useState(false)
  useEffect(() => { setPhoneMuted(false) }, [phoneCall])
  const togglePhoneMute = () => setPhoneMuted((m) => { deskLine.setMuted(!m); return !m })
  const endCall = () => { if (phone || line.state === 'dialling') deskLine.hangup(); setInCall(false) } // also cancels a call that still rings

  // A demo call plays its script at speaking pace through the same path as live transcription.
  const demo = demoCalls.find((d) => d.id === initialDemo)
  const [script, setScript] = useState<{ id: string; lines: Segment[] } | null>(demo ? { id: demo.id, lines: demo.script } : null)
  useEffect(() => {
    if (!inCall || !script || phone) return
    let stop = false, timer = 0
    const play = (i: number) => {
      if (stop || i >= script.lines.length) return
      hearRef.current([script.lines[i]])
      timer = window.setTimeout(() => play(i + 1), lineDelay(script.lines[i] as DemoLine))
    }
    timer = window.setTimeout(() => play(0), 2000)
    return () => { stop = true; clearTimeout(timer) }
  }, [inCall, script?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Outbound: the advisor calls a client. As a demo, the model writes the conversation from the
  // client's data and today's reasons (the ranking moves with the news, a fixed script would not fit).
  const ranking = useOutbound()
  const [dialling, setDialling] = useState<string | null>(null)
  const callOut = async (target: string, asDemo: boolean) => {
    // A demo call: no microphone (the conversation is written and played); set before the call starts.
    if (asDemo) setDialling(target)
    setDemoMenu(false); setIdentifying(false); setRef(target); setScript(null); setInCall(true)
    // A real call also rings the client's phone page (call.html); if nobody picks up, the laptop microphone takes over.
    if (!asDemo) { deskLine.dial(target); return }
    const who = clients.find((c) => c.ref === target)
    const reasons = ranking.find((r) => r.ref === target)?.reasons.map((r) => r.title) ?? []
    const lines = who ? await demoScript(who, reasons, settings, status) : []
    setDialling(null)
    if (lines.length) setScript({ id: `out-${target}-${Date.now()}`, lines })
  }
  // The app needs to know whether a call is on, so a second caller is put on the callback list.
  useEffect(() => { onCallState?.(inCall ? { inCall, name: identifying ? 'Unbekannter Anrufer' : client.name } : null) }, [inCall, identifying, client.name]) // eslint-disable-line react-hooks/exhaustive-deps

  // A call listens to the microphone straight away when recording is on (real transcript, no script).
  useEffect(() => { if (inCall && settings.record && canListen(!!status.transcribe) && !script && !dialling && !phone) setMic(true) }, [inCall, status.transcribe]) // eslint-disable-line react-hooks/exhaustive-deps
  // (the internet call brings its own audio; see usePhoneAudio above) // eslint-disable-line react-hooks/exhaustive-deps
  // Nobody picked up the internet call (timeout or declined): the call goes on with the laptop microphone, as before.
  const wasDialling = useRef(false)
  useEffect(() => {
    const gaveUp = wasDialling.current && line.state === 'idle'
    wasDialling.current = line.state === 'dialling'
    if (gaveUp && inCall && settings.record && canListen(!!status.transcribe) && !script) setMic(true)
  }, [line.state]) // eslint-disable-line react-hooks/exhaustive-deps

  useCallAudio(mic && inCall && settings.record && !phone, !!status.transcribe, (segments) => hearRef.current(segments), (error) => { setMic(false); if (error) setNote(error) })

  async function ask(text: string) {
    if (!text.trim() || busy) return
    setChat((c) => [...c, question(text)])
    setBusy(true)
    const reply = await answer(client, text, settings, status, chat)
    setChat((c) => [...c, reply.entry])
    if (reply.hints.length) setHints(reply.hints)
    setBusy(false)
  }

  const select = (r: string) => { setRef(r); setInCall(false) }
  const rankOf = useMemo(() => new Map(ranking.map((r) => [r.ref, r])), [ranking])
  const roster = useMemo(() => {
    const q = rosterQuery.trim().toLowerCase()
    const shown = clients.filter((c) => !q || c.name.toLowerCase().includes(q) || c.ref.toLowerCase().includes(q))
    return q ? shown : [...shown].sort((a, b) => (rankOf.get(b.ref)?.score ?? 0) - (rankOf.get(a.ref)?.score ?? 0))
  }, [clients, rosterQuery, rankOf])
  const topSignal = (r: string) => signals.flatMap((s) => s.affected.filter((a) => a.ref === r).map((a) => ({ ...a, title: s.title }))).sort((a, b) => rank[a.severity] - rank[b.severity])[0]
  const chatSuggestions = useMemo(() => topicsFor(client).map((t) => t.label), [client])

  // The left roster and the demo-call menu are the last hand-built German chrome: batched once,
  // cached, so the rest of the app (already language-aware via useTranslated) stays consistent.
  const [chrome, rosterReasons, callbackTexts, demoInTexts, demoOutTexts] = [
    useTranslated(['Kunden', 'Rückrufe', 'Heute anrufen', 'Alle Kunden', 'Chance: ', 'Eingehender Anruf', 'Ausgehender Anruf', 'Heute an erster Stelle', 'Rangliste lädt …', 'Name suchen …', 'Kundenliste einklappen', 'Kundenliste öffnen'], settings.language),
    useTranslated(roster.map((c) => rankOf.get(c.ref)?.reasons[0]?.title ?? ''), settings.language),
    useTranslated(callbacks.flatMap((cb) => [cb.label, cb.reason]), settings.language),
    useTranslated(demoCalls.filter((d) => d.direction === 'eingehend').map((d) => d.label), settings.language),
    useTranslated(ranking.slice(0, 2).map((r) => r.reasons[0]?.title ?? ''), settings.language),
  ]

  return (
    <>
      <div className="flex min-h-0 flex-1 gap-3 bg-[radial-gradient(ellipse_at_top_left,rgba(89,151,237,0.28),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(105,212,214,0.22),transparent_55%)] p-3">
        <aside style={{ width: settings.clientsOpen ? 196 : 44 }} className={`flex shrink-0 flex-col overflow-hidden rounded-2xl bg-white/55 shadow-[0_8px_32px_rgba(31,56,88,0.10)] ring-1 ring-white/70 backdrop-blur-xl transition-[width,opacity] duration-500 ease-[cubic-bezier(.22,1,.36,1)] ${inCall ? 'opacity-40 hover:opacity-100' : ''}`}>
          {!settings.clientsOpen ? (
            <button onClick={() => update({ clientsOpen: true })} aria-label="Kundenliste öffnen" title="Kundenliste öffnen"
              className="flex h-full w-11 flex-col items-center gap-2.5 py-4 text-muted transition-colors hover:text-ink">
              <Users size={16} strokeWidth={1.5} />
              <span className="whitespace-nowrap text-[11px] [writing-mode:vertical-rl]">{chrome[0]}</span>
            </button>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-1 border-b border-line/60 px-1.5 py-1.5">
                <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-white/70 px-2 py-1 text-[12px] text-muted">
                  <Search size={12} className="shrink-0" />
                  <input value={rosterQuery} onChange={(e) => setRosterQuery(e.target.value)} placeholder={chrome[9]} aria-label="Kunden suchen" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
                </label>
                <button onClick={() => update({ clientsOpen: false })} aria-label="Kundenliste einklappen" title={chrome[10]} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-pill hover:text-ink"><PanelLeftClose size={15} /></button>
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto py-1.5">
                {callbacks.length > 0 && (
                  <li className="px-3 pb-1 pt-1">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-risk">{chrome[1]}</div>
                    {callbacks.map((cb, ci) => (
                      <button key={cb.id} onClick={() => { onCallbackDone?.(cb.id); if (cb.ref) void callOut(cb.ref, false); else if (cb.demo) onSimulateCall(cb.demo) }}
                        className="anim-rise mb-1 flex w-full items-start gap-2 rounded-lg bg-risk/10 px-2 py-1.5 text-left hover:bg-risk/15">
                        <PhoneCall size={12} className="mt-0.5 shrink-0 text-risk" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-[12px]">{callbackTexts[ci * 2] || cb.label}</span><span className="block text-[10px] text-muted">{cb.at} · {callbackTexts[ci * 2 + 1] || cb.reason}</span></span>
                      </button>
                    ))}
                  </li>
                )}
                {roster.map((c, i) => {
                  const r = rankOf.get(c.ref)
                  const top = r?.reasons[0]
                  const s = topSignal(c.ref)
                  const severity = top?.severity ?? s?.severity ?? (c.errors ? 'risk' : c.warnings ? 'warn' : null)
                  const today = !rosterQuery && r && i < TODAY
                  return (
                    <li key={c.ref} data-flip={c.ref}>
                      {!rosterQuery && i === 0 && r && <div className="px-4 pb-1 pt-1 text-[10px] uppercase tracking-wide text-brand-dark">{chrome[2]}</div>}
                      {!rosterQuery && i === TODAY && <div className="mt-1 border-t border-line/60 px-4 pb-1 pt-2 text-[10px] uppercase tracking-wide text-muted">{chrome[3]}</div>}
                      <button onClick={() => select(c.ref)} title={top?.title ?? s?.title ?? c.profile} className={`flex w-full items-start gap-2.5 px-4 py-2 text-left text-[13px] transition-colors duration-200 ${c.ref === client.ref && !identifying ? 'bg-brand-soft/40 text-ink' : 'text-ink/75 hover:bg-brand-soft/20'}`}>
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${severity === 'risk' ? 'bg-risk' : severity === 'warn' ? 'bg-warn' : severity === 'ok' ? 'bg-ok' : 'bg-transparent'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{c.name}</span>
                          {today && top && <span className="line-clamp-2 text-[10px] leading-snug text-muted">{top.kind === 'opportunity' ? chrome[4] : ''}{rosterReasons[i] || top.title}</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div className="flex shrink-0 items-center gap-1 border-t border-line/60 px-2 py-1.5">
                <button onClick={() => setSettingsOpen(true)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-muted hover:bg-pill hover:text-ink">
                  <SettingsIcon size={14} className="shrink-0" /><span className="truncate">KI: {providerLabel[activeProvider(settings, status) ?? 'beispiel']}</span>
                </button>
                <div className="relative">
                  <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenuAt({ left: r.left, bottom: window.innerHeight - r.top + 6 }); setDemoMenu((v) => !v) }} aria-label="Demo-Anruf" title="Demo-Anruf" aria-expanded={demoMenu} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg hover:bg-pill hover:text-ink ${demoMenu ? 'bg-pill text-ink' : 'text-muted'}`}><PhoneCall size={14} /></button>
                  {demoMenu && createPortal(
<div data-demo-menu style={menuAt} className="anim-rise fixed z-[70] w-72 rounded-xl bg-white/90 p-1.5 shadow-[0_12px_40px_rgba(31,56,88,0.18)] ring-1 ring-black/5 backdrop-blur-xl">
                      {(['eingehend', 'ausgehend'] as const).map((dir) => (
                        <div key={dir}>
                          <div className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide text-muted">{dir === 'eingehend' ? chrome[5] : chrome[6]}</div>
                          {dir === 'eingehend' ? demoCalls.filter((d) => d.direction === dir).map((d, di) => {
                            const who = clients.find((c) => c.ref === d.ref)
                            return (
                              <button key={d.id} onClick={() => { setDemoMenu(false); onSimulateCall(d.id) }} className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-brand-soft/40">
                                <span className="text-[12px]">{who?.name ?? d.ref}</span>
                                <span className="text-[11px] text-muted">{demoInTexts[di] || d.label}</span>
                              </button>
                            )
                          }) : ranking.slice(0, 2).map((r, ri) => (
                            <button key={r.ref} onClick={() => void callOut(r.ref, true)} className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-brand-soft/40">
                              <span className="text-[12px]">{clients.find((c) => c.ref === r.ref)?.name ?? r.name ?? r.ref}</span>
                              <span className="line-clamp-2 text-[11px] text-muted">{demoOutTexts[ri] || r.reasons[0]?.title || chrome[7]}</span>
                            </button>
                          ))}
                          {dir === 'ausgehend' && !ranking.length && <p className="px-2 py-1 text-[11px] text-muted">{chrome[8]}</p>}
                        </div>
                      ))}
                    </div>
                  , document.body)}
                </div>
              </div>
            </>
          )}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          {identifying ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="anim-rise flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/55 px-6 py-10 text-center shadow-[0_8px_32px_rgba(31,56,88,0.10)] ring-1 ring-white/70 backdrop-blur-xl">
                <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-ok text-white"><span className="absolute inset-0 animate-ping rounded-full bg-ok/40" /><Phone size={22} className="relative" /></span>
                <div className="text-[18px]">Unbekannter Anrufer</div>
                <p className="max-w-md text-[13px] text-muted">Die Nummer ist keinem Kunden zugeordnet. Sobald im Gespräch ein Name fällt, öffnet sich der Kunde mit allen Angaben.</p>
                <button onClick={() => { setInCall(false); setIdentifying(false) }} className="flex items-center gap-1.5 rounded-full bg-risk px-3 py-1 text-xs text-white"><PhoneOff size={12} /> Beenden</button>
              </div>
              <div className="rounded-2xl bg-white/55 p-1 shadow-[0_8px_32px_rgba(31,56,88,0.10)] ring-1 ring-white/70 backdrop-blur-xl"><Transcript lines={lines} pending={pending} tall /></div>
            </div>
          ) : (
          <Stage client={client} screen={screen} plan={plan} brought={brought} thinking={thinking} inCall={inCall} recording={settings.record}
            lines={lines} pending={pending} note={note} freshNews={news.fresh} hints={hints}
            lead={
              <div className="flex min-w-0 shrink-0 items-baseline gap-2">
                <span className="truncate text-[15px]">{client.name}</span>
                <span className="flex items-center gap-1 text-[11px] text-muted"><span className={`h-1.5 w-1.5 rounded-full ${inCall ? 'animate-pulse bg-risk' : 'bg-track'}`} />{dialling ? 'Verbindet …' : phone && line.state === 'dialling' ? 'Klingelt …' : inCall ? 'Gespräch' : 'Vorbereitung'}</span>
              </div>
            }
            actions={
              <div className="flex shrink-0 gap-1.5">
                {inCall && settings.record && canListen(!!status.transcribe) && <button onClick={() => (phone ? togglePhoneMute() : setMic((m) => !m))} aria-label="Mikrofon" title="Mikrofon" className={`flex h-7 w-7 items-center justify-center rounded-full ${(phone ? !phoneMuted : mic) ? 'bg-risk text-white' : 'bg-pill hover:bg-track'}`}>{(phone ? !phoneMuted : mic) ? <Mic size={13} /> : <MicOff size={13} />}</button>}
                <button onClick={() => (inCall ? endCall() : void callOut(client.ref, false))} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-white transition-colors ${inCall ? 'bg-risk' : 'bg-brand hover:bg-brand-dark'}`}>{inCall ? <><PhoneOff size={12} /> Beenden</> : <><Phone size={12} /> Anrufen</>}</button>
              </div>
            }
            chat={chat} busy={busy} detail={settings.detail} chatSuggestions={chatSuggestions} onAsk={ask}
            graphsOpen={settings.graphsOpen} onGraphs={(open) => update({ graphsOpen: open })}
            graphWidth={settings.graphWidth} onGraphWidth={(width) => update({ graphWidth: width })}
            language={settings.language}
            onShowChart={(id) => setChat((c) => c.map((e) => (e.id === id && e.role === 'ki' && e.offered ? { ...e, module: e.offered.spec, offered: undefined } : e)))} />
          )}
        </section>
      </div>

      <SettingsPanel open={settingsOpen} settings={settings} status={status} update={update} onClose={() => setSettingsOpen(false)} />
      {ended && <AfterCall key={ended.ref + ended.lines.length} call={ended} onClose={() => setEnded(null)} />}
    </>
  )
}
