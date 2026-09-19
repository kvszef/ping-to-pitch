import { ChevronDown, Compass, Ear, Phone, PhoneOff } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Client, IncomingCall, Signal } from '../types'
import type { Slot } from './types'

// Hält einen Wert mindestens `ms` lang fest. Trifft früher etwas Neues ein, wird nur das
// jeweils Letzte nach Ablauf übernommen – die Anzeige wechselt ruhig statt hektisch.
export function usePaced<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value)
  const since = useRef(0)
  useEffect(() => {
    if (value === shown) return
    const wait = Math.max(0, since.current + ms - Date.now())
    const timer = setTimeout(() => { since.current = Date.now(); setShown(value) }, shown == null ? 0 : wait)
    return () => clearTimeout(timer)
  }, [value, shown, ms])
  return shown
}

const shell = 'pointer-events-auto overflow-hidden bg-[#0d0f12]/90 text-white shadow-[0_12px_40px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-xl transition-[width,border-radius] duration-700 ease-[cubic-bezier(.3,1.35,.5,1)] motion-reduce:transition-none'

function Island({ width, radius, children }: { width: number; radius: number; children: ReactNode }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-1.5 z-[60] flex justify-center px-2">
      <div className={`island-pop ${shell}`} style={{ width, maxWidth: '100%', borderRadius: radius }}>{children}</div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div><div className="truncate text-xs">{value}</div></div>
}

export function RingingIsland({ client, call, signal, onAccept, onDecline }: { client: Client; call: IncomingCall; signal?: Signal; onAccept: () => void; onDecline: () => void }) {
  const headline = client.briefing.find((c) => c.type === 'headline')
  return (
    <Island width={470} radius={30}>
      <div className="flex items-center gap-3 px-4 pt-4">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ok"><span className="absolute inset-0 animate-ping rounded-full bg-ok/60" /><Phone size={18} className="relative" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-white/50">Eingehender Anruf · {call.number}</div>
          <div className="truncate text-[17px]">{client.name} <span className="text-xs text-white/50">{client.ref}</span></div>
        </div>
        <button onClick={onDecline} aria-label="Ablehnen" className="flex h-10 w-10 items-center justify-center rounded-full bg-risk transition-transform hover:scale-110"><PhoneOff size={16} /></button>
        <button onClick={onAccept} aria-label="Annehmen" className="flex h-10 w-10 items-center justify-center rounded-full bg-ok transition-transform hover:scale-110"><Phone size={16} /></button>
      </div>
      <div className="island-stagger grid grid-cols-3 gap-x-4 gap-y-2.5 px-4 pt-4">
        <Fact label="Kundenprofil" value={client.profile} />
        <Fact label="Strategie" value={client.strategy} />
        <Fact label="Vermögen" value={client.aum} />
        <Fact label="Letzte Beratung" value={client.lastConsultation} />
        <Fact label="Regelverletzungen" value={`${client.errors} Fehler · ${client.warnings} Warnungen`} />
        <Fact label="Anlagedienstleistung" value={client.service} />
      </div>
      <div className="island-stagger m-3 rounded-[18px] bg-white/[0.07] p-3">
        {headline && <p className="text-xs leading-snug">{headline.text}</p>}
        <p className="mt-1.5 text-[11px] text-white/50">{signal ? `Vermuteter Anlass: ${signal.title}` : call.reason}</p>
      </div>
    </Island>
  )
}

export function Wave() {
  return <span className="flex h-4 items-center gap-[2px]" aria-hidden>{[0, 1, 2, 3, 4].map((i) => <span key={i} className="island-wave w-[2px] rounded-full bg-ok" style={{ animationDelay: `${i * 0.12}s` }} />)}</span>
}

export function SlotView({ tone, icon, label, action, slot, empty }: { tone: string; icon: ReactNode; label: string; action: string; slot: Slot | null; empty: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-[18px] bg-white/[0.07] p-4">
      <div className={`mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide ${tone}`}>{icon}{label}</div>
      {slot ? (
        <div key={slot.topic + slot.heard} className="island-swap">
          <p className="truncate text-[12px] italic text-white/45">«{slot.heard}»</p>
          <p className={`mt-1.5 text-[10px] uppercase tracking-wide ${tone}`}>{action}</p>
          <p className="text-[16px] leading-snug">{slot.text}</p>
        </div>
      ) : <p className="text-[11px] leading-snug text-white/40">{empty}</p>}
    </div>
  )
}

export function LiveIsland({ client, recording, customer, advisor, onEnd }: { client: Client; recording: boolean; customer: Slot | null; advisor: Slot | null; onEnd: () => void }) {
  const [open, setOpen] = useState(true)
  const [seconds, setSeconds] = useState(0)
  useEffect(() => { const t = setInterval(() => setSeconds((s) => s + 1), 1000); return () => clearInterval(t) }, [])
  const shownCustomer = usePaced(customer, 7000)
  const shownAdvisor = usePaced(advisor, 7000)
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <Island width={open ? 640 : 300} radius={open ? 30 : 22}>
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        <Wave />
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="truncate text-[13px]">{client.name}</span>
          <span className="text-[11px] tabular-nums text-white/50">{clock}</span>
          {open && <span className="truncate text-[11px] text-white/40">· {recording ? 'wird transkribiert' : 'keine Aufzeichnung'}</span>}
          <ChevronDown size={14} className={`ml-auto shrink-0 text-white/50 transition-transform duration-500 ${open ? 'rotate-180' : ''}`} />
        </button>
        <button onClick={onEnd} aria-label="Gespräch beenden" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-risk transition-transform hover:scale-110"><PhoneOff size={13} /></button>
      </div>
      <div className={`grid transition-[grid-template-rows,opacity] duration-700 ease-[cubic-bezier(.3,1.2,.5,1)] motion-reduce:transition-none ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="flex gap-2 px-3 pb-3">
            <SlotView tone="text-[#7db8ff]" icon={<Ear size={11} />} label="Der Kunde sagte" action="Ihre Antwort" slot={shownCustomer}
              empty={recording ? 'Wartet auf die erste Aussage des Kunden …' : 'Keine Aufzeichnung – es wird nichts vom Kunden ausgewertet.'} />
            <SlotView tone="text-[#69d4d6]" icon={<Compass size={11} />} label={recording ? 'Sie sagten' : 'Ihre letzte Frage im Chat'} action="Nächster Schritt" slot={shownAdvisor}
              empty={recording ? 'Wartet auf Ihre erste Aussage …' : 'Stellen Sie eine Frage im Berater-Chat, um den nächsten Schritt zu erhalten.'} />
          </div>
        </div>
      </div>
    </Island>
  )
}
