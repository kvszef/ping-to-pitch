import { AlertTriangle, ArrowLeft, Ban, Briefcase, CircleUser, ClipboardList, Info, Menu, Phone, PieChart, Radio, StickyNote, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CardView, slotOf } from './cards/registry'
import { ChatDock } from './components/ChatDock'
import { InfoBand, Pill, SubBar, TopBar, type ToolItem } from './components/Chrome'
import { ClientUpload } from './components/ClientUpload'
import { Dashboard } from './components/Dashboard'
import { LiveOverlay } from './components/LiveOverlay'
import { CardSkeleton, MetricsSkeleton } from './components/Skeleton'
import { sampleCall, signals } from './data/mock'
import { isSample, listClients, localClients, samples } from './data/source'
import { useBriefing } from './data/useBriefing'
import type { Card, IncomingCall } from './types'
import { RingingIsland } from './workspace/CallIsland'
import { Workspace } from './workspace/Workspace'

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
  const [call, setCall] = useState<IncomingCall | null>(hash.includes('anruf') ? sampleCall : null)
  const demoCall = hash.includes('gespraech')
  // First paint from local data (samples + uploads of this session), then the engine's list if it answers.
  const [clients, setClients] = useState(localClients)
  const [listed, setListed] = useState(false)
  const refresh = useCallback(() => { void listClients().then(setClients).catch(() => setClients(localClients())).finally(() => setListed(true)) }, [])
  useEffect(refresh, [refresh])
  const client = clients.find((c) => c.ref === ref)
  const briefing = useBriefing(client?.ref ?? null)
  const caller = clients.find((c) => c.ref === call?.ref)

  const open = (r: string, asCall = false) => { setRef(r); setLive(asCall) }
  const home = (p: Page) => { setRef(null); setLive(false); setPage(p) }
  const [session, setSession] = useState<{ n: number; ref?: string; call?: boolean }>({ n: 0, ref: demoCall ? hash[2] : undefined, call: demoCall })
  // Ein angenommener Anruf öffnet den Arbeitsplatz mit dem Kunden und laufendem Gespräch.
  const accept = () => { if (!call) return; setSession((s) => ({ n: s.n + 1, ref: call.ref, call: true })); setCall(null); home('signale') }

  const signalsItem: ToolItem = { label: 'Anrufe & Signale', icon: Radio, badge: signals.length + (call ? 1 : 0), badgeTone: 'red', active: !client && page === 'signale', onClick: () => home('signale') }
  const banner = call && caller && <RingingIsland client={caller} call={call} signal={signals.find((s) => s.affected.some((a) => a.ref === caller.ref))} onAccept={accept} onDecline={() => setCall(null)} />

  // Deep link to a client that only the engine knows: wait for the list before falling back to the dashboard.
  if (!client && ref && !listed) {
    return (
      <div className="flex h-full flex-col">
        <TopBar />
        <SubBar title={ref} items={[]} />
        <div className="p-2"><CardSkeleton label="Kunde wird geladen" /></div>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="flex h-full flex-col">
        <TopBar />
        <SubBar title="Kundenberater-Dashboard" items={[
          { label: 'Beratermappe', icon: Briefcase },
          signalsItem,
          { label: 'Kundenliste', icon: Users, active: page === 'kunden', onClick: () => home('kunden') },
          { label: 'Regelverletzungen', icon: Ban, badge: clients.reduce((n, c) => n + c.errors, 0), badgeTone: 'red' },
          { label: 'Warnungen', icon: AlertTriangle, badge: clients.reduce((n, c) => n + c.warnings, 0), badgeTone: 'red' },
          { label: '', icon: Menu },
        ]} />
        {page === 'kunden'
          ? <Dashboard clients={clients} onOpen={open} onUploaded={refresh} />
          : <Workspace key={session.n} clients={samples()} signals={signals} initialRef={session.ref} initialCall={session.call} onSimulateCall={() => setCall(sampleCall)} onOpenBriefing={open} />}
        {banner}
      </div>
    )
  }

  const main = briefing.cards.filter((c) => slotOf(c) === 'main')
  const side = briefing.cards.filter((c) => slotOf(c) === 'side')
  const loading = (tier: 'instant' | 'fast' | 'slow') => briefing.pending.includes(tier)
  const withBriefing = { ...client, briefing: briefing.cards }
  // The header pills are the demo shortcuts; an uploaded client gets its own pill while it is open.
  const pills = isSample(client.ref) ? samples() : [...samples(), client]

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <SubBar title={`${client.name} (${client.ref})`} items={[
        { label: 'Telefonberatung', icon: Phone, active: live, onClick: () => setLive((v) => !v) },
        { label: 'Beratermappe', icon: Briefcase },
        signalsItem,
        { label: 'Notizen', icon: StickyNote, badge: 0 },
        { label: 'Briefing', icon: ClipboardList, active: !live },
        { label: 'Analyse', icon: PieChart },
        { label: 'Kundeninformation', icon: CircleUser },
        { label: 'Portfolio', icon: Info },
        { label: '', icon: ArrowLeft, onClick: () => home(page) },
        { label: '', icon: Menu },
      ]} />
      <InfoBand total={client.aum} fields={[
        { label: 'Portfolio', value: client.portfolioNr },
        { label: 'Anlagedienstleistung', value: client.service },
        { label: 'Strategie', value: client.strategy },
        { label: 'Anlass', value: client.context },
      ]}>
        <div className="mt-2 flex gap-2">
          {pills.map((c) => <Pill key={c.ref} icon={CircleUser} active={c.ref === client.ref} onClick={() => open(c.ref, live)}>{c.name}</Pill>)}
          <span className="mx-1 border-l border-ink/40" />
          <ClientUpload variant="pill" onLoaded={refresh} />
        </div>
      </InfoBand>

      <div className="flex min-h-0 flex-1 gap-2.5 p-2">
        <main className="min-w-0 flex-1 space-y-2.5 overflow-y-auto pb-2 pr-0.5">
          {loading('fast') && <CardSkeleton lines={2} label="Einschätzung wird erstellt" />}
          {main.map((card, i) => <div key={cardKey(main, i)} className="anim-rise"><CardView card={card} /></div>)}
          {loading('instant') && <><CardSkeleton lines={4} label="Kundendaten werden geladen" /><CardSkeleton lines={3} /></>}
          {loading('slow') && <CardSkeleton lines={4} label="Marktumfeld wird abgeglichen" />}
          {briefing.pending.length === 0 && !briefing.cards.some((c) => c.type === 'headline') && (
            <p className="px-1 text-[11px] leading-snug text-muted">Für diesen Kunden liegen nur die Angaben aus der Kundendatei vor. Einschätzung, Gesprächsvorschläge und Marktumfeld folgen, sobald die Analyse angebunden ist – es wird nichts vermutet.</p>
          )}
        </main>
        <aside className="flex w-[300px] shrink-0 flex-col gap-2.5">
          {loading('instant') && !side.length && <MetricsSkeleton />}
          {side.map((card, i) => <CardView key={`${client.ref}-s${i}`} card={card} />)}
          {!live && <ChatDock client={withBriefing} className="min-h-0 flex-1" />}
        </aside>
      </div>

      {live && <LiveOverlay client={withBriefing} onClose={() => setLive(false)} />}
      {banner}
    </div>
  )
}
