// Everything that can hand us a stream: Android intents (Stremio "external
// player"), share sheets, our own stremcastio:// links and .m3u playlist files.

import * as LegacyFS from 'expo-file-system/legacy'
import * as Linking from 'expo-linking'
import { useEffect, useRef } from 'react'
import { addIntentListener, getInitialIntent, type IncomingIntent } from '../../modules/intent-extras/src/IntentExtrasModule'
import { extractUrl, parseM3u } from './stream'
import { subtitlesFromExtras, type SubtitleOption } from './subtitles'

export type Incoming = {
  /** Empty for a pick request. */
  streamUrl: string
  /** From the Stremio "Cast to TV" entry: a title to find streams for (stremcastio://pick?type=&id=). */
  pick?: { type: 'movie' | 'series'; id: string }
  title?: string
  subtitles: SubtitleOption[]
}

async function readPlaylist(uri: string): Promise<Incoming | null> {
  try {
    const text = await LegacyFS.readAsStringAsync(uri)
    const { url, title } = parseM3u(text)
    return url ? { streamUrl: url, title, subtitles: [] } : null
  } catch {
    return null
  }
}

export async function fromUrl(raw: string | null | undefined): Promise<Incoming | null> {
  if (!raw) return null
  if (/^stremcastio:/i.test(raw)) {
    const parsed = Linking.parse(raw)
    const q = parsed.queryParams ?? {}
    const type = q.type === 'movie' || q.type === 'series' ? q.type : null
    if (type && typeof q.id === 'string' && /^tt\d+(?::\d+:\d+)?$/.test(q.id)) {
      return { streamUrl: '', pick: { type, id: q.id }, subtitles: [] }
    }
    const url = typeof q.url === 'string' ? q.url : null
    if (!url) return null
    const sub = typeof q.sub === 'string' ? q.sub : null
    return {
      streamUrl: url,
      title: typeof q.title === 'string' ? q.title : undefined,
      subtitles: sub ? [{ key: 'link:sub', url: sub, lang: typeof q.lang === 'string' ? q.lang : 'und', label: '', source: 'link' }] : [],
    }
  }
  if (/^(file|content):/i.test(raw)) {
    if (/\.m3u8?($|\?)/i.test(raw) || /^content:/i.test(raw)) {
      const fromList = await readPlaylist(raw)
      if (fromList) return fromList
    }
    return null
  }
  const url = extractUrl(raw)
  return url ? { streamUrl: url, subtitles: [] } : null
}

export async function fromIntent(intent: IncomingIntent | null): Promise<Incoming | null> {
  if (!intent) return null
  const extras = intent.extras ?? {}
  const subtitles = subtitlesFromExtras(extras)
  const title = typeof extras.title === 'string' ? extras.title : undefined

  if (intent.data) {
    const isPlaylist = /mpegurl|m3u/i.test(intent.type ?? '') || /\.m3u8?($|\?)/i.test(intent.data)
    if (isPlaylist && !/^https?:/i.test(intent.data)) {
      const list = await readPlaylist(intent.data)
      if (list) return { ...list, title: list.title ?? title, subtitles }
    }
    if (/^https?:/i.test(intent.data)) return { streamUrl: intent.data, title, subtitles }
  }
  // ACTION_SEND: shared text
  const shared = extras['android.intent.extra.TEXT']
  const url = typeof shared === 'string' ? extractUrl(shared) : null
  return url ? { streamUrl: url, title, subtitles } : null
}

/** Calls onIncoming for the launch payload and every later one. */
export function useIncoming(onIncoming: (incoming: Incoming) => void) {
  const cb = useRef(onIncoming)
  cb.current = onIncoming
  const last = useRef<{ url: string; at: number } | null>(null)

  useEffect(() => {
    const deliver = (inc: Incoming | null) => {
      if (!inc) return
      // Android fires both the intent and Linking for the same VIEW action; keep the richer one.
      const now = Date.now()
      const key = inc.pick ? `pick:${inc.pick.id}` : inc.streamUrl
      const dup = last.current?.url === key && now - last.current.at < 3000
      if (dup && inc.subtitles.length === 0) return
      last.current = { url: key, at: now }
      cb.current(inc)
    }

    ;(async () => {
      const intent = await fromIntent(getInitialIntent())
      if (intent) deliver(intent)
      else deliver(await fromUrl(await Linking.getInitialURL()))
    })()

    const intentSub = addIntentListener(async (i) => deliver(await fromIntent(i)))
    const linkSub = Linking.addEventListener('url', async ({ url }) => deliver(await fromUrl(url)))
    return () => {
      intentSub?.remove()
      linkSub.remove()
    }
  }, [])
}
