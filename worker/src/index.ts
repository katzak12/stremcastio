// StremCastio subtitle relay — a tiny Cloudflare Worker.
//
// Chromecast can only show subtitles that are WebVTT *and* served with CORS
// headers. Most subtitle sources (OpenSubtitles, Stremio add-ons) serve SRT
// without CORS, so the receiver silently drops them. This Worker fixes that.
//
//   GET  /vtt?src=<url>[&offset=<ms>]   fetch + convert a subtitle URL
//   POST /upload[?offset=<ms>]          upload subtitle text (local files)
//   GET  /s/<id>.vtt                    serve an uploaded subtitle
//   GET  /tracks?u=<video url>           audio/subtitle tracks inside an MKV, with a cast URL per audio track
//   GET  /media?u=<video url>&p=<patches> the video, with a few header bytes changed so the Chromecast
//                                        plays the chosen audio track (see mkv.ts); the rest streams through
//
// Free tier is plenty: one request per film for the subtitle file. /media only touches the first bytes;
// everything after them is piped straight from the source without the Worker reading it.

import { decodeBytes, isGzip, toVtt } from './convert.ts'
import { handleOpen, handleStremio } from './stremio.ts'
import {
  decodePatches,
  defaultAudio,
  encodePatches,
  isPlayableAudioCodec,
  parseHead,
  parseTracksElement,
  patchesFor,
  TRACK_TYPE_AUDIO,
  TRACK_TYPE_SUBTITLE,
  type MkvTrack,
  type Patch,
} from './mkv.ts'

export interface Env {
  /** Optional KV namespace for /upload. Without it, /upload returns 501. */
  SUBS?: KVNamespace
  /**
   * "off" (the default in wrangler.toml): /media is disabled, so no video ever passes through this account;
   * only subtitles do. Choosing another audio track then goes through the user's Real-Debrid instead.
   * Set to "on" on a personal relay to keep the header-patch fallback for users without Real-Debrid.
   */
  MEDIA_PROXY?: string
}

function mediaEnabled(env: Env): boolean {
  return (env.MEDIA_PROXY ?? 'on').toLowerCase() !== 'off'
}

const MAX_BYTES = 8 * 1024 * 1024
const UPLOAD_TTL_SECONDS = 60 * 60 * 24 * 2

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
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

// ---------- audio track choice for MKV ----------

const HEAD_BYTES = 1024 * 1024
const TRACKS_BYTES = 512 * 1024
const UA = { 'User-Agent': 'StremCastio/1.0' }

function httpUrl(raw: string | null): URL | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

/** Reads bytes [start, start+length) of a remote file; stops early if the server ignores Range. */
async function fetchBytes(src: string, start: number, length: number): Promise<Uint8Array> {
  const res = await fetch(src, { headers: { ...UA, Range: `bytes=${start}-${start + length - 1}` }, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Video source returned ${res.status}`)
  if (res.status === 200 && start > 0) {
    await res.body.cancel()
    throw new Error('Video source does not support byte ranges')
  }
  const reader = res.body.getReader()
  const out = new Uint8Array(length)
  let pos = 0
  while (pos < length) {
    const { done, value } = await reader.read()
    if (done) break
    const n = Math.min(value.byteLength, length - pos)
    out.set(value.subarray(0, n), pos)
    pos += n
  }
  await reader.cancel().catch(() => {})
  return out.subarray(0, pos)
}

export async function readTracks(src: string): Promise<MkvTrack[] | null> {
  const head = await fetchBytes(src, 0, HEAD_BYTES)
  const result = parseHead(head)
  if (result.kind === 'tracks') return result.tracks
  if (result.kind === 'seek') {
    return parseTracksElement(await fetchBytes(src, result.tracksOffset, TRACKS_BYTES), result.tracksOffset)
  }
  return null
}

async function handleTracks(url: URL, media: boolean): Promise<Response> {
  const src = httpUrl(url.searchParams.get('u'))
  if (!src) return json({ error: 'Missing or invalid ?u=' }, 400)
  const tracks = await readTracks(src.toString())
  if (!tracks) return json({ container: 'other', audio: [], subtitles: [] }, 200)
  const tvDefault = defaultAudio(tracks)
  const audio = tracks
    .filter((t) => t.type === TRACK_TYPE_AUDIO)
    .map((t) => {
      const patches = patchesFor(tracks, t.number)
      const params = new URLSearchParams({ u: src.toString(), p: encodePatches(patches) })
      return {
        number: t.number,
        language: t.language,
        name: t.name,
        codec: t.codec,
        channels: t.channels,
        isDefault: t === tvDefault,
        playable: isPlayableAudioCodec(t.codec),
        // Without /media, tracks that need a patched header get no URL: the app uses Real-Debrid for those.
        url: patches.length ? (media ? `${url.origin}/media?${params}` : '') : src.toString(),
      }
    })
  const subtitles = tracks
    .filter((t) => t.type === TRACK_TYPE_SUBTITLE)
    .map((t) => ({ number: t.number, language: t.language, name: t.name, codec: t.codec }))
  return json({ container: 'mkv', audio, subtitles })
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']

function mediaHeaders(from: Headers): Headers {
  const h = new Headers(CORS)
  for (const k of PASS_HEADERS) {
    const v = from.get(k)
    if (v) h.set(k, v)
  }
  if (!h.get('content-type') || h.get('content-type') === 'application/octet-stream') h.set('content-type', 'video/x-matroska')
  h.set('accept-ranges', 'bytes')
  return h
}

function isPage(res: Response): boolean {
  return /text\/html|application\/json/i.test(res.headers.get('content-type') ?? '')
}

function parseRange(header: string | null): { start: number; end: number | null } | null {
  if (!header) return null
  const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim())
  if (!m) return null
  return { start: Number(m[1]), end: m[2] ? Number(m[2]) : null }
}

function totalFrom(res: Response): number | null {
  const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')
  return m ? Number(m[1]) : null
}

async function handleMedia(req: Request, url: URL, ctx?: ExecutionContext): Promise<Response> {
  const src = httpUrl(url.searchParams.get('u'))
  const patches = decodePatches(url.searchParams.get('p'))
  if (!src || !patches) return json({ error: 'Missing or invalid ?u= or ?p=' }, 400)

  const range = parseRange(req.headers.get('range'))
  const start = range?.start ?? 0
  const end = range?.end ?? null
  const inRange = patches.filter((p) => p.offset >= start && (end === null || p.offset <= end))

  // Nothing to change in the requested bytes (or a HEAD request): stream straight from the source.
  if (req.method === 'HEAD' || inRange.length === 0) {
    const headers: Record<string, string> = { ...UA }
    const rangeHeader = req.headers.get('range')
    if (rangeHeader) headers.Range = rangeHeader
    const up = await fetch(src.toString(), { method: req.method, headers, redirect: 'follow' })
    if (isPage(up)) return json({ error: 'Source is not a video' }, 502)
    return new Response(up.body, { status: up.status, headers: mediaHeaders(up.headers) })
  }

  // The requested bytes include the header bytes we change: read up to the last one, patch, then pipe the rest.
  const headEnd = inRange[inRange.length - 1].offset
  // Ask the source for both parts at once: a slow first byte from the source shouldn't count twice.
  const needRest = end === null || headEnd < end
  const [headRes, rest] = await Promise.all([
    fetch(src.toString(), { headers: { ...UA, Range: `bytes=${start}-${headEnd}` }, redirect: 'follow' }),
    needRest
      ? fetch(src.toString(), { headers: { ...UA, Range: `bytes=${headEnd + 1}-${end ?? ''}` }, redirect: 'follow' })
      : Promise.resolve(null),
  ])
  if (headRes.status !== 206 || isPage(headRes)) {
    await headRes.body?.cancel()
    await rest?.body?.cancel()
    return json({ error: `Video source returned ${headRes.status} for a byte range` }, 502)
  }
  const total = totalFrom(headRes)
  const head = new Uint8Array(await headRes.arrayBuffer())
  applyPatches(head, start, inRange)

  const lastByte = end ?? (total !== null ? total - 1 : null)
  if (lastByte === null) {
    await rest?.body?.cancel()
    return json({ error: 'Video source did not report its size' }, 502)
  }
  const length = lastByte - start + 1
  const headers = mediaHeaders(headRes.headers)
  headers.set('content-length', String(length))
  if (range) headers.set('content-range', `bytes ${start}-${lastByte}/${total ?? '*'}`)
  else headers.delete('content-range')
  const status = range ? 206 : 200

  if (!rest || headEnd >= lastByte) {
    await rest?.body?.cancel()
    return new Response(head.subarray(0, length), { status, headers })
  }
  if (rest.status !== 206 || !rest.body) {
    await rest.body?.cancel()
    return json({ error: `Video source returned ${rest.status} for a byte range` }, 502)
  }
  // FixedLengthStream (Workers) keeps Content-Length; piping between native streams costs no Worker CPU.
  const FLS = (globalThis as { FixedLengthStream?: new (n: number) => TransformStream<Uint8Array, Uint8Array> }).FixedLengthStream
  const { readable, writable } = FLS ? new FLS(length) : new TransformStream<Uint8Array, Uint8Array>()
  const pump = (async () => {
    const writer = writable.getWriter()
    await writer.write(head)
    writer.releaseLock()
    await rest.body!.pipeTo(writable)
  })().catch(() => {})
  ctx?.waitUntil(pump)
  return new Response(readable, { status, headers })
}

export function applyPatches(bytes: Uint8Array, base: number, patches: Patch[]): void {
  for (const p of patches) {
    const i = p.offset - base
    if (i >= 0 && i < bytes.length) bytes[i] = p.value
  }
}

/** The same subtitle asked again (another viewer, a reload for sync) comes from Cloudflare's cache. */
async function cachedVtt(req: Request, url: URL, ctx?: ExecutionContext): Promise<Response> {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default
  if (req.method === 'GET' && cache) {
    const hit = await cache.match(req)
    if (hit) return hit
  }
  const res = await handleVtt(url)
  if (req.method === 'GET' && cache && res.ok) ctx?.waitUntil(cache.put(req, res.clone()))
  return res
}

export default {
  async fetch(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
      const stremio = handleStremio(url)
      if (stremio) return stremio
      if (url.pathname === '/open' && req.method === 'GET') return handleOpen(url)
      if (url.pathname === '/vtt' && (req.method === 'GET' || req.method === 'HEAD')) return await cachedVtt(req, url, ctx)
      if (url.pathname === '/upload' && req.method === 'POST') return await handleUpload(req, url, env)
      if (url.pathname.startsWith('/s/') && req.method === 'GET') return await handleStored(url.pathname, env)
      if (url.pathname === '/tracks' && req.method === 'GET') return await handleTracks(url, mediaEnabled(env))
      if (url.pathname === '/media' && (req.method === 'GET' || req.method === 'HEAD')) {
        if (!mediaEnabled(env)) return json({ error: 'Video proxying is turned off on this relay' }, 403)
        return await handleMedia(req, url, ctx)
      }
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({ name: 'stremcastio-relay', ok: true, uploads: Boolean(env.SUBS), audioTracks: true, media: mediaEnabled(env) })
      }
      return json({ error: 'Not found' }, 404)
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  },
}
