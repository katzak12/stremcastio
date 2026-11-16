import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeStream, extractUrl, parseM3u, parseRelease, unwrapProxy } from '../src/lib/stream'
import { addonBase, pickBestMeta, rankSubtitles, searchSubtitles, stremioVideoId, subtitlesFromExtras } from '../src/lib/subtitles'
import { findLangInText, normalizeLang } from '../src/lib/languages'

test('parseRelease: movies', () => {
  assert.deepEqual(parseRelease('The.Matrix.1999.1080p.BluRay.x264-GRP.mkv'), { title: 'The Matrix', year: 1999, season: undefined, episode: undefined })
  assert.equal(parseRelease('Blade.Runner.2049.2017.2160p.UHD.mkv').title, 'Blade Runner 2049')
  assert.equal(parseRelease('Blade.Runner.2049.2017.2160p.UHD.mkv').year, 2017)
  assert.equal(parseRelease("Charlotte's.Web.2006.720p.mp4").title, "Charlotte's Web")
  assert.equal(parseRelease('2001.A.Space.Odyssey.1968.REMASTERED.mkv').title, '2001 A Space Odyssey')
  assert.equal(parseRelease('Oppenheimer (2023) [1080p] [WEBRip] [5.1] [YTS.MX].mp4').title, 'Oppenheimer')
  assert.equal(parseRelease('Dune Part Two 2160p WEB-DL DDP5 1 Atmos.mkv').title, 'Dune Part Two')
})

test('parseRelease: episodes', () => {
  const r = parseRelease('Breaking.Bad.S05E14.Ozymandias.1080p.WEB-DL.mkv')
  assert.equal(r.title, 'Breaking Bad')
  assert.equal(r.season, 5)
  assert.equal(r.episode, 14)
  const r2 = parseRelease('The.Office.US.2x03.mkv')
  assert.equal(r2.title, 'The Office US')
  assert.equal(r2.episode, 3)
  assert.equal(parseRelease('Severance.2022.S02E01.mkv').year, 2022)
  assert.equal(parseRelease('Severance.2022.S02E01.mkv').title, 'Severance')
})

test('describeStream: real-debrid style URL', () => {
  const s = describeStream('https://abc.download.real-debrid.com/d/XYZ123/The.Matrix.1999.1080p.mkv')
  assert.equal(s.filename, 'The.Matrix.1999.1080p.mkv')
  assert.equal(s.title, 'The Matrix')
  assert.equal(s.contentType, 'video/mp4')
  assert.equal(s.isLocalOnly, false)
})

test('describeStream: proxy unwrapping and local detection', () => {
  const inner = 'https://cdn.example/x/Movie.2020.mp4'
  assert.equal(unwrapProxy(`http://127.0.0.1:11470/proxy?from=${encodeURIComponent(inner)}`), inner)
  assert.equal(describeStream('http://127.0.0.1:11470/abcdef/0').isLocalOnly, true)
  assert.equal(describeStream('https://x.test/live/index.m3u8').contentType, 'application/x-mpegURL')
  assert.equal(describeStream('https://x.test/play?filename=Some.Film.2019.mkv&t=1').title, 'Some Film')
  assert.equal(describeStream('https://x.test/d/Some%20Film%20(2019).mkv').title, 'Some Film')
})

test('extractUrl / parseM3u', () => {
  assert.equal(extractUrl('Look: https://a.test/v.mkv nice'), 'https://a.test/v.mkv')
  assert.equal(extractUrl('nothing'), null)
  assert.deepEqual(parseM3u('#EXTM3U\n#EXTINF:-1,The Matrix\nhttps://a.test/v.mkv\n'), { url: 'https://a.test/v.mkv', title: 'The Matrix' })
})

test('languages', () => {
  assert.equal(normalizeLang('dut'), 'nl')
  assert.equal(normalizeLang('NLD'), 'nl')
  assert.equal(normalizeLang('pob'), 'pt')
  assert.equal(normalizeLang('pt-BR'), 'pt')
  assert.equal(normalizeLang('ell'), 'el')
  assert.equal(normalizeLang(undefined), 'und')
  assert.equal(findLangInText('/en/download/x'), 'en')
  assert.equal(findLangInText('Dutch subs 1080'), 'nl')
  assert.equal(findLangInText('subs 1080'), 'und')
})

test('addonBase', () => {
  assert.equal(addonBase('stremio://foo.test/abc/manifest.json'), 'https://foo.test/abc')
  assert.equal(addonBase('https://foo.test/manifest.json?x=1'), 'https://foo.test')
  assert.equal(addonBase('https://foo.test/'), 'https://foo.test')
})

test('pickBestMeta prefers exact title + year', () => {
  const metas = [
    { id: 'tt10838180', name: 'The Matrix Resurrections', releaseInfo: '2021' },
    { id: 'tt0133093', name: 'The Matrix', releaseInfo: '1999' },
    { id: 'tt0234215', name: 'The Matrix Reloaded', releaseInfo: '2003' },
  ]
  assert.equal(pickBestMeta(metas, 'The Matrix', 1999)?.id, 'tt0133093')
  assert.equal(pickBestMeta(metas, 'The Matrix')?.id, 'tt0133093')
  assert.equal(pickBestMeta([{ id: 'tt1', name: 'Dune', releaseInfo: '1984' }, { id: 'tt2', name: 'Dune', releaseInfo: '2021' }], 'Dune', 2021)?.id, 'tt2')
})

test('stremioVideoId', () => {
  assert.deepEqual(stremioVideoId('tt1', { title: 'x', season: 1, episode: 2 }), { type: 'series', id: 'tt1:1:2' })
  assert.deepEqual(stremioVideoId('tt1', { title: 'x' }), { type: 'movie', id: 'tt1' })
})

test('rankSubtitles respects preference order and stability', () => {
  const o = (key: string, lang: string) => ({ key, lang, url: key, label: '', source: 's' })
  const ranked = rankSubtitles([o('a', 'de'), o('b', 'en'), o('c', 'nl'), o('d', 'en'), o('e', 'nl')], ['nl', 'en'])
  assert.deepEqual(ranked.map((x) => x.key), ['c', 'e', 'b', 'd', 'a'])
})

test('subtitlesFromExtras: MX Player and VLC styles', () => {
  const subs = subtitlesFromExtras({
    subs: ['https://subs5.strem.io/en/download/a.srt', 'http://127.0.0.1:11470/subtitles.vtt?from=' + encodeURIComponent('https://s.test/nl/b.srt')],
    'subs.name': ['English', 'Nederlands'],
    'subs.enable': ['https://subs5.strem.io/en/download/a.srt'],
    subtitles_location: 'https://s.test/c.vtt',
    title: 'The Matrix',
    position: '0',
  })
  assert.deepEqual(subs.map((s) => s.url), ['https://subs5.strem.io/en/download/a.srt', 'https://s.test/nl/b.srt', 'https://s.test/c.vtt'])
  assert.equal(subs[0].lang, 'en')
  assert.equal(subs[1].lang, 'nl')
  assert.equal(subs[1].label, 'Nederlands')
})

test('searchSubtitles end-to-end with mocked add-ons', async () => {
  const calls: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('cinemeta')) {
      return Response.json({ metas: [{ id: 'tt0903747', name: 'Breaking Bad', releaseInfo: '2008–2013' }] })
    }
    if (url.startsWith('https://broken.test')) return new Response('nope', { status: 500 })
    return Response.json({
      subtitles: [
        { id: '1', url: 'https://subs.test/1', lang: 'dut', subtitleFileName: 'bb.nl.srt' },
        { id: '2', url: 'https://subs.test/2', lang: 'eng' },
        { id: '2b', url: 'https://subs.test/2', lang: 'eng' },
      ],
    })
  }) as typeof fetch
  try {
    const res = await searchSubtitles({
      release: { title: 'Breaking Bad', season: 5, episode: 14 },
      filename: 'Breaking.Bad.S05E14.mkv',
      addons: ['https://opensubtitles-v3.strem.io/manifest.json', 'https://broken.test'],
    })
    assert.equal(res.imdb?.id, 'tt0903747')
    assert.equal(res.options.length, 2)
    assert.equal(res.options[0].lang, 'nl')
    assert.equal(res.options[0].label, 'bb.nl.srt')
    assert.equal(res.errors.length, 1)
    assert.ok(calls.some((c) => c === 'https://opensubtitles-v3.strem.io/subtitles/series/tt0903747%3A5%3A14/filename=Breaking.Bad.S05E14.mkv.json'))
    assert.ok(calls.some((c) => c.includes('/catalog/series/top/search=Breaking%20Bad.json')))
  } finally {
    globalThis.fetch = realFetch
  }
})
