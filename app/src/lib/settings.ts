import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { getLocales } from 'expo-localization'
import { useCallback, useEffect, useState } from 'react'
import { normalizeLang } from './languages'
import { OPENSUBTITLES_ADDON } from './subtitles'

export type Settings = {
  /** Subtitle languages in order of preference, 2-letter keys. */
  languages: string[]
  /** Stremio subtitle add-on URLs (manifest or base). */
  addons: string[]
  relayUrl: string
  /** Chromecast subtitle size, 1 = receiver default. */
  fontScale: number
  autoSearch: boolean
}

const KEY = 'stremcastio.settings.v1'

function defaultLanguages(): string[] {
  const langs = getLocales()
    .map((l) => normalizeLang(l.languageCode))
    .filter((l) => l !== 'und')
  return [...new Set([...langs, 'en'])].slice(0, 3)
}

export function defaultSettings(): Settings {
  const extra = (Constants.expoConfig?.extra ?? {}) as { relayUrl?: string }
  return {
    languages: defaultLanguages(),
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
      languages: saved.languages?.length ? saved.languages : defaults.languages,
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
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [])

  return { settings, update }
}
