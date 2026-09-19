import { CircleCheck, LoaderCircle, Upload, XCircle } from 'lucide-react'
import { useRef, useState } from 'react'
import { uploadClients, type UploadResult } from '../data/source'
import { useLanguage } from '../data/useLanguage'
import { useTranslated } from '../data/useTranslate'

// "Kundendatei laden": picks a .json file shaped like clients.json and adds its clients to the session.
// `pill` matches the pills in the briefing header, `box` matches the search box on the dashboard.
export function ClientUpload({ variant, onLoaded }: { variant: 'pill' | 'box'; onLoaded: (result: Extract<UploadResult, { ok: true }>) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const language = useLanguage()
  const [label, resultText] = useTranslated(['Kundendatei laden', result?.message ?? ''], language)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setResult(null)
    const r = await uploadClients(file).catch((): UploadResult => ({ ok: false, message: 'Die Datei konnte nicht geladen werden.' }))
    setBusy(false)
    setResult(r)
    if (r.ok) onLoaded(r)
  }

  const Icon = busy ? LoaderCircle : Upload
  const style = variant === 'pill' ? 'rounded-sm bg-pill px-2.5 py-1 hover:bg-track' : 'border border-line bg-white px-2.5 py-[5px] hover:border-brand hover:text-brand'
  return (
    <span className={`flex items-center gap-2 text-xs ${variant === 'box' ? 'flex-row-reverse' : ''}`}>
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className={`flex shrink-0 items-center gap-1.5 ${style}`}>
        <Icon size={13} className={busy ? 'animate-spin' : ''} /> {label}
      </button>
      <input ref={input} type="file" accept=".json,application/json" data-testid="client-file" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
      {result && (
        <span role="status" className={`flex items-center gap-1 ${result.ok ? '' : 'text-risk'}`}>
          {result.ok ? <CircleCheck size={13} className="shrink-0 text-ok" /> : <XCircle size={13} className="shrink-0" />} {resultText || result.message}
        </span>
      )}
    </span>
  )
}
