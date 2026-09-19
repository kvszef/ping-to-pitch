import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assembleClients, assembleReference, type Raw, type Tables } from './database.ts'
import { toRows, ToolboxError } from './toolbox.ts'

const clients: Raw[] = JSON.parse(readFileSync(resolve(__dirname, '../../core-case/portfolio-data/clients.json'), 'utf8'))

const list = (v: unknown): Raw[] => (Array.isArray(v) ? v as Raw[] : [])

/**
 * Zerlegt einen Kunden in Tabellenzeilen, genau so wie phone/scripts/load-data.ts es tut: die fünf
 * Sammlungen mit eigener Tabelle fallen aus dem Kundensatz heraus, SecurityPositions und
 * AccountPositions aus dem Portfolio. Damit prüft der Rundlauf unten wirklich das Zusammensetzen
 * und nicht bloss, dass zwei Testdaten zueinander passen.
 */
function split(all: Raw[]): Tables {
  const t: Tables = { clients: [], portfolios: [], positions: [], accounts: [], proposals: [], transactions: [], violations: [], notes: [] }
  for (const c of all) {
    const { Portfolios, Proposals, Transactions, SuitabilityViolations, ClientNotes, ...satz } = c
    const ref = c.ClientRef as string
    t.clients.push({ client_ref: ref, beschreibung: c.Description ?? null, satz })
    for (const p of list(Portfolios)) {
      const { SecurityPositions, AccountPositions, ...pf } = p
      const id = p.PortfolioId as number
      t.portfolios.push({ client_ref: ref, portfolio_id: id, satz: pf })
      for (const x of list(SecurityPositions)) t.positions.push({ portfolio_id: id, satz: x })
      for (const a of list(AccountPositions)) t.accounts.push({ portfolio_id: id, satz: a })
    }
    for (const p of list(Proposals)) t.proposals.push({ client_ref: ref, satz: p })
    for (const x of list(Transactions)) t.transactions.push({ client_ref: ref, satz: x })
    // Der Lader schreibt IndividualRuleOverrides in dieselbe Tabelle mit is_override = 1; das
    // Werkzeug app_violations filtert sie weg, hier kommen sie deshalb gar nicht erst vor.
    for (const v of list(SuitabilityViolations)) t.violations.push({ client_ref: ref, satz: v })
    for (const n of list(ClientNotes)) t.notes.push({ client_ref: ref, satz: n })
  }
  return t
}

const empty: Tables = { clients: [], portfolios: [], positions: [], accounts: [], proposals: [], transactions: [], violations: [], notes: [] }

describe('assembleClients on the real clients.json', () => {
  const rebuilt = assembleClients(split(clients))

  it('gives every client back, in order', () => {
    expect(rebuilt).toHaveLength(clients.length)
    expect(rebuilt.map((c) => c.ClientRef)).toEqual(clients.map((c) => c.ClientRef))
  })

  it('rebuilds each client field by field', () => {
    for (const [i, original] of clients.entries()) {
      // Die fünf Sammlungen kommen immer als Liste zurück. In der Lieferung fehlen sie mal ganz
      // und stehen mal als null da (20 Kunden führen SuitabilityViolations: null) -- beides wird
      // ohnehin überall als leere Liste gelesen.
      expect(rebuilt[i]).toEqual({
        ...original,
        Portfolios: list(original.Portfolios).map((p) => ({ ...p, SecurityPositions: list(p.SecurityPositions), AccountPositions: list(p.AccountPositions) })),
        Proposals: list(original.Proposals),
        Transactions: list(original.Transactions),
        SuitabilityViolations: list(original.SuitabilityViolations),
        ClientNotes: list(original.ClientNotes),
      })
    }
  })

  it('keeps positions with their own portfolio', () => {
    // CASE-038 hat mehrere Portfolios; ohne Bündelung über portfolio_id landet alles im ersten.
    const original = clients.find((c) => c.ClientRef === 'CASE-038')!
    const got = rebuilt.find((c) => c.ClientRef === 'CASE-038')!
    const counts = (c: Raw) => list(c.Portfolios).map((p) => list(p.SecurityPositions).length + list(p.AccountPositions).length)
    expect(counts(got)).toEqual(counts(original))
    expect(counts(got).filter((n) => n > 0).length).toBeGreaterThan(1)
  })
})

describe('assembleClients with missing data', () => {
  it('sets every collection on a client that has nothing', () => {
    const [c] = assembleClients({ ...empty, clients: [{ client_ref: 'NEU-01', satz: { ClientRef: 'NEU-01' } }] })
    expect(c).toEqual({ ClientRef: 'NEU-01', Portfolios: [], Proposals: [], Transactions: [], SuitabilityViolations: [], ClientNotes: [] })
  })

  it('drops a row without a client reference instead of throwing', () => {
    expect(assembleClients({ ...empty, clients: [{ satz: { FirstName: 'Ohne' } }, { client_ref: 'X', satz: null }] })).toEqual([])
  })

  it('takes the maintained description over the one in the delivery', () => {
    const rows = { ...empty, clients: [{ client_ref: 'X', beschreibung: 'Telefon 2026-09-19: Mutter verstorben.', satz: { ClientRef: 'X', Description: 'Stand der Lieferung' } }] }
    expect(assembleClients(rows)[0].Description).toBe('Telefon 2026-09-19: Mutter verstorben.')
  })

  it('keeps the delivered description when the column is empty', () => {
    const rows = { ...empty, clients: [{ client_ref: 'X', beschreibung: null, satz: { ClientRef: 'X', Description: 'Stand der Lieferung' } }] }
    expect(assembleClients(rows)[0].Description).toBe('Stand der Lieferung')
  })

  it('reads a row whose satz arrived as a string', () => {
    // Toolbox parst JSON-Zellen selbst auf; eine ältere Fassung täte es nicht.
    const rows = { ...empty, clients: [{ client_ref: 'X', satz: '{"ClientRef":"X","FirstName":"Aus Text"}' }] }
    expect(assembleClients(rows)[0].FirstName).toBe('Aus Text')
  })
})

describe('assembleReference', () => {
  it('turns one row per collection back into the lookup file', () => {
    const ref = assembleReference([
      { name: 'Securities', entries: 1, satz: [{ Id: 7 }] },
      { name: 'SuitabilityRules', entries: 0, satz: [] },
      { name: 'Tags', entries: 1, satz: '[{"Id":3}]' },
    ])
    expect(ref).toEqual({ Securities: [{ Id: 7 }], SuitabilityRules: [], Tags: [{ Id: 3 }] })
  })

  it('ignores a row without a name', () => {
    expect(assembleReference([{ entries: 1, satz: [{ Id: 7 }] }])).toEqual({})
  })
})

describe('toRows', () => {
  it('parses the second stage', () => {
    expect(toRows('[{"a":1}]', 'app_clients')).toEqual([{ a: 1 }])
  })

  it('reads no hit as no rows', () => {
    expect(toRows('null', 'app_clients')).toEqual([])
    expect(toRows('', 'app_clients')).toEqual([])
  })

  it('treats a tool error dressed as HTTP 200 as an error', () => {
    // {"error":"…"} kommt mit Status 200 und steckt in der Zeichenkette; wer nur den Status
    // prüft, hält die Fehlermeldung für eine Datenzeile.
    expect(() => toRows('{"error":"no such table: reference_sets"}', 'app_reference')).toThrow(ToolboxError)
  })

  it('does not mistake a data row that has an error field for an error', () => {
    expect(toRows('[{"error":"x","name":"Securities"}]', 'app_reference')).toEqual([{ error: 'x', name: 'Securities' }])
  })
})
