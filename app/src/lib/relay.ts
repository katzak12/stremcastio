// The relay turns any subtitle into Chromecast-friendly WebVTT with CORS.
// See /worker in this repository.

import * as LegacyFS from 'expo-file-system/legacy'

export function relayBase(relayUrl: string): string {
  return relayUrl.trim().replace(/\/+$/, '')
}

/** URL the Chromecast itself will fetch. */
export function relayVttUrl(relayUrl: string, subtitleUrl: string, offsetMs = 0): string {
  const params = new URLSearchParams({ src: subtitleUrl })
  if (offsetMs) params.set('offset', String(Math.round(offsetMs)))
  return `${relayBase(relayUrl)}/vtt?${params.toString()}`
}

/** For subtitle files that exist only on the phone (content:// or file://). */
export async function uploadLocalSubtitle(relayUrl: string, localUri: string, offsetMs = 0): Promise<string> {
  const text = await LegacyFS.readAsStringAsync(localUri)
  const res = await fetch(`${relayBase(relayUrl)}/upload?offset=${Math.round(offsetMs)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: text,
  })
  const data = (await res.json()) as { url?: string; error?: string }
  if (!res.ok || !data.url) throw new Error(data.error ?? `Upload failed (${res.status})`)
  return data.url
}

export function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** Quick check that the relay is reachable, used in settings. */
export async function pingRelay(relayUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${relayBase(relayUrl)}/health`)
    const data = (await res.json()) as { ok?: boolean }
    return res.ok && data.ok === true
  } catch {
    return false
  }
}
