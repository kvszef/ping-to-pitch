import { ChevronDown, Search, User, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSettings } from '../workspace/settings'

// The language switch lives here, in the one bar every page shares — the Kundenliste itself has no
// settings gear (that only exists inside the call workspace), so this is the only place a user who
// hasn't opened a client yet can find it.
function LanguageSwitch() {
  const [settings, update] = useSettings()
  return (
    <div className="flex items-center overflow-hidden rounded-full border border-white/40 text-[10px]">
      <button onClick={() => update({ language: 'de' })} className={`px-2 py-0.5 ${settings.language === 'de' ? 'bg-white text-topbar' : 'text-white/80 hover:text-white'}`}>DE</button>
      <button onClick={() => update({ language: 'en' })} className={`px-2 py-0.5 ${settings.language === 'en' ? 'bg-white text-topbar' : 'text-white/80 hover:text-white'}`}>EN</button>
    </div>
  )
}

export function TopBar() {
  return (
    <header className="flex h-9 shrink-0 items-center justify-between bg-topbar px-2 text-white">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border-[3px] border-white text-[11px] font-semibold leading-none">U</span>
        <span className="text-[17px] tracking-wide"><span className="font-semibold">UNRISK</span><span className="font-light">OMEGA</span></span>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex w-52 items-center border-b border-white/80 pb-0.5">
          <Search size={12} strokeWidth={3} />
          <input className="ml-2 w-full bg-transparent text-xs outline-none" />
        </label>
        <LanguageSwitch />
        <span className="flex items-center gap-1 text-xs"><User size={13} /> Hans Muster <ChevronDown size={12} fill="white" /></span>
      </div>
    </header>
  )
}

export type ToolItem = { label: string; icon: LucideIcon; badge?: number; badgeTone?: 'grey' | 'red'; active?: boolean; onClick?: () => void }

export function SubBar({ title, items }: { title: string; items: ToolItem[] }) {
  return (
    <div className="relative z-10 flex h-[30px] shrink-0 items-center justify-between bg-subbar pl-3 shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
      <div className="text-[15px]">{title}</div>
      <nav className="flex h-full">
        {items.map(({ label, icon: Icon, badge, badgeTone, active, onClick }, i) => (
          <button key={i} onClick={onClick} className={`flex h-full items-center gap-1.5 border-l border-line px-3 text-xs hover:text-brand ${active ? 'text-brand' : ''}`}>
            <Icon size={15} strokeWidth={1.5} />
            {label}
            {badge !== undefined && <span className={`rounded-full px-1.5 text-[10px] text-white ${badgeTone === 'red' ? 'bg-risk' : 'bg-muted/70'}`}>{badge}</span>}
          </button>
        ))}
      </nav>
    </div>
  )
}

export function InfoBand({ fields, total, children }: { fields: { label: string; value: string }[]; total?: string; children?: ReactNode }) {
  return (
    <div className="shrink-0 bg-band px-3 pb-2 pt-2">
      <div className="flex items-end justify-between">
        <div className="flex">
          {fields.map((f, i) => (
            <div key={f.label} className={i ? 'ml-4 border-l border-ink pl-4' : ''}>
              <div className="text-[11px]">{f.label}</div>
              <div className="text-[15px]">{f.value}</div>
            </div>
          ))}
        </div>
        {total && <div className="text-[16px]">{total}</div>}
      </div>
      {children}
    </div>
  )
}

export function Pill({ icon: Icon, active, children, onClick }: { icon: LucideIcon; active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors ${active ? 'bg-brand text-white' : 'bg-pill hover:bg-track'}`}>
      <Icon size={13} /> {children}
    </button>
  )
}
