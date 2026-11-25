import type { MediaLoadRequest, MediaTrack, RemoteMediaClient, TextTrackStyle } from 'react-native-google-cast'
import { normalizeLang } from './languages'
import type { MediaDetails } from './meta'
import type { StreamInfo } from './stream'

export const SUBTITLE_TRACK_ID = 1

export function textStyle(fontScale: number): TextTrackStyle {
  return {
    fontScale,
    foregroundColor: '#FFFFFFFF',
    backgroundColor: '#00000000',
    edgeType: 'outline',
    edgeColor: '#000000FF',
    fontGenericFamily: 'sansSerif',
    windowType: 'none',
  } as TextTrackStyle
}

export function buildLoadRequest(opts: {
  stream: StreamInfo
  vttUrl: string | null
  subtitleLang?: string
  subtitleName?: string
  fontScale: number
  startTime?: number
  details?: MediaDetails | null
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

  const request = {
    autoplay: true,
    startTime: opts.startTime ?? 0,
    mediaInfo: {
      contentUrl: opts.stream.url,
      contentType: opts.stream.contentType,
      streamType: 'buffered',
      metadata,
      mediaTracks: tracks,
      textTrackStyle: textStyle(opts.fontScale),
    },
    // Honoured by the iOS bridge; on Android we set it after loading (see activateSubtitles).
    activeTrackIds: tracks.length ? [SUBTITLE_TRACK_ID] : [],
  }
  return request as unknown as MediaLoadRequest
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
