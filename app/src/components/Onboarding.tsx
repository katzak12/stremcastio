// First-run introduction: what the app does, then the few settings that matter, step by step.
// Shown until it is finished or skipped; Settings → How to use can show it again.

import { useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { APP_LANGUAGES, t } from '../lib/i18n'
import { LANGUAGE_CHOICES, langName } from '../lib/languages'
import type { Settings } from '../lib/settings'
import { LanguagePicker } from './LanguagePicker'
import { Badge, Button, Chips, colors, styles } from './ui'

type Props = {
  visible: boolean
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onDone: () => void
}

const STEPS = 4

export function Onboarding({ visible, settings, onChange, onDone }: Props) {
  const [step, setStep] = useState(0)
  const [pickingLang, setPickingLang] = useState(false)

  const finish = () => {
    setStep(0)
    onDone()
  }
  const last = step === STEPS - 1

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
              <View style={{ height: 40 }} />
              <Title text={t.introWelcomeTitle} />
              <Body text={t.introWelcome} />
            </>
          )}

          {step === 1 && (
            <>
              <Title text={t.introNeedTitle} />
              {[t.introNeedStremio, t.introNeedWifi, Platform.OS === 'ios' ? t.introNeedLocalNetwork : null, t.introNeedRd]
                .filter((x): x is string => !!x)
                .map((line) => (
                  <View key={line} style={[styles.row, { alignItems: 'flex-start', gap: 10 }]}>
                    <Text style={{ color: colors.accent, fontSize: 16, lineHeight: 23 }}>•</Text>
                    <Text style={[styles.muted, { flex: 1, fontSize: 16, lineHeight: 23 }]}>{line}</Text>
                  </View>
                ))}
            </>
          )}

          {step === 2 && (
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

          {step === 3 && (
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
