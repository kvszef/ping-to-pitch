import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { defaults } from './settings'
import type { Status } from './brain'
import type { Detail, Provider, Settings } from './types'

const details: { id: Detail; label: string; text: string }[] = [
  { id: 'kurz', label: 'Kurz', text: 'Ein bis zwei Sätze, nur Kernzahlen.' },
  { id: 'standard', label: 'Standard', text: 'Kernaussage mit Begründung.' },
  { id: 'detailliert', label: 'Detailliert', text: 'Vollständige Herleitung, Grafiken mit Wertetabelle.' },
]

function Row({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="border-b border-line py-4">
      <div className="font-medium">{title}</div>
      <div className="mb-3 text-[11px] leading-snug text-muted">{hint}</div>
      {children}
    </div>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex items-center gap-2 text-xs">
      <span className={`flex h-4 w-8 items-center rounded-full px-0.5 transition-colors duration-300 ${on ? 'bg-brand' : 'bg-track'}`}>
        <span className={`h-3 w-3 rounded-full bg-white transition-transform duration-300 ${on ? 'translate-x-4' : ''}`} />
      </span>
      {label}
    </button>
  )
}

const providers: { id: Provider; label: string; text: string }[] = [
  { id: 'openai', label: 'OpenAI', text: 'Verarbeitung ausserhalb der Schweiz. Es werden nur anonymisierte Fakten übermittelt.' },
  { id: 'apertus', label: 'Apertus', text: 'Offenes Schweizer Sprachmodell. Geeignet für den Betrieb in der Schweiz oder im Haus.' },
]

export function SettingsPanel({ open, settings, status, update, onClose }: { open: boolean; settings: Settings; status: Status; update: (p: Partial<Settings>) => void; onClose: () => void }) {
  return (
    <>
      <div onClick={onClose} className={`fixed inset-0 z-40 bg-ink/30 transition-opacity duration-300 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />
      <aside aria-hidden={!open} className={`fixed inset-y-0 right-0 z-50 flex w-[380px] max-w-full flex-col bg-white shadow-[0_0_30px_rgba(0,0,0,0.3)] transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none ${open ? '' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between bg-topbar px-4 py-2.5 text-white">
          <span className="text-[15px]">Einstellungen des Beraters</span>
          <button onClick={onClose} aria-label="Schliessen"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 text-xs">
          <Row title="Sprache" hint="Die Engine rechnet und begründet weiterhin auf Deutsch; Englisch übersetzt nur die Anzeige, keine Zahl oder Kennzahl ändert sich dabei.">
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => update({ language: 'de' })} className={`rounded-sm px-2 py-1.5 transition-colors ${settings.language === 'de' ? 'bg-brand text-white' : 'bg-pill hover:bg-track'}`}>Deutsch</button>
              <button onClick={() => update({ language: 'en' })} className={`rounded-sm px-2 py-1.5 transition-colors ${settings.language === 'en' ? 'bg-brand text-white' : 'bg-pill hover:bg-track'}`}>English</button>
            </div>
          </Row>

          <Row title="KI-Anbieter" hint="Welches Sprachmodell Gesprächsassistent und Berater-Chat verwenden. Ist der gewählte Anbieter nicht eingerichtet, arbeitet das Werkzeug im Beispielmodus.">
            <div className="grid grid-cols-2 gap-1.5">
              {providers.map((p) => (
                <button key={p.id} onClick={() => update({ provider: p.id })} className={`rounded-sm px-2 py-1.5 transition-colors ${settings.provider === p.id ? 'bg-brand text-white' : 'bg-pill hover:bg-track'}`}>{p.label}</button>
              ))}
            </div>
            <div className="mt-2 text-[11px] leading-snug text-muted">{providers.find((p) => p.id === settings.provider)!.text}</div>
            <div className={`mt-1 text-[11px] ${status[settings.provider] ? 'text-ok' : 'text-risk'}`}>{status[settings.provider] ? 'Eingerichtet und aktiv.' : 'Nicht eingerichtet – Beispielmodus aktiv.'}</div>
          </Row>

          <Row title="Gespräch aufzeichnen" hint="Eingeschaltet: Das Gespräch wird transkribiert, der Gesprächsassistent reagiert auf das Gesagte. Ausgeschaltet: Es wird nichts aufgezeichnet, der Gesprächsassistent stützt sich nur auf Berater-Chat und Kundendaten.">
            <Toggle on={settings.record} onChange={(record) => update({ record })} label={settings.record ? 'Aufzeichnung und Transkription ein' : 'Keine Aufzeichnung'} />
          </Row>

          <Row title="Detailgrad der Antworten" hint="Gilt für die Einblicke im Berater-Chat und für die Grafikmodule.">
            <div className="grid grid-cols-3 gap-1.5">
              {details.map((d) => (
                <button key={d.id} onClick={() => update({ detail: d.id })} className={`rounded-sm px-2 py-1.5 transition-colors ${settings.detail === d.id ? 'bg-brand text-white' : 'bg-pill hover:bg-track'}`}>{d.label}</button>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-muted">{details.find((d) => d.id === settings.detail)!.text}</div>
          </Row>

          <Row title="Grafikmodule" hint="Die KI blendet eine Grafik nur ein, wenn sie sicher genug ist, dass sie zur Frage passt. Darunter bietet sie die Grafik lediglich an.">
            <Toggle on={settings.autoModules} onChange={(autoModules) => update({ autoModules })} label="Grafiken automatisch einblenden" />
            <div className={`mt-4 transition-opacity ${settings.autoModules ? '' : 'pointer-events-none opacity-40'}`}>
              <div className="mb-1 flex justify-between"><span>Konfidenzschwelle</span><span className="tabular-nums">{settings.confidence}%</span></div>
              <input type="range" min={50} max={95} step={5} value={settings.confidence} onChange={(e) => update({ confidence: +e.target.value })} className="w-full accent-brand" />
            </div>
          </Row>

          <button onClick={() => update(defaults)} className="my-4 rounded-sm bg-pill px-3 py-1.5 hover:bg-track">Auf Standard zurücksetzen</button>
        </div>
      </aside>
    </>
  )
}
