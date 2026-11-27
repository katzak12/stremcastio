// "Cast to TV" inside Stremio: a tiny Stremio add-on that adds one entry per film/episode. Tapping it opens
// https://<relay>/open?type=…&id=…, a page that hands the title to the app (stremcastio://pick?…); the phone then
// asks the user's own stream add-on (Torrentio) for streams. So this relay never talks to Torrentio, never sees a
// debrid key, and the install link is the same for everyone:
//   GET /stremio/manifest.json
//   GET /stremio/stream/{movie|series}/{id}.json
//   GET /open?type=…&id=…
// Older install links with a config segment (/stremio/{cfg}/…) still work; the segment is ignored.

export const MANIFEST = {
  id: 'community.stremcastio',
  version: '2.0.0',
  name: 'StremCastio',
  description: 'Adds "Cast to TV" to every film and episode: opens StremCastio, which casts it to your Chromecast with subtitles.',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [],
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
const ID = /^tt\d+(?::\d+:\d+)?$/

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

export function appLink(type: string, id: string): string {
  return `stremcastio://pick?${new URLSearchParams({ type, id })}`
}

/** Handles /stremio/… ; null for other paths. */
export function handleStremio(url: URL): Response | null {
  if (!url.pathname.startsWith('/stremio')) return null
  const m = /^\/stremio(?:\/[A-Za-z0-9_-]+)?\/(manifest\.json|stream\/(movie|series)\/([^/]+)\.json)$/.exec(url.pathname)
  if (!m) return json({ error: 'Not found' }, 404)
  if (m[1] === 'manifest.json') return json(MANIFEST, 200, 86400)
  const type = m[2]
  const id = decodeURIComponent(m[3])
  if (!ID.test(id)) return json({ streams: [] }, 200, 86400)
  const open = `${url.origin}/open?${new URLSearchParams({ type, id })}`
  return json(
    { streams: [{ name: 'StremCastio', title: 'Cast to TV', externalUrl: open }] },
    200,
    86400,
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** /open: a web page (Stremio can always open https) that sends the browser on to the app. */
export function handleOpen(url: URL): Response {
  const type = url.searchParams.get('type') ?? ''
  const id = url.searchParams.get('id') ?? ''
  if (!/^(movie|series)$/.test(type) || !ID.test(id)) return new Response('Bad request', { status: 400 })
  const link = escapeHtml(appLink(type, id))
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StremCastio</title><meta http-equiv="refresh" content="0;url=${link}">
<style>body{background:#0E1015;color:#F2F3F7;font-family:-apple-system,system-ui,sans-serif;display:flex;min-height:90vh;align-items:center;justify-content:center;text-align:center}a{display:inline-block;margin-top:16px;padding:14px 28px;border-radius:14px;background:#7B61FF;color:#fff;text-decoration:none;font-weight:700}</style>
</head><body><div><div>Opening StremCastio…</div><a href="${link}">Open StremCastio</a></div>
<script>location.href=${JSON.stringify(appLink(type, id))}</script></body></html>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } })
}
