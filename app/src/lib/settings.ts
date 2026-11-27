import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { useCallback, useEffect, useState } from 'react'
import { normalizeLook, STANDARD_LOOK, type SubtitleBackground, type SubtitleColor, type SubtitleEdge, type SubtitleFont, type SubtitleLook } from './cast'
import { withEnglishFirst } from './languages'
import type { RdAuth } from './realDebrid'
import { OPENSUBTITLES_ADDON } from './subtitles'

export type Settings = {
  /** Subtitle languages in order of preference, 2-letter keys. English is always first. */
  languages: string[]
  /** UI language (see APP_LANGUAGES in i18n). */
  appLanguage: string
  /** Stremio subtitle add-on URLs (manifest or base). */
  addons: string[]
  relayUrl: string
  /** Chromecast subtitle size, 1 = receiver default. */
  fontScale: number
  subtitleColor: SubtitleColor
  subtitleEdge: SubtitleEdge
  subtitleBackground: SubtitleBackground
  subtitleFont: SubtitleFont
  autoSearch: boolean
  /** Stremio stream add-ons (e.g. Torrentio with debrid), for the next episode. */
  streamAddons: string[]
  autoNext: boolean
  /** Last spoken language picked from a file's audio tracks (2-letter key); '' = what the file plays by default. */
  audioLanguage: string
  /** The introduction (first-run setup) has been seen. */
  onboarded: boolean
  /** A linked Real-Debrid account (device-code flow). Not needed when streams come from Torrentio with RD. */
  rdAuth: RdAuth | null
}

const KEY = 'stremcastio.settings.v1'


export function defaultSettings(): Settings {
  const extra = (Constants.expoConfig?.extra ?? {}) as { relayUrl?: string }
  return {
    languages: ['en'],
    appLanguage: 'en',
    addons: [OPENSUBTITLES_ADDON],
    relayUrl: extra.relayUrl ?? '',
    fontScale: STANDARD_LOOK.fontScale,
    subtitleColor: STANDARD_LOOK.color,
    subtitleEdge: STANDARD_LOOK.edge,
    subtitleBackground: STANDARD_LOOK.background,
    subtitleFont: STANDARD_LOOK.font,
    autoSearch: true,
    streamAddons: [],
    autoNext: true,
    audioLanguage: '',
    onboarded: false,
    rdAuth: null,
  }
}

export async function loadSettings(): Promise<Settings> {
  const defaults = defaultSettings()
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return defaults
    const saved = JSON.parse(raw) as Partial<Settings>
    return {
      ...defaults,
      ...saved,
      // An empty relay in storage falls back to the build-time default.
      relayUrl: saved.relayUrl || defaults.relayUrl,
      addons: saved.addons?.length ? saved.addons : defaults.addons,
      languages: withEnglishFirst(saved.languages ?? []),
      ...lookToSettings(
        normalizeLook({
          fontScale: saved.fontScale,
          color: saved.subtitleColor,
          edge: saved.subtitleEdge,
          background: saved.subtitleBackground,
          font: saved.subtitleFont,
        }),
      ),
    }
  } catch {
    return defaults
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    loadSettings().then(setSettings)
  }, [])

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...(prev ?? defaultSettings()), ...patch }
      next.languages = withEnglishFirst(next.languages)
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [])

  return { settings, update }
}

export function lookFromSettings(s: Settings): SubtitleLook {
  return { fontScale: s.fontScale, color: s.subtitleColor, edge: s.subtitleEdge, background: s.subtitleBackground, font: s.subtitleFont }
}

export function lookToSettings(l: SubtitleLook): Pick<Settings, 'fontScale' | 'subtitleColor' | 'subtitleEdge' | 'subtitleBackground' | 'subtitleFont'> {
  return { fontScale: l.fontScale, subtitleColor: l.color, subtitleEdge: l.edge, subtitleBackground: l.background, subtitleFont: l.font }
}
