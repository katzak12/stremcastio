// "A new version is available": compare our version with the latest GitHub release, at most twice a day.

import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'stremcastio.updateCheck.v1'
const LATEST = 'https://api.github.com/repos/katzak12/stremcastio/releases/latest'
const EVERY_MS = 12 * 60 * 60 * 1000

export type Update = { version: string; url: string }

/** -1, 0 or 1, comparing "0.5.2"-style versions (a leading "v" is ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

export async function checkForUpdate(current: string): Promise<Update | null> {
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null') as { at: number; latest: Update | null } | null
    let latest = saved && Date.now() - saved.at < EVERY_MS ? saved.latest : null
    if (!saved || Date.now() - saved.at >= EVERY_MS) {
      const res = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } })
      if (res.ok) {
        const j = (await res.json()) as { tag_name?: string; html_url?: string }
        latest = j.tag_name && j.html_url ? { version: j.tag_name.replace(/^v/i, ''), url: j.html_url } : null
        await AsyncStorage.setItem(KEY, JSON.stringify({ at: Date.now(), latest }))
      }
    }
    return latest && compareVersions(latest.version, current) > 0 ? latest : null
  } catch {
    return null
  }
}
