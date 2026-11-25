// Making "Cast to TV" work on the first tap.

import AsyncStorage from '@react-native-async-storage/async-storage'
import type { MediaLoadRequest, RemoteMediaClient } from 'react-native-google-cast'

const DEVICE_KEY = 'stremcastio.lastDevice.v1'

export async function rememberDevice(deviceId: string): Promise<void> {
  await AsyncStorage.setItem(DEVICE_KEY, deviceId).catch(() => {})
}

export async function getRememberedDevice(): Promise<string | null> {
  return AsyncStorage.getItem(DEVICE_KEY).catch(() => null)
}

export function withTimeout<T>(promise: Promise<T>, ms: number, what = 'TV'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not respond`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/**
 * Is the existing connection still alive? A session the app "remembers" can be dead without the SDK
 * noticing (TV went to standby, another phone cast, app was in the background): then requests just hang.
 * 'timeout' = dead; 'ok'/'error' = the TV answered (an error can simply mean nothing is playing yet).
 */
export async function pingTv(client: Pick<RemoteMediaClient, 'requestStatus'>, ms = 3000): Promise<'ok' | 'error' | 'timeout'> {
  try {
    await withTimeout(client.requestStatus(), ms)
    return 'ok'
  } catch (e) {
    return e instanceof Error && /did not respond/.test(e.message) ? 'timeout' : 'error'
  }
}

/**
 * Right after connecting, the TV is still starting its media player, and the first load often fails
 * or is dropped. Retry a few times before giving up, so one tap is enough.
 */
export async function loadWithRetry(
  client: Pick<RemoteMediaClient, 'loadMedia'>,
  request: MediaLoadRequest,
  attempts = 3,
  delayMs = 1500,
  timeoutMs = 12000,
): Promise<void> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      await withTimeout(client.loadMedia(request), timeoutMs)
      return
    } catch (e) {
      lastError = e
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)))
    }
  }
  throw lastError
}
