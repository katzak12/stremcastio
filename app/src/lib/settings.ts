import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { useCallback, useEffect, useState } from 'react'
import { withEnglishFirst } from './languages'
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
  autoSearch: boolean
}

const KEY = 'stremcastio.settings.v1'


export function defaultSettings(): Settings {
  const extra = (Constants.expoConfig?.extra ?? {}) as { relayUrl?: string }
  return {
    languages: ['en'],
    appLanguage: 'en',
    addons: [OPENSUBTITLES_ADDON],
    relayUrl: extra.relayUrl ?? '',
    fontScale: 1.2,
    autoSearch: true,
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
