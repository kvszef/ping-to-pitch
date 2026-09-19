// Relay for the internet call's audio (TURN, Cloudflare Realtime). The audio normally flows directly between
// phone and desk; some networks block that, and then it goes through the relay. Optional: without
// CF_TURN_KEY_ID and CF_TURN_API_TOKEN in .env.local the call keeps its direct link only (protocol.ts ICE).
// The API token stays on the server: browsers only get short-lived credentials.

type Env = Record<string, string | undefined>
export type IceServer = { urls: string[]; username?: string; credential?: string }

const TTL_S = 6 * 3600 // how long one set of credentials is valid; a call is far shorter
const KEEP_MS = 3600_000 // how long the server reuses them before asking again
let kept: { at: number; key: string; servers: IceServer[] } | null = null

// Browsers refuse port 53, and waiting for it slows the connection down.
const usable = (url: string) => !/:53(\?|$)/.test(url)

/** Relay servers for a new call, or null when there is no relay (no keys, refused, offline). Never throws. */
export async function turnServers(env: Env, ask: typeof fetch = fetch, keepMs = KEEP_MS): Promise<IceServer[] | null> {
  const id = env.CF_TURN_KEY_ID, token = env.CF_TURN_API_TOKEN
  if (!id || !token) return null
  if (kept && kept.key === id && Date.now() - kept.at < keepMs) return kept.servers
  try {
    const r = await ask(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: TTL_S }), signal: AbortSignal.timeout(4000),
    })
    if (!r.ok) { console.info(`[turn] Cloudflare answered ${r.status}, the call uses the direct link only`); return null }
    const data = (await r.json()) as { iceServers?: unknown }
    const list = (Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : []) as { urls?: string | string[]; username?: string; credential?: string }[]
    const servers = list.map((s) => ({ ...s, urls: [s.urls ?? []].flat().filter(usable) })).filter((s) => s.urls.length) as IceServer[]
    if (!servers.length) return null
    kept = { at: Date.now(), key: id, servers }
    return servers
  } catch (e) {
    console.info(`[turn] not reachable (${e instanceof Error ? e.message : e}), the call uses the direct link only`)
    return null
  }
}
