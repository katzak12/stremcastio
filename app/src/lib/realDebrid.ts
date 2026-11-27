// Real-Debrid streaming: RD can serve a file as HLS with every audio track converted to AAC. The Chromecast
// plays that with sound (even when the file has TrueHD/DTS) and can switch the spoken language itself.
// We use it only when needed (another audio track than the file's default, or audio the TV can't play),
// because RD re-encodes the picture; otherwise the original file plays in full quality.
//
// API (https://api.real-debrid.com/rest/1.0, Bearer token):
//   POST /unrestrict/link (link)            -> { id, download, … }
//   GET  /streaming/transcode/{id}          -> { apple: { full: "…m3u8" }, dash, liveMP4, h264WebM }
//   GET  /streaming/mediaInfos/{id}         -> { details: { audio: { eng1: { lang, lang_iso, codec, channels } } } }
// The id is the one in download links: https://xxx.download.real-debrid.com/d/{ID}/{filename}.
//
// Token: a Torrentio-style link already carries the user's RD API key ("/resolve/realdebrid/KEY/…"), so
// nothing needs setting up. Otherwise the user links RD once with the device-code flow (open-source client id).

import { normalizeLang } from './languages'

const API = 'https://api.real-debrid.com/rest/1.0'
const OAUTH = 'https://api.real-debrid.com/oauth/v2'
/** Real-Debrid's public client id for open-source apps (device-code flow). */
export const RD_OPEN_SOURCE_CLIENT_ID = 'X245A4XAIBGVM'

export type RdAuth = {
  clientId: string
  clientSecret: string
  accessToken: string
  refreshToken: string
  /** ms since epoch */
  expiresAt: number
}

/** The RD API key inside a Torrentio-style link, or null. */
export function rdKeyFromStreamUrl(url: string): string | null {
  const m = /\/resolve\/realdebrid\/([^/]+)\//i.exec(url)
  return m ? decodeURIComponent(m[1]) : null
}

/** The download id in an RD download link, or null. */
export function rdIdFromDownloadUrl(url: string): string | null {
  const m = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:real-debrid\.com|rdeb\.io)\/d\/([A-Za-z0-9]+)(?:\/|$)/i.exec(url)
  return m ? m[1] : null
}

export type RdAudio = { key: string; lang: string; langIso: string; codec: string; channels?: number }

export function parseRdAudio(mediaInfos: unknown): RdAudio[] {
  const audio = (mediaInfos as { details?: { audio?: Record<string, Record<string, unknown>> | unknown[] } })?.details?.audio
  if (!audio || Array.isArray(audio)) return []
  return Object.entries(audio).map(([key, a]) => ({
    key,
    lang: String(a.lang ?? ''),
    langIso: String(a.lang_iso ?? ''),
    codec: String(a.codec ?? ''),
    channels: typeof a.channels === 'number' ? a.channels : undefined,
  }))
}

/**
 * The RD audio track matching a track from the file: same language, and the same position among the
 * tracks in that language (RD keys them in file order: eng1, eng2, …).
 */
export function matchRdAudio(
  rd: RdAudio[],
  wanted: { language: string },
  sameLanguageIndex: number,
): RdAudio | undefined {
  const lang = normalizeLang(wanted.language)
  const same = rd.filter((a) => normalizeLang(a.langIso || a.lang) === lang)
  return same[sameLanguageIndex] ?? same[0]
}

/**
 * RD's HLS links carry the audio track in the path (…/t/{id}/{audio}/{subs}/{codec}/full.m3u8). Point it at
 * another track when the link has that shape; otherwise return it unchanged (the TV then switches itself).
 */
export function hlsForAudio(hlsUrl: string, keys: string[], key: string): string {
  const parts = hlsUrl.split('/')
  const i = parts.findIndex((p, n) => n > 2 && keys.includes(p))
  if (i < 0 || parts[i] === key) return hlsUrl
  parts[i] = key
  return parts.join('/')
}

async function rdFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`Real-Debrid ${res.status}`)
  return (await res.json()) as T
}

/** Find the RD download id for a stream link: directly, by following the add-on's redirect, or by unrestricting. */
export async function resolveRdId(streamUrl: string, token: string): Promise<string | null> {
  const direct = rdIdFromDownloadUrl(streamUrl)
  if (direct) return direct
  try {
    // Torrentio & co. redirect to the RD download link; fetch follows it and reports the final URL.
    const res = await fetch(streamUrl, { method: 'GET', headers: { Range: 'bytes=0-0' } })
    const finalUrl = res.url
    res.body?.cancel?.().catch(() => {})
    const id = rdIdFromDownloadUrl(finalUrl)
    if (id) return id
  } catch {
    // fall through
  }
  try {
    const body = new URLSearchParams({ link: streamUrl }).toString()
    const data = await rdFetch<{ id?: string; download?: string }>(token, '/unrestrict/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    return (data.download && rdIdFromDownloadUrl(data.download)) || data.id || null
  } catch {
    return null
  }
}

export type RdStream = { hls: string; audio: RdAudio[] }

export async function rdStream(id: string, token: string): Promise<RdStream | null> {
  const [transcode, infos] = await Promise.all([
    rdFetch<{ apple?: Record<string, string> }>(token, `/streaming/transcode/${encodeURIComponent(id)}`),
    rdFetch<unknown>(token, `/streaming/mediaInfos/${encodeURIComponent(id)}`).catch(() => null),
  ])
  const apple = transcode.apple ?? {}
  const hls = apple.full ?? Object.values(apple)[0]
  if (!hls) return null
  return { hls, audio: parseRdAudio(infos) }
}

// ---------- linking an account (device-code flow) ----------

export type DeviceCode = { deviceCode: string; userCode: string; verificationUrl: string; interval: number; expiresAt: number }

export async function startDeviceLink(): Promise<DeviceCode> {
  const res = await fetch(`${OAUTH}/device/code?client_id=${RD_OPEN_SOURCE_CLIENT_ID}&new_credentials=yes`)
  if (!res.ok) throw new Error(`Real-Debrid ${res.status}`)
  const j = (await res.json()) as { device_code: string; user_code: string; verification_url: string; interval: number; expires_in: number }
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUrl: j.verification_url || 'https://real-debrid.com/device',
    interval: Math.max(2, j.interval || 5) * 1000,
    expiresAt: Date.now() + (j.expires_in || 600) * 1000,
  }
}

/** One poll: credentials once the user has entered the code, else null. Then exchange them for a token. */
export async function pollDeviceLink(code: DeviceCode): Promise<RdAuth | null> {
  const res = await fetch(`${OAUTH}/device/credentials?client_id=${RD_OPEN_SOURCE_CLIENT_ID}&code=${encodeURIComponent(code.deviceCode)}`)
  if (!res.ok) return null
  const cred = (await res.json()) as { client_id?: string; client_secret?: string }
  if (!cred.client_id || !cred.client_secret) return null
  return tokenRequest(cred.client_id, cred.client_secret, code.deviceCode)
}

async function tokenRequest(clientId: string, clientSecret: string, code: string): Promise<RdAuth> {
  const res = await fetch(`${OAUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'http://oauth.net/grant_type/device/1.0',
    }).toString(),
  })
  if (!res.ok) throw new Error(`Real-Debrid ${res.status}`)
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number }
  return {
    clientId,
    clientSecret,
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
  }
}

/** A valid access token for a linked account, refreshing it when it (almost) expired. */
export async function freshToken(auth: RdAuth, save: (a: RdAuth) => void): Promise<string> {
  if (Date.now() < auth.expiresAt - 60000) return auth.accessToken
  const next = await tokenRequest(auth.clientId, auth.clientSecret, auth.refreshToken)
  save(next)
  return next.accessToken
}
