import { AlertTriangle, ArrowLeft, Ban, Briefcase, CircleUser, ClipboardList, Info, Menu, Phone, PieChart, Radio, StickyNote, Upload, Users } from 'lucide-react'
import { useState } from 'react'
import { CardView, slotOf } from './cards/registry'
import { ChatDock } from './components/ChatDock'
import { InfoBand, Pill, SubBar, TopBar, type ToolItem } from './components/Chrome'
import { Dashboard } from './components/Dashboard'
import { LiveOverlay } from './components/LiveOverlay'
import { clients, sampleCall, signals } from './data/mock'
import type { IncomingCall } from './types'
import { RingingIsland } from './workspace/CallIsland'
import { Workspace } from './workspace/Workspace'

type Page = 'kunden' | 'signale'

// Direktlinks: #signale, #signale/gespraech/CASE-B, #CASE-A, #CASE-A/live; Zusatz /anruf simuliert einen eingehenden Anruf
const hash = location.hash.slice(1).split('/')

export default function App() {
  const [page, setPage] = useState<Page>(hash[0] === 'signale' ? 'signale' : 'kunden')
  const [ref, setRef] = useState<string | null>(() => (hash[0]?.startsWith('CASE') ? hash[0] : null))
  const [live, setLive] = useState(hash[1] === 'live')
  const [call, setCall] = useState<IncomingCall | null>(hash.includes('anruf') ? sampleCall : null)
  const demoCall = hash.includes('gespraech')
  const client = clients.find((c) => c.ref === ref)
  const caller = clients.find((c) => c.ref === call?.ref)

  const open = (r: string, asCall = false) => { setRef(r); setLive(asCall) }
  const home = (p: Page) => { setRef(null); setLive(false); setPage(p) }
  const [session, setSession] = useState<{ n: number; ref?: string; call?: boolean }>({ n: 0, ref: demoCall ? hash[2] : undefined, call: demoCall })
  // Ein angenommener Anruf öffnet den Arbeitsplatz mit dem Kunden und laufendem Gespräch.
  const accept = () => { if (!call) return; setSession((s) => ({ n: s.n + 1, ref: call.ref, call: true })); setCall(null); home('signale') }

  const signalsItem: ToolItem = { label: 'Anrufe & Signale', icon: Radio, badge: signals.length + (call ? 1 : 0), badgeTone: 'red', active: !client && page === 'signale', onClick: () => home('signale') }
  const banner = call && caller && <RingingIsland client={caller} call={call} signal={signals.find((s) => s.affected.some((a) => a.ref === caller.ref))} onAccept={accept} onDecline={() => setCall(null)} />

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
          ? <Dashboard clients={clients} onOpen={open} />
          : <Workspace key={session.n} clients={clients} signals={signals} initialRef={session.ref} initialCall={session.call} onSimulateCall={() => setCall(sampleCall)} onOpenBriefing={open} />}
        {banner}
      </div>
    )
  }

  const main = client.briefing.filter((c) => slotOf(c) === 'main')
  const side = client.briefing.filter((c) => slotOf(c) === 'side')

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
          {clients.map((c) => <Pill key={c.ref} icon={CircleUser} active={c.ref === client.ref} onClick={() => open(c.ref, live)}>{c.name}</Pill>)}
          <span className="mx-1 border-l border-ink/40" />
          <Pill icon={Upload}>Kundendatei laden</Pill>
        </div>
      </InfoBand>

      <div className="flex min-h-0 flex-1 gap-2.5 p-2">
        <main className="min-w-0 flex-1 space-y-2.5 overflow-y-auto pb-2 pr-0.5">
          {main.map((card, i) => <CardView key={`${client.ref}-${i}`} card={card} />)}
        </main>
        <aside className="flex w-[300px] shrink-0 flex-col gap-2.5">
          {side.map((card, i) => <CardView key={`${client.ref}-s${i}`} card={card} />)}
          {!live && <ChatDock client={client} className="min-h-0 flex-1" />}
        </aside>
      </div>

      {live && <LiveOverlay client={client} onClose={() => setLive(false)} />}
      {banner}
    </div>
  )
}
