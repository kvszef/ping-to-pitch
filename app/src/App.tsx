import { AlertTriangle, ArrowLeft, Ban, Briefcase, CircleUser, ClipboardList, Info, Menu, Phone, PieChart, Radio, StickyNote, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CardView, slotOf } from './cards/registry'
import { ChatDock } from './components/ChatDock'
import { InfoBand, Pill, SubBar, TopBar, type ToolItem } from './components/Chrome'
import { ClientUpload } from './components/ClientUpload'
import { ExCustodyUpload } from './components/ExCustodyUpload'
import { Dashboard } from './components/Dashboard'
import { LiveOverlay } from './components/LiveOverlay'
import { CardSkeleton, MetricsSkeleton } from './components/Skeleton'
import { demoCalls } from './data/demoCalls'
import { listClients, localClients } from './data/source'
import { useBriefing } from './data/useBriefing'
import { useLanguage } from './data/useLanguage'
import { useTranslated } from './data/useTranslate'
import type { Card, Client, IncomingCall } from './types'
import * as deskLine from './phone/deskLine'
import { RingingIsland } from './workspace/CallIsland'
import { Workspace, type Callback } from './workspace/Workspace'

type Page = 'kunden' | 'signale'

// Direktlinks: #signale, #signale/gespraech/CASE-B, #CASE-A, #CASE-A/live; Zusatz /anruf simuliert einen eingehenden Anruf
const hash = location.hash.slice(1).split('/').map((part) => { try { return decodeURIComponent(part) } catch { return part } })
// Anything that is not a page name or a call switch is a client ref, so uploaded clients can be deep-linked too.
const hashRef = hash[0] && !['signale', 'kunden', 'anruf'].includes(hash[0]) ? hash[0] : null

// Stable per card while tiers arrive in between: type + title + occurrence, never the list position.
function cardKey(cards: Card[], i: number) {
  const name = (c: Card) => `${c.type}-${'title' in c ? c.title : ''}`
  return `${name(cards[i])}-${cards.slice(0, i).filter((c) => name(c) === name(cards[i])).length}`
}

export default function App() {
  const [page, setPage] = useState<Page>(hash[0] === 'signale' ? 'signale' : 'kunden')
  const [ref, setRef] = useState<string | null>(hashRef)
  const [live, setLive] = useState(hash[1] === 'live')
  const [call, setCall] = useState<IncomingCall | null>(null)
  const demoCall = hash.includes('gespraech')
  // First paint from local data (samples + uploads of this session), then the engine's list if it answers.
  const [clients, setClients] = useState(localClients)
  const [listed, setListed] = useState(false)
  const refresh = useCallback(() => { void listClients().then(setClients).catch(() => setClients(localClients())).finally(() => setListed(true)) }, [])
  useEffect(refresh, [refresh])
  // A demo call rings a real client; its conversation is scripted in data/demoCalls.ts.
  const ring = useCallback((demoId: string) => {
    const demo = demoCalls.find((d) => d.id === demoId)
    if (demo) setCall({ ref: demo.direction === 'eingehend' ? '' : demo.ref, number: '', reason: demo.label, demo: demo.id })
  }, [])
  useEffect(() => { if (listed && hash.includes('anruf')) ring(demoCalls[0].id) }, [listed]) // eslint-disable-line react-hooks/exhaustive-deps
  // An internet call from the client's phone (call.html) rings like a simulated one.
  const line = deskLine.useDeskLine()
  useEffect(() => deskLine.startListening(), [])
  const ringingRef = line.state === 'ringing' ? line.ref : null
  useEffect(() => {
    if (ringingRef) {
      const c = clients.find((x) => x.ref === ringingRef)
      setCall({ ref: ringingRef, number: 'Internetanruf', reason: c ? (c.errors ? `${c.errors} offene Regelverletzungen` : c.context) : '' })
    } else setCall((c) => (c?.number === 'Internetanruf' ? null : c))
  }, [ringingRef]) // eslint-disable-line react-hooks/exhaustive-deps
  const client = clients.find((c) => c.ref === ref)
  // Bumped when an ex-custody statement is attached or removed, so the briefing reloads with it.
  const [importVersion, setImportVersion] = useState(0)
  const briefing = useBriefing(client?.ref ?? null, importVersion)
  // While it rings, the engine's briefing of the caller loads, so the banner shows why they are probably calling.
  const callerListed = clients.find((c) => c.ref === call?.ref)
  const callerBrief = useBriefing(call?.ref ?? null)
  const caller: Client | undefined = callerListed && (callerBrief.cards.length || callerBrief.findings.length)
    ? { ...callerListed, briefing: callerBrief.cards.length ? callerBrief.cards : callerListed.briefing, findings: callerBrief.findings }
    : callerListed

  const open = (r: string, asCall = false) => { setRef(r); setLive(asCall) }
  const home = (p: Page) => { setRef(null); setLive(false); setPage(p) }
  // Calls that came in during another call wait here for a callback; the workspace reports whether a call is on.
  const [callbacks, setCallbacks] = useState<Callback[]>([])
  const [onCall, setOnCall] = useState<{ inCall: boolean; name: string } | null>(null)
  const later = () => {
    if (!call) return
    const at = new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
    setCallbacks((list) => [{ id: `${call.demo ?? call.ref}-${Date.now()}`, ref: call.ref || undefined, demo: call.demo, label: caller?.name ?? 'Unbekannte Nummer', reason: call.reason || 'Anruf', at }, ...list])
    if (deskLine.getLine().state === 'ringing') deskLine.decline()
    setCall(null)
  }
  const [session, setSession] = useState<{ n: number; ref?: string; call?: boolean; demo?: string }>({ n: 0, ref: demoCall ? hash[2] : undefined, call: demoCall })
  // Ein angenommener Anruf öffnet den Arbeitsplatz mit dem Kunden und laufendem Gespräch.
  const accept = () => { if (!call) return; setSession((s) => ({ n: s.n + 1, ref: call.ref || undefined, call: true, demo: call.demo })); setCall(null); home('signale') }

  const language = useLanguage()
  const [
    tKundeWirdGeladen,
    tKundenberaterDashboard,
    tBeratermappe,
    tAnrufeSignale,
    tKundenliste,
    tRegelverletzungen,
    tWarnungen,
    tKundenWerdenGeladen,
    tTelefonberatung,
    tNotizen,
    tBriefing,
    tAnalyse,
    tKundeninformation,
    tPortfolio,
    tAnlagedienstleistung,
    tStrategie,
    tAnlass,
    tEinschaetzungWirdErstellt,
    tKundendatenWerdenGeladen,
    tMarktumfeldWirdAbgeglichen,
    tNurAngabenHinweis,
  ] = useTranslated([
    'Kunde wird geladen',
    'Kundenberater-Dashboard',
    'Beratermappe',
    'Anrufe & Signale',
    'Kundenliste',
    'Regelverletzungen',
    'Warnungen',
    'Kunden werden geladen',
    'Telefonberatung',
    'Notizen',
    'Briefing',
    'Analyse',
    'Kundeninformation',
    'Portfolio',
    'Anlagedienstleistung',
    'Strategie',
    'Anlass',
    'Einschätzung wird erstellt',
    'Kundendaten werden geladen',
    'Marktumfeld wird abgeglichen',
    'Für diesen Kunden liegen nur die Angaben aus der Kundendatei vor. Einschätzung, Gesprächsvorschläge und Marktumfeld folgen, sobald die Analyse angebunden ist – es wird nichts vermutet.',
  ], language)

  const signalsItem: ToolItem = { label: tAnrufeSignale, icon: Radio, badge: call ? 1 : undefined, badgeTone: 'red', active: !client && page === 'signale', onClick: () => home('signale') }
  // An unknown number rings without client details; the name is picked up from the conversation.
  const banner = call && (caller || !call.ref) && <RingingIsland client={caller} call={call} busyWith={onCall?.name} onLater={later} onAccept={() => { if (deskLine.getLine().state === 'ringing') void deskLine.accept(); accept() }} onDecline={() => { deskLine.decline(); setCall(null) }} />

  // Deep link to a client that only the engine knows: wait for the list before falling back to the dashboard.
  if (!client && ref && !listed) {
    return (
      <div className="flex h-full flex-col">
        <TopBar />
        <SubBar title={ref} items={[]} />
        <div className="p-2"><CardSkeleton label={tKundeWirdGeladen} /></div>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="flex h-full flex-col">
        <TopBar />
        <SubBar title={tKundenberaterDashboard} items={[
          { label: tBeratermappe, icon: Briefcase },
          signalsItem,
          { label: tKundenliste, icon: Users, active: page === 'kunden', onClick: () => home('kunden') },
          { label: tRegelverletzungen, icon: Ban, badge: clients.reduce((n, c) => n + c.errors, 0), badgeTone: 'red' },
          { label: tWarnungen, icon: AlertTriangle, badge: clients.reduce((n, c) => n + c.warnings, 0), badgeTone: 'red' },
          { label: '', icon: Menu },
        ]} />
        {page === 'kunden'
          ? <Dashboard clients={clients} onUploaded={refresh} />
          : listed ? <Workspace key={session.n} clients={clients} signals={[]} initialRef={session.ref} initialCall={session.call} initialDemo={session.demo} onSimulateCall={ring} onOpenBriefing={open}
            callbacks={callbacks} onCallbackDone={(id) => setCallbacks((list) => list.filter((c) => c.id !== id))} onCallState={setOnCall} />
          : <div className="p-3"><CardSkeleton label={tKundenWerdenGeladen} /></div>}
        {banner}
      </div>
    )
  }

  const main = briefing.cards.filter((c) => slotOf(c) === 'main')
  const side = briefing.cards.filter((c) => slotOf(c) === 'side')
  const loading = (tier: 'instant' | 'fast' | 'slow') => briefing.pending.includes(tier)
  const withBriefing = { ...client, briefing: briefing.cards }
  // The header pills are the demo shortcuts; an uploaded client gets its own pill while it is open.
  const pills = [client]

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <SubBar title={`${client.name} (${client.ref})`} items={[
        { label: tTelefonberatung, icon: Phone, active: live, onClick: () => setLive((v) => !v) },
        { label: tBeratermappe, icon: Briefcase },
        signalsItem,
        { label: tNotizen, icon: StickyNote, badge: 0 },
        { label: tBriefing, icon: ClipboardList, active: !live },
        { label: tAnalyse, icon: PieChart },
        { label: tKundeninformation, icon: CircleUser },
        { label: tPortfolio, icon: Info },
        { label: '', icon: ArrowLeft, onClick: () => home(page) },
        { label: '', icon: Menu },
      ]} />
      <InfoBand total={client.aum} fields={[
        { label: tPortfolio, value: client.portfolioNr },
        { label: tAnlagedienstleistung, value: client.service },
        { label: tStrategie, value: client.strategy },
        { label: tAnlass, value: client.context },
      ]}>
        <div className="mt-2 flex gap-2">
          {pills.map((c) => <Pill key={c.ref} icon={CircleUser} active={c.ref === client.ref} onClick={() => open(c.ref, live)}>{c.name}</Pill>)}
          <span className="mx-1 border-l border-ink/40" />
          <ClientUpload variant="pill" onLoaded={refresh} />
          <ExCustodyUpload clientRef={client.ref} onChanged={() => setImportVersion((v) => v + 1)} />
        </div>
      </InfoBand>

      <div className="flex min-h-0 flex-1 gap-2.5 p-2">
        <main className="min-w-0 flex-1 space-y-4 overflow-y-auto pb-2 pr-0.5">
          {loading('fast') && <CardSkeleton lines={2} label={tEinschaetzungWirdErstellt} />}
          {main.map((card, i) => <div key={cardKey(main, i)} className="anim-rise"><CardView card={card} /></div>)}
          {loading('instant') && <><CardSkeleton lines={4} label={tKundendatenWerdenGeladen} /><CardSkeleton lines={3} /></>}
          {loading('slow') && <CardSkeleton lines={4} label={tMarktumfeldWirdAbgeglichen} />}
          {briefing.pending.length === 0 && !briefing.cards.some((c) => c.type === 'headline' || c.type === 'talktrack') && (
            <p className="px-1 text-[11px] leading-snug text-muted">{tNurAngabenHinweis}</p>
          )}
        </main>
        <aside className="flex w-[300px] shrink-0 flex-col gap-4">
          {loading('instant') && !side.length && <MetricsSkeleton />}
          {side.map((card, i) => <CardView key={`${client.ref}-s${i}`} card={card} />)}
        </aside>
      </div>

      {!live && <ChatDock client={withBriefing} />}
      {live && <LiveOverlay client={withBriefing} onClose={() => setLive(false)} />}
      {banner}
    </div>
  )
}
