// The display language changes wording only. For every check, on all 47 clients: the English run has the
// same findings (ids, kinds, severities, numbers, evidence, fixes) as the German run, and no German left.
import { describe, expect, it } from 'vitest'
import { checks } from './checks/index.ts'
import { EXAMPLE_HOUSE_VIEW } from './houseview.ts'
import { peerStats } from './peers.ts'
import { clients, ctx } from './test-data.ts'
import type { CallNote, CheckContext, Finding, RawClient } from './types.ts'

const memoryFor = (clientRef: string): CallNote[] => [{
  id: 'n1', clientRef, date: '2026-09-01', confirmed: true,
  proposed: [{ text: 'Reduce the US technology share', reaction: 'open' }],
  promises: [{ text: 'Send the benchmark comparison', due: '2026-09-10', done: false }],
  factUpdates: [],
}]

const base: CheckContext = { ...ctx, peers: peerStats(clients, ctx.ref), houseView: EXAMPLE_HOUSE_VIEW }

// The rules read every note in the real data, so wish.unreviewed never fires there: it gets one note no rule knows.
const UNREAD_NOTE = { Note: 'Asked whether the branch in Lugano stays open on Saturdays.', CreatedByDateUTC: '2026-09-01T10:00:00' }
const inputFor = (check: string, c: RawClient): RawClient =>
  check === 'wish.unreviewed' ? { ...c, ClientNotes: [...(Array.isArray(c.ClientNotes) ? c.ClientNotes : []), UNREAD_NOTE] } : c

// Words that only German uses. Quoted data («…», evidence quotes) stays in its own language and is not looked at.
const GERMAN = /(?<![\p{L}-])(und|oder|nicht|für|mit|über|unter|vom|zum|zur|ist|sind|wird|wurde|werden|haben|keine?|noch|seit|bei|aus|auf|eine[nrms]?|dem|das|der|sich|auch|nur|mehr|durch|gegen|ohne|Kunden?|Wunsch|Vorschl[aä]ge?s?|Anteil|Grenze|Monate?n?|Gespräch|Berater|Risiko|Notiz|Verkauf|Kauf)(?![\p{L}-])/u
const unquoted = (text: string) => text.replace(/«[^»]*»/g, '').replace(/"[^"]*"/g, '')
const shape = (f: Finding) => ({ id: f.id, check: f.check, kind: f.kind, severity: f.severity, numbers: f.numbers, topic: f.topic, evidence: f.evidence.length, fix: f.fix?.SecurityPositions.length })

// No case client holds an ex-custody portfolio (assets at another bank): one gets a statement attached, the way server/import does it.
const external = {
  PortfolioId: 900_000_001, PortfolioNr: 'Fremddepot 1', Name: 'Fremddepot (ex-custody) · Beispielbank AG', PortfolioCurrency: 'CHF', AssetsUnderManagementInDefaultCurrency: 100_000, FactoryDateUtc: '2025-12-31', isExCustody: true,
  SecurityPositions: [{ SecurityId: 644, Isin: 'CH0038863350', SecurityName: 'N-Akt Nestlé AG', Currency: 'CHF', TotalAmountInPortfolioCurrency: 90_000, PortfolioValuePercentage: 0.9 }],
  AccountPositions: [{ Currency: 'CHF', TotalAmountInPortfolioCurrency: 10_000, PortfolioValuePercentage: 0.1 }],
}
const withStatement = structuredClone(clients.find((c) => c.ClientRef === 'CASE-004')!)
;(withStatement.Portfolios as unknown[]).push(external)
const everyone = [...clients, withStatement]

describe('findings in English', () => {
  for (const [name, check] of Object.entries(checks)) {
    it(`${name}: same findings as in German, phrased in English`, () => {
      const german: string[] = []
      let count = 0
      for (const original of everyone) {
        const c = inputFor(name, original)
        const memory = memoryFor(String(c.ClientRef))
        const de = check(c, { ...base, memory })
        const en = check(c, { ...base, memory, lang: 'en' })
        expect(en.map(shape), String(c.ClientRef)).toEqual(de.map(shape))
        count += en.length
        for (const f of en) {
          for (const text of [f.title, f.detail ?? '', f.fix?.Reason ?? '', ...f.evidence.map((e) => e.source)]) {
            const hit = GERMAN.exec(unquoted(text))
            if (hit) german.push(`${f.id}: «${hit[0]}» in: ${text}`)
          }
        }
      }
      expect(german.slice(0, 10), `${german.length} German texts in the English run`).toEqual([])
      expect(count, 'the check never fired, so nothing was compared').toBeGreaterThan(0)
    })
  }
})
