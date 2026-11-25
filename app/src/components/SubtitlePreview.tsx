import { Platform, Text, View, type TextStyle } from 'react-native'
import { COLOR_HEX, type SubtitleLook } from '../lib/cast'
import { t } from '../lib/i18n'
import { styles } from './ui'

const FONT: Record<SubtitleLook['font'], TextStyle> = {
  sansSerif: {},
  serif: { fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }) },
  monoSansSerif: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  casual: { fontFamily: Platform.select({ ios: 'Chalkboard SE', default: 'casual' }) },
  smallCaps: { fontVariant: ['small-caps'] },
}

/** Close approximation of how the TV will draw the subtitles (the TV uses its own renderer). */
export function SubtitlePreview({ look }: { look: SubtitleLook }) {
  const edge: TextStyle =
    look.edge === 'outline'
      ? { textShadowColor: '#000000', textShadowRadius: 2, textShadowOffset: { width: 0, height: 0 } }
      : look.edge === 'dropShadow'
        ? { textShadowColor: '#000000', textShadowRadius: 3, textShadowOffset: { width: 2, height: 2 } }
        : look.edge === 'raised'
          ? { textShadowColor: '#000000', textShadowRadius: 0, textShadowOffset: { width: 1, height: 1 } }
          : look.edge === 'depressed'
            ? { textShadowColor: '#000000', textShadowRadius: 0, textShadowOffset: { width: -1, height: -1 } }
            : {}
  const background =
    look.background === 'solid' ? '#000000' : look.background === 'semi' ? 'rgba(0,0,0,0.7)' : 'transparent'
  return (
    <View style={styles.preview}>
      <Text
        style={[
          {
            color: COLOR_HEX[look.color],
            backgroundColor: background,
            fontSize: 12 + look.fontScale * 6,
            fontWeight: '600',
            paddingHorizontal: 6,
            textAlign: 'center',
          },
          edge,
          FONT[look.font],
        ]}
      >
        {t.preview}
      </Text>
    </View>
  )
}
