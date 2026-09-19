// What to search the news for, per client: the biggest holdings, each turned into a short search term.
// Pure: security names in, search terms out. Only security names ever leave the server, never client data.
//   "Namen-Aktie Nestle SA"                                   → "Nestle"
//   "0.375 % OC Oerlikon Corporation AG, Pfaeffikon 2021-27.11.25" → "OC Oerlikon"
//   "Anteile … iShares VII PLC - iShares Core S&P 500 UCITS ETF"   → "S&P 500"
// Bond and money-market funds are left out: their news is the whole market, not the holding.

import type { Client, Position } from '../../engine/data.ts'

export type Holding = {
  query: string // search term, also the key for caching and matching
  label: string // what the advisor reads: the term, or the fund theme
  weight: number // share of the client's total portfolio value, 0–1, summed over all portfolios
  names: string[] // position names as in the client file (evidence, contradiction lookup)
  fund: boolean
}

const PREFIX = /^(Namen-Aktien?|Inhaber-Aktien?|Genussscheine?|Partizipationsscheine?|Stammaktien?|Vorzugsaktien?|Aktien?|Registered Shs|Namen-Akt\.?|Inhaber-Akt\.?|Shs|ADR)\s+/i
const LEGAL = /[\s,]+(AG|SA|S\.A\.|Ltd\.?|Limited|Inc\.?|Corp\.?|Corporation|plc|PLC|N\.V\.|NV|SE|S\.p\.A\.|GmbH|Holdings?|Group|International|Reg\.?\s*S?)\b\.?/g
const FUND_WORDS = /\b(iShares|Xtrackers|SPDR|UBS|CSIF|Swisscanto|Vanguard|PIMCO|HSBC|Pictet|Syz AM|Amundi|Lyxor|Invesco|Credit Suisse|Core|UCITS|ETF|ETFs|Fund|Funds|Fd|Index|Blue|Acc|Dist|Hedged|CHF|USD|EUR|\(CH\)|\(IE\)|\(Lux\)|\(R\)|Passive|Leader|I{1,3}|IV|VI{0,3}|PLC)\b/g

const tidy = (s: string) => s.replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/^[\s\-–,]+|[\s\-–,]+$/g, '').trim()

export function isFundPosition(p: Pick<Position, 'name' | 'security'>) {
  return /fund|etf/i.test(p.security?.type ?? '') || /^Anteile|^Accum|\bETF\b|\bFund\b|\bFonds\b/i.test(p.name)
}

/** Search term for one security name, or undefined when nothing searchable is left. */
export function searchTerm(name: string, fund: boolean): string | undefined {
  let s = name.trim()
  if (/Tracker|Zertifikat|Certificate/i.test(s) && /o\//.test(s)) s = s.split('o/').pop() ?? s
  else if (fund) s = s.includes(' - ') ? s.slice(s.lastIndexOf(' - ') + 3) : s.replace(/^(Anteile|Accum Shs)\s*(-[^-]*-)?\s*/i, '')
  else {
    s = s.replace(/^\d+(\.\d+)?\s*%\s*/, '') // bond coupon
    s = s.replace(/\s+\d{4}-.*$/, '') // bond term "2021-27.11.25 Reg S"
    s = s.replace(/,.*$/, '') // bond seat ", Pfaeffikon"
    s = s.replace(PREFIX, '')
  }
  s = fund ? s.replace(/\((CH|IE|Lux|R|Acc|Dist)\)/gi, ' ').replace(FUND_WORDS, ' ') : s.replace(LEGAL, ' ')
  s = tidy(s.replace(/[()]/g, ' '))
  return s.length >= 3 && /[a-z]/i.test(s) ? s : undefined
}

const SKIP_FUND_CLASS = /bond|liquid|money|fixed/i
// Structured products: the name is the product, not something the news writes about.
const STRUCTURED = /Reverse Convertible|Barrier|Autocall|Express[- ]Zertifikat|Callable|Warrant|Optionsschein/i

/** The client's biggest searchable holdings, merged across portfolios, largest first. */
export function holdingsOf(client: Client, max = 8): Holding[] {
  const total = client.portfolios.reduce((a, p) => a + p.value, 0)
  const byQuery = new Map<string, Holding>()
  for (const portfolio of client.portfolios) {
    const share = total > 0 ? portfolio.value / total : 0
    for (const p of portfolio.positions) {
      if (p.kind !== 'security' || p.weight <= 0) continue
      const fund = isFundPosition(p)
      if (STRUCTURED.test(p.name)) continue
      if (fund && SKIP_FUND_CLASS.test(p.security?.assetClass ?? p.security?.assetClassDetail ?? '')) continue
      const query = searchTerm(p.name, fund)
      if (!query) continue
      const h = byQuery.get(query) ?? { query, label: query, weight: 0, names: [], fund }
      h.weight += p.weight * share
      if (!h.names.includes(p.name)) h.names.push(p.name)
      byQuery.set(query, h)
    }
  }
  return [...byQuery.values()].sort((a, b) => b.weight - a.weight).slice(0, max)
}
