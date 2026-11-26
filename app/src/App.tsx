import * as Clipboard from 'expo-clipboard'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import GoogleCast, {
  CastButton,
  CastState,
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
import { SettingsModal } from './components/SettingsModal'
import { Badge, Button, Card, Chips, colors, styles } from './components/ui'
import { audioTrackLabel, chooseAudioTrack, fetchAudioTracks, type FileAudioTrack } from './lib/audioTracks'
import { activateSubtitles, buildLoadRequest, sleepPlaybackDuration, STANDARD_LOOK, SUBTITLE_TRACK_ID, textStyle, type SleepMode, type SubtitleLook } from './lib/cast'
import { getRememberedDevice, loadWithRetry, pingTv, rememberDevice } from './lib/castConnect'
import { setAppLanguage, t } from './lib/i18n'
import { useIncoming, type Incoming } from './lib/incoming'
import { langName, normalizeLang } from './lib/languages'
import { fetchDetails, formatClock, formatRuntime, type MediaDetails } from './lib/meta'
import { isRemote, relayVttUrl, uploadLocalSubtitle } from './lib/relay'
import { addonFromStreamUrl, findEpisodeStream, findPlayableAudioStream, unsupportedAudio } from './lib/streams'
import { clearResume, getResume, saveResume } from './lib/resume'
import { getSyncOffset, saveSyncOffset, syncKey } from './lib/syncMemory'
import { lookFromSettings, useSettings } from './lib/settings'
import { describeStream, extractUrl, type StreamInfo } from './lib/stream'
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

  // Audio tracks inside the file (MKV), read via the relay. The chosen track decides what we cast.
  const [fileAudio, setFileAudio] = useState<{ url: string; loading: boolean; tracks: FileAudioTrack[] }>({ url: '', loading: false, tracks: [] })
  const [audioPick, setAudioPick] = useState<number | null>(null)
  const audioTracksForStream = stream && fileAudio.url === stream.url ? fileAudio.tracks : []
  const chosenAudio =
    audioTracksForStream.find((tr) => tr.number === audioPick) ?? chooseAudioTrack(audioTracksForStream, settings?.audioLanguage)
  const castUrl = chosenAudio?.url ?? stream?.url
  const tvContentUrl = mediaStatus?.mediaInfo?.contentUrl
  const isPlayingOurs =
    !!tvContentUrl && !!stream && (tvContentUrl === stream.url || audioTracksForStream.some((tr) => tr.url === tvContentUrl))
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
    preparedFor.current = null
  }, [])

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

  const loadOnTv = useCallback(
    async (startTime = 0, offset = offsetMs, sleepState: { mode: SleepMode; endsAt: number | null } = { mode: sleep, endsAt: sleepEndsAt }) => {
      if (!client || !stream || !settings || !look) return
      setBusy(true)
      setCastError(null)
      try {
        const vttUrl = await resolveVtt(selected, offset)
        const request = buildLoadRequest({
          stream: castUrl && castUrl !== stream.url ? { ...stream, url: castUrl } : stream,
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
        await loadWithRetry(client, request)
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
      startCasting()
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
  const badAudio = !stream || audioPending
    ? null
    : audioTracksForStream.length
      ? chosenAudio && !chosenAudio.playable
        ? (chosenAudio.codec.match(/TRUEHD|DTS/i)?.[0] ?? chosenAudio.codec)
        : null
      : unsupportedAudio(stream.filename)

  // Picking another audio track while it plays: cast again at the same position.
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
  }, [castUrl, client, loadOnTv])

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
  const tvUrl = mediaStatus?.mediaInfo?.contentUrl
  useEffect(() => {
    if (nextUp.status !== 'ready' || tvUrl !== nextUp.url) return
    for (const key of resumeKeys) clearResume(key)
    setStream(nextUp.stream)
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
  const activeIds = mediaStatus?.activeTrackIds ?? []
  const activeAudio = audioTracks.find((tr) => activeIds.includes(tr.id))?.id ?? audioTracks[0]?.id
  const chooseAudio = (id: number) => {
    const audioIds = new Set(audioTracks.map((tr) => tr.id))
    client?.setActiveTrackIds([id, ...activeIds.filter((x) => !audioIds.has(x))]).catch(() => {})
  }

  const playerState = mediaStatus?.playerState
  const isPaused = playerState === MediaPlayerState.PAUSED

  // ---------- remote control (full screen while casting) ----------

  const [remoteOpen, setRemoteOpen] = useState(false)
  const playingNow = !!stream && connected && isPlayingOurs
  const autoOpenedFor = useRef<string | null>(null)
  useEffect(() => {
    // Open the remote once per video, as soon as it starts on the TV.
    if (playingNow && stream && autoOpenedFor.current !== stream.url) {
      autoOpenedFor.current = stream.url
      setRemoteOpen(true)
    }
    // Close it when playback has really ended (not during a quick reload for sync or audio).
    if (playingNow) return
    const timer = setTimeout(() => setRemoteOpen(false), 5000)
    return () => clearTimeout(timer)
  }, [playingNow, stream])

  const subtitlesOn = activeIds.includes(SUBTITLE_TRACK_ID)
  const toggleSubtitles = () => {
    const others = activeIds.filter((x) => x !== SUBTITLE_TRACK_ID)
    client?.setActiveTrackIds(subtitlesOn ? others : [SUBTITLE_TRACK_ID, ...others]).catch(() => {})
  }
  const playbackRate = mediaStatus?.playbackRate ?? 1
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
          <CastButton style={{ width: ICON_SIZE, height: ICON_SIZE, tintColor: colors.text }} />
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
              {fileAudio.loading && fileAudio.url === stream.url && (
                <View style={styles.row}>
                  <ActivityIndicator color={colors.accent} size="small" />
                  <Text style={styles.muted}>{t.audioLoading}</Text>
                </View>
              )}
              {audioTracksForStream.length > 1 && chosenAudio && (
                <View style={{ gap: 8 }}>
                  <Text style={styles.muted}>{t.audio}</Text>
                  <Chips
                    options={audioTracksForStream.map((tr) => ({
                      value: tr.number,
                      label: `${audioTrackLabel(tr)}${tr.playable ? '' : ` · ${t.audioNoSound}`}`,
                    }))}
                    value={chosenAudio.number}
                    onChange={pickAudio}
                  />
                </View>
              )}
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
        </Card>

        {/* ---------- subtitles ---------- */}
        {stream && (
          <Card
            title={t.subtitlesTitle}
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
              onPress={() => setSelectedKey(NONE)}
              lang="—"
              title={t.noSubtitle}
            />
            {visibleOptions.map((o) => (
              <SubtitleRow
                key={o.key}
                active={o.key === selectedKey}
                onPress={() => setSelectedKey(o.key)}
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
          </Card>
        )}

        {/* ---------- now playing: compact here, full remote in a sheet ---------- */}
        {playingNow && (
          <Card title={`${t.casting} ${device?.friendlyName ?? 'TV'}`}>
            <View style={styles.row}>
              <Button
                label={isPaused ? '▶' : '❚❚'}
                kind="primary"
                onPress={() => (isPaused ? client?.play() : client?.pause())}
              />
              <Button label={`🎛  ${t.openRemote}`} style={{ flex: 1 }} onPress={() => setRemoteOpen(true)} />
            </View>
          </Card>
        )}

        <Modal visible={remoteOpen && !!stream && connected} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setRemoteOpen(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
            <View style={[styles.row, { justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 }]}>
              <Pressable accessibilityLabel={t.done} onPress={() => setRemoteOpen(false)} hitSlop={16}>
                <Text style={{ color: colors.text, fontSize: 30, lineHeight: 34 }}>⌄</Text>
              </Pressable>
              <Text style={[styles.muted, { flex: 1, textAlign: 'center' }]} numberOfLines={1}>
                {t.casting} {device?.friendlyName ?? 'TV'}
              </Text>
              <CastButton style={{ width: ICON_SIZE, height: ICON_SIZE, tintColor: colors.text }} />
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 22, paddingBottom: 60 }}>
              <View style={{ alignItems: 'center', gap: 8 }}>
                {details?.poster ? (
                  <Image source={{ uri: details.poster }} style={{ width: 150, height: 225, borderRadius: 12 }} />
                ) : null}
                <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' }} numberOfLines={2}>
                  {details?.name ?? stream?.title}
                </Text>
                {stream?.season !== undefined && stream?.episode !== undefined && (
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

              <VolumeControl big />

              {selected && (
                <View style={{ gap: 8 }}>
                  <Text style={styles.muted}>{t.subtitlesTitle}</Text>
                  <Chips
                    options={[
                      { value: 'on', label: t.on },
                      { value: 'off', label: t.off },
                    ]}
                    value={subtitlesOn ? 'on' : 'off'}
                    onChange={(v) => (v === 'on') !== subtitlesOn && toggleSubtitles()}
                  />
                </View>
              )}
              {selected && (
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
              {audioTracks.length > 1 && activeAudio !== undefined && (
                <View style={{ gap: 8 }}>
                  <Text style={styles.muted}>{t.audio}</Text>
                  <Chips
                    options={audioTracks.map((tr, i) => ({
                      value: tr.id,
                      label: tr.name || (tr.language ? langName(tr.language) : `${t.audio} ${i + 1}`),
                    }))}
                    value={activeAudio}
                    onChange={chooseAudio}
                  />
                </View>
              )}
              <View style={{ gap: 8 }}>
                <Text style={styles.muted}>
                  {t.sleepTimer}
                  {typeof sleep === 'number' && sleepEndsAt
                    ? ` · ${t.stopsAt} ${new Date(sleepEndsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : sleep === 'end'
                      ? ` · ${t.stopsAfterThis}`
                      : ''}
                </Text>
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
              </View>
              {nextUp.status !== 'idle' && (
                <View style={[styles.selectRow, { gap: 6 }]}>
                  <Text style={styles.cardTitle}>{t.upNext}</Text>
                  {nextUp.label ? <Text style={styles.text}>{nextUp.label}</Text> : null}
                  {nextUp.status === 'preparing' && (
                    <View style={styles.row}>
                      <ActivityIndicator color={colors.accent} size="small" />
                      <Text style={styles.muted}>{t.preparingNext}</Text>
                    </View>
                  )}
                  {nextUp.status === 'notfound' && <Text style={styles.muted}>{t.nextNotFound}</Text>}
                  {nextUp.status === 'noaddon' && <Text style={styles.muted}>{t.nextNeedsAddon}</Text>}
                  {nextUp.status === 'ready' && (
                    <Button label={`⏭ ${t.playNow}`} small onPress={() => client?.queueNext()} />
                  )}
                </View>
              )}
              {audioTracksForStream.length > 1 && chosenAudio && (
                <View style={{ gap: 8 }}>
                  <Text style={styles.muted}>{t.audio}</Text>
                  <Chips
                    options={audioTracksForStream.map((tr) => ({
                      value: tr.number,
                      label: `${audioTrackLabel(tr)}${tr.playable ? '' : ` · ${t.audioNoSound}`}`,
                    }))}
                    value={chosenAudio.number}
                    onChange={pickAudio}
                  />
                </View>
              )}

              <View style={{ gap: 8 }}>
                <Text style={styles.muted}>{t.speed}</Text>
                <Chips
                  options={[0.75, 1, 1.25, 1.5].map((r) => ({ value: r, label: `${r}×` }))}
                  value={[0.75, 1, 1.25, 1.5].includes(playbackRate) ? playbackRate : 1}
                  onChange={(r) => client?.setPlaybackRate(r).catch(() => {})}
                />
              </View>

              <Button label={`■  ${t.stop}`} onPress={() => client?.stop()} />
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

      {stream && !(connected && isPlayingOurs) && (
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

      <SettingsModal visible={showSettings} settings={settings} onChange={update} onClose={() => setShowSettings(false)} />
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
  const knob = big ? 22 : 14
  const [width, setWidth] = useState(0)
  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0
  return (
    <View style={{ gap: 6 }}>
      <Pressable
        disabled={duration <= 0}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onPress={(e) => width > 0 && onSeek((e.nativeEvent.locationX / width) * duration)}
        hitSlop={{ top: 14, bottom: 14 }}
        style={{ height: bar, borderRadius: bar / 2, backgroundColor: '#2C303C', justifyContent: 'center' }}
      >
        <View pointerEvents="none" style={{ width: `${progress * 100}%`, height: bar, borderRadius: bar / 2, backgroundColor: colors.accent }} />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: Math.max(0, progress * width - knob / 2),
            width: knob,
            height: knob,
            borderRadius: knob / 2,
            backgroundColor: colors.text,
          }}
        />
      </Pressable>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={[styles.muted, { fontSize: big ? 15 : 12 }]}>{formatClock(position)}</Text>
        {duration > 0 && (
          <Text style={[styles.muted, { fontSize: big ? 15 : 12 }]}>
            −{formatClock(duration - position)} {t.left}
          </Text>
        )}
      </View>
    </View>
  )
}

/** Chromecast volume: drag or tap the bar, use − / +, or tap the speaker to mute. */
function VolumeControl({ big }: { big?: boolean }) {
  const session = useCastSession()
  const [volume, setVolume] = useState<number | null>(null)
  const [muted, setMuted] = useState(false)
  const [width, setWidth] = useState(0)
  const lastSent = useRef(0)
  const dragging = useRef(false)

  // Follow changes made elsewhere (TV remote, other phones).
  useEffect(() => {
    if (!session) return
    let alive = true
    const poll = () => {
      session
        .getVolume()
        .then((v) => alive && !dragging.current && setVolume(v))
        .catch(() => {})
      session
        .isMute()
        .then((m) => alive && setMuted(m))
        .catch(() => {})
    }
    poll()
    const timer = setInterval(poll, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [session])

  if (!session || volume == null) return null

  const send = (v: number, force = false) => {
    const clamped = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100
    setVolume(clamped)
    if (muted && clamped > 0) {
      session.setMute(false)
      setMuted(false)
    }
    if (force || Date.now() - lastSent.current > 120) {
      lastSent.current = Date.now()
      session.setVolume(clamped)
    }
  }
  const toggleMute = () => {
    session.setMute(!muted)
    setMuted(!muted)
  }
  const fromX = (x: number) => (width > 0 ? x / width : volume)
  const silent = muted || volume === 0
  const bar = big ? 12 : 6
  const knob = big ? 28 : 18

  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.muted, silent && { color: colors.warn }]}>
        {t.volume} · {muted ? t.muted : `${Math.round(volume * 100)}%`}
      </Text>
      <View style={[styles.row, { alignItems: 'center' }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={muted ? t.unmute : t.mute}
          onPress={toggleMute}
          hitSlop={10}
          style={{
            width: big ? 52 : 40,
            height: big ? 52 : 40,
            borderRadius: 999,
            backgroundColor: silent ? colors.warn : '#242733',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: big ? 24 : 18 }}>{silent ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}</Text>
        </Pressable>
        {big && <Button label="−" onPress={() => send(volume - 0.05, true)} />}
        <View
          style={{ flex: 1, height: big ? 52 : 32, justifyContent: 'center' }}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => {
            dragging.current = true
            send(fromX(e.nativeEvent.locationX))
          }}
          onResponderMove={(e) => send(fromX(e.nativeEvent.locationX))}
          onResponderRelease={(e) => {
            send(fromX(e.nativeEvent.locationX), true)
            dragging.current = false
          }}
          onResponderTerminate={() => {
            dragging.current = false
          }}
        >
          <View pointerEvents="none" style={{ height: bar, borderRadius: bar / 2, backgroundColor: '#2C303C' }}>
            <View
              style={{
                width: `${volume * 100}%`,
                height: bar,
                borderRadius: bar / 2,
                backgroundColor: muted ? colors.muted : colors.accent,
              }}
            />
          </View>
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: Math.max(0, volume * width - knob / 2),
              width: knob,
              height: knob,
              borderRadius: knob / 2,
              backgroundColor: colors.text,
            }}
          />
        </View>
        {big && <Button label="+" onPress={() => send(volume + 0.05, true)} />}
      </View>
    </View>
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
