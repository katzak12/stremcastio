import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodePatches, encodePatches, parseHead, parseTracksElement, patchesFor, TRACK_TYPE_IGNORED } from '../src/mkv.ts'
import worker from '../src/index.ts'

// ---------- a tiny EBML writer, enough to build test files ----------

function idBytes(id: number): number[] {
  const out: number[] = []
  while (id > 0) {
    out.unshift(id & 0xff)
    id = Math.floor(id / 256)
  }
  return out
}

function sizeBytes(n: number): number[] {
  // Always 4-byte sizes: simple and valid.
  return [0x10 | ((n >> 24) & 0x0f), (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function el(id: number, data: number[] | Uint8Array): number[] {
  const d = Array.from(data)
  return [...idBytes(id), ...sizeBytes(d.length), ...d]
}

const uint = (id: number, v: number) => el(id, [v])
const str = (id: number, s: string) => el(id, Array.from(new TextEncoder().encode(s)))

type T = { number: number; type: number; codec: string; lang?: string; name?: string; def?: number; channels?: number }

function trackEntry(t: T): number[] {
  return el(0xae, [
    ...uint(0xd7, t.number),
    ...uint(0x83, t.type),
    ...(t.def !== undefined ? uint(0x88, t.def) : []),
    ...str(0x86, t.codec),
    ...(t.lang ? str(0x22b59c, t.lang) : []),
    ...(t.name ? str(0x536e, t.name) : []),
    ...(t.channels ? el(0xe1, uint(0x9f, t.channels)) : []),
  ])
}

const TRACKS: T[] = [
  { number: 1, type: 1, codec: 'V_MPEGH/ISO/HEVC' },
  { number: 2, type: 2, codec: 'A_EAC3', lang: 'por', name: 'Portuguese (Brazil)', def: 1, channels: 6 },
  { number: 3, type: 2, codec: 'A_TRUEHD', lang: 'eng', name: 'TrueHD Atmos 7.1', def: 0, channels: 8 },
  { number: 4, type: 2, codec: 'A_AC3', lang: 'eng', name: 'AC-3 5.1', def: 0, channels: 6 },
  { number: 5, type: 0x11, codec: 'S_TEXT/UTF8', lang: 'eng', def: 0 },
]

/** EBML header + Segment(SeekHead, Tracks or padding, Cluster with payload). */
function buildMkv(opts: { tracksFarAway?: boolean } = {}): Uint8Array {
  const ebml = el(0x1a45dfa3, str(0x4282, 'matroska'))
  const tracks = el(0x1654ae6b, TRACKS.flatMap(trackEntry))
  const cluster = el(0x1f43b675, new Array(5000).fill(7))
  const pad = opts.tracksFarAway ? el(0xec, new Array(1024 * 1024 + 100).fill(0)) : []
  // SeekHead size is fixed (one Seek), so we can compute the Tracks position before writing it.
  const seekHeadFor = (pos: number) => el(0x114d9b74, el(0x4dbb, [...el(0x53ab, [0x16, 0x54, 0xae, 0x6b]), ...el(0x53ac, [(pos >> 24) & 0xff, (pos >> 16) & 0xff, (pos >> 8) & 0xff, pos & 0xff])]))
  const seekLen = seekHeadFor(0).length
  const body = opts.tracksFarAway
    ? [...seekHeadFor(seekLen + pad.length + cluster.length), ...pad, ...cluster, ...tracks]
    : [...seekHeadFor(seekLen), ...tracks, ...cluster]
  return new Uint8Array([...ebml, ...el(0x18538067, body)])
}

test('parseHead finds the audio tracks with language, name, codec and default flag', () => {
  const r = parseHead(buildMkv())
  assert.equal(r.kind, 'tracks')
  if (r.kind !== 'tracks') return
  const audio = r.tracks.filter((t) => t.type === 2)
  assert.deepEqual(
    audio.map((t) => [t.number, t.language, t.name, t.codec, t.isDefault, t.channels]),
    [
      [2, 'por', 'Portuguese (Brazil)', 'A_EAC3', true, 6],
      [3, 'eng', 'TrueHD Atmos 7.1', 'A_TRUEHD', false, 8],
      [4, 'eng', 'AC-3 5.1', 'A_AC3', false, 6],
    ],
  )
})

test('parseHead follows the SeekHead when Tracks lies beyond the first bytes', () => {
  const file = buildMkv({ tracksFarAway: true })
  const r = parseHead(file.subarray(0, 1024 * 1024))
  assert.equal(r.kind, 'seek')
  if (r.kind !== 'seek') return
  const tracks = parseTracksElement(file.subarray(r.tracksOffset), r.tracksOffset)
  assert.equal(tracks?.filter((t) => t.type === 2).length, 3)
  // Offsets are absolute: the byte there really is the TrackType value.
  for (const t of tracks!) assert.equal(file[t.typeOffset], t.type)
})

test('patchesFor hides the other audio tracks and nothing else', () => {
  const file = buildMkv()
  const r = parseHead(file)
  if (r.kind !== 'tracks') throw new Error('no tracks')
  assert.deepEqual(patchesFor(r.tracks, 2), [], 'first + default track needs no change')
  const p = patchesFor(r.tracks, 4)
  const patched = file.slice()
  for (const x of p) patched[x.offset] = x.value
  const after = parseHead(patched)
  if (after.kind !== 'tracks') throw new Error('no tracks after patch')
  assert.deepEqual(
    after.tracks.map((t) => [t.number, t.type]),
    [
      [1, 1],
      [2, TRACK_TYPE_IGNORED],
      [3, TRACK_TYPE_IGNORED],
      [4, 2],
      [5, 0x11],
    ],
  )
  assert.equal(after.tracks.find((t) => t.number === 4)?.isDefault, true)
  assert.equal(patched.length, file.length)
})

test('patch list round-trips and rejects junk', () => {
  const p = [
    { offset: 300, value: 32 },
    { offset: 120, value: 1 },
  ]
  assert.deepEqual(decodePatches(encodePatches(p)), [p[1], p[0]])
  assert.equal(decodePatches('12.999'), null)
  assert.equal(decodePatches('999999999.1'), null)
  assert.equal(decodePatches('abc'), null)
  assert.equal(decodePatches(null), null)
})

// ---------- the Worker routes against a fake video host ----------

function serveFile(file: Uint8Array) {
  const real = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const range = headers.get('range')
    calls.push(range ?? 'full')
    const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null
    if (!m) return new Response(file, { headers: { 'content-type': 'video/x-matroska', 'content-length': String(file.length) } })
    const start = Number(m[1])
    const end = m[2] ? Math.min(Number(m[2]), file.length - 1) : file.length - 1
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: { 'content-type': 'video/x-matroska', 'content-range': `bytes ${start}-${end}/${file.length}` },
    })
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = real) }
}

test('/tracks lists audio tracks with a cast URL each', async () => {
  const fake = serveFile(buildMkv())
  try {
    const res = await worker.fetch(new Request('https://relay.test/tracks?u=' + encodeURIComponent('https://cdn.test/movie.mkv')), {})
    const data = (await res.json()) as { container: string; audio: { number: number; url: string; playable: boolean; isDefault: boolean }[]; subtitles: unknown[] }
    assert.equal(data.container, 'mkv')
    assert.deepEqual(data.audio.map((a) => [a.number, a.playable, a.isDefault]), [
      [2, true, true],
      [3, false, false],
      [4, true, false],
    ])
    assert.equal(data.audio[0].url, 'https://cdn.test/movie.mkv')
    assert.match(data.audio[2].url, /^https:\/\/relay\.test\/media\?u=.+&p=\d+\.32/)
    assert.equal(data.subtitles.length, 1)
  } finally {
    fake.restore()
  }
})

test('/media returns the file with only the header bytes changed, for any byte range', async () => {
  const file = buildMkv()
  const fake = serveFile(file)
  try {
    const list = (await (await worker.fetch(new Request('https://relay.test/tracks?u=https://cdn.test/m.mkv'), {})).json()) as {
      audio: { number: number; url: string }[]
    }
    const mediaUrl = list.audio.find((a) => a.number === 4)!.url
    const full = new Uint8Array(await (await worker.fetch(new Request(mediaUrl), {})).arrayBuffer())
    assert.equal(full.length, file.length)
    const r = parseHead(full)
    if (r.kind !== 'tracks') throw new Error('no tracks')
    assert.deepEqual(r.tracks.filter((t) => t.type === 2).map((t) => t.number), [4])
    let diffs = 0
    for (let i = 0; i < file.length; i++) if (file[i] !== full[i]) diffs++
    assert.equal(diffs, 3) // two audio tracks hidden + the default flag of the chosen one

    // Range starting at 0 (what the Chromecast asks first)
    const open = await worker.fetch(new Request(mediaUrl, { headers: { Range: 'bytes=0-' } }), {})
    assert.equal(open.status, 206)
    assert.equal(open.headers.get('content-range'), `bytes 0-${file.length - 1}/${file.length}`)
    assert.deepEqual(new Uint8Array(await open.arrayBuffer()), full)

    // A seek past the header streams straight from the source
    const seek = await worker.fetch(new Request(mediaUrl, { headers: { Range: 'bytes=4000-4999' } }), {})
    assert.equal(seek.status, 206)
    assert.deepEqual(new Uint8Array(await seek.arrayBuffer()), file.slice(4000, 5000))

    // A small range ending inside the header
    const small = await worker.fetch(new Request(mediaUrl, { headers: { Range: 'bytes=10-99' } }), {})
    assert.deepEqual(new Uint8Array(await small.arrayBuffer()), full.slice(10, 100))
  } finally {
    fake.restore()
  }
})

test('/media refuses requests without a valid patch list', async () => {
  const res = await worker.fetch(new Request('https://relay.test/media?u=https://cdn.test/m.mkv'), {})
  assert.equal(res.status, 400)
})

test('with MEDIA_PROXY off, /media is refused and /tracks only links the default track', async () => {
  const fake = serveFile(buildMkv())
  try {
    const env = { MEDIA_PROXY: 'off' }
    const res = await worker.fetch(new Request('https://relay.test/tracks?u=https://cdn.test/m.mkv'), env)
    const data = (await res.json()) as { audio: { number: number; url: string }[] }
    assert.deepEqual(data.audio.map((a) => [a.number, a.url]), [
      [2, 'https://cdn.test/m.mkv'],
      [3, ''],
      [4, ''],
    ])
    const media = await worker.fetch(new Request('https://relay.test/media?u=https://cdn.test/m.mkv&p=1.32'), env)
    assert.equal(media.status, 403)
    const health = (await (await worker.fetch(new Request('https://relay.test/health'), env)).json()) as { media: boolean }
    assert.equal(health.media, false)
  } finally {
    fake.restore()
  }
})
