import { describe, expect, it } from 'vitest'
// `?raw` keeps the 3 MB file out of the type checker and needs no Node types in src/.
import clientsJson from '../../../core-case/portfolio-data/clients.json?raw'
import { formatAmount, formatDate, fromRaw, parseClientFile } from './fromRaw'

const now = new Date('2026-09-19T00:00:00Z')
const all = JSON.parse(clientsJson) as Record<string, unknown>[]
const IBAN = /\b[A-Z]{2}\d{2}[ ]?(\d{4}[ ]?){3,}/

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out))
  return out
}

describe('fromRaw on the real clients.json', () => {
  it('maps all 47 clients without throwing, each with a ref and a name', () => {
    expect(all).toHaveLength(47)
    for (const raw of all) {
      const client = fromRaw(raw, now)
      expect(client.ref).toBe(raw.ClientRef)
      expect(client.name.length).toBeGreaterThan(0)
      expect(client.briefing.map((c) => c.type)).toEqual(['talktrack', 'metrics', 'flags', 'context'])
    }
  })

  it('never lets an IBAN or an account name into the output', () => {
    for (const raw of all) {
      const accountNames = new Set(strings((raw.Portfolios as { AccountPositions?: { AccountName?: string }[] }[] | null ?? []).flatMap((p) => (p.AccountPositions ?? []).map((a) => a.AccountName))))
      for (const s of strings(fromRaw(raw, now))) {
        expect(s).not.toMatch(IBAN)
        expect(accountNames.has(s)).toBe(false)
      }
    }
  })

  it('invents no headline, proposal, actions or news', () => {
    const types = new Set(all.flatMap((raw) => fromRaw(raw, now).briefing.map((c) => c.type)))
    expect([...types].sort()).toEqual(['context', 'flags', 'metrics', 'talktrack'])
  })

  it('counts errors and warnings from the violation severities (CASE-001)', () => {
    const raw = all.find((c) => c.ClientRef === 'CASE-001')!
    const violations = raw.SuitabilityViolations as { Severity: string }[]
    const client = fromRaw(raw, now)
    expect(client.errors).toBe(violations.filter((v) => v.Severity === 'Error').length)
    expect(client.warnings).toBe(violations.filter((v) => v.Severity === 'Warning').length)
    expect(client.aum).toBe("CHF 726'484.80")
    expect(client.portfolioNr).toBe('CASE-001-01')
  })
})

describe('fromRaw happy path', () => {
  const client = fromRaw({
    ClientRef: 'CASE-900', FirstName: 'Anna', LastName: 'Muster', Company: null, RegulatoryClientTypeName: 'Private client',
    ReportingCurrency: 'CHF', RiskProfileName: 'Anlageprofil 4', EsgProfileName: 'Yes', Birthday: '1980-10-01', ProfilingDateUtc: '2025-03-04T23:00:00+01:00',
    AssetsUnderManagementInDefaultCurrency: 1240000, LiquidityInDefaultCurrency: 124000,
    Portfolios: [{
      PortfolioNr: 'CASE-900-01', InvestmentServiceName: 'Advisory', StrategyName: 'Balanced', AssetsUnderManagementInDefaultCurrency: 1240000,
      SecurityPositions: [{ SecurityName: 'A', PortfolioValuePercentage: 0.25 }, { SecurityName: 'B', PortfolioValuePercentage: 0.1 }],
      AccountPositions: [{ AccountName: 'Privatkonto BTC', IBAN: 'CH93 0076 2011 6238 5295 7', Currency: 'BTC', PortfolioValuePercentage: 0.1 }],
    }],
    Proposals: [{ ProposedDateUTC: '2024-01-05T10:00:00Z' }, { ProposedDateUTC: '2026-02-11T10:00:00Z' }],
    SuitabilityViolations: [{ RuleCode: 'Cluster risk', Severity: 'Warning' }, { RuleCode: 'Max volatility', Severity: 'Error' }, { RuleCode: 'Max volatility', Severity: 'Error' }],
    ClientNotes: [
      { Note: 'Oldest', CreatedByDateUTC: '2020-01-01T00:00:00' }, { Note: 'Newest, pays from CH93 0076 2011 6238 5295 7', CreatedByDateUTC: '2026-09-01T00:00:00' },
      { Note: 'n3', CreatedByDateUTC: '2025-01-01T00:00:00' }, { Note: 'n4', CreatedByDateUTC: '2024-01-01T00:00:00' }, { Note: 'n5', CreatedByDateUTC: '2023-01-01T00:00:00' },
    ],
  }, now)

  it('fills the header', () => {
    expect(client).toMatchObject({
      ref: 'CASE-900', name: 'Anna Muster', clientType: 'Privatkunde', profile: 'Anlageprofil 4', portfolioNr: 'CASE-900-01', service: 'Advisory', strategy: 'Balanced',
      aum: "CHF 1'240'000.00", birthday: '01.10.1980', lastProfiling: '04.03.2025', lastConsultation: '11.02.2026', errors: 2, warnings: 1,
    })
  })

  it('builds metrics, flags and context', () => {
    const [, metrics, flags, context] = client.briefing
    expect(metrics.type === 'metrics' && metrics.items.map((m) => m.value)).toEqual(["1'240'000", '10.0%', '2', '25.0%'])
    expect(flags.type === 'flags' && flags.items).toEqual([
      { severity: 'risk', text: 'Max volatility (2×)', source: 'Regelverletzung' },
      { severity: 'warn', text: 'Cluster risk', source: 'Regelverletzung' },
    ])
    expect(context.type === 'context' && context.notes.map((n) => n.date)).toEqual(['01.09.2026', '01.01.2025', '01.01.2024', '01.01.2023'])
    expect(context.type === 'context' && context.facts.find((f) => f.label === 'Alter')?.value).toBe('45 Jahre')
  })

  it('masks an IBAN typed into a note and drops account fields', () => {
    const out = strings(client).join('\n')
    expect(out).not.toMatch(IBAN)
    expect(out).not.toContain('Privatkonto')
  })
})

describe('fromRaw with missing data', () => {
  it('handles explicit nulls and absent keys', () => {
    const client = fromRaw({ ClientRef: 'CASE-901', FirstName: null, LastName: null, Company: 'Beispiel AG', Portfolios: null, SuitabilityViolations: null, ClientNotes: null, Birthday: null }, now)
    expect(client).toMatchObject({ ref: 'CASE-901', name: 'Beispiel AG', profile: '–', portfolioNr: '–', aum: 'CHF 0.00', birthday: '–', errors: 0, warnings: 0 })
    const flags = client.briefing.find((c) => c.type === 'flags')
    expect(flags?.type === 'flags' && flags.items[0].severity).toBe('ok')
  })

  it('never throws on junk', () => {
    for (const junk of [null, undefined, 42, 'x', [], {}, { ClientRef: 7, Portfolios: 'no', ClientNotes: [null, 3, {}], SuitabilityViolations: [{}] }]) {
      const client = fromRaw(junk, now)
      expect(client.ref.length).toBeGreaterThan(0)
      expect(client.name.length).toBeGreaterThan(0)
    }
  })
})

describe('formatting', () => {
  it('uses Swiss grouping and dd.MM.yyyy', () => {
    expect(formatAmount(1240000)).toBe("1'240'000.00")
    expect(formatAmount(-67000, 0)).toBe("-67'000")
    expect(formatAmount(999.5)).toBe('999.50')
    expect(formatDate('2026-05-08')).toBe('08.05.2026')
    expect(formatDate(null)).toBe('–')
  })
})

describe('parseClientFile', () => {
  it('accepts a list of clients', () => {
    const result = parseClientFile(clientsJson)
    expect(result.ok && result.raw.length).toBe(47)
  })

  it('explains in German what is wrong', () => {
    expect(parseClientFile('not json')).toMatchObject({ ok: false, error: expect.stringContaining('JSON') })
    expect(parseClientFile('{"a":1}')).toMatchObject({ ok: false })
    expect(parseClientFile('[]')).toMatchObject({ ok: false })
    expect(parseClientFile('[{"ClientRef":"CASE-1"},{"Name":"x"}]')).toMatchObject({ ok: false, error: expect.stringContaining('Eintrag 2') })
  })
})
