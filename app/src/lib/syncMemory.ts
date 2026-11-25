// Remembers the subtitle sync offset per video + subtitle file, so a fix you made once sticks.

import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'stremcastio.sync.v1'
const MAX_ENTRIES = 300

type Store = Record<string, { ms: number; at: number }>

let cache: Store | null = null

async function load(): Promise<Store> {
  if (cache) return cache
  try {
    cache = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}') as Store
  } catch {
    cache = {}
  }
  return cache
}

export function syncKey(videoId: string, subtitleUrl: string): string {
  return `${videoId}|${subtitleUrl}`
}

export async function getSyncOffset(key: string): Promise<number | null> {
  const store = await load()
  return store[key]?.ms ?? null
}

export async function saveSyncOffset(key: string, ms: number): Promise<void> {
  const store = await load()
  if (ms === 0) delete store[key]
  else store[key] = { ms, at: Date.now() }
  const keys = Object.keys(store)
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => store[a].at - store[b].at)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete store[k])
  }
  AsyncStorage.setItem(KEY, JSON.stringify(store)).catch(() => {})
}
