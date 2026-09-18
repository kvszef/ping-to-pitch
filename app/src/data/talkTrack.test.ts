import { describe, expect, it } from 'vitest'
import { factsFromRaw } from './facts'
import { talkTrackFromRaw } from './talkTrack'

const now = new Date('2026-09-19T00:00:00Z')

describe('talkTrackFromRaw', () => {
  it('builds the four blocks from violations, stale notes and rejected proposals', () => {
    const raw = {
      Portfolios: [{ AssetsUnderManagementInDefaultCurrency: 100, PerformanceHistory: [{ Date: '2025-12-01', Value: 100 }, { Date: '2026-01-01', Value: 100 }, { Date: '2026-07-01', Value: 104 }] }],
      ClientNotes: [{ Note: 'No fossil fuels', CreatedByDateUTC: '2024-01-01T00:00:00' }],
      Proposals: [{ ProposalStatusName: 'Abgelehnt', Reason: 'Client relocation', ProposedDateUTC: '2026-03-01T00:00:00Z' }],
    }
    const card = talkTrackFromRaw(raw, factsFromRaw(raw), [{ severity: 'risk', text: 'Übergewicht im Aktiensektor «Energie»' }], now)
    expect(card.open.text).toContain('+4.0%')
    expect(card.mention[0].text).toBe('Übergewicht im Aktiensektor «Energie».')
    expect(card.ask[0]).toMatchObject({ text: 'Gilt das noch: «No fossil fuels»?', date: '01.01.2024' })
    expect(card.avoid[0].text).toBe('«Client relocation»: vom Kunden abgelehnt.')
  })

  it('stays valid for an empty client file', () => {
    const card = talkTrackFromRaw({}, factsFromRaw({}), [], now)
    expect(card.open.text).toBeTruthy()
    expect([card.mention, card.ask, card.avoid, card.reasons]).toEqual([[], [], [], []])
  })
})
