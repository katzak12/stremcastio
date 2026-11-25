// Subtitle conversion: SRT / ASS / SSA / WebVTT  ->  WebVTT that the
// Chromecast Default Media Receiver can render.
// Pure functions only, so they run the same in the Worker and in tests.

const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
}

function decodeCp1252(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b] ?? 0xfffd : b)
  }
  return out
}

/** Turn raw subtitle bytes into a JS string, guessing the encoding. */
export function decodeBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    // UTF-16BE: swap to LE (not every runtime ships a utf-16be decoder)
    const swapped = new Uint8Array(bytes.length - 2)
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      swapped[i - 2] = bytes[i + 1]
      swapped[i - 1] = bytes[i]
    }
    return new TextDecoder('utf-16le').decode(swapped)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    // Most non-UTF-8 subtitles on the web are Windows-1252 (Western European).
    return decodeCp1252(bytes)
  }
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

export function formatVttTime(ms: number): string {
  const t = Math.max(0, Math.round(ms))
  const h = Math.floor(t / 3600000)
  const m = Math.floor((t % 3600000) / 60000)
  const s = Math.floor((t % 60000) / 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(t % 1000, 3)}`
}

/** "1:02:03,4" / "01:02:03.456" / "02:03.456" -> milliseconds */
export function parseTime(str: string): number | null {
  const m = str.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/)
  if (!m) return null
  const [, h, mi, s, frac = '0'] = m
  const ms = Number(frac.padEnd(3, '0'))
  return ((Number(h ?? 0) * 60 + Number(mi)) * 60 + Number(s)) * 1000 + ms
}

/** Keep only the markup WebVTT understands (<i>, <b>, <u>) and escape the rest. */
export function cleanCueText(text: string): string {
  let t = text
    .replace(/\{\\[^}]*\}/g, '') // ASS override tags like {\an8} or {\i1}
    .replace(/<\/?font[^>]*>/gi, '')
    .replace(/\\N/g, '\n') // ASS hard line break
    .replace(/\\n/g, '\n')
    .replace(/\\h/g, ' ')
  // Protect allowed tags, escape everything else.
  t = t.replace(/<(\/?)([ibu])>/gi, (_m, slash: string, tag: string) => `\u0000${slash}${tag.toLowerCase()}\u0001`)
  t = t.replace(/<[^>]*>/g, '') // drop unknown tags
  t = t.replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  t = t.replace(/\u0000/g, '<').replace(/\u0001/g, '>')
  t = t.replace(/-->/g, '→')
  return t
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
    .join('\n')
}

interface Cue {
  start: number
  end: number
  text: string
  /** WebVTT cue settings, e.g. "line:0" for text that belongs at the top of the picture. */
  settings?: string
}

/** VTT setting for text placed at the top (signs, on-screen text, songs). */
export const TOP = 'line:0'

/**
 * ASS/SSA override tags ({\i1}, {\an8}, …) also appear in many SRT files.
 * Turn italic/bold/underline into <i>/<b>/<u>, detect top placement, and flag vector drawings
 * ({\p1} … — shapes, not text) so they can be skipped. Everything else is dropped by cleanCueText.
 */
export function applyOverrides(text: string): { text: string; top: boolean; drawing: boolean } {
  let top = false
  let drawing = false
  const open = { i: false, b: false, u: false }
  let out = text.replace(/\{([^}]*)\}/g, (_m, block: string) => {
    let html = ''
    for (const tag of block.split('\\').slice(1)) {
      const an = tag.match(/^an(\d)/)
      if (an) top = ['7', '8', '9'].includes(an[1])
      const legacy = tag.match(/^a(\d{1,2})$/)
      if (legacy) top = ['5', '6', '7'].includes(legacy[1])
      if (/^p[1-9]/.test(tag)) drawing = true
      const fmt = tag.match(/^([ibu])(\d*)$/)
      if (fmt) {
        const k = fmt[1] as 'i' | 'b' | 'u'
        const on = fmt[2] !== '' && fmt[2] !== '0'
        if (on && !open[k]) html += `<${k}>`
        if (!on && open[k]) html += `</${k}>`
        open[k] = on
      }
    }
    return html
  })
  for (const k of ['u', 'b', 'i'] as const) if (open[k]) out += `</${k}>`
  return { text: out, top, drawing }
}

/** ASS "Alignment" is numpad-style (7-9 = top); legacy SSA uses 5-7 for top. */
function isTopAlignment(value: string | undefined, legacy: boolean): boolean {
  const n = Number(value)
  return legacy ? n >= 5 && n <= 7 : n >= 7 && n <= 9
}

function overriddenCue(start: number, end: number, raw: string, styleTop = false): Cue | null {
  const o = applyOverrides(raw)
  if (o.drawing) return null
  const text = cleanCueText(o.text)
  return { start, end, text, settings: o.top || styleTop ? TOP : undefined }
}

function renderVtt(cues: Cue[], offsetMs: number): string {
  const lines = ['WEBVTT', '']
  for (const c of cues) {
    const start = c.start + offsetMs
    const end = c.end + offsetMs
    if (end <= 0 || end <= start || !c.text) continue
    lines.push(`${formatVttTime(start)} --> ${formatVttTime(end)}${c.settings ? ` ${c.settings}` : ''}`, c.text, '')
  }
  return lines.join('\n')
}

const TIMING = /^\s*(\S+)\s*-->\s*(\S+)/

export function parseSrt(text: string): Cue[] {
  const cues: Cue[] = []
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)
  for (const block of blocks) {
    const lines = block.split('\n')
    const idx = lines.findIndex((l) => l.includes('-->'))
    if (idx === -1) continue
    const m = lines[idx].match(TIMING)
    if (!m) continue
    const start = parseTime(m[1])
    const end = parseTime(m[2])
    if (start === null || end === null) continue
    const cue = overriddenCue(start, end, lines.slice(idx + 1).join('\n'))
    if (cue) cues.push(cue)
  }
  return cues
}

export function parseAss(text: string): Cue[] {
  const cues: Cue[] = []
  let format: string[] | null = null
  let styleFormat: string[] | null = null
  let section = ''
  let legacy = false
  const topStyles = new Set<string>()
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (/^\[.*\]$/.test(line)) {
      section = line.toLowerCase()
      if (section === '[v4 styles]') legacy = true
      continue
    }
    if (section === '[v4+ styles]' || section === '[v4 styles]') {
      if (line.toLowerCase().startsWith('format:')) styleFormat = line.slice(7).split(',').map((x) => x.trim().toLowerCase())
      else if (line.toLowerCase().startsWith('style:') && styleFormat) {
        const f = line.slice(6).split(',').map((x) => x.trim())
        const name = f[styleFormat.indexOf('name')]
        if (name && isTopAlignment(f[styleFormat.indexOf('alignment')], legacy)) topStyles.add(name.toLowerCase())
      }
      continue
    }
    if (section !== '[events]') continue
    if (line.toLowerCase().startsWith('format:')) {
      format = line.slice(7).split(',').map((s) => s.trim().toLowerCase())
      continue
    }
    if (!line.toLowerCase().startsWith('dialogue:') || !format) continue
    const body = line.slice(9).trim()
    const parts: string[] = []
    let rest = body
    for (let i = 0; i < format.length - 1; i++) {
      const comma = rest.indexOf(',')
      if (comma === -1) break
      parts.push(rest.slice(0, comma))
      rest = rest.slice(comma + 1)
    }
    parts.push(rest) // the text field may contain commas
    const get = (k: string) => parts[format!.indexOf(k)]
    const start = parseTime(get('start') ?? '')
    const end = parseTime(get('end') ?? '')
    if (start === null || end === null) continue
    const cue = overriddenCue(start, end, get('text') ?? '', topStyles.has((get('style') ?? '').trim().toLowerCase()))
    if (cue) cues.push(cue)
  }
  return cues.sort((a, b) => a.start - b.start)
}

export function parseVtt(text: string): Cue[] {
  // Re-parse instead of passing through, so offsets and cleaning apply.
  const body = text.replace(/\r\n?/g, '\n').replace(/^WEBVTT[^\n]*\n/, '')
  const cues: Cue[] = []
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const idx = lines.findIndex((l) => l.includes('-->'))
    if (idx === -1) continue
    const m = lines[idx].match(TIMING)
    if (!m) continue
    const start = parseTime(m[1])
    const end = parseTime(m[2])
    if (start === null || end === null) continue
    // Keep only placement settings; the TV applies the look.
    const settings = lines[idx]
      .split('-->')[1]
      ?.trim()
      .split(/\s+/)
      .slice(1)
      .filter((x) => /^(line|position|align):[\w.%-]+$/.test(x))
      .join(' ')
    const cue = overriddenCue(start, end, lines.slice(idx + 1).join('\n'))
    if (cue) cues.push({ ...cue, settings: [settings, cue.settings].filter(Boolean).join(' ') || undefined })
  }
  return cues
}

export type SubtitleFormat = 'vtt' | 'ass' | 'srt'

export function detectFormat(text: string): SubtitleFormat {
  const head = text.trimStart().slice(0, 2000)
  if (head.startsWith('WEBVTT')) return 'vtt'
  if (/^\[Script Info\]/im.test(head) || /^\[Events\]/im.test(text)) return 'ass'
  return 'srt'
}

/** Convert any supported subtitle text to WebVTT, shifting by offsetMs. */
export function toVtt(text: string, offsetMs = 0): { vtt: string; cues: number; format: SubtitleFormat } {
  const clean = text.replace(/^﻿/, '')
  const format = detectFormat(clean)
  const cues = format === 'vtt' ? parseVtt(clean) : format === 'ass' ? parseAss(clean) : parseSrt(clean)
  return { vtt: renderVtt(cues, offsetMs), cues: cues.length, format }
}
