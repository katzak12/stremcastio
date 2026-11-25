import { useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { APP_LANGUAGES, t } from '../lib/i18n'
import { englishName, LANGUAGE_CHOICES, langName } from '../lib/languages'
import { STANDARD_LOOK } from '../lib/cast'
import { pingRelay } from '../lib/relay'
import type { Settings } from '../lib/settings'
import { addonBase } from '../lib/subtitles'
import { LanguagePicker } from './LanguagePicker'
import { Badge, Button, Card, Chips, colors, styles } from './ui'

type Props = {
  visible: boolean
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}

export function SettingsModal({ visible, settings, onChange, onClose }: Props) {
  const [addonInput, setAddonInput] = useState('')
  const [streamAddonInput, setStreamAddonInput] = useState('')
  const [relayInput, setRelayInput] = useState(settings.relayUrl)
  const [relayState, setRelayState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [picker, setPicker] = useState<'app' | 'subs' | null>(null)

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
          <Card title={t.languagesTitle}>
            <Text style={styles.label}>{t.appLanguage}</Text>
            <Pressable
              onPress={() => setPicker('app')}
              style={({ pressed }) => [styles.row, styles.selectRow, pressed && { opacity: 0.7 }]}
            >
              <Text style={[styles.text, { flex: 1 }]}>
                {APP_LANGUAGES.find((l) => l.key === settings.appLanguage)?.name ?? 'English'}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
            </Pressable>

            <Text style={[styles.label, { marginTop: 8 }]}>{t.subtitleLanguages}</Text>
            {settings.languages.map((code, i) => (
              <View key={code} style={[styles.row, styles.selectRow]}>
                <Badge text={code.toUpperCase()} tone={i === 0 ? 'accent' : 'default'} />
                <Text style={[styles.text, { flex: 1 }]}>
                  {langName(code)}
                  {i === 0 ? <Text style={styles.muted}>{`  ${t.alwaysFirst}`}</Text> : null}
                </Text>
                {code !== 'en' && (
                  <Pressable
                    accessibilityLabel={`${langName(code)} ✕`}
                    hitSlop={10}
                    onPress={() => onChange({ languages: settings.languages.filter((l) => l !== code) })}
                  >
                    <Text style={{ color: colors.muted, fontSize: 18 }}>✕</Text>
                  </Pressable>
                )}
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => setPicker('subs')}
              style={({ pressed }) => [styles.row, styles.selectRow, { borderStyle: 'dashed' }, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.plus}>
                <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '700', lineHeight: 22 }}>+</Text>
              </View>
              <Text style={[styles.text, { color: colors.accent }]}>{t.addLanguage}</Text>
            </Pressable>
          </Card>

          <Card title={t.subtitleStyle}>
            <View style={styles.preview}>
              <Text
                style={{
                  color: settings.subtitleColor === 'yellow' ? '#FFD65C' : '#FFFFFF',
                  backgroundColor: settings.subtitleBackground === 'box' ? 'rgba(0,0,0,0.7)' : 'transparent',
                  fontSize: 12 + settings.fontScale * 6,
                  fontWeight: '600',
                  paddingHorizontal: 6,
                  textAlign: 'center',
                  textShadowColor: settings.subtitleBackground === 'box' ? 'transparent' : '#000000',
                  textShadowRadius: 3,
                }}
              >
                {t.preview}
              </Text>
            </View>
            <Text style={styles.label}>{t.size}</Text>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Button label="A−" onPress={() => onChange({ fontScale: Math.max(0.6, +(settings.fontScale - 0.1).toFixed(1)) })} />
              <Text style={styles.text}>{Math.round(settings.fontScale * 100)}%</Text>
              <Button label="A+" onPress={() => onChange({ fontScale: Math.min(2.5, +(settings.fontScale + 0.1).toFixed(1)) })} />
            </View>
            <Text style={styles.label}>{t.textColor}</Text>
            <Chips
              options={[
                { value: 'white', label: t.white },
                { value: 'yellow', label: t.yellow },
              ]}
              value={settings.subtitleColor}
              onChange={(v) => onChange({ subtitleColor: v })}
            />
            <Text style={styles.label}>{t.background}</Text>
            <Chips
              options={[
                { value: 'none', label: t.bgNone },
                { value: 'box', label: t.bgBox },
              ]}
              value={settings.subtitleBackground}
              onChange={(v) => onChange({ subtitleBackground: v })}
            />
            <Text style={styles.muted}>{t.styleHint}</Text>
            <Button
              label={t.resetStyle}
              kind="ghost"
              small
              disabled={
                settings.fontScale === STANDARD_LOOK.fontScale &&
                settings.subtitleColor === STANDARD_LOOK.color &&
                settings.subtitleBackground === STANDARD_LOOK.background
              }
              onPress={() =>
                onChange({
                  fontScale: STANDARD_LOOK.fontScale,
                  subtitleColor: STANDARD_LOOK.color,
                  subtitleBackground: STANDARD_LOOK.background,
                })
              }
            />
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

          <Card title={t.nextEpisode}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={[styles.text, { flex: 1 }]}>{t.autoNext}</Text>
              <Switch
                value={settings.autoNext}
                onValueChange={(v) => onChange({ autoNext: v })}
                trackColor={{ true: colors.accent, false: '#2C303C' }}
              />
            </View>
            <Text style={[styles.label, { marginTop: 4 }]}>{t.streamAddons}</Text>
            <Text style={styles.muted}>{t.streamAddonHint}</Text>
            {settings.streamAddons.map((a) => (
              <View key={a} style={[styles.row, { justifyContent: 'space-between' }]}>
                <Text style={[styles.text, { flex: 1, fontSize: 14 }]} numberOfLines={1}>
                  {/* Hide debrid keys and other config: show only the host. */}
                  {addonBase(a).replace(/^https?:\/\//, '').split('/')[0]}
                </Text>
                <Button label="✕" small onPress={() => onChange({ streamAddons: settings.streamAddons.filter((x) => x !== a) })} />
              </View>
            ))}
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="https://torrentio.strem.fun/…/manifest.json"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={streamAddonInput}
                onChangeText={setStreamAddonInput}
              />
              <Button
                label={t.addAddon}
                small
                disabled={!/^(https?|stremio):\/\//i.test(streamAddonInput.trim())}
                onPress={() => {
                  onChange({ streamAddons: [...new Set([...settings.streamAddons, streamAddonInput.trim()])] })
                  setStreamAddonInput('')
                }}
              />
            </View>
          </Card>

          <Card title={t.relay}>
            <Text style={styles.muted}>{t.relayHint}</Text>
            <TextInput
              style={styles.input}
              placeholder="https://stremcastio-relay.example.workers.dev"
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

      <LanguagePicker
        visible={picker === 'app'}
        title={t.appLanguage}
        items={APP_LANGUAGES.map((l) => ({ ...l, english: englishName(l.key) }))}
        selected={[settings.appLanguage]}
        onPick={(key) => onChange({ appLanguage: key })}
        onClose={() => setPicker(null)}
      />
      <LanguagePicker
        visible={picker === 'subs'}
        title={t.addLanguage}
        items={LANGUAGE_CHOICES.filter((l) => !settings.languages.includes(l.key))}
        onPick={(key) => onChange({ languages: [...settings.languages, key] })}
        onClose={() => setPicker(null)}
      />
    </Modal>
  )
}
