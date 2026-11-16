import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'

export const colors = {
  bg: '#0E0F13',
  card: '#181A20',
  cardBorder: '#262933',
  text: '#F2F3F5',
  muted: '#9AA0AC',
  accent: '#7B61FF',
  accentDim: '#2A2350',
  warn: '#FFB547',
  danger: '#FF5D5D',
  ok: '#38D39F',
}

export function Card({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.card}>
      {(title || right) && (
        <View style={styles.cardHeader}>
          {title ? <Text style={styles.cardTitle}>{title}</Text> : <View />}
          {right}
        </View>
      )}
      {children}
    </View>
  )
}

type ButtonProps = {
  label: string
  onPress: () => void
  kind?: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean
  loading?: boolean
  style?: StyleProp<ViewStyle>
  small?: boolean
}

export function Button({ label, onPress, kind = 'secondary', disabled, loading, style, small }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        kind === 'primary' && styles.primary,
        kind === 'secondary' && styles.secondary,
        kind === 'ghost' && styles.ghost,
        (disabled || loading) && { opacity: 0.45 },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Text style={[styles.buttonText, small && { fontSize: 14 }, kind === 'ghost' && { color: colors.accent }]}>
          {label}
        </Text>
      )}
    </Pressable>
  )
}

export function Badge({ text, tone = 'default' }: { text: string; tone?: 'default' | 'accent' }) {
  return (
    <View style={[styles.badge, tone === 'accent' && { backgroundColor: colors.accent }]}>
      <Text style={styles.badgeText}>{text}</Text>
    </View>
  )
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: colors.muted, fontSize: 13, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  button: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { minHeight: 38, paddingHorizontal: 12, borderRadius: 10 },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: '#242733' },
  ghost: { backgroundColor: 'transparent' },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  badge: {
    backgroundColor: '#2C303C',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    minWidth: 34,
    alignItems: 'center',
  },
  badgeText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  text: { color: colors.text, fontSize: 16 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  input: {
    backgroundColor: '#11131A',
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
})
