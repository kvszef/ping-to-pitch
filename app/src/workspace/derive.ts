import type { Client, Severity } from '../types'
import type { Topic } from './types'

// Conversation topics for a client that has no hand-written ones: built from the computed key
// figures and the briefing cards, so they work for every client file. Every sentence carries a
// figure that `data/facts.ts` or a card produced. This is also the example-mode fallback.

const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
const share = (v: number) => `${v.toFixed(1)}%`
const levels = (kurz: string, standard: string, detailliert: string) => ({ kurz, standard: `${kurz} ${standard}`.trim(), detailliert: `${kurz} ${standard} ${detailliert}`.trim() })

export function deriveTopics(client: Client): Topic[] {
  const f = client.facts
  const out: Topic[] = []
  if (!f) return out

  const p = f.performance
  if (p) {
    const severity: Severity = p.month <= -3 ? 'risk' : p.month < 0 ? 'warn' : 'ok'
    out.push({
      id: 'wertentwicklung', label: 'Wertentwicklung', severity,
      keywords: ['wert', 'perform', 'rendite', 'verlust', 'verlor', 'gefallen', 'minus', 'entwickl', 'depot', 'gewinn'],
      say: `Ihr Vermögen hat sich im letzten Monat um ${signed(p.month)} verändert und steht seit Jahresbeginn bei ${signed(p.ytd)}.`,
      why: `Stand ${f.asOf ?? 'unbekannt'}. Schwächster Monat seit ${p.startLabel}: ${p.worst.label} mit ${signed(p.worst.value)}.`,
      next: `Den Monat (${signed(p.month)}) neben den schwächsten Monat ${p.worst.label} (${signed(p.worst.value)}) stellen und fragen, ob die Schwankung noch zum Ziel passt.`,
      insight: levels(
        `Letzter Monat ${signed(p.month)}, seit Jahresbeginn ${signed(p.ytd)}, seit ${p.startLabel} ${signed(p.sinceStart)}.`,
        `Schwächster Monat war ${p.worst.label} mit ${signed(p.worst.value)}.${f.risk ? ` Volatilität ${share(f.risk.volatility)}, Value at Risk ${share(f.risk.valueAtRisk)}.` : ''}`,
        p.note,
      ),
      sources: ['Wertverlauf des Portfolios'],
      module: { confidence: 85, spec: { type: 'verlauf', title: 'Wertverlauf, 12 Monate', unit: '', note: `Indexiert auf 100. ${p.note}`, points: p.series } },
    })
  }

  const top = f.positions[0]
  if (top) {
    const severity: Severity = top.share >= 20 ? 'risk' : top.share >= 10 ? 'warn' : 'info'
    const three = f.positions.slice(0, 3)
    const threeSum = three.reduce((n, x) => n + x.share, 0)
    out.push({
      id: 'konzentration', label: 'Grösste Positionen', severity,
      keywords: ['position', 'titel', 'aktie', 'klumpen', 'konzentr', 'gross', 'gröss', 'risiko', 'einzel', ...top.name.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 4).slice(0, 2)],
      say: `${top.name} macht ${share(top.share)} Ihres Vermögens aus${top.riskShare ? ` und trägt ${share(top.riskShare)} zum Risiko bei` : ''}. Möchten Sie dieses Gewicht so behalten?`,
      why: `Die drei grössten von ${f.positionCount} Positionen ergeben zusammen ${share(threeSum)}.`,
      next: `Fragen, ob ${top.name} (${share(top.share)}) bewusst so gross ist, und eine Obergrenze pro Titel festhalten.`,
      insight: levels(
        `${top.name} ist mit ${share(top.share)} die grösste von ${f.positionCount} Positionen.`,
        `Die drei grössten: ${three.map((x) => `${x.name} ${share(x.share)}`).join(', ')}, zusammen ${share(threeSum)}.`,
        three.some((x) => x.riskShare) ? `Anteil am Portfoliorisiko: ${three.filter((x) => x.riskShare).map((x) => `${x.name} ${share(x.riskShare!)}`).join(', ')}.` : '',
      ),
      sources: ['Positionen des Portfolios'],
      module: { confidence: 80, spec: { type: 'balken', title: 'Grösste Positionen', unit: '%', note: 'Anteil am Gesamtvermögen des Kunden.', bars: f.positions.map((x) => ({ label: x.name, value: x.share })) } },
    })
  }

  const foreign = f.currencies.filter((c) => c.label !== 'CHF')
  if (f.currencies.length > 1 && foreign[0]) {
    const home = f.currencies.find((c) => c.label === 'CHF')
    out.push({
      id: 'waehrungen', label: 'Währungen', severity: foreign[0].share >= 30 ? 'warn' : 'info',
      keywords: ['währung', 'dollar', 'usd', 'euro', 'eur', 'franken', 'chf', 'wechselkurs', 'fremdwähr'],
      say: `${home ? `${share(home.share)} Ihres Vermögens liegen in Franken, ` : ''}${share(foreign[0].share)} in ${foreign[0].label}. Wechselkurse bewegen also ${home ? share(100 - home.share) : 'einen Teil'} des Vermögens.`,
      why: f.currencies.map((c) => `${c.label} ${share(c.share)}`).join(', '),
      next: `Klären, ob der ${foreign[0].label}-Anteil von ${share(foreign[0].share)} gewollt ist oder abgesichert werden soll.`,
      insight: levels(`Währungen nach Position und Konto: ${f.currencies.map((c) => `${c.label} ${share(c.share)}`).join(', ')}.`, 'Ohne Durchsicht in Fonds: die Fondswährung zählt, nicht deren Inhalt.', ''),
      sources: ['Positionen und Konten des Portfolios'],
      module: { confidence: 75, spec: { type: 'balken', title: 'Währungen', unit: '%', note: 'Nach Positions- und Kontowährung, ohne Durchsicht in Fonds.', bars: f.currencies.map((c) => ({ label: c.label, value: c.share })) } },
    })
  }

  const flags = client.briefing.flatMap((c) => (c.type === 'flags' ? c.items : [])).filter((i) => i.severity === 'risk' || i.severity === 'warn')
  if (flags.length) {
    out.push({
      id: 'regeln', label: 'Regelverletzungen', severity: flags[0].severity,
      keywords: ['regel', 'verletz', 'verstoss', 'eignung', 'mandat', 'warnung', 'übergewicht', 'untergewicht'],
      say: `In Ihrem Portfolio ist eine Vorgabe nicht eingehalten: ${flags[0].text}. Ich möchte mit Ihnen besprechen, wie wir das beheben.`,
      why: `${client.errors} Fehler und ${client.warnings} Warnungen aus der Eignungsprüfung.`,
      next: `Zu «${flags[0].text.replace(/[«»]/g, '')}» die kleinste Umschichtung vorschlagen, die die Vorgabe wieder einhält.`,
      insight: levels(`${client.errors} Fehler, ${client.warnings} Warnungen. Wichtigste: ${flags[0].text}.`, `Weitere: ${flags.slice(1, 4).map((x) => x.text).join('; ')}.`, ''),
      sources: ['Eignungsprüfung (Regelverletzungen)'],
    })
  }

  const pr = f.proposals
  if (pr.total > 0) {
    out.push({
      id: 'vorschlaege', label: 'Frühere Vorschläge', severity: pr.rejected > pr.accepted ? 'warn' : 'info',
      keywords: ['vorschlag', 'vorschläg', 'abgelehnt', 'angenommen', 'empfehl', 'letzt'],
      say: pr.last ? `Unser letzter Vorschlag vom ${pr.last.date} ist ${pr.last.status === 'Final' ? 'umgesetzt' : pr.last.status === 'Abgelehnt' ? 'von Ihnen abgelehnt worden' : 'noch offen'}. Ich knüpfe heute daran an.` : `Wir haben Ihnen bisher ${pr.total} Vorschläge unterbreitet.`,
      why: `${pr.accepted} von ${pr.total} Vorschlägen umgesetzt, ${pr.rejected} abgelehnt${pr.draft ? `, ${pr.draft} im Entwurf` : ''}.`,
      next: pr.rejected > pr.accepted ? `Der Kunde lehnte ${pr.rejected} von ${pr.total} Vorschlägen ab: zwei Varianten zur Wahl anbieten statt einer Empfehlung.` : `An den Vorschlag vom ${pr.last?.date ?? 'letzten Mal'} anknüpfen und die Umsetzung bestätigen lassen.`,
      insight: levels(`${pr.accepted} von ${pr.total} Vorschlägen umgesetzt, ${pr.rejected} abgelehnt.`, pr.last ? `Letzter Vorschlag ${pr.last.date}: ${pr.last.status}${pr.last.reason ? `, Anlass «${pr.last.reason}»` : ''}.` : '', ''),
      sources: ['Vorschläge des Kunden'],
    })
  }

  const notes = client.briefing.flatMap((c) => (c.type === 'context' ? c.notes : []))
  if (notes[0]) {
    out.push({
      id: 'notizen', label: 'Letzte Notiz', severity: 'info',
      keywords: ['notiz', 'wunsch', 'wünsch', 'plan', 'ziel', 'gesagt', 'erwähnt'],
      say: `Beim letzten Mal haben wir festgehalten: «${notes[0].text}». Gilt das noch?`,
      why: `Notiz vom ${notes[0].date}.`,
      next: `Die Notiz vom ${notes[0].date} bestätigen oder anpassen lassen.`,
      insight: levels(`Notiz vom ${notes[0].date}: «${notes[0].text}».`, notes.slice(1, 3).map((n) => `${n.date}: «${n.text}»`).join(' '), ''),
      sources: ['Kundennotizen'],
    })
  }

  const rank: Record<Severity, number> = { risk: 0, warn: 1, info: 2, ok: 3 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}
