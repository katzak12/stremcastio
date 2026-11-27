// "Cast button in Stremio": installs our small Stremio add-on so every stream gets a "Cast to TV" entry
// that opens StremCastio directly. No copying links anymore.

import * as Clipboard from 'expo-clipboard'
import * as Linking from 'expo-linking'
import { useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { t } from '../lib/i18n'
import { addonInstallUrls } from '../lib/stremioAddon'
import { Button, Card, colors, styles } from './ui'

type Props = {
  relayUrl: string
  /** The Torrentio-style add-on base to wrap, if known. */
  base: string | null
  onAddAddon: (url: string) => void
}

export function StremioAddonCard({ relayUrl, base, onAddAddon }: Props) {
  const [input, setInput] = useState('')
  const [copied, setCopied] = useState(false)
  if (!relayUrl) return null
  const urls = base ? addonInstallUrls(relayUrl, base) : null

  return (
    <Card title={t.stremioButton}>
      <Text style={styles.muted}>{t.stremioButtonHint}</Text>
      {urls ? (
        <View style={{ gap: 8 }}>
          <Button
            label={t.addToStremio}
            kind="primary"
            onPress={() =>
              Linking.openURL(urls.stremio).catch(async () => {
                await Clipboard.setStringAsync(urls.manifest)
                setCopied(true)
              })
            }
          />
          <Button
            label={copied ? t.linkCopied : t.copyLink}
            small
            onPress={async () => {
              await Clipboard.setStringAsync(urls.manifest)
              setCopied(true)
            }}
          />
          {copied && <Text style={[styles.muted, { fontSize: 12 }]}>{t.pasteInStremio}</Text>}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={[styles.muted, { fontSize: 12 }]}>{t.torrentioLinkHint}</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="https://torrentio.strem.fun/…/manifest.json"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={input}
              onChangeText={setInput}
            />
            <Button
              label={t.addAddon}
              small
              disabled={!/^(https?|stremio):\/\//i.test(input.trim())}
              onPress={() => {
                onAddAddon(input.trim())
                setInput('')
              }}
            />
          </View>
        </View>
      )}
    </Card>
  )
}
