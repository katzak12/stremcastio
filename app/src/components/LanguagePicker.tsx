import { useMemo, useState } from 'react'
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { t } from '../lib/i18n'
import { Badge, Button, colors, styles } from './ui'

export type PickerItem = { key: string; name: string; english?: string }

type Props = {
  visible: boolean
  title: string
  items: PickerItem[]
  /** Keys to mark with a check (e.g. the current app language). */
  selected?: string[]
  onPick: (key: string) => void
  onClose: () => void
}

/** Full-screen, searchable list of languages. */
export function LanguagePicker({ visible, title, items, selected = [], onPick, onClose }: Props) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || i.english?.toLowerCase().includes(q) || i.key.startsWith(q),
    )
  }, [items, query])

  const close = () => {
    setQuery('')
    onClose()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={[styles.row, { justifyContent: 'space-between', padding: 16 }]}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>{title}</Text>
          <Button label={t.done} kind="ghost" small onPress={close} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <TextInput
            style={styles.input}
            placeholder={t.searchLanguages}
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            value={query}
            onChangeText={setQuery}
          />
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.key}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          renderItem={({ item }) => {
            const active = selected.includes(item.key)
            return (
              <Pressable
                onPress={() => {
                  onPick(item.key)
                  close()
                }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    paddingVertical: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.cardBorder,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <Badge text={item.key.toUpperCase()} tone={active ? 'accent' : 'default'} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.text}>{item.name}</Text>
                  {item.english && item.english !== item.name ? (
                    <Text style={[styles.muted, { fontSize: 12 }]}>{item.english}</Text>
                  ) : null}
                </View>
                {active && <Text style={{ color: colors.accent, fontSize: 18 }}>✓</Text>}
              </Pressable>
            )
          }}
        />
      </SafeAreaView>
    </Modal>
  )
}
