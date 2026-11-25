// Finding subtitles the same way Stremio does: via Stremio subtitle add-ons.
// Protocol: GET {base}/subtitles/{type}/{id}/{extra}.json -> { subtitles: [{ id, url, lang }] }

import { findLangInText, normalizeLang } from './languages'
import type { ParsedRelease } from './stream'
import { unwrapProxy } from './stream'

export type SubtitleOption = {
  key: string
  url: string
  lang: string // normalised 2-letter key when known
  label: string
  source: string
}

export const OPENSUBTITLES_ADDON = 'https://opensubtitles-v3.strem.io'
export const CINEMETA = 'https://v3-cinemeta.strem.io'

type CinemetaMeta = { id: string; name: string; releaseInfo?: string; year?: string | number }

export async function getJson<T>(url: string, timeoutMs = 10000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** "https://x/manifest.json" | "stremio://x/manifest.json" | "https://x" -> "https://x" */
export function addonBase(input: string): string {
  return input
    .trim()
    .replace(/^stremio:\/\//i, 'https://')
    .replace(/\/manifest\.json(\?.*)?$/i, '')
    .replace(/\/+$/, '')
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function yearOf(m: CinemetaMeta): number | undefined {
  const y = Number(String(m.year ?? m.releaseInfo ?? '').slice(0, 4))
  return Number.isFinite(y) && y > 1800 ? y : undefined
}

export function pickBestMeta(metas: CinemetaMeta[], title: string, year?: number): CinemetaMeta | null {
  const want = normalizeTitle(title)
  let best: CinemetaMeta | null = null
  let bestScore = -Infinity
  metas.slice(0, 15).forEach((m, i) => {
    const name = normalizeTitle(m.name)
    let score = -i // search rank
    if (name === want) score += 100
    else if (name.startsWith(want) || want.startsWith(name)) score += 40
    const y = yearOf(m)
    if (year && y) score += y === year ? 50 : Math.abs(y - year) <= 1 ? 20 : -30
    if (score > bestScore) {
      best = m
      bestScore = score
    }
  })
  return best
}

/** Find the IMDb id ("tt0133093") for a parsed release name via Cinemeta. */
export async function lookupImdbId(release: ParsedRelease): Promise<{ id: string; name: string } | null> {
  const type = release.season !== undefined ? 'series' : 'movie'
  const q = encodeURIComponent(release.title)
  const data = await getJson<{ metas?: CinemetaMeta[] }>(`${CINEMETA}/catalog/${type}/top/search=${q}.json`)
  const meta = pickBestMeta(data.metas ?? [], release.title, release.year)
  return meta && /^tt\d+$/.test(meta.id) ? { id: meta.id, name: meta.name } : null
}

export function stremioVideoId(imdbId: string, release: ParsedRelease): { type: 'movie' | 'series'; id: string } {
  return release.season !== undefined && release.episode !== undefined
    ? { type: 'series', id: `${imdbId}:${release.season}:${release.episode}` }
    : { type: 'movie', id: imdbId }
}

type AddonSubtitle = { id?: string; url: string; lang?: string; label?: string; name?: string; subtitleFileName?: string }

async function queryAddon(base: string, type: string, id: string, filename: string): Promise<AddonSubtitle[]> {
  const extra = filename ? `/filename=${encodeURIComponent(filename)}` : ''
  const url = `${base}/subtitles/${type}/${encodeURIComponent(id)}${extra}.json`
  const data = await getJson<{ subtitles?: AddonSubtitle[] }>(url)
  return (data.subtitles ?? []).filter((s) => typeof s?.url === 'string')
}

export async function searchSubtitles(opts: {
  release: ParsedRelease
  filename: string
  addons: string[]
  imdbId?: string
}): Promise<{ options: SubtitleOption[]; imdb?: { id: string; name: string }; errors: string[] }> {
  const errors: string[] = []
  const imdb = opts.imdbId ? { id: opts.imdbId, name: opts.release.title } : await lookupImdbId(opts.release)
  if (!imdb) return { options: [], errors: ['title-not-found'] }
  const { type, id } = stremioVideoId(imdb.id, opts.release)

  const bases = [...new Set(opts.addons.map(addonBase).filter(Boolean))]
  const results = await Promise.allSettled(bases.map((b) => queryAddon(b, type, id, opts.filename)))

  const options: SubtitleOption[] = []
  const seen = new Set<string>()
  results.forEach((r, i) => {
    const source = bases[i].replace(/^https?:\/\//, '').split('/')[0]
    if (r.status === 'rejected') {
      errors.push(`${source}: ${String(r.reason?.message ?? r.reason)}`)
      return
    }
    for (const s of r.value) {
      const url = unwrapProxy(s.url)
      if (seen.has(url)) continue
      seen.add(url)
      options.push({
        key: `${source}:${s.id ?? url}`,
        url,
        lang: normalizeLang(s.lang),
        label: s.label ?? s.subtitleFileName ?? s.name ?? '',
        source,
      })
    }
  })
  return { options, imdb, errors }
}

/** Order: preferred languages first (in the user's order), then the rest; stable within. */
export function rankSubtitles(options: SubtitleOption[], preferred: string[]): SubtitleOption[] {
  const pref = preferred.map(normalizeLang)
  const rank = (o: SubtitleOption) => {
    const i = pref.indexOf(o.lang)
    return i === -1 ? pref.length : i
  }
  return options
    .map((o, i) => ({ o, i }))
    .sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i)
    .map(({ o }) => o)
}

const SUB_EXT = /\.(srt|vtt|ass|ssa|sub)(\?|$)/i

/**
 * Subtitles handed over by the app that opened us (Android intent extras).
 * Players use different keys: MX Player "subs", VLC "subtitles_location", etc.
 */
export function subtitlesFromExtras(extras: Record<string, string | string[] | null>): SubtitleOption[] {
  const out: SubtitleOption[] = []
  const names = ([] as string[]).concat(extras['subs.name'] ?? [])
  for (const [key, value] of Object.entries(extras)) {
    if (value == null) continue
    const list = Array.isArray(value) ? value : [value]
    const keyLooksSub = /sub/i.test(key) && !/name|enable|title/i.test(key)
    list.forEach((v, i) => {
      if (typeof v !== 'string') return
      const isUrl = /^(https?|content|file):\/\//i.test(v)
      if (!isUrl || !(keyLooksSub || SUB_EXT.test(v) || /subtitles?/i.test(v))) return
      const url = unwrapProxy(v)
      if (out.some((o) => o.url === url)) return
      const name = key === 'subs' ? names[i] : undefined
      out.push({
        key: `intent:${key}:${i}`,
        url,
        lang: findLangInText(name ?? new URL(url).pathname),
        label: name ?? '',
        source: 'stremio',
      })
    })
  }
  return out
}
