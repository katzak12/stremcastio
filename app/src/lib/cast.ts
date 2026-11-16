import type { MediaLoadRequest, MediaTrack, RemoteMediaClient, TextTrackStyle } from 'react-native-google-cast'
import { normalizeLang } from './languages'
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

  const title =
    opts.stream.season !== undefined && opts.stream.episode !== undefined
      ? `${opts.stream.title} S${String(opts.stream.season).padStart(2, '0')}E${String(opts.stream.episode).padStart(2, '0')}`
      : opts.stream.title

  const request = {
    autoplay: true,
    startTime: opts.startTime ?? 0,
    mediaInfo: {
      contentUrl: opts.stream.url,
      contentType: opts.stream.contentType,
      streamType: 'buffered',
      metadata: { type: 'movie', title, subtitle: opts.stream.filename },
      mediaTracks: tracks,
      textTrackStyle: textStyle(opts.fontScale),
    },
    // Honoured by the iOS bridge; on Android we set it after loading (see activateSubtitles).
    activeTrackIds: tracks.length ? [SUBTITLE_TRACK_ID] : [],
  }
  return request as unknown as MediaLoadRequest
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
