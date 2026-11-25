// "Continue watching": remembers how far you got per video, so casting it again can pick up there.

import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'stremcastio.resume.v1'
const MAX_ENTRIES = 200

type Entry = { pos: number; dur: number; at: number }
type Store = Record<string, Entry>

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

/** Worth asking? Not for the first minute, and not once (nearly) finished. */
export function shouldOfferResume(pos: number, dur: number): boolean {
  if (!(pos >= 60)) return false
  if (dur > 0 && pos >= dur * 0.95) return false
  return true
}

export async function getResume(key: string): Promise<Entry | null> {
  const e = (await load())[key]
  return e && shouldOfferResume(e.pos, e.dur) ? e : null
}

export async function saveResume(key: string, pos: number, dur: number): Promise<void> {
  const store = await load()
  if (dur > 0 && pos >= dur * 0.95) delete store[key]
  else if (pos >= 1) store[key] = { pos, dur, at: Date.now() }
  else return
  const keys = Object.keys(store)
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => store[a].at - store[b].at)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete store[k])
  }
  AsyncStorage.setItem(KEY, JSON.stringify(store)).catch(() => {})
}

export async function clearResume(key: string): Promise<void> {
  const store = await load()
  if (!(key in store)) return
  delete store[key]
  AsyncStorage.setItem(KEY, JSON.stringify(store)).catch(() => {})
}
