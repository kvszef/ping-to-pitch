import type { CardOf, Severity, TalkLine } from '../types.ts'
import type { ClientFacts } from './facts.ts'
import { isObj, list, str } from './facts.ts'

// The 60-second talk track for a raw client file (PLAN section 2): open with, must mention, ask,
// don't bring up, plus ranked guesses why the client might be calling. Deterministic and pure; the
// engine's briefing writer (A1) replaces it once it serves `talktrack` cards. Values quoted from the
// file (notes, proposal reasons) stay as written.

const DAY = 86_400_000
const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
const day = (iso: string) => (iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '')
const time = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0 }

type Flag = { severity: Severity; text: string }

export function talkTrackFromRaw(input: unknown, facts: ClientFacts, flags: Flag[], now: Date): CardOf<'talktrack'> {
  const raw = isObj(input) ? input : {}
  const p = facts.performance
  const errors = flags.filter((f) => f.severity === 'risk')
  const top = facts.positions[0]

  const open: TalkLine = p
    ? { text: `Guten Tag, ich melde mich zu Ihrem Portfolio: seit Jahresbeginn ${signed(p.ytd)}${errors.length ? ', und es gibt einen Punkt, den ich kurz mit Ihnen anschauen möchte.' : '. Alles im Rahmen, ich habe zwei kurze Fragen.'}`, source: 'Wertverlauf des Portfolios', date: facts.asOf }
    : { text: 'Guten Tag, ich melde mich zu Ihrem Portfolio und habe zwei kurze Punkte.', source: 'Kundendatei' }

  const mention: TalkLine[] = [
    ...errors.slice(0, 2).map((f) => ({ text: `${f.text}.`, source: 'Regelverletzung', severity: f.severity })),
    ...(p && p.month <= -3 ? [{ text: `Letzter Monat ${signed(p.month)}; schwächster Monat bisher ${p.worst.label} mit ${signed(p.worst.value)}.`, source: 'Wertverlauf des Portfolios', date: facts.asOf, severity: 'warn' as Severity }] : []),
    ...(top && top.share >= 10 && !errors.some((f) => /Klumpen/.test(f.text)) ? [{ text: `${top.name} macht ${top.share.toFixed(1)}% des Vermögens aus.`, source: 'Positionen', severity: 'warn' as Severity }] : []),
  ].slice(0, 3)
  if (!mention.length && flags[0]) mention.push({ text: `${flags[0].text}.`, source: 'Regelverletzung', severity: flags[0].severity })

  const notes = list(raw.ClientNotes).map((n) => ({ text: str(n.Note), at: str(n.CreatedByDateUTC) })).filter((n) => n.text && time(n.at)).sort((a, b) => time(a.at) - time(b.at))
  const stale = notes.filter((n) => now.getTime() - time(n.at) > 365 * DAY)
  const proposals = list(raw.Proposals).map((x) => ({ status: str(x.ProposalStatusName), reason: str(x.Reason), at: str(x.ProposedDateUTC) })).filter((x) => time(x.at)).sort((a, b) => time(b.at) - time(a.at))
  const draft = proposals.find((x) => x.status === 'Entwurf')

  const ask: TalkLine[] = [
    ...(stale.length ? stale.slice(0, 1) : notes.slice(-1)).map((n) => ({ text: `Gilt das noch: «${n.text}»?`, source: stale.length ? 'Kundennotiz, älter als 12 Monate' : 'Kundennotiz', date: day(n.at) })),
    ...(draft ? [{ text: `Der Vorschlag vom ${day(draft.at)}${draft.reason ? ` («${draft.reason}»)` : ''} ist noch im Entwurf: umsetzen oder verwerfen?`, source: 'Vorschlag im Entwurf', date: day(draft.at) }] : []),
  ]

  const seen = new Set<string>()
  const avoid: TalkLine[] = proposals.filter((x) => x.status === 'Abgelehnt' && x.reason && !seen.has(x.reason) && seen.add(x.reason)).slice(0, 2)
    .map((x) => ({ text: `«${x.reason}»: vom Kunden abgelehnt.`, source: 'Abgelehnter Vorschlag', date: day(x.at) }))

  const recent = notes.filter((n) => now.getTime() - time(n.at) < 90 * DAY).pop()
  const reasons: TalkLine[] = [
    ...(p && p.month <= -2 ? [{ text: `Wertrückgang im letzten Monat (${signed(p.month)})`, source: 'Wertverlauf des Portfolios', date: facts.asOf, severity: 'risk' as Severity }] : []),
    ...(errors[0] ? [{ text: errors[0].text, source: 'Regelverletzung', severity: 'risk' as Severity }] : []),
    ...(draft ? [{ text: `Offener Vorschlag vom ${day(draft.at)}`, source: 'Vorschlag im Entwurf', date: day(draft.at), severity: 'warn' as Severity }] : []),
    ...(recent ? [{ text: `Eigene Notiz vom ${day(recent.at)}: «${recent.text}»`, source: 'Kundennotiz', date: day(recent.at), severity: 'info' as Severity }] : []),
  ].slice(0, 3)

  return { type: 'talktrack', title: '60-Sekunden-Briefing', open, mention, ask, avoid, reasons }
}
