// Reads the track list at the start of a Matroska (MKV/WebM) file, and works out the few bytes to change
// so a Chromecast plays the audio track the user picked.
//
// The Chromecast always plays the file's first/default audio track and cannot switch tracks in a plain
// MKV. So for the chosen track we leave it alone and turn every *other* audio track into an unknown track
// type (0x20, "control"): players skip tracks of a type they don't know, so only the chosen audio remains.
// Each change is a single byte inside the header; the rest of the file streams through untouched.

export type MkvTrack = {
  number: number
  /** 1 video, 2 audio, 0x11 subtitle, … */
  type: number
  codec: string
  language: string
  name?: string
  channels?: number
  /** FlagDefault; absent means default (1) per the Matroska spec. */
  isDefault: boolean
  /** Absolute byte offset of the last byte of the TrackType value. */
  typeOffset: number
  /** Absolute byte offset of the FlagDefault value byte, if the element is present. */
  defaultOffset?: number
}

export type Patch = { offset: number; value: number }

export const TRACK_TYPE_AUDIO = 2
export const TRACK_TYPE_SUBTITLE = 0x11
/** A track type players ignore. */
export const TRACK_TYPE_IGNORED = 0x20

const ID_EBML = 0x1a45dfa3
const ID_SEGMENT = 0x18538067
const ID_SEEKHEAD = 0x114d9b74
const ID_SEEK = 0x4dbb
const ID_SEEKID = 0x53ab
const ID_SEEKPOSITION = 0x53ac
const ID_TRACKS = 0x1654ae6b
const ID_CLUSTER = 0x1f43b675
const ID_TRACKENTRY = 0xae
const ID_TRACKNUMBER = 0xd7
const ID_TRACKTYPE = 0x83
const ID_FLAGDEFAULT = 0x88
const ID_CODECID = 0x86
const ID_LANGUAGE = 0x22b59c
const ID_LANGUAGE_BCP47 = 0x22b59d
const ID_NAME = 0x536e
const ID_AUDIO = 0xe1
const ID_CHANNELS = 0x9f

type Element = { id: number; dataStart: number; size: number | null; end: number | null }

/** Reads an element header at `pos`; null when it doesn't fit in the buffer. */
function readElement(buf: Uint8Array, pos: number): Element | null {
  if (pos >= buf.length) return null
  const first = buf[pos]
  let idLen = 1
  while (idLen <= 4 && !(first & (0x80 >> (idLen - 1)))) idLen++
  if (idLen > 4 || pos + idLen > buf.length) return null
  let id = 0
  for (let i = 0; i < idLen; i++) id = id * 256 + buf[pos + i]

  const sp = pos + idLen
  if (sp >= buf.length) return null
  const s0 = buf[sp]
  let sizeLen = 1
  while (sizeLen <= 8 && !(s0 & (0x80 >> (sizeLen - 1)))) sizeLen++
  if (sizeLen > 8 || sp + sizeLen > buf.length) return null
  let size = s0 & (0xff >> sizeLen)
  let allOnes = size === 0xff >> sizeLen
  for (let i = 1; i < sizeLen; i++) {
    const b = buf[sp + i]
    if (b !== 0xff) allOnes = false
    size = size * 256 + b
  }
  const dataStart = sp + sizeLen
  if (allOnes) return { id, dataStart, size: null, end: null }
  return { id, dataStart, size, end: dataStart + size }
}

function readUint(buf: Uint8Array, start: number, end: number): number {
  let v = 0
  for (let i = start; i < end; i++) v = v * 256 + buf[i]
  return v
}

function readString(buf: Uint8Array, start: number, end: number): string {
  return new TextDecoder().decode(buf.subarray(start, end)).replace(/\0+$/, '')
}

export function isMatroska(buf: Uint8Array): boolean {
  return buf.length >= 4 && readUint(buf, 0, 4) === ID_EBML
}

export type HeadResult =
  | { kind: 'tracks'; tracks: MkvTrack[] }
  /** The Tracks element starts at this absolute offset, outside the bytes we read. */
  | { kind: 'seek'; tracksOffset: number }
  | { kind: 'none' }

/** Parse the first bytes of an MKV file (starting at offset 0). */
export function parseHead(buf: Uint8Array): HeadResult {
  if (!isMatroska(buf)) return { kind: 'none' }
  const ebml = readElement(buf, 0)
  if (!ebml?.end) return { kind: 'none' }
  const segment = readElement(buf, ebml.end)
  if (!segment || segment.id !== ID_SEGMENT) return { kind: 'none' }
  const segStart = segment.dataStart
  let tracksOffset: number | null = null
  let pos = segStart
  for (;;) {
    const el = readElement(buf, pos)
    if (!el) break
    if (el.id === ID_CLUSTER) break
    if (el.id === ID_TRACKS) {
      if (el.end !== null && el.end <= buf.length) return { kind: 'tracks', tracks: parseTracks(buf, el.dataStart, el.end, 0) }
      tracksOffset = pos
      break
    }
    if (el.id === ID_SEEKHEAD && el.end !== null && el.end <= buf.length) {
      const found = seekTracks(buf, el.dataStart, el.end)
      if (found !== null) tracksOffset ??= segStart + found
    }
    if (el.end === null) break
    pos = el.end
  }
  return tracksOffset !== null ? { kind: 'seek', tracksOffset } : { kind: 'none' }
}

function seekTracks(buf: Uint8Array, start: number, end: number): number | null {
  for (let pos = start; pos < end; ) {
    const seek = readElement(buf, pos)
    if (!seek?.end) return null
    if (seek.id === ID_SEEK) {
      let id: number | null = null
      let position: number | null = null
      for (let p = seek.dataStart; p < seek.end; ) {
        const c = readElement(buf, p)
        if (!c?.end) break
        if (c.id === ID_SEEKID) id = readUint(buf, c.dataStart, c.end)
        if (c.id === ID_SEEKPOSITION) position = readUint(buf, c.dataStart, c.end)
        p = c.end
      }
      if (id === ID_TRACKS && position !== null) return position
    }
    pos = seek.end
  }
  return null
}

/** Parse a buffer that starts with the Tracks element; `base` is its absolute file offset. */
export function parseTracksElement(buf: Uint8Array, base: number): MkvTrack[] | null {
  const el = readElement(buf, 0)
  if (!el || el.id !== ID_TRACKS || el.end === null || el.end > buf.length) return null
  return parseTracks(buf, el.dataStart, el.end, base)
}

function parseTracks(buf: Uint8Array, start: number, end: number, base: number): MkvTrack[] {
  const tracks: MkvTrack[] = []
  for (let pos = start; pos < end; ) {
    const entry = readElement(buf, pos)
    if (!entry?.end) break
    if (entry.id === ID_TRACKENTRY) {
      const t: Partial<MkvTrack> & { bcp47?: string } = { isDefault: true }
      for (let p = entry.dataStart; p < entry.end; ) {
        const c = readElement(buf, p)
        if (!c?.end) break
        switch (c.id) {
          case ID_TRACKNUMBER:
            t.number = readUint(buf, c.dataStart, c.end)
            break
          case ID_TRACKTYPE:
            if (c.size) {
              t.type = readUint(buf, c.dataStart, c.end)
              t.typeOffset = base + c.end - 1
            }
            break
          case ID_FLAGDEFAULT:
            t.isDefault = readUint(buf, c.dataStart, c.end) !== 0
            if (c.size === 1) t.defaultOffset = base + c.dataStart
            break
          case ID_CODECID:
            t.codec = readString(buf, c.dataStart, c.end)
            break
          case ID_LANGUAGE:
            t.language = readString(buf, c.dataStart, c.end)
            break
          case ID_LANGUAGE_BCP47:
            t.bcp47 = readString(buf, c.dataStart, c.end)
            break
          case ID_NAME:
            t.name = readString(buf, c.dataStart, c.end)
            break
          case ID_AUDIO:
            for (let a = c.dataStart; a < c.end; ) {
              const ac = readElement(buf, a)
              if (!ac?.end) break
              if (ac.id === ID_CHANNELS) t.channels = readUint(buf, ac.dataStart, ac.end)
              a = ac.end
            }
            break
        }
        p = c.end
      }
      if (t.number !== undefined && t.type !== undefined && t.typeOffset !== undefined) {
        tracks.push({
          number: t.number,
          type: t.type,
          codec: t.codec ?? '',
          // Matroska's default language is English.
          language: t.bcp47 || t.language || 'eng',
          name: t.name || undefined,
          channels: t.channels,
          isDefault: t.isDefault ?? true,
          typeOffset: t.typeOffset,
          defaultOffset: t.defaultOffset,
        })
      }
    }
    pos = entry.end
  }
  return tracks
}

/** The audio track a player picks on its own: the first one flagged default, else the first one. */
export function defaultAudio(tracks: MkvTrack[]): MkvTrack | undefined {
  const audio = tracks.filter((t) => t.type === TRACK_TYPE_AUDIO)
  return audio.find((t) => t.isDefault) ?? audio[0]
}

/** Codecs a Chromecast can't decode or pass through: you'd hear nothing. */
export function isPlayableAudioCodec(codec: string): boolean {
  return !/^A_(TRUEHD|MLP|DTS)/i.test(codec)
}

/**
 * Byte changes that leave `chosen` as the only audio track. Empty when the file already plays it
 * (it's the only audio track, or the first audio track and flagged default).
 */
export function patchesFor(tracks: MkvTrack[], chosen: number): Patch[] {
  const audio = tracks.filter((t) => t.type === TRACK_TYPE_AUDIO)
  const pick = audio.find((t) => t.number === chosen)
  if (!pick) return []
  if (audio.length === 1 || (audio[0] === pick && pick.isDefault)) return []
  const patches: Patch[] = []
  for (const t of audio) {
    if (t === pick) {
      if (t.defaultOffset !== undefined && !t.isDefault) patches.push({ offset: t.defaultOffset, value: 1 })
    } else {
      patches.push({ offset: t.typeOffset, value: TRACK_TYPE_IGNORED })
    }
  }
  return patches
}

export function encodePatches(patches: Patch[]): string {
  return patches.map((p) => `${p.offset}.${p.value}`).join(',')
}

/** Limits keep /media from being a general-purpose rewriting proxy. */
export const MAX_PATCHES = 64
export const MAX_PATCH_OFFSET = 64 * 1024 * 1024

export function decodePatches(text: string | null): Patch[] | null {
  if (!text) return null
  const parts = text.split(',')
  if (parts.length === 0 || parts.length > MAX_PATCHES) return null
  const patches: Patch[] = []
  for (const part of parts) {
    const m = /^(\d{1,9})\.(\d{1,3})$/.exec(part)
    if (!m) return null
    const offset = Number(m[1])
    const value = Number(m[2])
    if (offset >= MAX_PATCH_OFFSET || value > 255) return null
    patches.push({ offset, value })
  }
  return patches.sort((a, b) => a.offset - b.offset)
}
