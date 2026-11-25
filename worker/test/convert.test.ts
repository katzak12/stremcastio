import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { cleanCueText, decodeBytes, formatVttTime, isGzip, parseTime, toVtt } from '../src/convert.ts'
import worker from '../src/index.ts'

const SRT = `1
00:00:01,000 --> 00:00:04,500
<font color="#ffff00">Hallo</font> <i>wereld</i>
{\\an8}Tom & Jerry <3

2
00:01:02,05 --> 00:01:03,9
Tweede regel


3
bad timing line
ignored
`

test('parseTime handles , and . and short fractions', () => {
  assert.equal(parseTime('00:00:01,000'), 1000)
  assert.equal(parseTime('00:01:02,05'), 62050)
  assert.equal(parseTime('1:02:03.4'), 3723400)
  assert.equal(parseTime('02:03.456'), 123456)
  assert.equal(parseTime('nope'), null)
})

test('formatVttTime', () => {
  assert.equal(formatVttTime(3723400), '01:02:03.400')
  assert.equal(formatVttTime(-50), '00:00:00.000')
})

test('SRT -> VTT with cleaning', () => {
  const { vtt, cues, format } = toVtt(SRT)
  assert.equal(format, 'srt')
  assert.equal(cues, 2)
  assert.ok(vtt.startsWith('WEBVTT\n\n'))
  assert.ok(vtt.includes('00:00:01.000 --> 00:00:04.500 line:0\nHallo <i>wereld</i>\nTom &amp; Jerry &lt;3'))
  assert.ok(vtt.includes('00:01:02.050 --> 00:01:03.900\nTweede regel'))
})

test('offset shifts and drops cues before zero', () => {
  const { vtt } = toVtt(SRT, -2000)
  assert.ok(vtt.includes('00:00:00.000 --> 00:00:02.500'))
  const { vtt: v2 } = toVtt(SRT, -5000)
  assert.ok(!v2.includes('Hallo'))
})

test('CRLF input', () => {
  assert.equal(toVtt(SRT.replace(/\n/g, '\r\n')).cues, 2)
})

test('ASS -> VTT', () => {
  const ass = `[Script Info]
Title: x

[V4+ Styles]
Format: Name, Fontname
Style: Default,Arial

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:05.10,0:00:07.00,Default,,0,0,0,,{\\i1}Hoi{\\i0}, hoe gaat het?\\Nprima
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Eerst`
  const { vtt, cues, format } = toVtt(ass)
  assert.equal(format, 'ass')
  assert.equal(cues, 2)
  assert.ok(vtt.indexOf('Eerst') < vtt.indexOf('Hoi'))
  assert.ok(vtt.includes('00:00:05.100 --> 00:00:07.000\n<i>Hoi</i>, hoe gaat het?\nprima'))
})

test('VTT passthrough re-renders', () => {
  const { vtt, cues } = toVtt('WEBVTT\n\n00:01.000 --> 00:02.000\nhi\n')
  assert.equal(cues, 1)
  assert.ok(vtt.includes('00:00:01.000 --> 00:00:02.000\nhi'))
})

test('encodings: UTF-8 BOM, cp1252, UTF-16LE', () => {
  const enc = new TextEncoder()
  assert.equal(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('één')])), 'één')
  assert.equal(decodeBytes(new Uint8Array([0xe9, 0xe9, 0x6e, 0x80])), 'één€')
  const u16 = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0xe9, 0x00])
  assert.equal(decodeBytes(u16), 'hé')
})

test('cleanCueText keeps i/b/u only', () => {
  assert.equal(cleanCueText('<B>bold</B> <span>x</span>'), '<b>bold</b> x')
})

test('worker: /vtt converts gzip SRT from upstream with CORS', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(gzipSync(Buffer.from(SRT)))) as typeof fetch
  try {
    const res = await worker.fetch(new Request('https://relay.test/vtt?src=https://x.test/a.srt&offset=500'), {})
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    assert.match(res.headers.get('content-type') ?? '', /text\/vtt/)
    const body = await res.text()
    assert.ok(body.includes('00:00:01.500 --> 00:00:05.000'))
  } finally {
    globalThis.fetch = realFetch
  }
  assert.ok(isGzip(gzipSync(Buffer.from('x'))))
})

test('worker: errors', async () => {
  assert.equal((await worker.fetch(new Request('https://relay.test/vtt'), {})).status, 400)
  assert.equal((await worker.fetch(new Request('https://relay.test/vtt?src=file:///etc/passwd'), {})).status, 400)
  const up = await worker.fetch(new Request('https://relay.test/upload', { method: 'POST', body: SRT }), {})
  assert.equal(up.status, 501)
})

test('worker: upload + fetch with KV', async () => {
  const store = new Map<string, string>()
  const SUBS = {
    put: async (k: string, v: string) => void store.set(k, v),
    get: async (k: string) => store.get(k) ?? null,
  } as unknown as KVNamespace
  const up = await worker.fetch(new Request('https://relay.test/upload', { method: 'POST', body: SRT }), { SUBS })
  assert.equal(up.status, 200)
  const { url } = (await up.json()) as { url: string }
  const got = await worker.fetch(new Request(url), { SUBS })
  assert.equal(got.status, 200)
  assert.ok((await got.text()).includes('Tweede regel'))
})

test('ASS: top-aligned styles, \\an8, unclosed italics, drawings skipped', () => {
  const ass = `[Script Info]
Title: x

[V4+ Styles]
Format: Name, Fontname, Fontsize, Alignment
Style: Default,Arial,20,2
Style: Sign,Arial,20,8

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Gewoon onderin
Dialogue: 0,0:00:03.00,0:00:04.00,Sign,,0,0,0,,BORD
Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,{\\an8}Bovenin
Dialogue: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,{\\i1}Cursief tot het eind
Dialogue: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100`
  const { vtt, cues } = toVtt(ass)
  assert.equal(cues, 4)
  assert.ok(vtt.includes('00:00:01.000 --> 00:00:02.000\nGewoon onderin'))
  assert.ok(vtt.includes('00:00:03.000 --> 00:00:04.000 line:0\nBORD'))
  assert.ok(vtt.includes('00:00:05.000 --> 00:00:06.000 line:0\nBovenin'))
  assert.ok(vtt.includes('<i>Cursief tot het eind</i>'))
  assert.ok(!vtt.includes('m 0 0'))
})

test('VTT: placement settings kept, styling settings dropped', () => {
  const { vtt } = toVtt('WEBVTT\n\n00:01.000 --> 00:02.000 line:0 position:50% size:80% vertical:rl\nboven\n')
  assert.ok(vtt.includes('00:00:01.000 --> 00:00:02.000 line:0 position:50%\nboven'))
})

test('SRT: bold/underline overrides become tags', () => {
  const { vtt } = toVtt('1\n00:00:01,000 --> 00:00:02,000\n{\\b1}Vet{\\b0} en {\\u1}onder{\\u0}\n')
  assert.ok(vtt.includes('<b>Vet</b> en <u>onder</u>'))
})
