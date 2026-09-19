import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { run } from '../../engine/run.ts'
import { client, ctx } from '../../engine/test-data.ts'
import { composeBriefing } from '../ai/briefing.ts'
import { assistUnparsed } from './llm-assist.ts'
import { pdfPages } from './pdf-text.ts'
import { attachExCustody, buildExCustody, detachExCustody, exCustodyOf, indexIsins } from './portfolio.ts'
import { parseStatement } from './statement.ts'

const DIR = fileURLToPath(new URL('../../../side-challenge/', import.meta.url))
const reference = JSON.parse(readFileSync(fileURLToPath(new URL('../../../core-case/portfolio-data/reference.json', import.meta.url)), 'utf8'))
const isins = indexIsins(reference)
const imported = async (n: string) => buildExCustody(parseStatement(await pdfPages(readFileSync(DIR + readdirSync(DIR).find((f) => f.includes(`_${n}_`))!))), isins)

type Pos = Record<string, unknown>
const securities = (p: Record<string, unknown>) => p.SecurityPositions as Pos[]

describe('virtual ex-custody portfolio', () => {
  it('joins by ISIN and currency, reconciles and is flagged ex-custody', async () => {
    const { portfolio, report } = await imported('01')
    expect(portfolio.isExCustody).toBe(true)
    expect(portfolio.Name).toBe('Fremddepot (ex-custody) · Privatbank Helvetia AG')
    expect(report).toMatchObject({ positions: 21, securities: 19, accounts: 2, reconciles: true, total: 2_049_658, statedTotal: 2_049_658 })
    expect(report.sections.every((s) => s.ok)).toBe(true)
    // TotalEnergies shares: the bank's own record in EUR.
    expect(securities(portfolio).find((s) => s.Isin === 'FR0000120271')).toMatchObject({ SecurityId: 11546, Currency: 'EUR', PortfolioValuePercentage: 0.0538 })
    expect(report.matched).toBeGreaterThanOrEqual(6)
  })

  it('classifies unknown securities from the statement and says so', async () => {
    const { portfolio, report } = await imported('01')
    const bond = securities(portfolio).find((s) => s.Isin === 'XS2652887431')!
    expect(bond).toMatchObject({ SAA_AssetClassName: 'Bonds', SAA_IndustryName: 'Energy', ClassificationSource: 'issuer' })
    expect(bond.SecurityId as number).toBeLessThan(0)
    expect(securities(portfolio).find((s) => s.Isin === 'CH0014420878')).toMatchObject({ SAA_AssetClassName: 'Real estate', SecurityTypeName: 'Investment fund' })
    expect(securities(portfolio).find((s) => s.Isin === 'US78463V1070')).toMatchObject({ SAA_AssetClassName: 'Specialties andCommodities' })
    expect(securities(portfolio).find((s) => s.Isin === 'IE00B3XXRP09')).toMatchObject({ SAA_AssetClassName: 'Shares', SAA_CountryGroupName: 'North America' })
    expect(report.issues.some((i) => /nicht in den Bank-Stammdaten/.test(i))).toBe(true)
  })

  it('never throws on an empty statement and reports it', () => {
    const { report, portfolio } = buildExCustody(parseStatement(['nichts']), isins)
    expect(report.reconciles).toBe(false)
    expect(report.positions).toBe(0)
    expect(report.issues[0]).toMatch(/Keine Positionen/)
    expect(portfolio.isExCustody).toBe(true)
    expect(buildExCustody(parseStatement([]), indexIsins(null)).report.positions).toBe(0)
  })
})

describe('in English', () => {
  const importedEn = async (n: string) => buildExCustody(parseStatement(await pdfPages(readFileSync(DIR + readdirSync(DIR).find((f) => f.includes(`_${n}_`))!))), isins, 'en')

  it('labels the portfolio and writes the report in English, numbers unchanged', async () => {
    const [de, en] = [await imported('01'), await importedEn('01')]
    expect(en.portfolio.Name).toBe('External custody account (ex-custody) · Privatbank Helvetia AG')
    expect(en.portfolio.InvestmentServiceName).toBe('External custody account (ex-custody)')
    expect(en.portfolio.StrategyName).toMatch(/^External mandate «/)
    expect(en.importId).toBe(de.importId)
    expect({ ...en.report, issues: [], rows: [] }).toEqual({ ...de.report, issues: [], rows: [] })
    expect(en.report.issues).toHaveLength(de.report.issues.length)
    expect(en.report.issues.some((i) => /not in the bank's master data: asset class estimated from the statement/.test(i))).toBe(true)
    expect(en.report.issues.join(' ')).not.toMatch(/Position\(en\)|geschätzt|Auszug|Prüfziffer/)
    expect(en.report.rows.filter((r) => r.matchedBy === 'account').every((r) => /^Account [A-Z]{3,5}$/.test(r.name))).toBe(true)
    expect(buildExCustody(parseStatement(['nothing']), isins, 'en').report.issues[0]).toMatch(/^No positions recognised/)
  })

  it('says when the sum does not reconcile', () => {
    const page = ["Privatbank Test AG", "Referenzwährung: CHF", "Detailpositionen", "Aktien", "CHF 10 N-Akt Nestle SA 3 886 335 / CH0038863350 90.00 100.00 31.12.25 1'000 50.00 %", "Total Vermögen 5'000 100.00 %"]
    const { report } = buildExCustody(parseStatement([page.join('\n')]), isins, 'en')
    expect(report.reconciles).toBe(false)
    expect(report.issues.some((i) => /^The sum of the positions differs from the stated total assets by CHF -4.000\.$/.test(i))).toBe(true)
  })

  it('numbers the attached portfolio in English and the engine names it so', async () => {
    const { portfolio, importId } = await importedEn('01')
    const withEx = attachExCustody(attachExCustody(client('CASE-004'), portfolio), portfolio)
    expect(exCustodyOf(withEx).map((p) => p.PortfolioNr)).toEqual(['External custody account 1'])
    const findings = run(withEx, { ...ctx, lang: 'en' })
    expect(findings.find((f) => f.check === 'portfolio.ex-custody')!.title).toMatch(/^External custody account 1 at Privatbank Helvetia AG: CHF 2'049'658/)
    expect(exCustodyOf(detachExCustody(withEx, importId))).toHaveLength(0)
  })
})

describe('attached to a client', () => {
  it('adds, replaces and removes the portfolio and keeps the totals right', async () => {
    const base = client('CASE-004')
    const { portfolio, importId } = await imported('01')
    const aum = base.AssetsUnderManagementInDefaultCurrency as number
    const once = attachExCustody(base, portfolio)
    const twice = attachExCustody(once, portfolio)
    expect(exCustodyOf(twice)).toHaveLength(1)
    expect(exCustodyOf(twice)[0].PortfolioNr).toBe('Fremddepot 1')
    expect(twice.AssetsUnderManagementInDefaultCurrency).toBeCloseTo(aum + 2_049_658, 2)
    const gone = detachExCustody(twice, importId)
    expect(exCustodyOf(gone)).toHaveLength(0)
    expect(gone.AssetsUnderManagementInDefaultCurrency).toBeCloseTo(aum, 2)
    expect(base.Portfolios).toHaveLength((gone.Portfolios as unknown[]).length) // the original is untouched
  })

  it('runs through the whole engine and the briefing like any portfolio (CASE-004 + statement 01)', async () => {
    const withEx = attachExCustody(client('CASE-004'), (await imported('01')).portfolio)
    const findings = run(withEx, ctx)
    expect(findings.failed).toBeUndefined()
    const ex = findings.filter((f) => f.id.includes('Fremddepot 1'))
    expect(ex.map((f) => f.check)).toEqual(expect.arrayContaining(['portfolio.ex-custody', 'portfolio.allocation', 'portfolio.concentration']))
    expect(findings.find((f) => f.check === 'portfolio.ex-custody')!.title).toMatch(/^Fremddepot 1 bei Privatbank Helvetia AG: CHF 2'049'658/)
    // The client does not want fossil fuels: the TotalEnergies shares at the other bank now show up.
    const fossil = findings.find((f) => f.check === 'contradiction.fossil-fuel')!
    expect(JSON.stringify(fossil)).toMatch(/TotalEnergies/)
    const b = composeBriefing('CASE-004', findings)
    expect(b.blocks.mention.some((l) => /Fremddepot 1/.test(l.text))).toBe(true)
    // Without the import, none of it.
    expect(run(client('CASE-004'), ctx).some((f) => f.check === 'portfolio.ex-custody' || /TotalEnergies/.test(JSON.stringify(f)))).toBe(false)
  })
})

describe('model assist for lines the rules cannot read', () => {
  const line = "CHF 385 Ant Helvetia Multi Fonds CH0312041188 102.52 115.64 44'522 1.31 % Konto CH46 0483 5012 3456 7873 9"
  it('sends scrubbed lines only and keeps numbers that stand in the line', async () => {
    let sent = ''
    const r = await assistUnparsed([line], async (m) => {
      sent = m.map((x) => x.content).join('\n')
      return { positions: [{ i: 0, currency: 'CHF', quantity: '385', name: 'Ant Helvetia Multi Fonds', isin: 'CH0312041188', value: "44'522", weightPercent: '1.31' }] }
    })
    expect(sent).not.toMatch(/0483/)
    expect(r.positions).toHaveLength(1)
    expect(r.positions[0]).toMatchObject({ value: 44_522, weight: 0.0131, quantity: 385 })
  })

  it('rejects invented numbers', async () => {
    const r = await assistUnparsed([line], async () => ({ positions: [{ i: 0, currency: 'CHF', quantity: '385', name: 'Ant Helvetia Multi Fonds', value: "54'522", weightPercent: '1.31' }] }))
    expect(r.positions).toHaveLength(0)
    expect(r.unverified[0].reason).toMatch(/Marktwert/)
  })
})
