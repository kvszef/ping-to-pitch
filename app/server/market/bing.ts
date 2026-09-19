// Free news source: Bing News RSS. No key, German headlines for Swiss names, one request per search term.
// Chosen because Google News blocks server requests, Yahoo needs tickers (the data has none) and GDELT
// allows one request every 5 s. The parser is separate so tests run without network.

export type Article = { id: string; title: string; url: string; source: string; published?: string; snippet: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const tag = (item: string, name: string) => {
  const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? decode(m[1]) : ''
}

// Bing wraps links in a click tracker; the real article sits in its `url` parameter.
function realUrl(link: string) {
  try { return new URL(link).searchParams.get('url') ?? link } catch { return link }
}

// Short stable id from the article URL, so the same article keeps its id across requests.
export function articleId(url: string) {
  let h = 5381
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) >>> 0
  return `N-${h.toString(36)}`
}

export function parseRss(xml: string): Article[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []
  return items.map((item) => {
    const url = realUrl(tag(item, 'link'))
    const date = tag(item, 'pubDate')
    const published = date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : undefined
    return { id: articleId(url), title: tag(item, 'title'), url, source: tag(item, 'News:Source') || tag(item, 'source') || 'Bing News', published, snippet: tag(item, 'description') }
  }).filter((a) => a.title && a.url)
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

export async function searchBing(query: string, fetchImpl: typeof fetch = fetch): Promise<Article[]> {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&setlang=de-CH&cc=CH`
  const r = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'de-CH,de;q=0.9' }, signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`Bing News ${r.status}`)
  return parseRss(await r.text())
}
