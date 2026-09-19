// context.history — this client's own worst drawdowns from the monthly values: how deep, when, and how long until
// the previous high was reached again. A fact for calming a worried client: it has happened before, and recovered.
import { combinedHistory, type NavPoint } from '../data.ts'
import { monthCh, signedPct } from '../format.ts'
import { pick, type Lang } from '../lang.ts'
import type { Check, Finding } from '../types.ts'
import { clientOf, findingId, srcOf } from './common.ts'

const CHECK = 'context.history'
// Dips smaller than 3% are everyday noise and not worth telling a client about. Our judgement.
const MIN_DROP = -0.03

export type Drawdown = { depth: number; peak: string; trough: string; recovered?: string; monthsToRecover?: number }

const monthsApart = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))

/** Peak-to-trough episodes, deepest first. An episode ends when the old peak is reached again. */
export function drawdowns(history: NavPoint[]): Drawdown[] {
  const out: Drawdown[] = []
  if (history.length < 2) return out
  let peak = history[0]
  let current: Drawdown | undefined
  for (const h of history) {
    if (h.value >= peak.value) {
      if (current) {
        current.recovered = h.date
        current.monthsToRecover = monthsApart(current.trough, h.date)
        out.push(current)
        current = undefined
      }
      peak = h
      continue
    }
    const depth = h.value / peak.value - 1
    if (!current) current = { depth, peak: peak.date, trough: h.date }
    else if (depth < current.depth) { current.depth = depth; current.trough = h.date }
  }
  if (current) out.push(current)
  return out.sort((a, b) => a.depth - b.depth)
}

const recovery = (d: Drawdown, lang?: Lang) => (lang === 'en'
  ? (d.recovered ? `back at the previous high after ${d.monthsToRecover === 1 ? '1 month' : `${d.monthsToRecover} months`}` : 'not yet recovered')
  : (d.recovered ? `nach ${d.monthsToRecover === 1 ? '1 Monat' : `${d.monthsToRecover} Monaten`} wieder auf dem alten Höchststand` : 'noch nicht erholt'))

export const history: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const lang = ctx.lang, t = pick(lang)
  const month = (iso: string) => monthCh(iso, lang)
  const values = client.portfolios.length > 1 ? combinedHistory(client.portfolios) : client.portfolios[0]?.history ?? []
  const worst = drawdowns(values).filter((d) => d.depth <= MIN_DROP)
  if (!worst.length) return []
  const [top, ...rest] = worst
  const numbers: Record<string, number> = { maxDrawdown: top.depth, months: values.length }
  if (top.monthsToRecover !== undefined) numbers.monthsToRecover = top.monthsToRecover
  const detail = [
    t(
      `Aus ${values.length} Monatswerten (${month(values[0].date)} bis ${month(values[values.length - 1].date)}), Höchst- bis Tiefstwert.`,
      `From ${values.length} monthly values (${month(values[0].date)} to ${month(values[values.length - 1].date)}), peak to trough.`,
    ),
    ...rest.slice(0, 2).map((d) => t(
      `Weiterer Rückgang: ${signedPct(d.depth)} bis ${month(d.trough)}, ${recovery(d, lang)}.`,
      `Further drop: ${signedPct(d.depth)} to ${month(d.trough)}, ${recovery(d, lang)}.`,
    )),
    t('Nicht um Ein- und Auszahlungen bereinigt.', 'Not adjusted for deposits and withdrawals.'),
  ]
  const f: Finding = {
    id: findingId(CHECK, client.ref, 'total'), check: CHECK, kind: 'fact', severity: 'info', topic: 'performance',
    title: t(
      `Grösster Rückgang bisher: ${signedPct(top.depth)} (${month(top.peak)} bis ${month(top.trough)}), ${recovery(top, lang)}`,
      `Largest drop so far: ${signedPct(top.depth)} (${month(top.peak)} to ${month(top.trough)}), ${recovery(top, lang)}`,
    ),
    detail: detail.join(' '), numbers,
    evidence: [srcOf(lang).history(client.portfolios.map((p) => p.nr).join(', '), top.trough)],
  }
  return [f]
}
