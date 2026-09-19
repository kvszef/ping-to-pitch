import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { indexReference } from '../../engine/data.ts'
import { cash, history, holding, periodOf, phrase, routeQuestion, runTool, transactions, unsupportedTopic, type ToolName } from './chat-tools.ts'

const data = (file: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../core-case/portfolio-data', file), 'utf8'))
const clients: Record<string, unknown>[] = data('clients.json')
const ref = indexReference(data('reference.json'))
const client = (id: string) => clients.find((c) => c.ClientRef === id)!
const r = (x: { result: Record<string, unknown> }) => x.result as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('holding', () => {
  it('finds a directly held share (CASE-017 holds Neste)', () => {
    const out = holding(client('CASE-017'), ref, { query: 'Neste' })
    expect(r(out).gehalten).toBe(true)
    expect(r(out).direkt[0].titel).toMatch(/Neste/)
    expect(r(out).direkt[0].anteilPortfolioProzent).toBe(0.9)
    expect(out.source).toMatch(/Depotpositionen/)
  })

  it('says "not held" for a security the client does not own', () => {
    const out = holding(client('CASE-004'), ref, { query: 'Neste' })
    expect(r(out).gehalten).toBe(false)
    expect(r(out).hinweis).toMatch(/Keine Position/)
  })

  it('finds energy held only through funds (CASE-004) via look-through', () => {
    const out = r(holding(client('CASE-004'), ref, { query: 'Energie' }))
    expect(out.gehalten).toBe(true)
    expect(out.direktAnteilProzent).toBe(0)
    expect(out.viaFondsAnteilProzent).toBeGreaterThan(0)
    expect(out.viaFonds.map((v: { fonds: string }) => v.fonds).join(' ')).toMatch(/Energy/)
  })

  it('splits direct and fund exposure for CASE-017 energy', () => {
    const out = r(holding(client('CASE-017'), ref, { query: 'energy' }))
    expect(out.direktAnteilProzent).toBeGreaterThan(0)
    expect(out.direkt[0].titel).toMatch(/Neste/)
  })

  it('handles a client without portfolios and an empty query', () => {
    expect(r(holding({ ClientRef: 'X', Portfolios: null }, ref, { query: 'Nestlé' })).gehalten).toBe(false)
    expect(r(holding(client('CASE-017'), ref, {})).gehalten).toBe(false)
  })

  it('never throws on unknown securities and counts them as unclassified', () => {
    const raw = { ReportingCurrency: 'CHF', Portfolios: [{ AssetsUnderManagementInDefaultCurrency: 1000, SecurityPositions: [{ SecurityId: 99999999, SecurityName: 'Unbekannt AG', PortfolioValuePercentage: 1 }] }] }
    expect(r(holding(raw, ref, { query: 'Unbekannt' })).gehalten).toBe(true)
    expect(r(holding(raw, ref, { query: 'Energie' })).nichtKlassifiziertProzent).toBe(100)
  })
})

describe('transactions', () => {
  it('lists and sums trades, dated via the proposal (CASE-004)', () => {
    const out = r(transactions(client('CASE-004'), ref, { status: 'alle' }))
    expect(out.anzahl).toBe(96)
    expect(out.transaktionen[0].datum).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(out.summenProWaehrung.length).toBeGreaterThan(0)
  })

  it('counts only orders of final proposals by default and says what it left out', () => {
    const out = r(transactions(client('CASE-004'), ref, {}))
    expect(out.anzahl).toBeLessThan(96)
    expect(out.transaktionen.every((t: { vorschlagStatus: string }) => t.vorschlagStatus === 'Final')).toBe(true)
    expect(out.hinweisStatus).toMatch(/Abgelehnt/)
  })

  it('filters by period', () => {
    const out = r(transactions(client('CASE-004'), ref, { from: '2026-08-01', to: '2026-08-31', status: 'alle' }))
    expect(out.transaktionen.every((t: { datum: string }) => t.datum.startsWith('2026-08'))).toBe(true)
  })

  it('filters by direction and security', () => {
    const sells = r(transactions(client('CASE-004'), ref, { direction: 'verkauf' }))
    expect(sells.transaktionen.every((t: { richtung: string }) => t.richtung === 'Verkauf')).toBe(true)
    expect(r(transactions(client('CASE-004'), ref, { security: 'Neste' })).anzahl).toBe(0)
  })

  it('says so when a client has no transactions (null or absent)', () => {
    expect(r(transactions(client('CASE-003'), ref, {})).hinweis).toMatch(/keine Transaktionen/)
    expect(r(transactions({ Transactions: null }, ref, {})).anzahl).toBe(0)
  })
})

describe('history', () => {
  it('gives start, end and change of the portfolio value', () => {
    const out = r(history(client('CASE-001'), ref, {}))
    expect(out.start.wert).toBeGreaterThan(0)
    expect(typeof out.veraenderungProzent).toBe('number')
  })

  it('says so without history', () => {
    expect(r(history({ Portfolios: [{ PerformanceHistory: null }] }, ref, {})).hinweis).toMatch(/keine Wertentwicklung/)
  })
})

describe('cash', () => {
  it('lists accounts and flags crypto tickers (CASE-004 has SOL)', () => {
    const out = r(cash(client('CASE-004'), ref))
    expect(out.konten.some((k: { waehrung: string; art: string }) => k.waehrung === 'SOL' && /Krypto/.test(k.art))).toBe(true)
    expect(out.kryptoAnteilGesamtvermoegenProzent).toBeGreaterThan(0)
    expect(JSON.stringify(out)).not.toMatch(/AccountName|IBAN|CH\d{2}/)
  })

  it('has no crypto for CASE-017 and handles missing accounts', () => {
    expect(r(cash(client('CASE-017'), ref)).kryptoAnteilGesamtvermoegenProzent).toBeUndefined()
    expect(r(cash({}, ref)).anzahlKonten).toBe(0)
  })
})

describe('router and phrasing', () => {
  it('routes a holding question to the named position', () => {
    expect(routeQuestion('Wie viel Neste hat der Kunde?', client('CASE-017'), ref)).toEqual([{ name: 'holding', args: { query: 'neste' } }])
  })

  it('routes an unknown name to holding so the answer can say "not held"', () => {
    const calls = routeQuestion('Wie viel Rheinmetall hält der Kunde?', client('CASE-017'), ref)
    expect(calls).toEqual([{ name: 'holding', args: { query: 'Rheinmetall' } }])
    expect(phrase(calls.map((c) => runTool(client('CASE-017'), ref, c)))).toMatch(/Keine Position «Rheinmetall»/)
  })

  it('routes sectors, trades, cash and history', () => {
    const names = (q: string) => routeQuestion(q, client('CASE-004'), ref).map((c) => c.name)
    expect(names('Wie viel Energie hat der Kunde über Fonds?')).toEqual(['holding'])
    expect(names('Was wurde zuletzt verkauft?')).toEqual(['transactions'])
    expect(names('Hat er Krypto auf dem Konto?')).toContain('cash')
    expect(names('Wie war die Wertentwicklung?')).toEqual(['history'])
    expect(names('Wie wird das Wetter morgen?')).toEqual([])
  })

  it('reads a period from the question', () => {
    expect(periodOf('Was wurde im August 2026 verkauft?')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(periodOf('Wie hat sich das Vermögen seit Anfang 2025 entwickelt?')).toEqual({ from: '2025-01-01' })
    expect(periodOf('Wie war es im Jahr 2024?')).toEqual({ from: '2024-01-01', to: '2024-12-31' })
    expect(periodOf('Wie geht es dem Kunden?')).toEqual({})
  })

  it('routes a development question with its period to history, not to a holding', () => {
    expect(routeQuestion('Wie hat sich das Vermögen seit Anfang 2025 entwickelt?', client('CASE-001'), ref)).toEqual([{ name: 'history', args: { from: '2025-01-01' } }])
  })

  it('names fees as not in the data', () => {
    expect(unsupportedTopic('Welche Gebühren zahlt der Kunde?')).toMatch(/nicht erfasst/)
    expect(unsupportedTopic('Wie viel Neste?')).toBeUndefined()
  })

  it('runs every tool on all 47 clients without throwing', () => {
    const tools: ToolName[] = ['holding', 'transactions', 'history', 'cash']
    for (const c of clients) for (const name of tools) {
      const out = runTool(c, ref, { name, args: name === 'holding' ? { query: 'Energie' } : {} })
      expect(out.source).not.toBe('–')
      const text = phrase([out])
      expect(text).not.toMatch(/undefined|NaN/)
      expect(text).not.toMatch(/ß/)
    }
  })
})
