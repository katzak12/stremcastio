// Subtitle add-ons use a mix of ISO 639-1 ("nl"), 639-2/B ("dut") and
// 639-2/T ("nld") codes, sometimes with regions ("pt-br", "pob").
// We normalise everything to a 2-letter key.

const TABLE: [key: string, name: string, aliases: string[]][] = [
  ['en', 'English', ['eng']],
  ['nl', 'Nederlands', ['nld', 'dut', 'nl-be', 'vls']],
  ['de', 'Deutsch', ['deu', 'ger']],
  ['fr', 'Français', ['fra', 'fre']],
  ['es', 'Español', ['spa', 'spl', 'es-419', 'es-mx', 'ea']],
  ['pt', 'Português', ['por', 'pob', 'pt-br', 'pb', 'pt-pt']],
  ['it', 'Italiano', ['ita']],
  ['pl', 'Polski', ['pol']],
  ['tr', 'Türkçe', ['tur']],
  ['ar', 'العربية', ['ara']],
  ['ru', 'Русский', ['rus']],
  ['uk', 'Українська', ['ukr']],
  ['sv', 'Svenska', ['swe']],
  ['da', 'Dansk', ['dan']],
  ['no', 'Norsk', ['nor', 'nob', 'nb', 'nno', 'nn']],
  ['fi', 'Suomi', ['fin']],
  ['cs', 'Čeština', ['ces', 'cze']],
  ['sk', 'Slovenčina', ['slk', 'slo']],
  ['hu', 'Magyar', ['hun']],
  ['ro', 'Română', ['ron', 'rum']],
  ['el', 'Ελληνικά', ['ell', 'gre']],
  ['he', 'עברית', ['heb']],
  ['hi', 'हिन्दी', ['hin']],
  ['id', 'Bahasa Indonesia', ['ind']],
  ['ms', 'Bahasa Melayu', ['msa', 'may']],
  ['vi', 'Tiếng Việt', ['vie']],
  ['th', 'ไทย', ['tha']],
  ['zh', '中文', ['zho', 'chi', 'zh-cn', 'zh-tw', 'zht', 'zhs', 'ze']],
  ['ja', '日本語', ['jpn']],
  ['ko', '한국어', ['kor']],
  ['fa', 'فارسی', ['fas', 'per']],
  ['bg', 'Български', ['bul']],
  ['hr', 'Hrvatski', ['hrv']],
  ['sr', 'Српски', ['srp', 'scc']],
  ['sl', 'Slovenščina', ['slv']],
  ['et', 'Eesti', ['est']],
  ['lv', 'Latviešu', ['lav']],
  ['lt', 'Lietuvių', ['lit']],
]

const ENGLISH_NAMES: Record<string, string> = {
  english: 'en', dutch: 'nl', flemish: 'nl', german: 'de', french: 'fr', spanish: 'es', portuguese: 'pt',
  brazilian: 'pt', italian: 'it', polish: 'pl', turkish: 'tr', arabic: 'ar', russian: 'ru', ukrainian: 'uk',
  swedish: 'sv', danish: 'da', norwegian: 'no', finnish: 'fi', czech: 'cs', slovak: 'sk', hungarian: 'hu',
  romanian: 'ro', greek: 'el', hebrew: 'he', hindi: 'hi', indonesian: 'id', malay: 'ms', vietnamese: 'vi',
  thai: 'th', chinese: 'zh', japanese: 'ja', korean: 'ko', persian: 'fa', farsi: 'fa', bulgarian: 'bg',
  croatian: 'hr', serbian: 'sr', slovenian: 'sl', estonian: 'et', latvian: 'lv', lithuanian: 'lt',
}

const LOOKUP = new Map<string, string>()
for (const [key, name, aliases] of TABLE) {
  LOOKUP.set(key, key)
  LOOKUP.set(name.toLowerCase(), key)
  for (const a of aliases) LOOKUP.set(a, key)
}
for (const [name, key] of Object.entries(ENGLISH_NAMES)) LOOKUP.set(name, key)

export function normalizeLang(code: string | undefined | null): string {
  if (!code) return 'und'
  const c = code.trim().toLowerCase().replace('_', '-')
  return LOOKUP.get(c) ?? LOOKUP.get(c.split('-')[0]) ?? c
}

export function langName(code: string): string {
  const key = normalizeLang(code)
  return TABLE.find(([k]) => k === key)?.[1] ?? code.toUpperCase()
}

/** English name per key ("nl" -> "Dutch"): the first entry in ENGLISH_NAMES for that key. */
export function englishName(code: string): string {
  const key = normalizeLang(code)
  const name = Object.entries(ENGLISH_NAMES).find(([, k]) => k === key)?.[0]
  return name ? name[0].toUpperCase() + name.slice(1) : langName(key)
}

export const LANGUAGE_CHOICES = TABLE.map(([key, name]) => ({ key, name, english: englishName(key) }))

/** First token in free text that is a known language code ("…/en/download/…" -> "en"). */
export function findLangInText(text: string): string {
  for (const token of text.toLowerCase().split(/[^a-z-]+/)) {
    if (token.length >= 2 && LOOKUP.has(token)) return LOOKUP.get(token)!
  }
  return 'und'
}

/** Subtitle preference list: English first, then the user's own choices, without duplicates. */
export function withEnglishFirst(langs: string[]): string[] {
  return [...new Set(['en', ...langs.map(normalizeLang).filter((l) => l !== 'und')])]
}
