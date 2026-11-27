import * as Clipboard from 'expo-clipboard'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import GoogleCast, {
  CastButton,
  CastState,
  MediaPlayerIdleReason,
  MediaPlayerState,
  useCastDevice,
  useDevices,
  useCastSession,
  useCastState,
  useMediaStatus,
  useRemoteMediaClient,
  useStreamPosition,
} from 'react-native-google-cast'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { Onboarding } from './components/Onboarding'
import { SettingsModal } from './components/SettingsModal'
import { Badge, Button, Card, Chips, colors, styles } from './components/ui'
import { audioTrackLabel, chooseAudioTrack, fetchAudioTracks, type FileAudioTrack } from './lib/audioTracks'
import { activateSubtitles, buildLoadRequest, sleepPlaybackDuration, STANDARD_LOOK, SUBTITLE_TRACK_ID, textStyle, type SleepMode, type SubtitleLook } from './lib/cast'
import { getRememberedDevice, loadWithRetry, pingTv, rememberDevice } from './lib/castConnect'
import { setAppLanguage, t } from './lib/i18n'
import { useIncoming, type Incoming } from './lib/incoming'
import { langName, normalizeLang } from './lib/languages'
import { fetchDetails, formatClock, formatRuntime, type MediaDetails } from './lib/meta'
import { freshToken, hlsForAudio, matchRdAudio, rdKeyFromStreamUrl, rdStream, resolveRdId, type RdStream } from './lib/realDebrid'
import { isRemote, relayVttUrl, uploadLocalSubtitle } from './lib/relay'
import { addonFromStreamUrl, findEpisodeStream, findPlayableAudioStream, unsupportedAudio } from './lib/streams'
import { clearResume, getResume, saveResume } from './lib/resume'
import { getSyncOffset, saveSyncOffset, syncKey } from './lib/syncMemory'
import { lookFromSettings, useSettings } from './lib/settings'
import { describeStream, extractUrl, sameMediaUrl, type StreamInfo } from './lib/stream'
import { lookupImdbId, rankSubtitles, searchSubtitles, stremioVideoId, type SubtitleOption } from './lib/subtitles'

type SearchState = { status: 'idle' | 'searching' | 'done'; message?: string }

type NextUp =
  | { status: 'idle' | 'preparing' | 'notfound' | 'noaddon'; label?: string }
  | {
      status: 'ready'
      label: string
      url: string
      stream: StreamInfo
      subtitles: SubtitleOption[]
      subtitleKey: string
      offsetMs: number
    }

const NONE = 'none'
const SYNC_STEP_MS = 250
const ICON_SIZE = 32

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  )
}

function Main() {
  const { settings, update } = useSettings()
  setAppLanguage(settings?.appLanguage)
  const [showSettings, setShowSettings] = useState(false)

  const [stream, setStream] = useState<StreamInfo | null>(null)
  const [linkInput, setLinkInput] = useState('')
  const [incomingSubs, setIncomingSubs] = useState<SubtitleOption[]>([])
  const [found, setFound] = useState<SubtitleOption[]>([])
  const [search, setSearch] = useState<SearchState>({ status: 'idle' })
  const [showAll, setShowAll] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string>(NONE)
  const [customSub, setCustomSub] = useState('')
  const [offsetMs, setOffsetMs] = useState(0)
  const [busy, setBusy] = useState(false)
  const [castError, setCastError] = useState<string | null>(null)
  const [pendingCast, setPendingCast] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const reconnectTried = useRef(false)
  const reconnectRef = useRef<(() => void) | null>(null)
  const [details, setDetails] = useState<MediaDetails | null>(null)
  const [imdbId, setImdbId] = useState<string | null>(null)
  const [offsetSaved, setOffsetSaved] = useState(false)
  const [nextUp, setNextUp] = useState<NextUp>({ status: 'idle' })
  const preparedFor = useRef<string | null>(null)
  const [altSearch, setAltSearch] = useState<'idle' | 'searching' | 'notfound' | 'noaddon'>('idle')
  const [sleep, setSleep] = useState<SleepMode>('off')
  const [sleepEndsAt, setSleepEndsAt] = useState<number | null>(null)

  const castState = useCastState()
  const client = useRemoteMediaClient()
  const device = useCastDevice()
  const mediaStatus = useMediaStatus()
  const connected = castState === CastState.CONNECTED && client != null
  const activeIds = mediaStatus?.activeTrackIds ?? []

  // Audio tracks inside the file (MKV), read via the relay. The chosen track decides what we cast.
  const [fileAudio, setFileAudio] = useState<{ url: string; loading: boolean; tracks: FileAudioTrack[] }>({ url: '', loading: false, tracks: [] })
  const [audioPick, setAudioPick] = useState<number | null>(null)
  const audioTracksForStream = stream && fileAudio.url === stream.url ? fileAudio.tracks : []
  const chosenAudio =
    audioTracksForStream.find((tr) => tr.number === audioPick) ?? chooseAudioTrack(audioTracksForStream, settings?.audioLanguage)
  const castUrl = chosenAudio?.url ?? stream?.url
  const tvContentUrl = mediaStatus?.mediaInfo?.contentUrl || mediaStatus?.mediaInfo?.contentId
  // The URL we last sent to the TV for this stream (direct, or via the relay for an audio track).
  const lastCastUrl = useRef<{ stream: string; url: string } | null>(null)
  const tvReportsOurs =
    !!tvContentUrl &&
    !!stream &&
    (sameMediaUrl(tvContentUrl, stream.url) ||
      (lastCastUrl.current?.stream === stream.url && sameMediaUrl(tvContentUrl, lastCastUrl.current.url)) ||
      audioTracksForStream.some((tr) => sameMediaUrl(tr.url, tvContentUrl)))
  // We cast this stream ourselves and the TV hasn't stopped it: that counts too, whatever URL the TV reports back.
  const [weCast, setWeCast] = useState<string | null>(null)
  const isPlayingOurs = !!stream && connected && (tvReportsOurs || weCast === stream.url)
  const position = useStreamPosition(1)

  // One IMDb lookup per stream, shared by the subtitle search and the artwork/rating.
  const imdbLookup = useMemo(() => (stream ? lookupImdbId(stream).catch(() => null) : null), [stream])

  useEffect(() => {
    setDetails(null)
    setImdbId(null)
    if (!stream || !imdbLookup) return
    let cancelled = false
    imdbLookup
      .then((imdb) => {
        if (!cancelled) setImdbId(imdb?.id ?? null)
        return imdb ? fetchDetails(imdb.id, stream) : null
      })
      .then((d) => {
        if (!cancelled) setDetails(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [stream, imdbLookup])

  // ---------- incoming streams ----------

  const acceptStream = useCallback((url: string, subs: SubtitleOption[] = [], title?: string, keep?: Partial<StreamInfo>) => {
    const described = describeStream(url)
    const info = keep ? { ...described, ...keep } : described
    setStream(title && !info.season ? { ...info, title } : info)
    setAltSearch('idle')
    setIncomingSubs(subs)
    setFound([])
    setSearch({ status: 'idle' })
    setSelectedKey(subs[0]?.key ?? NONE)
    setOffsetMs(0)
    setCastError(null)
    setLinkInput('')
    setNextUp({ status: 'idle' })
    setAudioPick(null)
    setWeCast(null)
    preparedFor.current = null
  }, [])

  // Forget "we cast this" when the TV stops or finishes the video. Not on a dropped connection: that also
  // happens for a moment when the app comes back from the background.
  const tvIdleReason = mediaStatus?.idleReason
  const tvPlayerState = mediaStatus?.playerState
  useEffect(() => {
    if (
      tvPlayerState === MediaPlayerState.IDLE &&
      (tvIdleReason === MediaPlayerIdleReason.FINISHED || tvIdleReason === MediaPlayerIdleReason.CANCELLED)
    )
      setWeCast(null)
  }, [tvPlayerState, tvIdleReason])

  useEffect(() => {
    if (!stream || !settings?.relayUrl || !isRemote(stream.url)) return
    const url = stream.url
    let cancelled = false
    setFileAudio({ url, loading: true, tracks: [] })
    fetchAudioTracks(settings.relayUrl, url).then((tracks) => {
      if (!cancelled) setFileAudio({ url, loading: false, tracks })
    })
    return () => {
      cancelled = true
    }
  }, [stream, settings?.relayUrl])

  useIncoming(
    useCallback((inc: Incoming) => acceptStream(inc.streamUrl, inc.subtitles, inc.title), [acceptStream]),
  )

  const acceptText = (text: string) => {
    const url = extractUrl(text)
    if (url) acceptStream(url)
    else Alert.alert(t.error, t.noVideo)
  }

  // ---------- subtitle search ----------

  const runSearch = useCallback(async () => {
    if (!stream || !settings) return
    setSearch({ status: 'searching' })
    try {
      const imdb = await imdbLookup
      if (!imdb) {
        setSearch({ status: 'done', message: t.titleNotFound })
        return
      }
      const res = await searchSubtitles({ release: stream, filename: stream.filename, addons: settings.addons, imdbId: imdb.id })
      const ranked = rankSubtitles(res.options, settings.languages)
      setFound(ranked)
      setSearch({
        status: 'done',
        message: res.errors.includes('title-not-found') ? t.titleNotFound : ranked.length === 0 ? t.noneFound : undefined,
      })
      setSelectedKey((current) => {
        if (current !== NONE) return current // keep a subtitle Stremio handed us
        const best = ranked.find((o) => settings.languages.includes(o.lang))
        return best?.key ?? NONE
      })
    } catch (e) {
      setSearch({ status: 'done', message: `${t.error}: ${e instanceof Error ? e.message : String(e)}` })
    }
  }, [stream, settings, imdbLookup])

  useEffect(() => {
    if (stream && settings?.autoSearch && search.status === 'idle') runSearch()
  }, [stream, settings, search.status, runSearch])

  const allOptions = useMemo(() => {
    const custom: SubtitleOption[] = /^https?:\/\//i.test(customSub.trim())
      ? [{ key: 'custom', url: customSub.trim(), lang: 'und', label: customSub.trim(), source: 'link' }]
      : []
    return [...custom, ...incomingSubs, ...found]
  }, [customSub, incomingSubs, found])

  const visibleOptions = useMemo(() => {
    if (showAll || !settings) return allOptions.slice(0, 60)
    return allOptions
      .filter((o) => o.source === 'stremio' || o.key === 'custom' || o.key === selectedKey || settings.languages.includes(o.lang))
      .slice(0, 20)
  }, [allOptions, showAll, settings, selectedKey])

  const selected = allOptions.find((o) => o.key === selectedKey) ?? null

  // ---------- remembered subtitle sync ----------

  const videoId = imdbId && stream ? stremioVideoId(imdbId, stream).id : null
  const offsetKey = videoId && selected ? syncKey(videoId, selected.url) : null

  useEffect(() => {
    setOffsetSaved(false)
    if (!offsetKey) return
    let cancelled = false
    getSyncOffset(offsetKey).then((ms) => {
      if (cancelled) return
      setOffsetMs(ms ?? 0)
      setOffsetSaved(ms != null)
    })
    return () => {
      cancelled = true
    }
  }, [offsetKey])

  // ---------- casting ----------

  const resolveVtt = useCallback(
    async (sub: SubtitleOption | null, offset: number): Promise<string | null> => {
      if (!sub || !settings) return null
      if (!settings.relayUrl) throw new Error(t.noRelay)
      return isRemote(sub.url) ? relayVttUrl(settings.relayUrl, sub.url, offset) : uploadLocalSubtitle(settings.relayUrl, sub.url, offset)
    },
    [settings],
  )

  const look: SubtitleLook | null = settings ? lookFromSettings(settings) : null

  // ---------- Real-Debrid streaming (other spoken language, or audio the TV can't play) ----------

  const rdAvailable = !!stream && (!!settings?.rdAuth || !!rdKeyFromStreamUrl(stream.url))
  const rdCache = useRef<{ stream: string; data: RdStream } | null>(null)
  /** Language to switch the TV to once an RD stream (HLS with all audio tracks) is playing. */
  const pendingRdLang = useRef<string | null>(null)
  /** The TV refused RD's stream for this video (e.g. not allowed to fetch it): don't try RD again for it. */
  const rdBroken = useRef<string | null>(null)
  const lastWasRd = useRef(false)

  /** Best way to play the chosen audio: the original file when it can, else RD's HLS, else the relay trick. */
  const playbackTarget = async (): Promise<{ url: string; contentType: string; rdLang?: string }> => {
    if (!stream) throw new Error('no stream')
    const original = { url: stream.url, contentType: stream.contentType }
    const tracks = audioTracksForStream
    const isDefault = !chosenAudio || chosenAudio.isDefault
    const silentByName = tracks.length === 0 && !!unsupportedAudio(stream.filename)
    const wantRd = rdAvailable && rdBroken.current !== stream.url && ((chosenAudio && (!isDefault || !chosenAudio.playable)) || silentByName)
    if (!wantRd) return chosenAudio ? { url: chosenAudio.url, contentType: stream.contentType } : original
    try {
      const token = settings?.rdAuth
        ? await freshToken(settings.rdAuth, (a) => update({ rdAuth: a }))
        : rdKeyFromStreamUrl(stream.url)
      if (!token) throw new Error('no token')
      let data = rdCache.current?.stream === stream.url ? rdCache.current.data : null
      if (!data) {
        const id = await resolveRdId(stream.url, token)
        data = id ? await rdStream(id, token) : null
        if (data) rdCache.current = { stream: stream.url, data }
      }
      if (data) {
        let url = data.hls
        if (chosenAudio) {
          const lang = normalizeLang(chosenAudio.language)
          const same = tracks.filter((tr) => normalizeLang(tr.language) === lang)
          const match = matchRdAudio(data.audio, chosenAudio, Math.max(0, same.indexOf(chosenAudio)))
          if (match)
            url = hlsForAudio(
              data.hls,
              data.audio.map((a) => a.key),
              match.key,
            )
        }
        return { url, contentType: 'application/x-mpegURL', rdLang: chosenAudio ? normalizeLang(chosenAudio.language) : undefined }
      }
    } catch {
      // fall back below
    }
    return chosenAudio ? { url: chosenAudio.url, contentType: stream.contentType } : original
  }

  // The TV sometimes starts loading and then gives up (slow source on the first request).
  // Watch the first minute after a load and try again by itself, like tapping Cast again.
  const loadWatch = useRef<{ at: number; startTime: number; offset: number; retries: number } | null>(null)
  const retryingLoad = useRef(false)

  const loadOnTv = useCallback(
    async (startTime = 0, offset = offsetMs, sleepState: { mode: SleepMode; endsAt: number | null } = { mode: sleep, endsAt: sleepEndsAt }) => {
      if (!client || !stream || !settings || !look) return
      setBusy(true)
      setCastError(null)
      try {
        const [vttUrl, target] = await Promise.all([resolveVtt(selected, offset), playbackTarget()])
        pendingRdLang.current = target.rdLang ?? null
        lastWasRd.current = target.contentType === 'application/x-mpegURL' && target.url !== stream.url
        const request = buildLoadRequest({
          stream: target.url !== stream.url ? { ...stream, url: target.url, contentType: target.contentType } : stream,
          vttUrl,
          subtitleLang: selected?.lang,
          subtitleName: selected ? langName(selected.lang) : undefined,
          look,
          startTime,
          details,
          playbackDuration: sleepPlaybackDuration(sleepState.mode, sleepState.endsAt),
        })
        // A fresh load replaces the TV's queue, so line up the next episode again afterwards.
        preparedFor.current = null
        setNextUp({ status: 'idle' })
        lastCastUrl.current = { stream: stream.url, url: target.url }
        await loadWithRetry(client, request)
        setWeCast(stream.url)
        loadWatch.current = {
          at: Date.now(),
          startTime,
          offset,
          retries: retryingLoad.current ? (loadWatch.current?.retries ?? 0) : 0,
        }
        retryingLoad.current = false
        reconnectTried.current = false
        await activateSubtitles(client, vttUrl != null, look)
      } catch (e) {
        // A dead "remembered" connection: reconnect to the same TV once, then cast again.
        if (!reconnectTried.current) {
          reconnectTried.current = true
          reconnectRef.current?.()
          return
        }
        reconnectTried.current = false
        setCastError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [client, stream, castUrl, settings, selected, offsetMs, resolveVtt, details, sleep, sleepEndsAt],
  )

  // ---------- continue watching ----------

  const resumeKeys = useMemo(
    () => [videoId ? `id:${videoId}` : null, stream ? `file:${stream.filename}` : null].filter((k): k is string => !!k),
    [videoId, stream],
  )

  /** Start casting; if we stopped halfway last time, ask whether to continue there. */
  const startCasting = useCallback(async () => {
    let saved: Awaited<ReturnType<typeof getResume>> = null
    for (const key of resumeKeys) {
      saved = await getResume(key)
      if (saved) break
    }
    if (!saved) return loadOnTv(0)
    const pos = saved.pos
    Alert.alert(t.continueTitle, details?.name ?? stream?.title, [
      { text: `${t.resumeFrom} ${formatClock(pos)}`, onPress: () => loadOnTv(pos) },
      { text: t.startOver, onPress: () => loadOnTv(0) },
      { text: t.cancel, style: 'cancel' },
    ])
  }, [resumeKeys, loadOnTv, details, stream])

  // Remember the position every 10 s while our video plays.
  const lastResumeSave = useRef(0)
  const duration = mediaStatus?.mediaInfo?.streamDuration ?? 0
  useEffect(() => {
    if (!isPlayingOurs || position == null || position < 1) return
    if (Date.now() - lastResumeSave.current < 10000) return
    lastResumeSave.current = Date.now()
    for (const key of resumeKeys) saveResume(key, position, duration)
  }, [isPlayingOurs, position, duration, resumeKeys])

  // ---------- connecting to the TV ----------

  // Remember the TV we last cast to, so "Cast to TV" can connect straight to it.
  const devices = useDevices()
  useEffect(() => {
    if (connected && device?.deviceId) rememberDevice(device.deviceId)
  }, [connected, device?.deviceId])

  const connectedRef = useRef(connected)
  connectedRef.current = connected

  const openPicker = async () => {
    try {
      await GoogleCast.showCastDialog()
    } catch {
      setPendingCast(false)
    }
  }

  /** Drop a dead connection and connect to the same TV again; casting continues once connected. */
  const reconnectAndCast = async () => {
    const id = device?.deviceId ?? (await getRememberedDevice())
    setReconnecting(true)
    setPendingCast(true)
    try {
      await GoogleCast.getSessionManager().endCurrentSession(false)
    } catch {
      // already gone
    }
    if (id) {
      try {
        if (await GoogleCast.getSessionManager().startSession(id)) {
          setTimeout(() => {
            if (!connectedRef.current) {
              setReconnecting(false)
              openPicker()
            }
          }, 10000)
          return
        }
      } catch {
        // fall through to the picker
      }
    }
    setReconnecting(false)
    openPicker()
  }
  reconnectRef.current = reconnectAndCast

  const onCastPress = async () => {
    if (connected && client) {
      // "Cast to TV · <name>": check the remembered connection still works before using it.
      setBusy(true)
      const alive = await pingTv(client)
      setBusy(false)
      if (alive === 'timeout') return reconnectAndCast()
      return startCasting()
    }
    setPendingCast(true)
    // Already (re)connecting: just wait, the effect below starts playback once connected.
    if (castState === CastState.CONNECTING) return
    const last = await getRememberedDevice()
    if (last && devices.some((d) => d.deviceId === last)) {
      try {
        if (await GoogleCast.getSessionManager().startSession(last)) {
          // Fall back to the picker if the TV doesn't answer in time.
          setTimeout(() => {
            if (!connectedRef.current) openPicker()
          }, 8000)
          return
        }
      } catch {
        // fall through to the picker
      }
    }
    openPicker()
  }

  // Continue once connected (picked in the dialog, or reconnected to the remembered TV).
  useEffect(() => {
    if (pendingCast && connected) {
      setPendingCast(false)
      setReconnecting(false)
      // Let the TV picker finish closing first: iOS drops an alert ("continue watching?") shown during that.
      setTimeout(() => startCasting(), 800)
    }
  }, [pendingCast, connected, startCasting])

  // Don't start casting much later out of the blue if the dialog was closed without choosing a TV.
  useEffect(() => {
    if (!pendingCast) return
    const timer = setTimeout(() => {
      setPendingCast(false)
      setReconnecting(false)
    }, 60000)
    return () => clearTimeout(timer)
  }, [pendingCast])

  // Subtitle sync: reload at the current position with a shifted subtitle (debounced).
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nudgeSync = (delta: number) => {
    const next = offsetMs + delta
    setOffsetMs(next)
    if (offsetKey) {
      saveSyncOffset(offsetKey, next)
      setOffsetSaved(next !== 0)
    }
    if (!client || !isPlayingOurs || !selected) return
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(async () => {
      const position = (await client.getStreamPosition()) ?? 0
      loadOnTv(position, next)
    }, 1200)
  }

  // ---------- audio the Chromecast can't play (DTS / TrueHD) ----------

  // Known tracks: only warn when the track we'd cast is silent on the TV. Otherwise guess from the file name.
  // While the track list is still being read, say nothing: the file name often names only the first track.
  const audioPending =
    !!stream && !!settings?.relayUrl && isRemote(stream.url) && (fileAudio.url !== stream.url || fileAudio.loading)
  const badAudio = !stream || audioPending || rdAvailable
    ? null
    : audioTracksForStream.length
      ? chosenAudio && !chosenAudio.playable
        ? (chosenAudio.codec.match(/TRUEHD|DTS/i)?.[0] ?? chosenAudio.codec)
        : null
      : unsupportedAudio(stream.filename)

  // Picking another audio track or subtitle while it plays: cast again at the same position.
  const reloadForAudio = useRef(false)
  const pickAudio = (num: number) => {
    const track = audioTracksForStream.find((tr) => tr.number === num)
    if (!track || track.number === chosenAudio?.number) return
    setAudioPick(num)
    update({ audioLanguage: normalizeLang(track.language) })
    reloadForAudio.current = isPlayingOurs
  }
  useEffect(() => {
    if (!reloadForAudio.current || !client) return
    reloadForAudio.current = false
    client
      .getStreamPosition()
      .then((pos) => loadOnTv(pos ?? 0))
      .catch(() => {})
  }, [castUrl, selectedKey, client, loadOnTv])

  const pickSubtitle = (key: string) => {
    if (key === NONE) {
      // Just hide them on the TV; no reload needed.
      setSelectedKey(NONE)
      const others = activeIds.filter((x) => x !== SUBTITLE_TRACK_ID)
      client?.setActiveTrackIds(others).catch(() => {})
      return
    }
    if (key === selectedKey && activeIds.includes(SUBTITLE_TRACK_ID)) return
    if (key === selectedKey) {
      client?.setActiveTrackIds([SUBTITLE_TRACK_ID, ...activeIds]).catch(() => {})
      return
    }
    setSelectedKey(key)
    reloadForAudio.current = isPlayingOurs
  }

  const findDolbyVersion = async () => {
    if (!stream || !settings) return
    const addons = [...settings.streamAddons, addonFromStreamUrl(stream.url)].filter((a): a is string => !!a)
    if (addons.length === 0) return setAltSearch('noaddon')
    setAltSearch('searching')
    try {
      const imdb = imdbId ?? (await imdbLookup)?.id
      if (!imdb) return setAltSearch('notfound')
      const { type, id } = stremioVideoId(imdb, stream)
      const candidate = await findPlayableAudioStream({
        addons,
        type,
        videoId: id,
        currentUrl: stream.url,
        currentFilename: stream.filename,
      })
      if (!candidate) return setAltSearch('notfound')
      const described = describeStream(candidate.url)
      // Same title/episode; keep what we already know so artwork and subtitles stay right.
      acceptStream(candidate.url, [], undefined, {
        filename: candidate.filename ?? described.filename,
        title: stream.title,
        year: stream.year,
        season: stream.season,
        episode: stream.episode,
      })
    } catch {
      setAltSearch('notfound')
    }
  }

  // ---------- next episode ----------

  // Once an episode plays, find the next one's stream + subtitle and put it in the TV's queue,
  // so the Chromecast moves on by itself (even with the phone locked).
  useEffect(() => {
    if (!client || !connected || !isPlayingOurs || !stream || !settings || !imdbId) return
    const next = details?.nextEpisode
    if (!next || !settings.autoNext || sleep !== 'off' || preparedFor.current === stream.url) return
    preparedFor.current = stream.url
    const label = `S${String(next.season).padStart(2, '0')}E${String(next.episode).padStart(2, '0')}${next.name ? ` · ${next.name}` : ''}`
    const addons = [...settings.streamAddons, addonFromStreamUrl(stream.url)].filter((a): a is string => !!a)
    if (addons.length === 0) {
      setNextUp({ status: 'noaddon', label })
      return
    }
    setNextUp({ status: 'preparing', label })
    ;(async () => {
      try {
        const candidate = await findEpisodeStream({
          addons,
          imdbId,
          season: next.season,
          episode: next.episode,
          currentFilename: stream.filename,
        })
        if (!candidate) return setNextUp({ status: 'notfound', label })
        const described = describeStream(candidate.url)
        const nextStream: StreamInfo = {
          ...described,
          filename: candidate.filename ?? described.filename,
          title: stream.title,
          year: stream.year,
          season: next.season,
          episode: next.episode,
        }

        // Subtitle: same language as now if possible, else the first preferred language.
        let subtitles: SubtitleOption[] = []
        try {
          const res = await searchSubtitles({ release: nextStream, filename: nextStream.filename, addons: settings.addons, imdbId })
          subtitles = rankSubtitles(res.options, settings.languages)
        } catch {
          // play without subtitles rather than not at all
        }
        const wantLang = selected?.lang
        const sub =
          (wantLang ? subtitles.find((o) => o.lang === wantLang) : undefined) ??
          subtitles.find((o) => settings.languages.includes(o.lang)) ??
          null
        const nextVideoId = stremioVideoId(imdbId, nextStream).id
        const subOffset = sub ? ((await getSyncOffset(syncKey(nextVideoId, sub.url))) ?? 0) : 0
        const vttUrl = sub && settings.relayUrl && isRemote(sub.url) ? relayVttUrl(settings.relayUrl, sub.url, subOffset) : null

        const request = buildLoadRequest({
          stream: nextStream,
          vttUrl,
          subtitleLang: sub?.lang,
          subtitleName: sub ? langName(sub.lang) : undefined,
          look: look ?? STANDARD_LOOK,
          details: details
            ? { ...details, episodeTitle: next.name, image: next.thumbnail ?? details.image, nextEpisode: undefined }
            : null,
        }) as unknown as { mediaInfo: Parameters<typeof client.queueInsertItem>[0]['mediaInfo'] }
        await client.queueInsertItem({
          mediaInfo: request.mediaInfo,
          autoplay: true,
          preloadTime: 30,
          activeTrackIds: vttUrl ? [SUBTITLE_TRACK_ID] : [],
        })
        setNextUp({
          status: 'ready',
          label,
          url: nextStream.url,
          stream: nextStream,
          subtitles,
          subtitleKey: vttUrl && sub ? sub.key : NONE,
          offsetMs: subOffset,
        })
      } catch {
        setNextUp({ status: 'notfound', label })
      }
    })()
  }, [client, connected, isPlayingOurs, stream, settings, imdbId, details, selected, sleep])

  // The TV moved on to the queued episode: follow it in the app.
  const tvUrl = mediaStatus?.mediaInfo?.contentUrl || mediaStatus?.mediaInfo?.contentId
  useEffect(() => {
    if (nextUp.status !== 'ready' || !sameMediaUrl(tvUrl, nextUp.url)) return
    for (const key of resumeKeys) clearResume(key)
    setStream(nextUp.stream)
    setWeCast(nextUp.stream.url)
    setIncomingSubs([])
    setFound(nextUp.subtitles)
    setSearch({ status: 'done' })
    setSelectedKey(nextUp.subtitleKey)
    setOffsetMs(nextUp.offsetMs)
    setCastError(null)
    setNextUp({ status: 'idle' })
    if (client) activateSubtitles(client, nextUp.subtitleKey !== NONE, look ?? undefined)
  }, [tvUrl, nextUp, client])

  // ---------- sleep timer ----------

  const chooseSleep = async (mode: SleepMode) => {
    const endsAt = typeof mode === 'number' ? Date.now() + mode * 60000 : null
    const wasTimed = typeof sleep === 'number'
    setSleep(mode)
    setSleepEndsAt(endsAt)
    // Timed: the TV must know the limit (works with the phone locked), which needs a reload at the
    // current position. "End of video": only drop the queued next episode. "Off" after a timer: lift the limit.
    const needsReload = typeof mode === 'number' || wasTimed || (mode === 'end' && nextUp.status === 'ready')
    if (client && isPlayingOurs && needsReload) {
      const pos = (await client.getStreamPosition()) ?? 0
      loadOnTv(pos, offsetMs, { mode, endsAt })
    }
    if (mode === 'off') preparedFor.current = null
  }

  // Back-up for while the app is open: stop exactly on time, then reset.
  useEffect(() => {
    if (!sleepEndsAt) return
    const timer = setTimeout(() => {
      client?.stop().catch(() => {})
      setSleep('off')
      setSleepEndsAt(null)
    }, Math.max(0, sleepEndsAt - Date.now()))
    return () => clearTimeout(timer)
  }, [sleepEndsAt, client])

  // ---------- subtitle style, live ----------

  const lookJson = look ? JSON.stringify(look) : ''
  const appliedLook = useRef(lookJson)
  useEffect(() => {
    if (!client || !isPlayingOurs || !look || lookJson === appliedLook.current) return
    appliedLook.current = lookJson
    client.setTextTrackStyle(textStyle(look)).catch(() => {})
  }, [lookJson, client, isPlayingOurs])

  // ---------- audio tracks ----------

  // Only offered when the TV reports more than one audio track (HLS/DASH streams usually do;
  // most single-file MKV/MP4 streams do not, and then this simply stays hidden).
  const audioTracks = (mediaStatus?.mediaInfo?.mediaTracks ?? []).filter((tr) => tr.type === 'audio')
  const activeAudio = audioTracks.find((tr) => activeIds.includes(tr.id))?.id ?? audioTracks[0]?.id
  useEffect(() => {
    const lang = pendingRdLang.current
    if (!lang || !client || !isPlayingOurs || audioTracks.length < 2) return
    pendingRdLang.current = null
    const want = audioTracks.find((tr) => normalizeLang(tr.language ?? '') === lang)
    if (!want || activeIds.includes(want.id)) return
    const audioIds = new Set(audioTracks.map((tr) => tr.id))
    client.setActiveTrackIds([want.id, ...activeIds.filter((x) => !audioIds.has(x))]).catch(() => {})
  }, [audioTracks.length, isPlayingOurs, client])
  const chooseAudio = (id: number) => {
    const audioIds = new Set(audioTracks.map((tr) => tr.id))
    client?.setActiveTrackIds([id, ...activeIds.filter((x) => !audioIds.has(x))]).catch(() => {})
  }

  const playerState = mediaStatus?.playerState
  const isPaused = playerState === MediaPlayerState.PAUSED

  useEffect(() => {
    const watch = loadWatch.current
    if (!watch || !client) return
    if (playerState === MediaPlayerState.PLAYING) {
      loadWatch.current = null
      return
    }
    const failed = playerState === MediaPlayerState.IDLE && mediaStatus?.idleReason === MediaPlayerIdleReason.ERROR
    if (!failed || Date.now() - watch.at > 60000) return
    if (watch.retries >= 2) {
      loadWatch.current = null
      setCastError(t.tvCouldNotPlay)
      return
    }
    watch.retries += 1
    watch.at = Date.now()
    // RD's stream failed on the TV: retry the normal way (original file / relay) instead.
    if (lastWasRd.current && stream) rdBroken.current = stream.url
    retryingLoad.current = true
    const timer = setTimeout(() => loadOnTv(watch.startTime, watch.offset), 1500)
    return () => clearTimeout(timer)
  }, [playerState, mediaStatus?.idleReason, client, loadOnTv])

  // ---------- remote control (full screen while casting) ----------

  const [remoteOpen, setRemoteOpen] = useState(false)
  /** Show the remote. Close-then-open with a short delay: iOS ignores a modal presented while an alert or the
   *  TV picker is still closing, which left remoteOpen stuck on true with nothing on screen. */
  const openRemote = useCallback(() => {
    setRemoteOpen(false)
    setTimeout(() => setRemoteOpen(true), 450)
  }, [])
  const [sheet, setSheet] = useState<'audio' | 'subs' | null>(null)
  // Whatever the TV is playing (e.g. after the app was closed and reopened, when we no longer know the stream).
  const tvMeta = mediaStatus?.mediaInfo?.metadata as { title?: string; images?: { url: string }[] } | undefined
  const tvActive = connected && !!mediaStatus?.mediaInfo && playerState != null && playerState !== MediaPlayerState.IDLE
  const playingNow = isPlayingOurs || tvActive
  // Coming back from the background, the connection drops for a moment: keep the bar for a while.
  const [barGrace, setBarGrace] = useState(false)
  useEffect(() => {
    if (playingNow) {
      setBarGrace(true)
      return
    }
    if (!barGrace) return
    const timer = setTimeout(() => setBarGrace(false), 20000)
    return () => clearTimeout(timer)
  }, [playingNow, barGrace])
  const showBar = playingNow || (barGrace && castState !== CastState.NO_DEVICES_AVAILABLE)
  const nowTitle = isPlayingOurs ? (details?.name ?? stream?.title) : (tvMeta?.title ?? stream?.title ?? 'TV')
  const nowPoster = isPlayingOurs ? details?.poster : tvMeta?.images?.[0]?.url
  const autoOpenedFor = useRef<string | null>(null)
  useEffect(() => {
    // Open the remote once per video, as soon as it starts on the TV.
    const key = stream?.url ?? tvContentUrl ?? null
    if (playingNow && key && autoOpenedFor.current !== key) {
      autoOpenedFor.current = key
      openRemote()
    }
    // Close it when playback has really ended (not during a quick reload for sync or audio).
    if (playingNow) return
    const timer = setTimeout(() => setRemoteOpen(false), 5000)
    return () => clearTimeout(timer)
  }, [playingNow, stream, tvContentUrl])

  const subtitlesOn = activeIds.includes(SUBTITLE_TRACK_ID)
  const toggleSubtitles = () => {
    const others = activeIds.filter((x) => x !== SUBTITLE_TRACK_ID)
    client?.setActiveTrackIds(subtitlesOn ? others : [SUBTITLE_TRACK_ID, ...others]).catch(() => {})
  }
  /** Stop the video on the TV and disconnect. */
  const stopCasting = () => {
    GoogleCast.getSessionManager().endCurrentSession(true).catch(() => {})
    setWeCast(null)
    setBarGrace(false)
    setRemoteOpen(false)
  }

  /** Our own tap on the cast icon: the SDK's own sheet (volume slider, its own player) is not used. */
  const onCastIconPress = () => {
    if (!connected) {
      GoogleCast.showCastDialog().catch(() => {})
      return
    }
    Alert.alert(device?.friendlyName ?? 'TV', undefined, [
      ...(playingNow ? [{ text: t.openRemote, onPress: openRemote }] : []),
      { text: t.stopCasting, style: 'destructive' as const, onPress: stopCasting },
      { text: t.cancel, style: 'cancel' as const },
    ])
  }
  const playbackRate = mediaStatus?.playbackRate ?? 1
  const [remoteSection, setRemoteSection] = useState<'audio' | 'subs' | 'next' | 'sleep' | null>(null)
  const toggleSection = (k: 'audio' | 'subs' | 'next' | 'sleep') => setRemoteSection((cur) => (cur === k ? null : k))
  const subtitleName = (o: SubtitleOption) => {
    const what = o.source === 'stremio' ? t.fromStremio : langName(o.lang)
    return o.key === 'custom' ? t.customSub : what
  }
  const seekBy = (sec: number) => client?.seek({ position: sec, relative: true }).catch(() => {})

  if (!settings) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <View style={[styles.row, { justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 }]}>
        <View>
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: '800' }}>StremCastio</Text>
          <Text style={styles.muted}>{t.tagline}</Text>
        </View>
        <View style={styles.row}>
          <CastIcon onPress={onCastIconPress} />
          <Pressable
            accessibilityLabel={t.settings}
            onPress={() => setShowSettings(true)}
            hitSlop={12}
            style={{ width: ICON_SIZE, height: ICON_SIZE, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: colors.text, fontSize: ICON_SIZE, lineHeight: ICON_SIZE + 2 }}>⚙︎</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        {/* ---------- video ---------- */}
        <Card title={t.videoTitle}>
          {stream ? (
            <View style={{ gap: 10 }}>
              <VideoInfo stream={stream} details={details} />
              {badAudio && (
                <View style={[styles.selectRow, { gap: 8, borderColor: colors.warn }]}>
                  <Text style={{ color: colors.warn }}>{t.audioUnsupported.replace('{codec}', badAudio)}</Text>
                  {altSearch === 'searching' ? (
                    <View style={styles.row}>
                      <ActivityIndicator color={colors.accent} size="small" />
                      <Text style={styles.muted}>{t.searchingDolby}</Text>
                    </View>
                  ) : (
                    <Button label={t.findDolby} kind="primary" small onPress={findDolbyVersion} />
                  )}
                  {altSearch === 'notfound' && <Text style={styles.muted}>{t.dolbyNotFound}</Text>}
                  {altSearch === 'noaddon' && <Text style={styles.muted}>{t.dolbyNeedsAddon}</Text>}
                </View>
              )}
              <View style={{ gap: 8 }}>
                {(audioTracksForStream.length > 1 || (fileAudio.loading && fileAudio.url === stream.url)) && (
                  <OptionRow
                    title={t.audio}
                    value={fileAudio.loading && fileAudio.url === stream.url ? t.audioLoading : chosenAudio ? audioTrackLabel(chosenAudio) : ''}
                    loading={fileAudio.loading && fileAudio.url === stream.url}
                    onPress={() => setSheet('audio')}
                  />
                )}
                <OptionRow
                  title={t.subtitlesTitle}
                  value={search.status === 'searching' ? t.searching : selected ? subtitleName(selected) : t.noSubtitle}
                  loading={search.status === 'searching'}
                  onPress={() => setSheet('subs')}
                />
              </View>
            </View>
          ) : (
            <Text style={styles.muted}>{t.noVideo}</Text>
          )}
          <View style={styles.row}>
            {Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable ? (
              <Clipboard.ClipboardPasteButton
                acceptedContentTypes={['plain-text', 'url']}
                displayMode="iconAndLabel"
                cornerStyle="capsule"
                backgroundColor={colors.accent}
                foregroundColor="#FFFFFF"
                style={{ height: 44, width: 150 }}
                onPress={(data) => {
                  if (data.type === 'text') acceptText(data.text)
                }}
              />
            ) : (
              <Button
                label={t.pasteLink}
                kind={stream ? 'secondary' : 'primary'}
                onPress={async () => acceptText(await Clipboard.getStringAsync())}
              />
            )}
          </View>
          {!stream && (
          <TextInput
            style={styles.input}
            placeholder={t.orTypeLink}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={linkInput}
            onChangeText={setLinkInput}
            onSubmitEditing={() => acceptText(linkInput)}
            returnKeyType="go"
          />
          )}
        </Card>

        {/* ---------- audio / subtitle menus ---------- */}
        <Sheet
          visible={sheet === 'subs'}
          title={t.subtitlesTitle}
          onClose={() => setSheet(null)}
          right={search.status === 'done' ? <Button label={t.searchAgain} kind="ghost" small onPress={runSearch} /> : undefined}
        >
            {search.status === 'searching' && (
              <View style={styles.row}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.muted}>{t.searching}</Text>
              </View>
            )}
            {search.message && <Text style={styles.muted}>{search.message}</Text>}

            <SubtitleRow
              active={selectedKey === NONE}
              onPress={() => {
                setSelectedKey(NONE)
                setSheet(null)
              }}
              lang="—"
              title={t.noSubtitle}
            />
            {visibleOptions.map((o) => (
              <SubtitleRow
                key={o.key}
                active={o.key === selectedKey}
                onPress={() => {
                  setSelectedKey(o.key)
                  setSheet(null)
                }}
                lang={o.lang === 'und' ? '?' : o.lang.toUpperCase()}
                title={o.source === 'stremio' ? `${t.fromStremio}${o.label ? ` · ${o.label}` : ''}` : langName(o.lang)}
                subtitle={o.source === 'stremio' ? undefined : o.label || o.source}
              />
            ))}
            {!showAll && allOptions.length > visibleOptions.length && (
              <Button label={`${t.showAll} (${allOptions.length})`} kind="ghost" small onPress={() => setShowAll(true)} />
            )}
            <TextInput
              style={styles.input}
              placeholder={t.customSub}
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={customSub}
              onChangeText={(v) => {
                setCustomSub(v)
                if (/^https?:\/\//i.test(v.trim())) setSelectedKey('custom')
              }}
            />
        </Sheet>
        <Sheet visible={sheet === 'audio'} title={t.audio} onClose={() => setSheet(null)}>
          {audioTracksForStream.map((tr) => (
            <SubtitleRow
              key={tr.number}
              active={tr.number === chosenAudio?.number}
              onPress={() => {
                pickAudio(tr.number)
                setSheet(null)
              }}
              lang={normalizeLang(tr.language) === 'und' ? '?' : normalizeLang(tr.language).toUpperCase()}
              title={audioTrackLabel(tr)}
              subtitle={tr.playable || rdAvailable ? undefined : t.audioNoSound}
            />
          ))}
        </Sheet>

        {/* ---------- full remote in a sheet; the bottom bar shows what plays ---------- */}
        <Modal visible={remoteOpen && connected && playingNow} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setRemoteOpen(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
            <View style={[styles.row, { justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 }]}>
              <Pressable accessibilityLabel={t.done} onPress={() => setRemoteOpen(false)} hitSlop={16}>
                <Text style={{ color: colors.text, fontSize: 30, lineHeight: 34 }}>⌄</Text>
              </Pressable>
              <Text style={[styles.muted, { flex: 1, textAlign: 'center' }]} numberOfLines={1}>
                {t.casting} {device?.friendlyName ?? 'TV'}
              </Text>
              <CastIcon onPress={onCastIconPress} />
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 22, paddingBottom: 60 }}>
              <View style={{ alignItems: 'center', gap: 8 }}>
                {nowPoster ? <Image source={{ uri: nowPoster }} style={{ width: 150, height: 225, borderRadius: 12 }} /> : null}
                <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' }} numberOfLines={2}>
                  {nowTitle}
                </Text>
                {isPlayingOurs && stream?.season !== undefined && stream?.episode !== undefined && (
                  <Text style={styles.muted}>
                    S{String(stream.season).padStart(2, '0')}E{String(stream.episode).padStart(2, '0')}
                    {details?.episodeTitle ? ` · ${details.episodeTitle}` : ''}
                  </Text>
                )}
              </View>

              <ProgressBar
                big
                position={position ?? mediaStatus?.streamPosition ?? 0}
                duration={mediaStatus?.mediaInfo?.streamDuration ?? 0}
                onSeek={(p) => client?.seek({ position: p })}
              />

              <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                <RoundButton label="−30" size={56} onPress={() => seekBy(-30)} />
                <RoundButton label="−10" size={64} onPress={() => seekBy(-10)} />
                <RoundButton
                  label={isPaused ? '▶' : '❚❚'}
                  size={88}
                  primary
                  onPress={() => (isPaused ? client?.play() : client?.pause())}
                />
                <RoundButton label="+10" size={64} onPress={() => seekBy(10)} />
                <RoundButton label="+30" size={56} onPress={() => seekBy(30)} />
              </View>

              <Chips
                options={[0.75, 1, 1.25, 1.5].map((r) => ({ value: r, label: `${r}×` }))}
                value={[0.75, 1, 1.25, 1.5].includes(playbackRate) ? playbackRate : 1}
                onChange={(r) => client?.setPlaybackRate(r).catch(() => {})}
                center
              />

              <View style={{ gap: 10 }}>
                {isPlayingOurs && audioTracksForStream.length > 1 && chosenAudio ? (
                  <Section
                    title={t.audio}
                    value={audioTrackLabel(chosenAudio)}
                    open={remoteSection === 'audio'}
                    onToggle={() => toggleSection('audio')}
                  >
                    <Chips
                      options={audioTracksForStream.map((tr) => ({
                        value: tr.number,
                        label: `${audioTrackLabel(tr)}${tr.playable || rdAvailable ? '' : ` · ${t.audioNoSound}`}`,
                      }))}
                      value={chosenAudio.number}
                      onChange={pickAudio}
                    />
                  </Section>
                ) : audioTracks.length > 1 && activeAudio !== undefined ? (
                  <Section
                    title={t.audio}
                    value={audioTracks.find((tr) => tr.id === activeAudio)?.name ?? ''}
                    open={remoteSection === 'audio'}
                    onToggle={() => toggleSection('audio')}
                  >
                    <Chips
                      options={audioTracks.map((tr, i) => ({
                        value: tr.id,
                        label: tr.name || (tr.language ? langName(tr.language) : `${t.audio} ${i + 1}`),
                      }))}
                      value={activeAudio}
                      onChange={chooseAudio}
                    />
                  </Section>
                ) : null}

                {isPlayingOurs && (
                  <Section
                    title={t.subtitlesTitle}
                    value={selected && subtitlesOn ? subtitleName(selected) : t.off}
                    open={remoteSection === 'subs'}
                    onToggle={() => toggleSection('subs')}
                  >
                    <Chips
                      options={[
                        { value: NONE, label: t.off },
                        ...visibleOptions.slice(0, 8).map((o) => ({ value: o.key, label: subtitleName(o) })),
                      ]}
                      value={selected && subtitlesOn ? selected.key : NONE}
                      onChange={pickSubtitle}
                    />
                    {selected && subtitlesOn && (
                      <View style={{ gap: 8 }}>
                        <Text style={styles.muted}>
                          {t.syncTitle}: {offsetMs > 0 ? '+' : ''}
                          {(offsetMs / 1000).toFixed(2)}s{offsetSaved ? ` · ${t.saved}` : ''}
                        </Text>
                        <View style={styles.row}>
                          <Button label={`◀ ${t.earlier}`} small style={{ flex: 1 }} onPress={() => nudgeSync(-SYNC_STEP_MS)} />
                          <Button label={`${t.later} ▶`} small style={{ flex: 1 }} onPress={() => nudgeSync(SYNC_STEP_MS)} />
                        </View>
                      </View>
                    )}
                  </Section>
                )}

                {nextUp.status !== 'idle' && (
                  <Section
                    title={t.upNext}
                    value={nextUp.label ?? ''}
                    open={remoteSection === 'next'}
                    onToggle={() => toggleSection('next')}
                  >
                    {nextUp.status === 'preparing' && (
                      <View style={styles.row}>
                        <ActivityIndicator color={colors.accent} size="small" />
                        <Text style={styles.muted}>{t.preparingNext}</Text>
                      </View>
                    )}
                    {nextUp.status === 'notfound' && <Text style={styles.muted}>{t.nextNotFound}</Text>}
                    {nextUp.status === 'noaddon' && <Text style={styles.muted}>{t.nextNeedsAddon}</Text>}
                    {nextUp.status === 'ready' && (
                      <Button label={t.playNow} small onPress={() => client?.queueNext()} />
                    )}
                  </Section>
                )}

                <Section
                  title={t.sleepTimer}
                  value={
                    typeof sleep === 'number' && sleepEndsAt
                      ? `${t.stopsAt} ${new Date(sleepEndsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                      : sleep === 'end'
                        ? t.stopsAfterThis
                        : t.off
                  }
                  open={remoteSection === 'sleep'}
                  onToggle={() => toggleSection('sleep')}
                >
                  <Chips<SleepMode>
                    options={[
                      { value: 'off', label: t.off },
                      { value: 'end', label: t.endOfVideo },
                      { value: 15, label: '15 min' },
                      { value: 30, label: '30 min' },
                      { value: 60, label: '60 min' },
                      { value: 90, label: '90 min' },
                    ]}
                    value={sleep}
                    onChange={chooseSleep}
                  />
                </Section>
              </View>

              <Button label={t.stopCasting} onPress={stopCasting} />
            </ScrollView>
          </SafeAreaView>
        </Modal>

        {castError && (
          <Card>
            <Text style={{ color: colors.danger }}>{castError}</Text>
          </Card>
        )}

        {!stream && (
          <Card title={t.howTo}>
            <Text style={styles.muted}>{Platform.OS === 'android' ? t.howToAndroid : t.howToIos}</Text>
          </Card>
        )}
      </ScrollView>

      {showBar && (!stream || isPlayingOurs || !playingNow) && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.openRemote}
          onPress={openRemote}
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 28,
            minHeight: 72,
            borderRadius: 18,
            backgroundColor: '#242733',
            borderWidth: 1,
            borderColor: colors.accent,
            flexDirection: 'row',
            alignItems: 'center',
            padding: 10,
            gap: 12,
          }}
        >
          {nowPoster ? <Image source={{ uri: nowPoster }} style={{ width: 40, height: 60, borderRadius: 6 }} /> : null}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
              {nowTitle}
            </Text>
            <Text style={[styles.muted, { fontSize: 12 }]} numberOfLines={1}>
              {!playingNow
                ? t.reconnecting
                : isPlayingOurs && chosenAudio
                  ? `${t.audio}: ${audioTrackLabel(chosenAudio)}`
                  : `${t.casting} ${device?.friendlyName ?? 'TV'}`}
            </Text>
            {isPlayingOurs && (
              <Text style={[styles.muted, { fontSize: 12 }]} numberOfLines={1}>
                {t.subtitlesTitle}: {selected && subtitlesOn ? subtitleName(selected) : t.off}
              </Text>
            )}
          </View>
          <Pressable
            accessibilityLabel={isPaused ? t.play : t.pause}
            onPress={() => (isPaused ? client?.play() : client?.pause())}
            hitSlop={10}
            style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>{isPaused ? '▶' : '❚❚'}</Text>
          </Pressable>
        </Pressable>
      )}

      {stream && !isPlayingOurs && !(showBar && !playingNow) && (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 28 }}>
          <Button
            label={
              reconnecting
                ? t.reconnecting
                : busy
                  ? t.loading
                  : connected
                    ? `${t.castButton} · ${device?.friendlyName ?? ''}`
                    : t.castButton
            }
            kind="primary"
            loading={busy && !reconnecting}
            disabled={stream.isLocalOnly || reconnecting}
            onPress={onCastPress}
            style={{ minHeight: 58, borderRadius: 18 }}
          />
        </View>
      )}

      <Onboarding visible={!settings.onboarded} settings={settings} onChange={update} onDone={() => update({ onboarded: true })} />
      <SettingsModal
        visible={showSettings && settings.onboarded}
        settings={settings}
        onChange={update}
        onClose={() => setShowSettings(false)}
        diagnostics={[
          `TV: ${connected ? (device?.friendlyName ?? '?') : '—'} · ${tvPlayerState ?? '—'}${tvIdleReason ? ` (${tvIdleReason})` : ''}`,
          `TV URL: ${tvContentUrl ? tvContentUrl.slice(0, 90) : '—'}`,
          `Sent: ${lastCastUrl.current?.url.slice(0, 90) ?? '—'}`,
          `Ours: ${isPlayingOurs ? 'yes' : 'no'} (url ${tvReportsOurs ? 'match' : 'no match'}, cast ${weCast && weCast === stream?.url ? 'yes' : 'no'})`,
        ].join('\n')}
      />
    </SafeAreaView>
  )
}

function SubtitleRow(props: { active: boolean; onPress: () => void; lang: string; title: string; subtitle?: string }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={[
        styles.row,
        {
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderRadius: 12,
          backgroundColor: props.active ? colors.accentDim : 'transparent',
          borderWidth: 1,
          borderColor: props.active ? colors.accent : 'transparent',
        },
      ]}
    >
      <Badge text={props.lang} tone={props.active ? 'accent' : 'default'} />
      <View style={{ flex: 1 }}>
        <Text style={styles.text} numberOfLines={1}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text style={[styles.muted, { fontSize: 12 }]} numberOfLines={1}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.active && <Text style={{ color: colors.accent, fontSize: 18 }}>✓</Text>}
    </Pressable>
  )
}

function VideoInfo({ stream, details }: { stream: StreamInfo; details: MediaDetails | null }) {
  const episodeCode =
    stream.season !== undefined
      ? `S${String(stream.season).padStart(2, '0')}E${String(stream.episode ?? 0).padStart(2, '0')}`
      : undefined
  const facts = [
    details?.year ?? (stream.year ? String(stream.year) : undefined),
    formatRuntime(details?.runtimeMinutes),
    ...(details?.genres ?? []).slice(0, 2),
  ].filter(Boolean)

  return (
    <View style={{ gap: 10 }}>
      {details?.image ? (
        <Image
          source={{ uri: details.image }}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#11131A' }}
        />
      ) : null}
      <View style={{ gap: 4 }}>
        <Text style={[styles.text, { fontSize: 19, fontWeight: '700' }]}>{details?.name ?? stream.title}</Text>
        {episodeCode ? (
          <Text style={[styles.text, { color: colors.muted }]}>
            {episodeCode}
            {details?.episodeTitle ? ` · ${details.episodeTitle}` : ''}
          </Text>
        ) : null}
        <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
          {details?.rating ? (
            <View style={styles.imdb}>
              <Text style={styles.imdbText}>IMDb</Text>
              <Text style={[styles.text, { fontSize: 14, fontWeight: '700' }]}>★ {details.rating.toFixed(1)}</Text>
            </View>
          ) : null}
          {facts.length > 0 && <Text style={styles.muted}>{facts.join(' · ')}</Text>}
        </View>
      </View>
      {details?.description ? (
        <Text style={styles.muted} numberOfLines={3}>
          {details.description}
        </Text>
      ) : null}
      <Text style={[styles.muted, { fontSize: 12 }]} numberOfLines={1}>
        {stream.filename}
      </Text>
      {stream.isLocalOnly && <Text style={{ color: colors.warn }}>{t.localOnly}</Text>}
    </View>
  )
}

/** Tap anywhere on the bar to jump there. */
function ProgressBar({ position, duration, onSeek, big }: { position: number; duration: number; onSeek: (p: number) => void; big?: boolean }) {
  const bar = big ? 10 : 6
  const knob = big ? 24 : 16
  const [width, setWidth] = useState(0)
  // While dragging, show where you are going; seek once on release.
  const [dragPos, setDragPos] = useState<number | null>(null)
  const shown = dragPos ?? position
  const progress = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0
  const toPos = (x: number) => (width > 0 ? Math.min(1, Math.max(0, x / width)) * duration : 0)
  return (
    <View style={{ gap: 6 }}>
      {/* The whole 48-pt high strip reacts, not just the thin bar; children don't take touches,
          so locationX is always measured from the strip's left edge. */}
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => duration > 0}
        onMoveShouldSetResponder={() => duration > 0}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => setDragPos(toPos(e.nativeEvent.locationX))}
        onResponderMove={(e) => setDragPos(toPos(e.nativeEvent.locationX))}
        onResponderRelease={(e) => {
          onSeek(toPos(e.nativeEvent.locationX))
          setDragPos(null)
        }}
        onResponderTerminate={() => setDragPos(null)}
        style={{ height: 48, justifyContent: 'center' }}
      >
        <View pointerEvents="none" style={{ height: bar, borderRadius: bar / 2, backgroundColor: '#2C303C' }}>
          <View style={{ width: `${progress * 100}%`, height: bar, borderRadius: bar / 2, backgroundColor: colors.accent }} />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: Math.max(0, Math.min(width - knob, progress * width - knob / 2)),
            width: dragPos != null ? knob + 6 : knob,
            height: dragPos != null ? knob + 6 : knob,
            borderRadius: (knob + 6) / 2,
            backgroundColor: colors.text,
          }}
        />
      </View>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={[styles.muted, { fontSize: big ? 15 : 12 }]}>{formatClock(shown)}</Text>
        {duration > 0 && (
          <Text style={[styles.muted, { fontSize: big ? 15 : 12 }]}>
            −{formatClock(duration - shown)}
          </Text>
        )}
      </View>
    </View>
  )
}

/** The Cast icon (shows connecting/connected state) with our own tap action instead of the SDK's sheet. */
function CastIcon({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Cast" onPress={onPress} hitSlop={12}>
      <View pointerEvents="none">
        <CastButton style={{ width: ICON_SIZE, height: ICON_SIZE, tintColor: colors.text }} />
      </View>
    </Pressable>
  )
}

/** A tappable line: icon, name, current value, chevron. Opens a menu. */
function OptionRow({ title, value, onPress, loading }: { title: string; value: string; onPress: () => void; loading?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { padding: 12, borderRadius: 12, backgroundColor: '#242733', gap: 10, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={{ color: colors.text, fontWeight: '600' }}>{title}</Text>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
        {loading && <ActivityIndicator color={colors.accent} size="small" />}
        <Text style={[styles.muted, { flexShrink: 1, textAlign: 'right' }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Text style={[styles.muted, { fontSize: 18 }]}>›</Text>
    </Pressable>
  )
}

/** A line that unfolds its options in place (used inside the remote). */
function Section(props: { title: string; value: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <View style={{ borderRadius: 12, backgroundColor: '#1B1E27', overflow: 'hidden' }}>
      <Pressable accessibilityRole="button" onPress={props.onToggle} style={[styles.row, { padding: 14, gap: 10 }]}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{props.title}</Text>
        <Text style={[styles.muted, { flex: 1, textAlign: 'right' }]} numberOfLines={1}>
          {props.value}
        </Text>
        <Text style={[styles.muted, { fontSize: 16 }]}>{props.open ? '⌃' : '⌄'}</Text>
      </Pressable>
      {props.open && <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 12 }}>{props.children}</View>}
    </View>
  )
}

/** A menu sliding up from the bottom. */
function Sheet(props: { visible: boolean; title: string; onClose: () => void; right?: ReactNode; children: ReactNode }) {
  return (
    <Modal visible={props.visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={[styles.row, { justifyContent: 'space-between', padding: 16 }]}>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>{props.title}</Text>
          <View style={styles.row}>
            {props.right}
            <Button label={t.done} kind="ghost" small onPress={props.onClose} />
          </View>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }} keyboardShouldPersistTaps="handled">
          {props.children}
        </ScrollView>
      </View>
    </Modal>
  )
}

function RoundButton({ label, onPress, size, primary }: { label: string; onPress: () => void; size: number; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: primary ? colors.accent : '#242733',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: colors.text, fontSize: primary ? 30 : 17, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  )
}
