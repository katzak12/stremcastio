// StremCastio subtitle relay — a tiny Cloudflare Worker.
//
// Chromecast can only show subtitles that are WebVTT *and* served with CORS
// headers. Most subtitle sources (OpenSubtitles, Stremio add-ons) serve SRT
// without CORS, so the receiver silently drops them. This Worker fixes that.
//
//   GET  /vtt?src=<url>[&offset=<ms>]   fetch + convert a subtitle URL
//   POST /upload[?offset=<ms>]          upload subtitle text (local files)
//   GET  /s/<id>.vtt                    serve an uploaded subtitle
//
// Free tier is plenty: one request per film for the subtitle file.

import { decodeBytes, isGzip, toVtt } from './convert.ts'

export interface Env {
  /** Optional KV namespace for /upload. Without it, /upload returns 501. */
  SUBS?: KVNamespace
}

const MAX_BYTES = 8 * 1024 * 1024
const UPLOAD_TTL_SECONDS = 60 * 60 * 24 * 2

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function vttResponse(vtt: string, cacheSeconds: number): Response {
  return new Response(vtt, {
    headers: {
      ...CORS,
      'Content-Type': 'text/vtt; charset=utf-8',
      'Cache-Control': `public, max-age=${cacheSeconds}`,
    },
  })
}

function parseOffset(url: URL): number {
  const n = Number(url.searchParams.get('offset') ?? 0)
  return Number.isFinite(n) ? Math.max(-3600000, Math.min(3600000, n)) : 0
}

async function readLimited(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw new Error('Subtitle file too large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.byteLength
  }
  return out
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return readLimited(stream)
}

async function bytesToVtt(bytes: Uint8Array, offset: number) {
  const raw = isGzip(bytes) ? await gunzip(bytes) : bytes
  return toVtt(decodeBytes(raw), offset)
}

async function handleVtt(url: URL): Promise<Response> {
  const src = url.searchParams.get('src')
  if (!src) return json({ error: 'Missing ?src=' }, 400)
  let target: URL
  try {
    target = new URL(src)
  } catch {
    return json({ error: 'Invalid src URL' }, 400)
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return json({ error: 'Only http(s) sources are allowed' }, 400)
  }
  const upstream = await fetch(target.toString(), {
    headers: { 'User-Agent': 'StremCastio/1.0 (+https://github.com/)' },
    redirect: 'follow',
    cf: { cacheTtl: 86400, cacheEverything: true },
  } as RequestInit)
  if (!upstream.ok) return json({ error: `Upstream returned ${upstream.status}` }, 502)
  const { vtt, cues } = await bytesToVtt(await readLimited(upstream.body), parseOffset(url))
  if (cues === 0) return json({ error: 'No subtitle cues found in source' }, 422)
  return vttResponse(vtt, 86400)
}

async function handleUpload(req: Request, url: URL, env: Env): Promise<Response> {
  if (!env.SUBS) return json({ error: 'Uploads are not enabled on this relay (no KV bound)' }, 501)
  const { vtt, cues } = await bytesToVtt(await readLimited(req.body), parseOffset(url))
  if (cues === 0) return json({ error: 'No subtitle cues found' }, 422)
  const id = crypto.randomUUID().replace(/-/g, '')
  await env.SUBS.put(id, vtt, { expirationTtl: UPLOAD_TTL_SECONDS })
  return json({ url: `${url.origin}/s/${id}.vtt`, cues })
}

async function handleStored(path: string, env: Env): Promise<Response> {
  const id = path.slice(3).replace(/\.vtt$/, '')
  if (!env.SUBS || !/^[a-f0-9]{32}$/.test(id)) return json({ error: 'Not found' }, 404)
  const vtt = await env.SUBS.get(id)
  return vtt ? vttResponse(vtt, 3600) : json({ error: 'Not found or expired' }, 404)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
      if (url.pathname === '/vtt' && (req.method === 'GET' || req.method === 'HEAD')) return await handleVtt(url)
      if (url.pathname === '/upload' && req.method === 'POST') return await handleUpload(req, url, env)
      if (url.pathname.startsWith('/s/') && req.method === 'GET') return await handleStored(url.pathname, env)
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({ name: 'stremcastio-relay', ok: true, uploads: Boolean(env.SUBS) })
      }
      return json({ error: 'Not found' }, 404)
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  },
}
