// Audio tracks inside the video file (like VLC shows them), read by the relay's /tracks.
// The Chromecast can't switch tracks in a plain MKV, so each track comes with its own cast URL:
// the relay changes a few header bytes so only that audio track is left (see worker/src/mkv.ts).

import { englishName, langName, normalizeLang } from './languages'

export type FileAudioTrack = {
  number: number
  /** Language as in the file (ISO 639-2 like "eng"/"por", or BCP 47). */
  language: string
  name?: string
  codec: string
  channels?: number
  /** The track the TV plays when nothing is changed. */
  isDefault: boolean
  /** False for TrueHD/DTS: the Chromecast stays silent. */
  playable: boolean
  /** What to cast for this track: the original URL, or the relay's /media URL. */
  url: string
}

export async function fetchAudioTracks(relayUrl: string, videoUrl: string, timeoutMs = 15000): Promise<FileAudioTrack[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${relayUrl.trim().replace(/\/+$/, '')}/tracks?u=${encodeURIComponent(videoUrl)}`, { signal: controller.signal })
    if (!res.ok) return []
    const data = (await res.json()) as { audio?: FileAudioTrack[] }
    return Array.isArray(data.audio) ? data.audio : []
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Track to cast unless the user picks one: the preferred language if the file has it, otherwise
 * what the TV would play, but never a track the TV can't play when there's a playable one.
 */
export function chooseAudioTrack(tracks: FileAudioTrack[], preferredLang?: string): FileAudioTrack | undefined {
  if (tracks.length === 0) return undefined
  const playable = tracks.filter((t) => t.playable)
  const pool = playable.length ? playable : tracks
  const tvDefault = tracks.find((t) => t.isDefault) ?? tracks[0]
  const pref = preferredLang ? normalizeLang(preferredLang) : null
  const isMain = (t: FileAudioTrack) => !/comment/i.test(t.name ?? '')
  if (pref && pref !== 'und') {
    const sameLang = pool.filter((t) => normalizeLang(t.language) === pref && isMain(t))
    if (sameLang.length) return sameLang.includes(tvDefault) ? tvDefault : sameLang[0]
  }
  if (pool.includes(tvDefault)) return tvDefault
  // Default track is TrueHD/DTS: same language in a format the TV can play, if there is one.
  const lang = normalizeLang(tvDefault.language)
  return pool.find((t) => normalizeLang(t.language) === lang && isMain(t)) ?? pool.find(isMain) ?? pool[0]
}

const CODEC_LABEL: [RegExp, string][] = [
  [/^A_EAC3/, 'DD+'],
  [/^A_AC3/, 'DD'],
  [/^A_TRUEHD/, 'TrueHD'],
  [/^A_DTS/, 'DTS'],
  [/^A_AAC/, 'AAC'],
  [/^A_OPUS/, 'Opus'],
  [/^A_FLAC/, 'FLAC'],
  [/^A_VORBIS/, 'Vorbis'],
  [/^A_MPEG\/L3/, 'MP3'],
  [/^A_PCM/, 'PCM'],
]

function channelLabel(n?: number): string | null {
  if (!n) return null
  if (n === 1) return 'mono'
  if (n === 2) return '2.0'
  return `${n - 1}.1`
}

/** "English · DD 5.1 · Commentary by …" */
export function audioTrackLabel(t: FileAudioTrack): string {
  const lang = normalizeLang(t.language)
  const parts = [lang === 'und' ? t.language : langName(lang)]
  const codec = CODEC_LABEL.find(([re]) => re.test(t.codec))?.[1]
  const tech = [codec, channelLabel(t.channels)].filter(Boolean).join(' ')
  if (tech) parts.push(tech)
  // Names often just repeat language/codec ("English", "AC-3 5.1"); show only names that add something.
  const name = t.name?.trim()
  if (name) {
    const rest = name
      .replace(/\b(?:e-?ac-?3|ac-?3|dd\+?|ddp|dolby|digital|plus|truehd|atmos|dts(?:-hd)?|ma|aac|opus|flac|l?pcm|stereo|mono|surround|\d\.\d)\b/gi, ' ')
      .replace(/[[\]()_.,|-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const langWords = [langName(lang), englishName(lang), t.language].map((w) => w.toLowerCase())
    if (rest && !langWords.includes(rest)) parts.push(name)
  }
  return parts.join(' · ')
}
