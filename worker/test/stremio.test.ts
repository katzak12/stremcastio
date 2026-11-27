import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeCfg, encodeCfg, toCastStreams } from '../src/stremio.ts'
import worker from '../src/index.ts'

const BASE = 'https://torrentio.strem.fun/realdebrid=ABC123'

test('cfg round-trips and only accepts https bases', () => {
  assert.equal(decodeCfg(encodeCfg(BASE)), BASE)
  assert.equal(decodeCfg(encodeCfg(`${BASE}/manifest.json`)), BASE)
  assert.equal(decodeCfg(encodeCfg('http://insecure.example')), null)
  assert.equal(decodeCfg('%%%'), null)
})

test('toCastStreams turns streams into stremcastio:// links', () => {
  const out = toCastStreams([
    { url: 'https://torrentio.strem.fun/resolve/realdebrid/ABC123/h/null/0/Movie.2009.mkv', name: 'Torrentio\n4k', title: 'Movie.2009.mkv\nseeds 10', behaviorHints: { filename: 'Movie.2009.mkv' } },
    { name: 'no url' },
  ])
  assert.equal(out.length, 1)
  const link = new URL(out[0].externalUrl)
  assert.equal(link.protocol, 'stremcastio:')
  assert.equal(link.searchParams.get('url'), 'https://torrentio.strem.fun/resolve/realdebrid/ABC123/h/null/0/Movie.2009.mkv')
  assert.equal(link.searchParams.get('title'), 'Movie.2009.mkv')
  assert.match(out[0].name, /^StremCastio\nTorrentio 4k$/)
})

test('/stremio routes: manifest and streams via the user\'s add-on', async () => {
  const cfg = encodeCfg(BASE)
  const real = globalThis.fetch
  let asked = ''
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked = String(input)
    return new Response(JSON.stringify({ streams: [{ url: 'https://x.test/a.mkv', name: 'T', title: 'a.mkv' }] }))
  }) as typeof fetch
  try {
    const man = (await (await worker.fetch(new Request(`https://relay.test/stremio/${cfg}/manifest.json`), {})).json()) as { id: string }
    assert.equal(man.id, 'community.stremcastio')
    const res = await worker.fetch(new Request(`https://relay.test/stremio/${cfg}/stream/movie/tt0327597.json`), {})
    const data = (await res.json()) as { streams: { externalUrl: string }[] }
    assert.equal(asked, `${BASE}/stream/movie/tt0327597.json`)
    assert.equal(data.streams.length, 1)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    const bad = await worker.fetch(new Request('https://relay.test/stremio/%%/manifest.json'), {})
    assert.equal(bad.status, 404)
  } finally {
    globalThis.fetch = real
  }
})
