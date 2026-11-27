// "Make my own relay": open Cloudflare's deploy page, and when the user comes back with the new
// *.workers.dev address copied, check it and offer to use it. Shared by Settings and the introduction.

import * as Clipboard from 'expo-clipboard'
import * as Linking from 'expo-linking'
import { useEffect, useRef } from 'react'
import { Alert, AppState } from 'react-native'
import { t } from '../lib/i18n'
import { pingRelay } from '../lib/relay'
import { DEPLOY_RELAY_URL, findWorkerUrl } from '../lib/relaySetup'

export function useOwnRelay(currentRelay: string, onUse: (url: string) => void): () => void {
  const awaiting = useRef(false)
  const onUseRef = useRef(onUse)
  onUseRef.current = onUse

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active' || !awaiting.current) return
      try {
        if (!(await Clipboard.hasStringAsync())) return
        const found = findWorkerUrl(await Clipboard.getStringAsync())
        if (!found || found === currentRelay) return
        if (!(await pingRelay(found))) return
        awaiting.current = false
        Alert.alert(t.relayFound, `${found}\n\n${t.useThisRelay}`, [
          { text: t.cancel, style: 'cancel' },
          { text: t.done, onPress: () => onUseRef.current(found) },
        ])
      } catch {
        // clipboard not available
      }
    })
    return () => sub.remove()
  }, [currentRelay])

  return () => {
    awaiting.current = true
    Linking.openURL(DEPLOY_RELAY_URL).catch(() => {})
  }
}
