import type { Client } from '../types'
import type { Chart, Tile } from './screen'

// The whole main panel as one text: the same tiles the advisor sees (already trimmed to ~60 s), as
// grouped bullet points, plus at most two graphs. Shown in place of the tiles, copied as plain text,
// or printed as a one-page PDF (TextView.tsx). Nothing is computed here: every figure, sentence and
// source comes from the tiles and charts, so the text can never say more than the screen does.

export type DigestBullet = { id: string; figure?: string; text: string; source: string; severity?: Tile['severity'] }
export type DigestSection = { group: string; bullets: DigestBullet[] }
export type Digest = { ref: string; name: string; facts: [label: string, value: string][]; sections: DigestSection[]; charts: Chart[]; seconds: number }

const MAX_CHARTS = 2

function bulletsOf(tile: Tile, clientRef: string, text?: string): DigestBullet[] {
  if (tile.item) {
    const { figure, source } = tile.item
    // The agent's shorter wording may repeat the figure; it is shown once, in front.
    const body = text && figure && text.startsWith(figure) ? text.slice(figure.length).replace(/^[\s,:]+/, '') : text ?? tile.item.text
    return [{ id: tile.id, figure, text: body, source, severity: tile.severity }]
  }
  if (tile.news) return tile.news.flatMap((n) => {
    const hit = n.affects[clientRef]
    return hit ? [{ id: `${tile.id}:${n.id}`, figure: hit.tag, text: `${n.title}: ${hit.meaning}`, source: `${n.source} · ${n.time}`, severity: hit.severity }] : []
  })
  if (tile.card?.type === 'proposal') return [
    { id: tile.id, text: text ?? tile.card.summary, source: 'Anlagevorschlag', severity: tile.severity },
    ...tile.card.effects.slice(0, 4).map((e, i) => ({ id: `${tile.id}:${i}`, figure: `${e.before} → ${e.after}`, text: e.label, source: 'Anlagevorschlag', severity: e.ok ? 'ok' as const : 'risk' as const })),
  ]
  return []
}

export function digestFor(client: Client, tiles: Tile[], charts: Chart[], texts: Record<string, string> = {}): Digest {
  const sections: DigestSection[] = []
  for (const t of tiles) {
    const bullets = bulletsOf(t, client.ref, texts[t.id])
    if (!bullets.length) continue
    const last = sections[sections.length - 1]
    if (last?.group === t.group) last.bullets.push(...bullets)
    else sections.push({ group: t.group, bullets })
  }
  const facts = ([
    ['Vermögen', client.aum], ['Profil', client.profile], ['Strategie', client.strategy], ['Dienstleistung', client.service], ['Letzte Beratung', client.lastConsultation],
    ['Regelverletzungen', client.errors + client.warnings ? `${client.errors} Fehler · ${client.warnings} Warnungen` : undefined],
  ] as [string, string | undefined][]).filter((f): f is [string, string] => !!f[1] && f[1] !== '–')
  // The graphs the shown tiles point to come first, then whatever else the data offers.
  const wanted = [...tiles.map((t) => t.chart), ...charts.map((c) => c.id)]
  const picked = [...new Set(wanted)].map((id) => charts.find((c) => c.id === id)).filter((c): c is Chart => !!c && (c.spec.type === 'balken' ? c.spec.bars.length > 0 : c.spec.points.length > 1))
  return { ref: client.ref, name: client.name, facts, sections, charts: picked.slice(0, MAX_CHARTS), seconds: Math.round(tiles.reduce((n, t) => n + t.seconds, 0)) }
}

/** The digest as plain text, for the clipboard or an e-mail to oneself. `t` puts a German original into the display language. */
export function digestText(d: Digest, t: (german: string) => string = (x) => x): string {
  const chartLine = ({ title, spec }: Chart) => spec.type === 'balken'
    ? `${t(title)}: ${spec.bars.map((b) => `${t(b.label)} ${b.value}${spec.unit}`).join(', ')}`
    : `${t(title)}: ${spec.points[0].label} ${spec.points[0].value} → ${spec.points[spec.points.length - 1].label} ${spec.points[spec.points.length - 1].value} ${spec.unit}`.trim()
  const head = [`${d.name} · ${t('Überblick')}, ${d.seconds} ${t('Sekunden Lesezeit')}`, d.facts.map(([l, v]) => `${t(l)}: ${v}`).join(' · ')].filter(Boolean)
  const body = d.sections.map((s) => [t(s.group), ...s.bullets.map((b) => `• ${b.figure ? `${b.figure} ` : ''}${t(b.text)} (${t(b.source)})`)].join('\n'))
  const charts = d.charts.length ? [[t('Grafiken'), ...d.charts.map((c) => `• ${chartLine(c)}`)].join('\n')] : []
  return [head.join('\n'), ...body, ...charts].join('\n\n')
}
