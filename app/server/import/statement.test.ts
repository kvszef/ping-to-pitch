import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isPdf, pdfPages } from './pdf-text.ts'
import { isIsin, parseNumber, parseStatement, scrub } from './statement.ts'

// The sample statements from the side challenge, read straight from the repo (no extracted text in fixtures:
// the statements carry fictitious but name-like client data).
const DIR = fileURLToPath(new URL('../../../side-challenge/', import.meta.url))
const pdf = (n: string) => readFileSync(DIR + readdirSync(DIR).find((f) => f.includes(`_${n}_`))!)
const parse = async (n: string) => parseStatement(await pdfPages(pdf(n)))

describe('statement parser on the sample PDFs', () => {
  it.each([
    ['01', 21, 'US0231351067', 2_049_658],
    ['04', 23, 'CH0418792922', 4_803_193],
    ['09', 25, 'IE00B4L5Y983', 9_203_755],
  ])('statement %s: %i positions, a known ISIN, total reconciles', async (n, count, isin, total) => {
    const s = await parse(n)
    expect(s.positions).toHaveLength(count)
    expect(s.positions.some((p) => p.isin === isin)).toBe(true)
    expect(s.statedTotal).toBe(total)
    const sum = s.positions.reduce((a, p) => a + p.value, 0)
    expect(Math.abs(sum - total)).toBeLessThanOrEqual(0.5 * count + 1)
    expect(s.positions.reduce((a, p) => a + p.weight, 0)).toBeCloseTo(1, 2)
    expect(s.currency).toBe('CHF')
    expect(s.asOf).toBe('2025-12-31')
    expect(s.unparsed).toEqual([])
  })

  it('reads every sample statement completely', async () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.pdf'))
    expect(files).toHaveLength(10)
    for (const f of files) {
      const s = parseStatement(await pdfPages(readFileSync(DIR + f)))
      const sum = s.positions.reduce((a, p) => a + p.value, 0)
      expect(Math.abs(sum - (s.statedTotal ?? 0)), f).toBeLessThanOrEqual(0.5 * s.positions.length + 1)
      expect(s.unparsed, f).toEqual([])
    }
  })

  it('reads name, quantity, prices and section of a bond line and keeps the maturity in the name', async () => {
    const s = await parse('01')
    const bond = s.positions.find((p) => p.isin === 'XS2652887431')!
    expect(bond).toMatchObject({ kind: 'security', currency: 'EUR', quantity: 210_000, name: '3.625% TotalEnergies SE 2023-2033', cost: 103.49, price: 101.1, value: 199_996, weight: 0.0976, sectionClass: 'Bonds' })
    const etf = s.positions.find((p) => p.isin === 'IE00B3XXRP09')!
    expect(etf).toMatchObject({ name: 'Ant Vanguard S&P 500 UCITS ETF', sectionClass: 'Shares', value: 267_118 })
  })

  it('keeps no client data: accounts carry the currency only, no IBAN, no name', async () => {
    const s = await parse('01')
    const accounts = s.positions.filter((p) => p.kind === 'account')
    expect(accounts.map((a) => a.name)).toEqual(['Konto CHF', 'Konto EUR'])
    const out = JSON.stringify(s)
    expect(out).not.toMatch(/CH\d{2} \d{4}/)
    expect(out).not.toMatch(/Muster|Depot-Nr/)
    expect(s.bank).toBe('Privatbank Helvetia AG')
  })
})

describe('statement parser on missing or garbage input', () => {
  it('returns no positions and never throws', () => {
    expect(parseStatement([]).positions).toEqual([])
    const s = parseStatement(['Hallo Welt', 'CHF 12 irgendwas', 'Total Vermögen 100 100.00 %'])
    expect(s.positions).toEqual([])
    expect(s.statedTotal).toBe(100)
  })

  it('marks position-like lines it cannot read as unparsed', () => {
    const s = parseStatement(['Detailpositionen per 31.12.2025, in CHF', 'Aktien', 'Nestlé AG CH0038863350 irgendwie 5 %', 'CHF 10 Akt Beispiel AG 1 234 / CH0038863350 1.00 2.00 31.12.25 20 100.00 %'])
    expect(s.unparsed).toHaveLength(1)
    expect(s.positions).toHaveLength(1)
    expect(s.positions[0]).toMatchObject({ isin: 'CH0038863350', value: 20, weight: 1, sectionClass: 'Shares' })
  })

  it('refuses a file that is not a PDF', () => {
    expect(isPdf(new TextEncoder().encode('{"ClientRef":"X"}'))).toBe(false)
    expect(isPdf(pdf('01'))).toBe(true)
  })
})

describe('helpers', () => {
  it('parses Swiss numbers', () => {
    expect(parseNumber("2'049'658")).toBe(2_049_658)
    expect(parseNumber("67'589.35")).toBe(67_589.35)
    expect(parseNumber('+4.20')).toBe(4.2)
    expect(parseNumber('abc')).toBeUndefined()
    expect(parseNumber(undefined)).toBeUndefined()
  })

  it('checks ISIN check digits', () => {
    expect(isIsin('CH0038863350')).toBe(true)
    expect(isIsin('US0378331005')).toBe(true)
    expect(isIsin('US0378331006')).toBe(false)
  })

  it('scrubs IBANs and depot numbers before anything leaves the server', () => {
    expect(scrub('CHF 67\'589.35 Privatkonto CHF CH46 0483 5012 3456 7873 9 31.12.25 67\'589 3.30 %')).not.toMatch(/0483/)
    expect(scrub('Herr Max Muster · Depot-Nr. 1583.5357.1001')).not.toMatch(/1583|Muster/)
    expect(scrub('USD 570 Akt Amazon.com Inc. 2 000 654 / US0231351067 202.27 235.64 31.12.25 114\'638 5.59 %')).toContain('US0231351067')
  })
})
