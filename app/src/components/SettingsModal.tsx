import { useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { t } from '../lib/i18n'
import { LANGUAGE_CHOICES, langName } from '../lib/languages'
import { pingRelay } from '../lib/relay'
import type { Settings } from '../lib/settings'
import { addonBase } from '../lib/subtitles'
import { Button, Card, colors, styles } from './ui'

type Props = {
  visible: boolean
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}

export function SettingsModal({ visible, settings, onChange, onClose }: Props) {
  const [addonInput, setAddonInput] = useState('')
  const [relayInput, setRelayInput] = useState(settings.relayUrl)
  const [relayState, setRelayState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [pickLang, setPickLang] = useState(false)

  const moveLang = (index: number, dir: -1 | 1) => {
    const next = [...settings.languages]
    const j = index + dir
    if (j < 0 || j >= next.length) return
    ;[next[index], next[j]] = [next[j], next[index]]
    onChange({ languages: next })
  }

  const saveRelay = async () => {
    const value = relayInput.trim().replace(/\/+$/, '')
    onChange({ relayUrl: value })
    if (!value) return setRelayState('idle')
    setRelayState('testing')
    setRelayState((await pingRelay(value)) ? 'ok' : 'fail')
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={[styles.row, { justifyContent: 'space-between', padding: 16 }]}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>{t.settings}</Text>
          <Button label={t.done} kind="ghost" small onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <Card title={t.languages}>
            {settings.languages.map((code, i) => (
              <View key={code} style={[styles.row, { justifyContent: 'space-between' }]}>
                <Text style={styles.text}>
                  {i + 1}. {langName(code)}
                </Text>
                <View style={styles.row}>
                  <Button label="↑" small onPress={() => moveLang(i, -1)} disabled={i === 0} />
                  <Button label="↓" small onPress={() => moveLang(i, 1)} disabled={i === settings.languages.length - 1} />
                  <Button
                    label="✕"
                    small
                    onPress={() => onChange({ languages: settings.languages.filter((l) => l !== code) })}
                    disabled={settings.languages.length <= 1}
                  />
                </View>
              </View>
            ))}
            <Button label={`+ ${t.addLanguage}`} kind="ghost" small onPress={() => setPickLang((v) => !v)} />
            {pickLang && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {LANGUAGE_CHOICES.filter((l) => !settings.languages.includes(l.key)).map((l) => (
                  <Pressable
                    key={l.key}
                    onPress={() => {
                      onChange({ languages: [...settings.languages, l.key] })
                      setPickLang(false)
                    }}
                    style={{ backgroundColor: '#242733', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}
                  >
                    <Text style={{ color: colors.text }}>{l.name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </Card>

          <Card title={t.size}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Button label="A−" onPress={() => onChange({ fontScale: Math.max(0.6, +(settings.fontScale - 0.1).toFixed(1)) })} />
              <Text style={[styles.text, { fontSize: 14 + settings.fontScale * 6 }]}>{Math.round(settings.fontScale * 100)}%</Text>
              <Button label="A+" onPress={() => onChange({ fontScale: Math.min(2.5, +(settings.fontScale + 0.1).toFixed(1)) })} />
            </View>
          </Card>

          <Card title={t.addons}>
            <Text style={styles.muted}>{t.addonHint}</Text>
            {settings.addons.map((a) => (
              <View key={a} style={[styles.row, { justifyContent: 'space-between' }]}>
                <Text style={[styles.text, { flex: 1, fontSize: 14 }]} numberOfLines={1}>
                  {addonBase(a).replace(/^https?:\/\//, '')}
                </Text>
                <Button
                  label="✕"
                  small
                  onPress={() => onChange({ addons: settings.addons.filter((x) => x !== a) })}
                  disabled={settings.addons.length <= 1}
                />
              </View>
            ))}
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="https://…/manifest.json"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={addonInput}
                onChangeText={setAddonInput}
              />
              <Button
                label={t.addAddon}
                small
                disabled={!/^(https?|stremio):\/\//i.test(addonInput.trim())}
                onPress={() => {
                  onChange({ addons: [...new Set([...settings.addons, addonInput.trim()])] })
                  setAddonInput('')
                }}
              />
            </View>
          </Card>

          <Card title={t.relay}>
            <Text style={styles.muted}>{t.relayHint}</Text>
            <TextInput
              style={styles.input}
              placeholder="https://subcast-relay.example.workers.dev"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={relayInput}
              onChangeText={setRelayInput}
              onEndEditing={saveRelay}
            />
            <View style={styles.row}>
              <Button label={t.test} small onPress={saveRelay} loading={relayState === 'testing'} />
              {relayState === 'ok' && <Text style={{ color: colors.ok }}>✓ {t.relayOk}</Text>}
              {relayState === 'fail' && <Text style={{ color: colors.danger }}>✕ {t.relayFail}</Text>}
            </View>
          </Card>

          <Card title={t.howTo}>
            <Text style={styles.muted}>{Platform.OS === 'android' ? t.howToAndroid : t.howToIos}</Text>
          </Card>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}
