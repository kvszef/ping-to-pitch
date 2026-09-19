import { describe, expect, it } from 'vitest'
import type { EngineFinding } from '../types'
import { callReasonsOf, talkingPointsOf } from './callReasons'

const finding = (id: string, check: string, severity: EngineFinding['severity'], numbers?: Record<string, number>): EngineFinding =>
  ({ id, check, kind: 'interpretation', severity, title: id, evidence: [], numbers }) as EngineFinding

describe('callReasonsOf', () => {
  // The engine's list arrives sorted by severity, so a 'warn' house view used to show as reason no. 1.
  const findings = [finding('view', 'cio.house-view', 'warn', { changed: 1 }), finding('news', 'profile.call-reason', 'risk'), finding('second', 'profile.call-reason', 'info', { rank: 2 }), finding('first', 'profile.call-reason', 'info', { rank: 1 })]

  it('keeps call reasons only, most probable first, unranked news last', () => {
    expect(callReasonsOf(findings).map((f) => f.id)).toEqual(['first', 'second', 'news'])
  })

  it('lists a changed house view apart, as a talking point', () => {
    expect(talkingPointsOf(findings).map((f) => f.id)).toEqual(['view'])
  })

  it('has nothing to say without findings', () => {
    expect(callReasonsOf(undefined)).toEqual([])
    expect(talkingPointsOf([])).toEqual([])
  })
})
