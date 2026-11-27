import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../src/index.ts'

test('/stremio manifest and one "Cast to TV" entry per title, without any config', async () => {
  for (const base of ['https://relay.test/stremio', 'https://relay.test/stremio/oldCfgSegment']) {
    const man = (await (await worker.fetch(new Request(`${base}/manifest.json`), {})).json()) as { id: string; resources: string[] }
    assert.equal(man.id, 'community.stremcastio')
    const res = await worker.fetch(new Request(`${base}/stream/series/tt0903747%3A1%3A2.json`), {})
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    const data = (await res.json()) as { streams: { externalUrl: string }[] }
    assert.equal(data.streams.length, 1)
    const open = new URL(data.streams[0].externalUrl)
    assert.equal(open.origin + open.pathname, 'https://relay.test/open')
    assert.equal(open.searchParams.get('type'), 'series')
    assert.equal(open.searchParams.get('id'), 'tt0903747:1:2')
  }
  const other = (await (await worker.fetch(new Request('https://relay.test/stremio/stream/movie/kitsu:1.json'), {})).json()) as { streams: unknown[] }
  assert.equal(other.streams.length, 0)
})

test('/open hands the title to the app', async () => {
  const res = await worker.fetch(new Request('https://relay.test/open?type=movie&id=tt0327597'), {})
  const html = await res.text()
  assert.match(html, /stremcastio:\/\/pick\?type=movie&amp;id=tt0327597/)
  assert.match(html, /location\.href="stremcastio:\/\/pick\?type=movie&id=tt0327597"/)
  const bad = await worker.fetch(new Request('https://relay.test/open?type=movie&id=<script>'), {})
  assert.equal(bad.status, 400)
})
