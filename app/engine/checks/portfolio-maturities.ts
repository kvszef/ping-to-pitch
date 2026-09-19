// portfolio.maturities — bonds that repay soon (a natural reason to call about reinvesting), and bonds past maturity still held.
// Only Security.maturity counts: security names carry old, unshifted dates.
import { daysBetween, type Position } from '../data.ts'
import { chf, dateCh, pct, shortName } from '../format.ts'
import { pick } from '../lang.ts'
import type { Check, Finding } from '../types.ts'
import { clientOf, findingId, srcOf } from './common.ts'

const CHECK = 'portfolio.maturities'
const TOPIC = 'maturities'
// ≈ 6 months ahead: long enough to plan the reinvestment, short enough to be a reason to call now.
const MATURITY_WINDOW_DAYS = 183
// DATA.md: a far-future maturity (e.g. 2299) means perpetual, not a data error.
const PERPETUAL_FROM_YEAR = 2200

// Bond names end in the issue/maturity dates before the case's date shift ("... AG 2019-14.10.26 Reg S"): cut them off.
const bondName = (name: string) => shortName(name).replace(/\s+\d{4}-\d{1,2}\.\d{1,2}\.\d{2,4}\b.*$/, '') || shortName(name)
// Maturities come with a time zone ("2026-11-10T23:00:00+01:00"): the calendar date is the first ten characters.
const dayOf = (iso: string) => iso.slice(0, 10)

export const maturities: Check = (raw, ctx) => {
  const client = clientOf(raw, ctx.ref)
  const t = pick(ctx.lang)
  const SRC = srcOf(ctx.lang)
  const out: Finding[] = []
  for (const p of client.portfolios) {
    const soon: { pos: Position; date: string; days: number }[] = []
    for (const pos of p.positions) {
      const m = pos.kind === 'security' ? pos.security?.maturity : undefined
      if (!m || !/^\d{4}-\d{2}-\d{2}/.test(m) || Number(m.slice(0, 4)) >= PERPETUAL_FROM_YEAR) continue
      // Worthless positions have nothing to reinvest (CASE-022 holds a defaulted Lehman note at 0).
      if (pos.amount <= 0) continue
      const days = daysBetween(ctx.now, m)
      if (!Number.isFinite(days)) continue
      const date = dayOf(m)
      if (days < 0) {
        out.push({
          id: findingId(CHECK, client.ref, `matured:${p.nr}:${pos.securityId ?? pos.isin ?? pos.name}`),
          check: CHECK, kind: 'fact', severity: 'warn', topic: TOPIC,
          title: t(
            `Obligation ${bondName(pos.name)} ist am ${dateCh(date)} fällig geworden, wird aber noch gehalten: prüfen`,
            `Bond ${bondName(pos.name)} matured on ${dateCh(date, 'en')} but is still held: check`,
          ),
          detail: t(
            'Die Daten können hinterherhinken. Vor dem Gespräch prüfen, ob die Rückzahlung schon verbucht ist.',
            'The data may lag behind. Before the call, check whether the repayment has already been booked.',
          ),
          numbers: { amount: pos.amount, daysPast: -days },
          evidence: [SRC.position(pos.name, p.nr), SRC.security(pos.name)],
        })
      } else if (days <= MATURITY_WINDOW_DAYS) soon.push({ pos, date, days })
    }
    if (!soon.length) continue
    soon.sort((a, b) => a.days - b.days)
    const amount = soon.reduce((a, s) => a + s.pos.amount, 0)
    // Position weights, not amount / value: amounts are in portfolio currency, the portfolio value in the client's.
    const share = soon.reduce((a, s) => a + s.pos.weight, 0)
    const last = soon[soon.length - 1].date
    const evidence = [SRC.portfolio(p.nr), ...soon.map((s) => SRC.security(s.pos.name))]
    out.push({
      id: findingId(CHECK, client.ref, `soon:${p.nr}`),
      check: CHECK, kind: 'fact', severity: 'info', topic: TOPIC,
      title: t(
        `${p.nr}: ${soon.length} ${soon.length === 1 ? 'Obligation wird' : 'Obligationen werden'} bis ${dateCh(last)} fällig, zusammen ${chf(amount, p.currency ?? client.currency)}`,
        `${p.nr}: ${soon.length} ${soon.length === 1 ? 'bond matures' : 'bonds mature'} by ${dateCh(last, 'en')}, together ${chf(amount, p.currency ?? client.currency)}`,
      ),
      detail: soon.map((s) => `${bondName(s.pos.name)}: ${dateCh(s.date, ctx.lang)}, ${chf(s.pos.amount, p.currency ?? client.currency)}`).join('; '),
      numbers: { count: soon.length, amount, share },
      evidence,
    })
    out.push({
      id: findingId(CHECK, client.ref, `reinvest:${p.nr}`),
      check: CHECK, kind: 'action', severity: 'info', topic: TOPIC,
      title: t(
        `${p.nr}: Wiederanlage von ${chf(amount, p.currency ?? client.currency)} (${pct(share)} des Portfolios) bis ${dateCh(last)} besprechen`,
        `${p.nr}: discuss reinvesting ${chf(amount, p.currency ?? client.currency)} (${pct(share)} of the portfolio) by ${dateCh(last, 'en')}`,
      ),
      numbers: { amount, share },
      evidence,
    })
  }
  return out
}
