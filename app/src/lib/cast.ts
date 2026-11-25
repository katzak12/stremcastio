import type { MediaLoadRequest, MediaTrack, RemoteMediaClient, TextTrackStyle } from 'react-native-google-cast'
import { normalizeLang } from './languages'
import type { MediaDetails } from './meta'
import type { StreamInfo } from './stream'

export const SUBTITLE_TRACK_ID = 1

export type SubtitleLook = { fontScale: number; color: 'white' | 'yellow'; background: 'none' | 'box' }

/**
 * The industry look (Netflix Timed Text Style Guide, followed by most streaming services and studios):
 * white sans-serif with a black edge, no box, bottom centre, at the receiver's normal size.
 * Readable on any picture while hiding as little of it as possible.
 */
export const STANDARD_LOOK: SubtitleLook = { fontScale: 1, color: 'white', background: 'none' }

export function textStyle(look: SubtitleLook): TextTrackStyle {
  const box = look.background === 'box'
  return {
    fontScale: look.fontScale,
    foregroundColor: look.color === 'yellow' ? '#FFD65CFF' : '#FFFFFFFF',
    backgroundColor: box ? '#000000B3' : '#00000000',
    edgeType: box ? 'none' : 'outline',
    edgeColor: '#000000FF',
    fontGenericFamily: 'sansSerif',
    windowType: 'none',
  } as TextTrackStyle
}

export type SleepMode = 'off' | 'end' | number

/** Seconds of playback left before the sleep timer stops the TV; undefined = no limit. */
export function sleepPlaybackDuration(mode: SleepMode, endsAt: number | null, now = Date.now()): number | undefined {
  if (typeof mode !== 'number' || !endsAt) return undefined
  return Math.max(5, Math.round((endsAt - now) / 1000))
}

export function buildLoadRequest(opts: {
  stream: StreamInfo
  vttUrl: string | null
  subtitleLang?: string
  subtitleName?: string
  look: SubtitleLook
  startTime?: number
  details?: MediaDetails | null
  /** Stop playback on the TV after this many seconds (sleep timer). */
  playbackDuration?: number
}): MediaLoadRequest {
  const tracks: MediaTrack[] = opts.vttUrl
    ? [
        {
          id: SUBTITLE_TRACK_ID,
          type: 'text',
          subtype: 'subtitles',
          contentId: opts.vttUrl,
          contentType: 'text/vtt',
          language: normalizeLang(opts.subtitleLang) === 'und' ? 'en' : normalizeLang(opts.subtitleLang),
          name: opts.subtitleName ?? 'Subtitles',
        },
      ]
    : []

  const metadata = buildMetadata(opts.stream, opts.details)

  const activeTrackIds = tracks.length ? [SUBTITLE_TRACK_ID] : []
  if (opts.playbackDuration !== undefined) {
    // The TV itself stops after playbackDuration, so the timer works with the phone locked.
    // Loading a one-item queue also drops any queued next episode.
    const mediaInfo = buildLoadRequestInfo(opts.stream, tracks, metadata, opts.look)
    return {
      autoplay: true,
      startTime: opts.startTime ?? 0,
      queueData: {
        startIndex: 0,
        items: [
          {
            mediaInfo,
            autoplay: true,
            startTime: opts.startTime ?? 0,
            playbackDuration: opts.playbackDuration,
            activeTrackIds,
          },
        ],
      },
    } as unknown as MediaLoadRequest
  }

  const request = {
    autoplay: true,
    startTime: opts.startTime ?? 0,
    mediaInfo: buildLoadRequestInfo(opts.stream, tracks, metadata, opts.look),
    // Honoured by the iOS bridge; on Android we set it after loading (see activateSubtitles).
    activeTrackIds,
  }
  return request as unknown as MediaLoadRequest
}

function buildLoadRequestInfo(stream: StreamInfo, tracks: MediaTrack[], metadata: Record<string, unknown>, look: SubtitleLook) {
  return {
    contentUrl: stream.url,
    contentType: stream.contentType,
    streamType: 'buffered',
    metadata,
    mediaTracks: tracks,
    textTrackStyle: textStyle(look),
  } as never
}

/** What the TV shows while loading/paused: title, episode info and artwork. */
export function buildMetadata(stream: StreamInfo, details?: MediaDetails | null): Record<string, unknown> {
  const images = [details?.poster, details?.image].filter((u): u is string => !!u).map((url) => ({ url }))
  const isEpisode = stream.season !== undefined && stream.episode !== undefined
  if (isEpisode) {
    const code = `S${String(stream.season).padStart(2, '0')}E${String(stream.episode).padStart(2, '0')}`
    const series = details?.name ?? stream.title
    return {
      type: 'tvShow',
      seriesTitle: series,
      title: details?.episodeTitle ? `${code} · ${details.episodeTitle}` : `${series} ${code}`,
      seasonNumber: stream.season,
      episodeNumber: stream.episode,
      images,
    }
  }
  return {
    type: 'movie',
    title: details?.name ?? stream.title,
    subtitle: details?.year ?? (stream.year ? String(stream.year) : stream.filename),
    images,
  }
}

/** Turn the subtitle track on once the receiver has a media session. Retries briefly. */
export async function activateSubtitles(client: RemoteMediaClient, enabled: boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const status = await client.getMediaStatus()
      if (status?.mediaInfo) {
        await client.setActiveTrackIds(enabled ? [SUBTITLE_TRACK_ID] : [])
        return
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}
