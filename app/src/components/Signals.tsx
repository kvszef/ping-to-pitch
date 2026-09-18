import { Activity, ArrowRight, Phone, PhoneCall, PhoneIncoming, PhoneOff } from 'lucide-react'
import type { Client, IncomingCall, Signal } from '../types'
import { Panel, SeverityIcon, Source } from '../cards/ui'
import { Pill } from './Chrome'

type Props = {
  clients: Client[]
  signals: Signal[]
  call: IncomingCall | null
  onSimulateCall: () => void
  onAccept: () => void
  onDecline: () => void
  onOpen: (ref: string) => void
}

const order = { risk: 0, warn: 1, info: 2, ok: 3 }

export function Signals({ clients, signals, call, onSimulateCall, onAccept, onDecline, onOpen }: Props) {
  const byRef = new Map(clients.map((c) => [c.ref, c]))
  const outreach = signals
    .flatMap((s) => s.affected.map((a) => ({ ...a, signal: s, client: byRef.get(a.ref) })))
    .filter((o) => o.client)
    .sort((a, b) => order[a.severity] - order[b.severity])
  const caller = call && byRef.get(call.ref)
  const callerHeadline = caller?.briefing.find((c) => c.type === 'headline')

  return (
    <>
      <div className="flex shrink-0 items-center justify-between bg-band px-3 py-3">
        <div>
          <div className="text-[17px]">Anrufe &amp; Signale</div>
          <div className="mt-1 text-[11px]">
            Eingehende Anrufe: {call ? 1 : 0} <span className="mx-1 text-muted">|</span> Marktsignale: {signals.length} <span className="mx-1 text-muted">|</span> Kontaktvorschläge: {outreach.length}
          </div>
        </div>
        <Pill icon={PhoneCall} onClick={onSimulateCall}>Anruf simulieren</Pill>
      </div>

      <main className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2">
        <Panel title="Eingehender Anruf" icon={PhoneIncoming} className={caller ? 'border-l-4 border-brand' : ''}>
          {caller && call ? (
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 animate-pulse items-center justify-center rounded-full bg-brand text-white"><Phone size={18} /></span>
                <div>
                  <div className="text-[16px]">{caller.name} <span className="text-xs text-muted">({caller.ref})</span></div>
                  <div className="text-xs text-muted">{call.number} · {caller.profile} · {caller.aum}</div>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                {callerHeadline && <div className="leading-snug">{callerHeadline.text}</div>}
                <div className="mt-1 text-[11px] text-muted">{call.reason}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={onAccept} className="flex items-center gap-1.5 rounded-sm bg-brand px-3 py-1.5 text-xs text-white hover:bg-brand-dark"><Phone size={13} /> Annehmen und Briefing öffnen</button>
                <button onClick={onDecline} className="flex items-center gap-1.5 rounded-sm bg-pill px-3 py-1.5 text-xs hover:bg-track"><PhoneOff size={13} /> Ablehnen</button>
              </div>
            </div>
          ) : (
            <p className="text-muted">Kein aktiver Anruf. Eingehende Anrufe erscheinen hier mit dem Kurzbriefing des Kunden.</p>
          )}
        </Panel>

        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-start">
          <Panel title="Proaktive Kontaktaufnahme" icon={PhoneCall} className="min-w-0 flex-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b-2 border-ink/70 text-left">
                  <th className="w-8 py-2 pl-2" />
                  {['Kunde', 'Signal', 'Betroffenheit', 'Gesprächseinstieg', ''].map((h, i) => <th key={i} className="py-2 pr-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {outreach.map((o, i) => (
                  <tr key={`${o.signal.id}-${o.ref}`} className={`align-top ${i % 2 ? 'bg-stripe' : ''}`}>
                    <td className="py-2.5 pl-2"><SeverityIcon severity={o.severity} size={12} /></td>
                    <td className="whitespace-nowrap py-2.5 pr-3"><button onClick={() => onOpen(o.ref)} className="text-brand hover:underline">{o.client!.name}</button><div className="text-[11px] text-muted">{o.client!.profile}</div></td>
                    <td className="py-2.5 pr-3">{o.signal.title}</td>
                    <td className="py-2.5 pr-3">{o.exposure}</td>
                    <td className="py-2.5 pr-3 italic text-muted">«{o.opener}»</td>
                    <td className="whitespace-nowrap py-2.5 pr-2 text-right"><button onClick={() => onOpen(o.ref)} className="inline-flex items-center gap-1 text-brand hover:underline">Briefing <ArrowRight size={12} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Marktsignale" icon={Activity} className="xl:w-[380px] xl:shrink-0">
            <ul>
              {signals.map((s, i) => (
                <li key={s.id} className={`px-2 py-2 ${i % 2 ? 'bg-stripe' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="leading-snug">{s.title}</span>
                    <span className="shrink-0 rounded-sm bg-pill px-1.5 py-px text-[10px]">{s.reach}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted">{s.detail}</div>
                  <div className="mt-0.5 text-[11px] text-muted">{s.time} <Source>{s.source}</Source> <Source>{s.affected.length} {s.affected.length === 1 ? 'Kunde' : 'Kunden'} betroffen</Source></div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </main>
    </>
  )
}

export function CallBanner({ client, call, onAccept, onDecline }: { client: Client; call: IncomingCall; onAccept: () => void; onDecline: () => void }) {
  return (
    <div className="fixed right-2 top-[74px] z-30 w-[320px] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-2 bg-topbar px-3 py-2 text-xs text-white"><span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Eingehender Anruf</div>
      <div className="p-3">
        <div className="text-[15px]">{client.name} <span className="text-xs text-muted">({client.ref})</span></div>
        <div className="text-[11px] text-muted">{call.number}</div>
        <div className="mt-2 text-[11px] text-muted">{call.reason}</div>
        <div className="mt-3 flex gap-2">
          <button onClick={onAccept} className="flex-1 rounded-sm bg-brand px-3 py-1.5 text-xs text-white hover:bg-brand-dark">Annehmen</button>
          <button onClick={onDecline} className="rounded-sm bg-pill px-3 py-1.5 text-xs hover:bg-track">Ablehnen</button>
        </div>
      </div>
    </div>
  )
}
