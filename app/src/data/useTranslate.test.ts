import { describe, expect, it } from 'vitest'
import { staticEn, tr } from './i18n-static'
import { looksGerman, monthLabel } from './useTranslate'

// Only German goes to the translator. The examples are finding titles as the engine writes them
// (engine/checks/*.ts), in both languages.
describe('looksGerman', () => {
  it('recognises German finding titles', () => {
    for (const title of [
      'P-1001: Klumpenrisiko Nestlé, 23.9% des Portfolios',
      'Von 12 Kunden mit Profil Ausgewogen haben 7 im Jahr 2025 einen Vorschlag angenommen',
      'P-1001: keine Zielallokation hinterlegt, Abweichungen werden nicht geprüft',
      'P-1001: Fremdwährungsanteil 61.0%, über der Grenze von 50%',
      'Widerspruch: Keine fossilen Energien, Portfolio hält 0.9% direkt',
      'Zugesagt am 12.08.2026, noch offen (14 Tage).',
      'Grösster Treiber: Apple mit 17.8%. Nach Verkauf: 12.1%.',
      "Liquidität CHF 80'000 liegt unter dem geplanten Bezug von CHF 120'000",
      'im letzten Monat. Seit Jahresbeginn −5.6%.',
      'Zürcher Kantonalbank macht 12.4% des Vermögens aus.',
    ]) expect(looksGerman(title), title).toBe(true)
  })

  it('lets English titles pass, also with Swiss security names and amounts in them', () => {
    for (const title of [
      'P-1001: Cluster risk Nestlé, 23.9% of the portfolio',
      'P-1001: Cluster risk Zürcher Kantonalbank, 12.4% of the portfolio',
      'Münchener Rück: 4.2% of total assets, held directly',
      'P-1001: foreign-currency share 61.0%, above the limit of 50%',
      'Of 12 clients with profile Ausgewogen, 7 accepted a proposal in 2025',
      "Liquidity CHF 80'000 is below the planned withdrawal of CHF 120'000",
      '0.625 % Vereinigte Staaten von Amerika 2021-15.10.24: 5.1% of the portfolio',
      'Tone: factual, numbers first',
      'Zürcher Kantonalbank',
      'Nestlé',
      'Münchener Rück',
      "CHF 1'240'000",
      '',
    ]) expect(looksGerman(title), title).toBe(false)
  })

  it('ignores what is quoted from the data inside «…»', () => {
    expect(looksGerman('Rejected on 20.08.2024: «Zu viel Risiko für den Kunden»')).toBe(false)
    expect(looksGerman('Abgelehnt vom 20.08.2024: «Too much risk»')).toBe(true)
  })
})

describe('fixed labels', () => {
  it('answers from the dictionary, exact strings and patterns', () => {
    expect(staticEn('Einstieg')).toBe('Opening')
    expect(staticEn('Chance: ')).toBe('Opportunity: ')
    expect(staticEn('2 Fehler · 1 Warnungen')).toBe('2 errors · 1 warning')
    expect(staticEn('Sept. 2024')).toBe('Sep 2024')
    expect(staticEn('45 Jahre')).toBe('45 years')
    expect(staticEn('Nachfragen zu Muster AG …  /')).toBe('Ask about Muster AG …  /')
  })

  it('leaves everything else alone', () => {
    expect(staticEn('Nestlé 2024')).toBeUndefined()
    expect(staticEn('P-1001: Klumpenrisiko Nestlé, 23.9% des Portfolios')).toBeUndefined()
    expect(tr('Einstieg', 'de')).toBe('Einstieg')
    expect(tr('Kein Eintrag hier', 'en')).toBe('Kein Eintrag hier')
  })

  it('month labels keep working for charts', () => {
    expect(monthLabel('Juli 2025', 'en')).toBe('July 2025')
    expect(monthLabel('Juli 2025', 'de')).toBe('Juli 2025')
  })
})
