import * as Clipboard from 'expo-clipboard'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import GoogleCast, {
  CastButton,
  CastState,
  MediaPlayerState,
  useCastDevice,
  useCastState,
  useMediaStatus,
  useRemoteMediaClient,
} from 'react-native-google-cast'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { SettingsModal } from './components/SettingsModal'
import { Badge, Button, Card, colors, styles } from './components/ui'
import { activateSubtitles, buildLoadRequest } from './lib/cast'
import { t } from './lib/i18n'
import { useIncoming, type Incoming } from './lib/incoming'
import { langName } from './lib/languages'
import { isRemote, relayVttUrl, uploadLocalSubtitle } from './lib/relay'
import { useSettings } from './lib/settings'
import { describeStream, extractUrl, type StreamInfo } from './lib/stream'
import { rankSubtitles, searchSubtitles, type SubtitleOption } from './lib/subtitles'

type SearchState = { status: 'idle' | 'searching' | 'done'; message?: string }

const NONE = 'none'
const SYNC_STEP_MS = 250

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  )
}

function Main() {
  const { settings, update } = useSettings()
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

  const castState = useCastState()
  const client = useRemoteMediaClient()
  const device = useCastDevice()
  const mediaStatus = useMediaStatus()
  const connected = castState === CastState.CONNECTED && client != null
  const isPlayingOurs = !!mediaStatus?.mediaInfo && mediaStatus.mediaInfo.contentUrl === stream?.url

  // ---------- incoming streams ----------

  const acceptStream = useCallback((url: string, subs: SubtitleOption[] = [], title?: string) => {
    const info = describeStream(url)
    setStream(title && !info.season ? { ...info, title } : info)
    setIncomingSubs(subs)
    setFound([])
    setSearch({ status: 'idle' })
    setSelectedKey(subs[0]?.key ?? NONE)
    setOffsetMs(0)
    setCastError(null)
    setLinkInput('')
  }, [])

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
      const res = await searchSubtitles({ release: stream, filename: stream.filename, addons: settings.addons })
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
  }, [stream, settings])

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

  // ---------- casting ----------

  const resolveVtt = useCallback(
    async (sub: SubtitleOption | null, offset: number): Promise<string | null> => {
      if (!sub || !settings) return null
      if (!settings.relayUrl) throw new Error(t.noRelay)
      return isRemote(sub.url) ? relayVttUrl(settings.relayUrl, sub.url, offset) : uploadLocalSubtitle(settings.relayUrl, sub.url, offset)
    },
    [settings],
  )

  const loadOnTv = useCallback(
    async (startTime = 0, offset = offsetMs) => {
      if (!client || !stream || !settings) return
      setBusy(true)
      setCastError(null)
      try {
        const vttUrl = await resolveVtt(selected, offset)
        const request = buildLoadRequest({
          stream,
          vttUrl,
          subtitleLang: selected?.lang,
          subtitleName: selected ? langName(selected.lang) : undefined,
          fontScale: settings.fontScale,
          startTime,
        })
        await client.loadMedia(request)
        await activateSubtitles(client, vttUrl != null)
      } catch (e) {
        setCastError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [client, stream, settings, selected, offsetMs, resolveVtt],
  )

  const onCastPress = async () => {
    if (connected) return loadOnTv(0)
    setPendingCast(true)
    try {
      await GoogleCast.showCastDialog()
    } catch {
      setPendingCast(false)
    }
  }

  // Continue once the user has picked a TV in the dialog.
  useEffect(() => {
    if (pendingCast && connected) {
      setPendingCast(false)
      loadOnTv(0)
    }
  }, [pendingCast, connected, loadOnTv])

  // Subtitle sync: reload at the current position with a shifted subtitle (debounced).
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nudgeSync = (delta: number) => {
    const next = offsetMs + delta
    setOffsetMs(next)
    if (!client || !isPlayingOurs || !selected) return
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(async () => {
      const position = (await client.getStreamPosition()) ?? 0
      loadOnTv(position, next)
    }, 1200)
  }

  const playerState = mediaStatus?.playerState
  const isPaused = playerState === MediaPlayerState.PAUSED

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
          <CastButton style={{ width: 32, height: 32, tintColor: colors.text }} />
          <Pressable accessibilityLabel={t.settings} onPress={() => setShowSettings(true)} hitSlop={12}>
            <Text style={{ color: colors.text, fontSize: 24 }}>⚙︎</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        {/* ---------- video ---------- */}
        <Card title={t.videoTitle}>
          {stream ? (
            <View style={{ gap: 6 }}>
              <Text style={[styles.text, { fontSize: 19, fontWeight: '700' }]}>
                {stream.title}
                {stream.year ? ` (${stream.year})` : ''}
                {stream.season !== undefined
                  ? `  S${String(stream.season).padStart(2, '0')}E${String(stream.episode ?? 0).padStart(2, '0')}`
                  : ''}
              </Text>
              <Text style={styles.muted} numberOfLines={2}>
                {stream.filename}
              </Text>
              {stream.isLocalOnly && <Text style={{ color: colors.warn }}>{t.localOnly}</Text>}
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

        {/* ---------- now playing ---------- */}
        {stream && connected && isPlayingOurs && (
          <Card title={`${t.casting} ${device?.friendlyName ?? 'TV'}`}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Button label="−10s" onPress={() => client?.seek({ position: -10, relative: true })} />
              <Button
                label={isPaused ? `▶ ${t.play}` : `❚❚ ${t.pause}`}
                kind="primary"
                style={{ flex: 1 }}
                onPress={() => (isPaused ? client?.play() : client?.pause())}
              />
              <Button label="+10s" onPress={() => client?.seek({ position: 10, relative: true })} />
            </View>
            {selected && (
              <View style={{ gap: 8 }}>
                <Text style={styles.muted}>
                  {t.syncTitle}: {offsetMs > 0 ? '+' : ''}
                  {(offsetMs / 1000).toFixed(2)}s
                </Text>
                <View style={styles.row}>
                  <Button label={`◀ ${t.earlier}`} small style={{ flex: 1 }} onPress={() => nudgeSync(-SYNC_STEP_MS)} />
                  <Button label={`${t.later} ▶`} small style={{ flex: 1 }} onPress={() => nudgeSync(SYNC_STEP_MS)} />
                </View>
              </View>
            )}
            <View style={styles.row}>
              <Button label={t.bigControls} small style={{ flex: 1 }} onPress={() => GoogleCast.showExpandedControls()} />
              <Button label={t.stop} small style={{ flex: 1 }} onPress={() => client?.stop()} />
            </View>
          </Card>
        )}

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
            label={busy ? t.loading : connected ? `${t.castButton} · ${device?.friendlyName ?? ''}` : t.castButton}
            kind="primary"
            loading={busy}
            disabled={stream.isLocalOnly}
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
