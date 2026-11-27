// Settings → Real-Debrid: usually nothing to do (a Torrentio link carries the key). Otherwise link the
// account once with a code on real-debrid.com/device; no keys to copy.

import * as Clipboard from 'expo-clipboard'
import * as Linking from 'expo-linking'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { t } from '../lib/i18n'
import { pollDeviceLink, startDeviceLink, type DeviceCode, type RdAuth } from '../lib/realDebrid'
import { Button, Card, colors, styles } from './ui'

type Props = { rdAuth: RdAuth | null; onChange: (rdAuth: RdAuth | null) => void }

export function RealDebridCard({ rdAuth, onChange }: Props) {
  const [code, setCode] = useState<DeviceCode | null>(null)
  const [error, setError] = useState(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Poll until the user has entered the code (or it expires).
  useEffect(() => {
    if (!code) return
    let stopped = false
    const tick = async () => {
      if (stopped) return
      if (Date.now() > code.expiresAt) {
        setCode(null)
        return
      }
      try {
        const auth = await pollDeviceLink(code)
        if (auth && !stopped) {
          onChangeRef.current(auth)
          setCode(null)
          return
        }
      } catch {
        // keep waiting
      }
      if (!stopped) timer = setTimeout(tick, code.interval)
    }
    let timer = setTimeout(tick, code.interval)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [code])

  const link = async () => {
    setError(false)
    try {
      const c = await startDeviceLink()
      setCode(c)
      Clipboard.setStringAsync(c.userCode).catch(() => {})
    } catch {
      setError(true)
    }
  }

  return (
    <Card title="Real-Debrid">
      <Text style={styles.muted}>{t.rdHint}</Text>
      {rdAuth ? (
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={{ color: colors.ok }}>✓ {t.rdLinked}</Text>
          <Button label={t.rdUnlink} small onPress={() => onChange(null)} />
        </View>
      ) : code ? (
        <View style={{ gap: 10 }}>
          <Text style={styles.muted}>{t.rdEnterCode}</Text>
          <Text selectable style={{ color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: 4, textAlign: 'center' }}>
            {code.userCode}
          </Text>
          <Button label={t.rdOpenSite} kind="primary" onPress={() => Linking.openURL(code.verificationUrl).catch(() => {})} />
          <View style={styles.row}>
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.muted}>{t.rdWaiting}</Text>
          </View>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={[styles.muted, { fontSize: 12 }]}>{t.rdAuto}</Text>
          <Button label={t.rdLink} onPress={link} />
          {error && <Text style={{ color: colors.danger }}>{t.error}</Text>}
        </View>
      )}
    </Card>
  )
}
