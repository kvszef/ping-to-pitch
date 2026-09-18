import { ArrowLeft, Briefcase, CircleUser, ClipboardList, FileUp, Info, Menu, Phone, PieChart, StickyNote, Upload } from 'lucide-react'
import { useState } from 'react'
import { CardView, slotOf } from './cards/registry'
import { ChatDock } from './components/ChatDock'
import { InfoBand, Pill, SubBar, TopBar } from './components/Chrome'
import { Dashboard } from './components/Dashboard'
import { LiveOverlay } from './components/LiveOverlay'
import { clients } from './data/mock'

// Deep link: #CASE-A or #CASE-A/live
const hash = location.hash.slice(1).split('/')

export default function App() {
  const [ref, setRef] = useState<string | null>(() => hash[0] || null)
  const [live, setLive] = useState(hash[1] === 'live')
  const client = clients.find((c) => c.ref === ref)

  if (!client) {
    return (
      <div className="flex h-full flex-col">
        <TopBar />
        <Dashboard clients={clients} onOpen={setRef} />
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
        { label: 'Notizen', icon: StickyNote, badge: 0 },
        { label: 'Briefing', icon: ClipboardList, active: !live },
        { label: 'Analyse', icon: PieChart },
        { label: 'Kundeninformation', icon: CircleUser },
        { label: 'Portfolio', icon: Info },
        { label: '', icon: ArrowLeft, onClick: () => { setRef(null); setLive(false) } },
        { label: '', icon: Menu },
      ]} />
      <InfoBand total={client.aum} fields={[
        { label: 'Portfolio', value: client.portfolioNr },
        { label: 'Anlagedienstleistung', value: client.service },
        { label: 'Strategie', value: client.strategy },
        { label: 'Anlass', value: client.context },
      ]}>
        <div className="mt-2 flex gap-2">
          {clients.map((c) => <Pill key={c.ref} icon={CircleUser} active={c.ref === client.ref} onClick={() => setRef(c.ref)}>{c.name}</Pill>)}
          <span className="mx-1 border-l border-ink/40" />
          <Pill icon={Upload}>clients.json</Pill>
          <Pill icon={FileUp}>Fremdbank-PDF</Pill>
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
    </div>
  )
}
