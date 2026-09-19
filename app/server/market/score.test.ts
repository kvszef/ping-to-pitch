import { describe, expect, it } from 'vitest'
import { run } from '../../engine/run.ts'
import { client, clients, ctx } from '../../engine/test-data.ts'
import { engineReasons, newsPoints, weigh, type Reason } from './score.ts'

const reasonsOf = (ref: string, lang: 'de' | 'en' = 'en') => engineReasons(run(client(ref), { ...ctx, lang }), lang)
const headline = (points: number): Reason => ({ kind: 'risk', severity: 'risk', title: 'Nestle (4.0%): Schlagzeile', newsId: `n${points}`, points })

describe('engineReasons', () => {
  it('puts a missed payment and the rule breaches of CASE-012 in front', () => {
    const r = weigh([], reasonsOf('CASE-012')).reasons
    expect(r[0].title).toMatch(/13 rule breaches/)
    expect(r.some((x) => x.findingId?.startsWith('portfolio.liquidity'))).toBe(true)
  })

  it('gives a client without findings no reason and no score', () => {
    expect(weigh([], reasonsOf('CASE-003'))).toEqual({ score: 0, reasons: [] })
  })

  it('counts the many model-portfolio deviations as one weak line', () => {
    const lines = reasonsOf('CASE-045').filter((r) => /deviations from the model portfolio/.test(r.title))
    expect(lines).toHaveLength(1)
    expect(lines[0].points).toBe(0.5)
  })

  it('scores the same in German and English', () => {
    for (const c of clients.slice(0, 12)) {
      const ref = c.ClientRef as string
      expect(weigh([], reasonsOf(ref, 'de')).score).toBe(weigh([], reasonsOf(ref, 'en')).score)
    }
  })

  it('never throws on an empty or broken finding list', () => {
    expect(engineReasons([])).toEqual([])
    expect(engineReasons([{ id: 'x', check: 'portfolio.performance', kind: 'fact', severity: 'warn', title: 'x', evidence: [] }])).toEqual([])
  })
})

describe('weigh', () => {
  it('lets no single headline outrank five rule breaches', () => {
    const w = weigh([headline(3)], reasonsOf('CASE-001'))
    expect(w.reasons[0].findingId).toMatch(/^portfolio\.violations/)
  })

  it('keeps the two best stories and caps what news can add', () => {
    const w = weigh([headline(3), headline(2.5), headline(2), headline(1)], [])
    expect(w.reasons).toHaveLength(2)
    expect(w.score).toBeLessThanOrEqual(4)
  })

  it('ranks clients who need a call above clients with only a headline', () => {
    const quiet = weigh([headline(3), headline(3)], reasonsOf('CASE-003')).score
    for (const ref of ['CASE-012', 'CASE-001', 'CASE-041', 'CASE-036']) expect(weigh([], reasonsOf(ref)).score).toBeGreaterThan(quiet)
  })

  it('dampens a headline many clients share', () => {
    expect(newsPoints(2, 1)).toBe(2)
    expect(newsPoints(2, 8)).toBe(0.7)
  })
})
