import type { CardOf, Severity, TalkLine } from '../types.ts'
import type { ClientFacts } from './facts.ts'
import { isObj, list, str } from './facts.ts'
import { pick, type Lang } from '../../engine/lang.ts'
import { uiLang } from './uiLang.ts'

// The 60-second talk track for a raw client file (PLAN section 2): open with, must mention, ask,
// don't bring up, plus ranked guesses why the client might be calling. Deterministic and pure; the
// engine's briefing writer (A1) replaces it once it serves `talktrack` cards. Values quoted from the
// file (notes, proposal reasons) stay as written. Written in `lang`; numbers and dates read the same in both.

const DAY = 86_400_000
const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
const day = (iso: string) => (iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '')
const time = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0 }

type Flag = { severity: Severity; text: string }

export function talkTrackFromRaw(input: unknown, facts: ClientFacts, flags: Flag[], now: Date, lang: Lang = uiLang()): CardOf<'talktrack'> {
  const t = pick(lang)
  const SRC = {
    history: t('Wertverlauf des Portfolios', 'Value history of the portfolio'), file: t('Kundendatei', 'Client file'), rule: t('Regelverletzung', 'Rule violation'),
    positions: t('Positionen', 'Positions'), note: t('Kundennotiz', 'Client note'), oldNote: t('Kundennotiz, älter als 12 Monate', 'Client note, older than 12 months'),
    draft: t('Vorschlag im Entwurf', 'Proposal in draft'), rejected: t('Abgelehnter Vorschlag', 'Rejected proposal'),
  }
  const raw = isObj(input) ? input : {}
  const p = facts.performance
  const errors = flags.filter((f) => f.severity === 'risk')
  const top = facts.positions[0]

  const open: TalkLine = p
    ? { text: t(
      `Guten Tag, ich melde mich zu Ihrem Portfolio: seit Jahresbeginn ${signed(p.ytd)}${errors.length ? ', und es gibt einen Punkt, den ich kurz mit Ihnen anschauen möchte.' : '. Alles im Rahmen, ich habe zwei kurze Fragen.'}`,
      `Hello, I am calling about your portfolio: ${signed(p.ytd)} since the start of the year${errors.length ? ', and there is one point I would like to look at with you briefly.' : '. All within range, I have two short questions.'}`,
    ), source: SRC.history, date: facts.asOf }
    : { text: t('Guten Tag, ich melde mich zu Ihrem Portfolio und habe zwei kurze Punkte.', 'Hello, I am calling about your portfolio and have two short points.'), source: SRC.file }

  const mention: TalkLine[] = [
    ...errors.slice(0, 2).map((f) => ({ text: `${f.text}.`, source: SRC.rule, severity: f.severity })),
    ...(p && p.month <= -3 ? [{ text: t(`Letzter Monat ${signed(p.month)}; schwächster Monat bisher ${p.worst.label} mit ${signed(p.worst.value)}.`, `Last month ${signed(p.month)}; weakest month so far ${p.worst.label} with ${signed(p.worst.value)}.`), source: SRC.history, date: facts.asOf, severity: 'warn' as Severity }] : []),
    ...(top && top.share >= 10 && !errors.some((f) => /Klumpen|Cluster risk/i.test(f.text)) ? [{ text: t(`${top.name} macht ${top.share.toFixed(1)}% des Vermögens aus.`, `${top.name} makes up ${top.share.toFixed(1)}% of the assets.`), source: SRC.positions, severity: 'warn' as Severity }] : []),
  ].slice(0, 3)
  if (!mention.length && flags[0]) mention.push({ text: `${flags[0].text}.`, source: SRC.rule, severity: flags[0].severity })

  const notes = list(raw.ClientNotes).map((n) => ({ text: str(n.Note), at: str(n.CreatedByDateUTC) })).filter((n) => n.text && time(n.at)).sort((a, b) => time(a.at) - time(b.at))
  const stale = notes.filter((n) => now.getTime() - time(n.at) > 365 * DAY)
  const proposals = list(raw.Proposals).map((x) => ({ status: str(x.ProposalStatusName), reason: str(x.Reason), at: str(x.ProposedDateUTC) })).filter((x) => time(x.at)).sort((a, b) => time(b.at) - time(a.at))
  const draft = proposals.find((x) => x.status === 'Entwurf')

  const ask: TalkLine[] = [
    ...(stale.length ? stale.slice(0, 1) : notes.slice(-1)).map((n) => ({ text: t(`Gilt das noch: «${n.text}»?`, `Does this still hold: «${n.text}»?`), source: stale.length ? SRC.oldNote : SRC.note, date: day(n.at) })),
    ...(draft ? [{ text: t(`Der Vorschlag vom ${day(draft.at)}${draft.reason ? ` («${draft.reason}»)` : ''} ist noch im Entwurf: umsetzen oder verwerfen?`, `The proposal of ${day(draft.at)}${draft.reason ? ` («${draft.reason}»)` : ''} is still a draft: implement or discard?`), source: SRC.draft, date: day(draft.at) }] : []),
  ]

  const seen = new Set<string>()
  const avoid: TalkLine[] = proposals.filter((x) => x.status === 'Abgelehnt' && x.reason && !seen.has(x.reason) && seen.add(x.reason)).slice(0, 2)
    .map((x) => ({ text: t(`«${x.reason}»: vom Kunden abgelehnt.`, `«${x.reason}»: rejected by the client.`), source: SRC.rejected, date: day(x.at) }))

  const recent = notes.filter((n) => now.getTime() - time(n.at) < 90 * DAY).pop()
  const reasons: TalkLine[] = [
    ...(p && p.month <= -2 ? [{ text: t(`Wertrückgang im letzten Monat (${signed(p.month)})`, `Drop in value last month (${signed(p.month)})`), source: SRC.history, date: facts.asOf, severity: 'risk' as Severity }] : []),
    ...(errors[0] ? [{ text: errors[0].text, source: SRC.rule, severity: 'risk' as Severity }] : []),
    ...(draft ? [{ text: t(`Offener Vorschlag vom ${day(draft.at)}`, `Open proposal of ${day(draft.at)}`), source: SRC.draft, date: day(draft.at), severity: 'warn' as Severity }] : []),
    ...(recent ? [{ text: t(`Eigene Notiz vom ${day(recent.at)}: «${recent.text}»`, `Own note of ${day(recent.at)}: «${recent.text}»`), source: SRC.note, date: day(recent.at), severity: 'info' as Severity }] : []),
  ].slice(0, 3)

  return { type: 'talktrack', title: t('60-Sekunden-Briefing', '60-second briefing'), open, mention, ask, avoid, reasons }
}
