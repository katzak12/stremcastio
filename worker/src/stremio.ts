// "Cast with StremCastio" inside Stremio: a tiny Stremio add-on. The user's own Torrentio configuration
// (including their debrid key) is part of the install URL, so nothing is stored here:
//   GET /stremio/{cfg}/manifest.json
//   GET /stremio/{cfg}/stream/{type}/{id}.json
// {cfg} = base64url of the user's Torrentio base (e.g. https://torrentio.strem.fun/realdebrid=KEY).
// Each Torrentio stream comes back as a stream whose externalUrl opens the app with that link:
// stremcastio://cast?url=…  — tap it in Stremio and StremCastio opens, ready to cast.

const MAX_STREAMS = 20
const CACHE_SECONDS = 600

export const MANIFEST = {
  id: 'community.stremcastio',
  version: '1.0.0',
  name: 'StremCastio',
  description: 'Adds "Cast to TV" to every stream: opens StremCastio, which casts it to your Chromecast with subtitles.',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [],
}

export function encodeCfg(base: string): string {
  const bytes = new TextEncoder().encode(base)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeCfg(cfg: string): string | null {
  try {
    const b64 = cfg.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (cfg.length % 4)) % 4)
    const bin = atob(b64)
    const base = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))).replace(/\/manifest\.json$/, '').replace(/\/+$/, '')
    const u = new URL(base)
    return u.protocol === 'https:' ? base : null
  } catch {
    return null
  }
}

type AddonStream = { url?: string; name?: string; title?: string; behaviorHints?: { filename?: string } }

export function toCastStreams(streams: AddonStream[]): { name: string; title: string; externalUrl: string }[] {
  return streams
    .filter((s) => typeof s.url === 'string' && /^https?:\/\//i.test(s.url))
    .slice(0, MAX_STREAMS)
    .map((s) => {
      const filename = s.behaviorHints?.filename ?? (s.title ?? '').split('\n')[0]
      const params = new URLSearchParams({ url: s.url! })
      if (filename) params.set('title', filename)
      return {
        name: `StremCastio\n${(s.name ?? '').replace(/\s*\n\s*/g, ' ')}`.trim(),
        title: `Cast to TV\n${s.title ?? filename}`,
        externalUrl: `stremcastio://cast?${params}`,
      }
    })
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }

function json(data: unknown, status = 200, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      ...(cacheSeconds ? { 'Cache-Control': `public, max-age=${cacheSeconds}` } : {}),
    },
  })
}

/** Handles /stremio/…; returns null for other paths. */
export async function handleStremio(req: Request, url: URL, ctx?: ExecutionContext): Promise<Response | null> {
  const m = /^\/stremio\/([A-Za-z0-9_-]+)\/(manifest\.json|stream\/(movie|series)\/([^/]+)\.json)$/.exec(url.pathname)
  if (!m) return url.pathname.startsWith('/stremio') ? json({ error: 'Not found' }, 404) : null
  const base = decodeCfg(m[1])
  if (!base) return json({ error: 'Invalid configuration' }, 400)
  if (m[2] === 'manifest.json') return json(MANIFEST, 200, 86400)

  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default
  if (cache) {
    const hit = await cache.match(req)
    if (hit) return hit
  }
  const type = m[3]
  const id = decodeURIComponent(m[4])
  let streams: AddonStream[] = []
  try {
    const res = await fetch(`${base}/stream/${type}/${encodeURIComponent(id)}.json`, { headers: { 'User-Agent': 'StremCastio/1.0' } })
    if (res.ok) streams = ((await res.json()) as { streams?: AddonStream[] }).streams ?? []
  } catch {
    // no streams
  }
  const out = json({ streams: toCastStreams(streams) }, 200, CACHE_SECONDS)
  if (cache && streams.length) ctx?.waitUntil(cache.put(req, out.clone()))
  return out
}
