// Artwork, rating and runtime for the video, from Cinemeta (Stremio's own metadata add-on).
// GET {CINEMETA}/meta/{movie|series}/{imdbId}.json -> { meta: { poster, background, imdbRating, runtime, videos: [...] } }

import type { ParsedRelease } from './stream'
import { CINEMETA, getJson } from './subtitles'

type CinemetaVideo = {
  season?: number
  episode?: number
  number?: number
  name?: string
  title?: string
  thumbnail?: string
  overview?: string
  description?: string
  released?: string
  firstAired?: string
}

export type CinemetaFullMeta = {
  id: string
  name: string
  poster?: string
  background?: string
  description?: string
  imdbRating?: string | number
  runtime?: string
  releaseInfo?: string
  year?: string | number
  genres?: string[]
  genre?: string[]
  videos?: CinemetaVideo[]
}

export type MediaDetails = {
  imdbId: string
  name: string
  /** Landscape picture for the app: episode still for episodes, backdrop for movies (poster as fallback). */
  image?: string
  /** Portrait poster, for the TV and as fallback. */
  poster?: string
  rating?: number
  runtimeMinutes?: number
  year?: string
  genres: string[]
  episodeTitle?: string
  description?: string
  released?: string
}

/** "136 min" | "2h 16min" | "1h" | "45" -> minutes */
export function parseRuntime(runtime: string | undefined | null): number | undefined {
  if (!runtime) return undefined
  const s = String(runtime).toLowerCase()
  const h = s.match(/(\d+)\s*h/)
  const m = s.match(/(\d+)\s*m/)
  if (h || m) {
    const total = Number(h?.[1] ?? 0) * 60 + Number(m?.[1] ?? 0)
    return total > 0 ? total : undefined
  }
  const n = Number(s.trim())
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** 136 -> "2h 16m", 45 -> "45m", 120 -> "2h" */
export function formatRuntime(minutes: number | undefined): string | undefined {
  if (!minutes || minutes <= 0) return undefined
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Seconds -> "1:05:09" or "5:09" */
export function formatClock(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.floor(seconds ?? 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function toDetails(meta: CinemetaFullMeta, release: ParsedRelease): MediaDetails {
  const rating = Number(meta.imdbRating)
  const isEpisode = release.season !== undefined && release.episode !== undefined
  const video = isEpisode
    ? meta.videos?.find((v) => v.season === release.season && (v.episode ?? v.number) === release.episode)
    : undefined
  const year = String(meta.year ?? meta.releaseInfo ?? '').trim()
  return {
    imdbId: meta.id,
    name: meta.name,
    image: video?.thumbnail || meta.background || meta.poster,
    poster: meta.poster,
    rating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
    runtimeMinutes: parseRuntime(meta.runtime),
    year: year || undefined,
    genres: (meta.genres ?? meta.genre ?? []).slice(0, 3),
    episodeTitle: video?.name || video?.title || undefined,
    description: (isEpisode ? video?.overview || video?.description : undefined) || meta.description,
    released: video?.released || video?.firstAired || undefined,
  }
}

export async function fetchDetails(imdbId: string, release: ParsedRelease): Promise<MediaDetails | null> {
  const type = release.season !== undefined ? 'series' : 'movie'
  const data = await getJson<{ meta?: CinemetaFullMeta }>(`${CINEMETA}/meta/${type}/${imdbId}.json`)
  return data.meta ? toDetails(data.meta, release) : null
}
