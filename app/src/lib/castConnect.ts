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

/**
 * Right after connecting, the TV is still starting its media player, and the first load often fails
 * or is dropped. Retry a few times before giving up, so one tap is enough.
 */
export async function loadWithRetry(
  client: Pick<RemoteMediaClient, 'loadMedia'>,
  request: MediaLoadRequest,
  attempts = 4,
  delayMs = 1500,
): Promise<void> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      await client.loadMedia(request)
      return
    } catch (e) {
      lastError = e
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)))
    }
  }
  throw lastError
}
