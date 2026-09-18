import { describe, expect, it } from 'vitest'
import { client, ctx } from '../test-data.ts'
import { proposals } from './portfolio-proposals.ts'

describe('portfolio.proposals', () => {
  it('flags the CASE-037 draft and that it resembles the rejected proposal', () => {
    const f = proposals(client('CASE-037'), ctx)
    const draft = f.find((x) => x.id === 'portfolio.proposals:CASE-037:draft:24792')!
    expect(draft).toMatchObject({ kind: 'action', severity: 'warn', numbers: { positions: 37 } })
    expect(draft.title).toMatch(/^Offener Entwurf: «Periodische Portfolioüberprüfung» mit /)
    const repeat = f.find((x) => x.id === 'portfolio.proposals:CASE-037:repeat:24792')!
    expect(repeat).toMatchObject({ kind: 'interpretation', severity: 'info' })
    expect(repeat.numbers!.overlap).toBeGreaterThanOrEqual(0.5)
    expect(repeat.evidence.map((e) => e.ref)).toEqual(['24792', '22848'])
    // Roche, Novartis and Clariant were in the rejected proposal and are back in the draft.
    const raw = client('CASE-037').Proposals as { ProposalId: number; SecurityPositions: { SecurityName: string }[] }[]
    for (const id of [22848, 24792]) {
      const names = raw.find((p) => p.ProposalId === id)!.SecurityPositions.map((s) => s.SecurityName).join('|')
      for (const n of ['Roche', 'Novartis', 'Clariant']) expect(names).toContain(n)
    }
  })

  it('lists CASE-012 with 12 rejected proposals, one finding each, and the acceptance ratio', () => {
    const f = proposals(client('CASE-012'), ctx)
    expect(f.find((x) => x.id.endsWith(':rejected-summary'))!.numbers).toEqual({ rejected: 12 })
    expect(f.filter((x) => x.id.includes(':rejected:'))).toHaveLength(12)
    const ratio = f.find((x) => x.id.endsWith(':acceptance'))!
    expect(ratio.title).toBe('6 von 18 Vorschlägen angenommen, 12 abgelehnt')
    expect(ratio.numbers).toMatchObject({ accepted: 6, rejected: 12, total: 18 })
    expect(ratio.numbers!.acceptanceRate).toBeCloseTo(1 / 3)
  })

  it('yields nothing for a client with Proposals null', () => {
    expect(client('CASE-003').Proposals).toBeNull()
    expect(proposals(client('CASE-003'), ctx)).toEqual([])
  })

  it('does not flag a repeat when nothing was rejected', () => {
    const f = proposals(client('CASE-045'), ctx)
    expect(f.some((x) => x.id.includes(':draft:'))).toBe(true)
    expect(f.some((x) => x.id.includes(':repeat:'))).toBe(false)
  })
})
