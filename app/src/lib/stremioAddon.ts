// The "Cast to TV" button inside Stremio: our relay serves a tiny Stremio add-on (worker/src/stremio.ts).
// Its install URL carries the user's own Torrentio configuration, so the relay stores nothing.

import { addonFromStreamUrl } from './streams'
import { addonBase } from './subtitles'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** base64url without padding (no reliance on btoa/TextEncoder being present). */
export function base64Url(text: string): string {
  const bytes: number[] = []
  for (const ch of unescape(encodeURIComponent(text))) bytes.push(ch.charCodeAt(0))
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63]
    if (i + 2 < bytes.length) out += B64[n & 63]
  }
  return out
}

/** The add-on base to wrap: a Torrentio-style one we saw in a stream link, else one the user added. */
export function pickAddonBase(opts: { detected?: string | null; streamUrl?: string | null; added: string[] }): string | null {
  const fromStream = opts.streamUrl ? addonFromStreamUrl(opts.streamUrl) : null
  const candidate = fromStream ?? opts.detected ?? opts.added[0] ?? null
  if (!candidate) return null
  const base = addonBase(candidate)
  return /^https:\/\//i.test(base) ? base : null
}

export function addonInstallUrls(relayUrl: string, base: string): { manifest: string; stremio: string } {
  const manifest = `${relayUrl.trim().replace(/\/+$/, '')}/stremio/${base64Url(base)}/manifest.json`
  return { manifest, stremio: manifest.replace(/^https?:\/\//i, 'stremio://') }
}
