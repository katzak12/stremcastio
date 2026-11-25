// Finding streams the way Stremio does: via a stream add-on (e.g. Torrentio with debrid). Used for the next
// episode and for swapping a stream whose audio the Chromecast can't play for one with Dolby audio.
// Protocol: GET {base}/stream/{movie|series}/{id}.json -> { streams: [{ url, name, title, behaviorHints }] }

import { addonBase, getJson } from './subtitles'

export type AddonStream = {
  url?: string
  infoHash?: string
  name?: string
  title?: string
  description?: string
  behaviorHints?: { filename?: string; bingeGroup?: string; notWebReady?: boolean }
}

export type StreamCandidate = { url: string; label: string; filename?: string; bingeGroup?: string }

const DEBRID = /^(https?:\/\/[^/]+)\/resolve\/(realdebrid|premiumize|alldebrid|debridlink|offcloud|torbox|easydebrid|putio)\/([^/]+)\//i

/**
 * A Torrentio-style debrid link ("https://torrentio.strem.fun/resolve/realdebrid/KEY/…") tells us which
 * add-on and debrid account produced it, so we can ask the same add-on for the next episode
 * without the user configuring anything.
 */
export function addonFromStreamUrl(url: string): string | null {
  const m = url.match(DEBRID)
  return m ? `${m[1]}/${m[2].toLowerCase()}=${m[3]}` : null
}

/**
 * Audio the Chromecast can't decode or pass through (DTS family, Dolby TrueHD): usually no sound at all.
 * Returns the codec name for the warning, or null.
 */
export function unsupportedAudio(text: string): string | null {
  const t = text.toLowerCase().replace(/[._]/g, ' ')
  if (/\btrue ?hd\b/.test(t)) return 'Dolby TrueHD'
  if (/\bdts(?:[ -]?(?:hd|x|ma|es))?\b/.test(t)) return 'DTS'
  return null
}

/** Dolby Digital / Dolby Digital Plus (incl. Atmos over DD+): plays in 5.1 through HDMI. */
export function hasDolbyAudio(text: string): boolean {
  return /\b(ddp?|dd\+|e?-?ac-?3|dolby digital)( ?\d[ .]?\d)?\b/i.test(text.replace(/[._]/g, ' '))
}

const TAGS = /\b(2160p|1080p|720p|480p|4k|hdr10\+?|hdr|dv|dovi|web[- ]?dl|webrip|bluray|remux|hdtv|x264|x265|h ?264|h ?265|hevc|av1|atmos|ddp?5 ?1|aac)\b/gi

function tagsOf(text: string): Set<string> {
  return new Set((text.toLowerCase().replace(/[._]/g, ' ').match(TAGS) ?? []).map((t) => t.replace(/[\s-]/g, '')))
}

/** Release group: "…x264-NTb.mkv" -> "ntb" */
function groupOf(text: string): string | undefined {
  return text.match(/-([a-z0-9]+)(?:\.[a-z0-9]{2,4})?$/i)?.[1]?.toLowerCase()
}

/**
 * Pick the stream most like the one we are watching: same quality/codec tags and release group,
 * preferring ones the debrid service already has cached ("[RD+]") so they start instantly.
 */
export function pickBestStream(
  streams: AddonStream[],
  currentFilename: string,
  opts: { requireSupportedAudio?: boolean; excludeUrl?: string } = {},
): StreamCandidate | null {
  const wantTags = tagsOf(currentFilename)
  const wantGroup = groupOf(currentFilename)
  let best: StreamCandidate | null = null
  let bestScore = -Infinity
  streams.forEach((s, i) => {
    if (!s.url || !/^https?:\/\//i.test(s.url)) return
    const text = [s.behaviorHints?.filename, s.title, s.description].filter(Boolean).join(' ')
    const name = s.name ?? ''
    if (opts.excludeUrl && s.url === opts.excludeUrl) return
    const audioBad = unsupportedAudio(`${text} ${name}`) != null
    if (audioBad && opts.requireSupportedAudio) return
    let score = -i * 0.5 // add-on order is a decent default
    if (audioBad) score -= 60 // likely silent on the TV
    if (hasDolbyAudio(`${text} ${name}`)) score += 8
    for (const tag of tagsOf(text + ' ' + name)) if (wantTags.has(tag)) score += 10
    const group = groupOf(s.behaviorHints?.filename ?? (s.title ?? '').split('\n')[0])
    if (wantGroup && group === wantGroup) score += 25
    if (/\+\]/.test(name) || /\[(rd|pm|ad|dl|oc|tb)\+/i.test(name)) score += 30 // cached on debrid
    if (/download/i.test(name) && !/\+/.test(name)) score -= 40 // not cached: would need downloading first
    if (score > bestScore) {
      bestScore = score
      best = {
        url: s.url,
        label: (s.title ?? s.name ?? '').split('\n')[0],
        filename: s.behaviorHints?.filename,
        bingeGroup: s.behaviorHints?.bingeGroup,
      }
    }
  })
  return best
}

async function fetchStreams(addons: string[], type: 'movie' | 'series', id: string): Promise<AddonStream[]> {
  const bases = [...new Set(addons.map(addonBase).filter(Boolean))]
  const results = await Promise.allSettled(
    bases.map((b) => getJson<{ streams?: AddonStream[] }>(`${b}/stream/${type}/${encodeURIComponent(id)}.json`, 20000)),
  )
  return results.flatMap((r) => (r.status === 'fulfilled' ? (r.value.streams ?? []) : []))
}

export async function findEpisodeStream(opts: {
  addons: string[]
  imdbId: string
  season: number
  episode: number
  currentFilename: string
}): Promise<StreamCandidate | null> {
  const all = await fetchStreams(opts.addons, 'series', `${opts.imdbId}:${opts.season}:${opts.episode}`)
  return pickBestStream(all, opts.currentFilename)
}

/** Same movie/episode, as close as possible to the current one, but with audio the Chromecast can play. */
export async function findPlayableAudioStream(opts: {
  addons: string[]
  type: 'movie' | 'series'
  videoId: string
  currentUrl: string
  currentFilename: string
}): Promise<StreamCandidate | null> {
  const all = await fetchStreams(opts.addons, opts.type, opts.videoId)
  return pickBestStream(all, opts.currentFilename, { requireSupportedAudio: true, excludeUrl: opts.currentUrl })
}
