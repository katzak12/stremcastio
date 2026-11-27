// First-run introduction: what the app does, then the few settings that matter, step by step.
// Shown until it is finished or skipped; Settings → How to use can show it again.

import { useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { APP_LANGUAGES, t } from '../lib/i18n'
import { LANGUAGE_CHOICES, langName } from '../lib/languages'
import { defaultSettings, type Settings } from '../lib/settings'
import { addonBase } from '../lib/subtitles'
import { LanguagePicker } from './LanguagePicker'
import { Badge, Button, Chips, colors, styles } from './ui'
import { useOwnRelay } from './useOwnRelay'

type Props = {
  visible: boolean
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onDone: () => void
}

const STEPS = 5

export function Onboarding({ visible, settings, onChange, onDone }: Props) {
  const [step, setStep] = useState(0)
  const [pickingLang, setPickingLang] = useState(false)
  const [addonInput, setAddonInput] = useState('')
  const defaultRelay = defaultSettings().relayUrl
  const openDeploy = useOwnRelay(settings.relayUrl, (url) => onChange({ relayUrl: url }))

  const finish = () => {
    setStep(0)
    onDone()
  }
  const last = step === STEPS - 1
  const usingOwnRelay = !!settings.relayUrl && settings.relayUrl !== defaultRelay

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={finish}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={[styles.row, { justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 }]}>
          <View style={[styles.row, { gap: 6 }]}>
            {Array.from({ length: STEPS }, (_, i) => (
              <View
                key={i}
                style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === step ? colors.accent : '#2C303C' }}
              />
            ))}
          </View>
          {!last && <Button label={t.introSkip} kind="ghost" small onPress={finish} />}
        </View>

        <ScrollView contentContainerStyle={{ padding: 24, gap: 16, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          {step === 0 && (
            <>
              <Text style={{ fontSize: 56, textAlign: 'center', marginTop: 24 }}>📺</Text>
              <Title text={t.introWelcomeTitle} />
              <Body text={t.introWelcome} />
            </>
          )}

          {step === 1 && (
            <>
              <Title text={t.introLangTitle} />
              <Body text={t.introLang} />
              <Text style={styles.label}>{t.appLanguage}</Text>
              <Chips
                options={APP_LANGUAGES.map((l) => ({ value: l.key, label: l.name }))}
                value={settings.appLanguage}
                onChange={(key) => onChange({ appLanguage: key })}
              />
              <Text style={[styles.label, { marginTop: 8 }]}>{t.subtitleLanguages}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {settings.languages.map((code, i) => (
                  <Pressable
                    key={code}
                    disabled={code === 'en'}
                    onPress={() => onChange({ languages: settings.languages.filter((l) => l !== code) })}
                    style={[styles.row, { gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#242733' }]}
                  >
                    <Badge text={code.toUpperCase()} tone={i === 0 ? 'accent' : 'default'} />
                    <Text style={styles.text}>{langName(code)}</Text>
                    {code !== 'en' && <Text style={styles.muted}>✕</Text>}
                  </Pressable>
                ))}
                <Button label={`+ ${t.addLanguage}`} small onPress={() => setPickingLang(true)} />
              </View>
            </>
          )}

          {step === 2 && (
            <>
              <Title text={t.introRelayTitle} />
              <Body text={t.introRelay} />
              <Choice
                active={!usingOwnRelay}
                title={t.introRelayDefault}
                onPress={() => onChange({ relayUrl: defaultRelay })}
              />
              <Choice active={usingOwnRelay} title={t.ownRelay} subtitle={t.ownRelayHint} onPress={openDeploy} />
              {usingOwnRelay && (
                <Text style={[styles.muted, { fontSize: 12 }]} numberOfLines={1}>
                  ✓ {settings.relayUrl}
                </Text>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <Title text={t.introAddonTitle} />
              <Body text={t.introAddon} />
              {settings.streamAddons.map((a) => (
                <View key={a} style={[styles.row, { justifyContent: 'space-between' }]}>
                  <Text style={[styles.text, { flex: 1, fontSize: 14 }]} numberOfLines={1}>
                    ✓ {addonBase(a).replace(/^https?:\/\//, '').split('/')[0]}
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
                  value={addonInput}
                  onChangeText={setAddonInput}
                />
                <Button
                  label={t.addAddon}
                  small
                  disabled={!/^(https?|stremio):\/\//i.test(addonInput.trim())}
                  onPress={() => {
                    onChange({ streamAddons: [...new Set([...settings.streamAddons, addonInput.trim()])] })
                    setAddonInput('')
                  }}
                />
              </View>
            </>
          )}

          {step === 4 && (
            <>
              <Title text={t.introHowTitle} />
              <Body text={Platform.OS === 'android' ? t.howToAndroid : t.howToIos} />
              <Body text={t.introHowFooter} />
            </>
          )}
        </ScrollView>

        <View style={[styles.row, { padding: 20, gap: 12 }]}>
          {step > 0 && <Button label={t.introBack} onPress={() => setStep(step - 1)} />}
          <Button
            label={last ? t.introStart : t.introNext}
            kind="primary"
            style={{ flex: 1, minHeight: 52 }}
            onPress={() => (last ? finish() : setStep(step + 1))}
          />
        </View>
      </SafeAreaView>

      <LanguagePicker
        visible={pickingLang}
        title={t.addLanguage}
        items={LANGUAGE_CHOICES.filter((l) => !settings.languages.includes(l.key))}
        onPick={(key) => onChange({ languages: [...settings.languages, key] })}
        onClose={() => setPickingLang(false)}
      />
    </Modal>
  )
}

function Title({ text }: { text: string }) {
  return <Text style={{ color: colors.text, fontSize: 26, fontWeight: '800', textAlign: 'center' }}>{text}</Text>
}

function Body({ text }: { text: string }) {
  return <Text style={[styles.muted, { fontSize: 16, lineHeight: 23, textAlign: 'center' }]}>{text}</Text>
}

function Choice({ active, title, subtitle, onPress }: { active: boolean; title: string; subtitle?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: active ? colors.accent : '#2C303C',
        backgroundColor: active ? colors.accentDim : '#1B1E27',
        gap: 4,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: colors.text, fontWeight: '700' }}>
        {active ? '✓  ' : ''}
        {title}
      </Text>
      {subtitle ? <Text style={[styles.muted, { fontSize: 13 }]}>{subtitle}</Text> : null}
    </Pressable>
  )
}
