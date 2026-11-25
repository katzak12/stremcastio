import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLoadRequest, buildMetadata, sleepPlaybackDuration, textStyle } from '../src/lib/cast'
import { APP_LANGUAGES, setAppLanguage, stringsFor, t } from '../src/lib/i18n'
import { englishName, LANGUAGE_CHOICES, withEnglishFirst } from '../src/lib/languages'
import { formatClock, formatRuntime, parseRuntime, toDetails } from '../src/lib/meta'
import { describeStream } from '../src/lib/stream'

test('runtime parsing and formatting', () => {
  assert.equal(parseRuntime('136 min'), 136)
  assert.equal(parseRuntime('2h 16min'), 136)
  assert.equal(parseRuntime('1h'), 60)
  assert.equal(parseRuntime('45'), 45)
  assert.equal(parseRuntime(''), undefined)
  assert.equal(parseRuntime(undefined), undefined)
  assert.equal(formatRuntime(136), '2h 16m')
  assert.equal(formatRuntime(45), '45m')
  assert.equal(formatRuntime(120), '2h')
  assert.equal(formatRuntime(undefined), undefined)
})

test('formatClock', () => {
  assert.equal(formatClock(0), '0:00')
  assert.equal(formatClock(69), '1:09')
  assert.equal(formatClock(3909), '1:05:09')
  assert.equal(formatClock(null), '0:00')
  assert.equal(formatClock(-5), '0:00')
})

const seriesMeta = {
  id: 'tt0903747',
  name: 'Breaking Bad',
  poster: 'https://img/poster.jpg',
  background: 'https://img/bg.jpg',
  imdbRating: '9.5',
  runtime: '49 min',
  releaseInfo: '2008–2013',
  genres: ['Crime', 'Drama', 'Thriller', 'Extra'],
  description: 'Series description',
  videos: [
    { season: 5, episode: 13, name: 'To\'hajiilee', thumbnail: 'https://img/5x13.jpg' },
    { season: 5, episode: 14, name: 'Ozymandias', thumbnail: 'https://img/5x14.jpg', overview: 'Episode overview' },
  ],
}

test('toDetails: episode uses episode still, title and overview', () => {
  const d = toDetails(seriesMeta, { title: 'Breaking Bad', season: 5, episode: 14 })
  assert.equal(d.image, 'https://img/5x14.jpg')
  assert.equal(d.episodeTitle, 'Ozymandias')
  assert.equal(d.description, 'Episode overview')
  assert.equal(d.rating, 9.5)
  assert.equal(d.runtimeMinutes, 49)
  assert.deepEqual(d.genres, ['Crime', 'Drama', 'Thriller'])
})

test('toDetails: movie uses backdrop, falls back to poster; bad rating ignored', () => {
  const movie = { id: 'tt0133093', name: 'The Matrix', poster: 'https://img/p.jpg', background: 'https://img/b.jpg', imdbRating: '8.7', runtime: '136 min', year: 1999 }
  const d = toDetails(movie, { title: 'The Matrix', year: 1999 })
  assert.equal(d.image, 'https://img/b.jpg')
  assert.equal(d.year, '1999')
  assert.equal(d.rating, 8.7)
  const d2 = toDetails({ id: 'tt1', name: 'X', poster: 'https://img/p.jpg', imdbRating: '' }, { title: 'X' })
  assert.equal(d2.image, 'https://img/p.jpg')
  assert.equal(d2.rating, undefined)
  // Episode not in the list -> series backdrop
  assert.equal(toDetails(seriesMeta, { title: 'Breaking Bad', season: 9, episode: 1 }).image, 'https://img/bg.jpg')
})

test('buildMetadata: TV gets artwork and episode info', () => {
  const ep = describeStream('https://x/Breaking.Bad.S05E14.1080p.mkv')
  const d = toDetails(seriesMeta, ep)
  const m = buildMetadata(ep, d)
  assert.equal(m.type, 'tvShow')
  assert.equal(m.seriesTitle, 'Breaking Bad')
  assert.equal(m.title, 'S05E14 · Ozymandias')
  assert.deepEqual(m.images, [{ url: 'https://img/poster.jpg' }, { url: 'https://img/5x14.jpg' }])
  const movie = buildMetadata(describeStream('https://x/The.Matrix.1999.mkv'), null)
  assert.equal(movie.type, 'movie')
  assert.equal(movie.title, 'The Matrix')
  assert.deepEqual(movie.images, [])
})

test('subtitle languages: English always first, no duplicates', () => {
  assert.deepEqual(withEnglishFirst([]), ['en'])
  assert.deepEqual(withEnglishFirst(['nl', 'en', 'de']), ['en', 'nl', 'de'])
  assert.deepEqual(withEnglishFirst(['dut', 'nl', 'eng']), ['en', 'nl'])
  assert.equal(englishName('nl'), 'Dutch')
  assert.ok(LANGUAGE_CHOICES.every((l) => l.english.length > 0))
})

test('i18n: default English, switch and fall back', () => {
  assert.equal(APP_LANGUAGES[0].key, 'en')
  setAppLanguage(undefined)
  assert.equal(t.settings, 'Settings')
  setAppLanguage('nl')
  assert.equal(t.settings, 'Instellingen')
  setAppLanguage('xx')
  assert.equal(t.settings, 'Settings')
  for (const { key } of APP_LANGUAGES) {
    const s = stringsFor(key)
    for (const [k, v] of Object.entries(s)) assert.ok(typeof v === 'string' && v.length > 0, `${key}.${k}`)
  }
})

import { findNextEpisode } from '../src/lib/meta'
import { addonFromStreamUrl, pickBestStream } from '../src/lib/streams'

test('findNextEpisode: within season, across seasons, skips specials and unaired', () => {
  const videos = [
    { season: 0, episode: 1 },
    { season: 1, episode: 2, name: 'Two' },
    { season: 1, episode: 1, name: 'One' },
    { season: 2, episode: 1, name: 'S2 start', released: '2020-01-01T00:00:00Z' },
    { season: 2, episode: 2, name: 'Future', released: '2999-01-01T00:00:00Z' },
  ]
  assert.deepEqual(findNextEpisode(videos, 1, 1), { season: 1, episode: 2, name: 'Two', thumbnail: undefined })
  assert.equal(findNextEpisode(videos, 1, 2)?.name, 'S2 start')
  assert.equal(findNextEpisode(videos, 2, 1), undefined) // not aired yet
  assert.equal(findNextEpisode(videos, 2, 2), undefined)
})

test('addonFromStreamUrl: Torrentio debrid links', () => {
  assert.equal(
    addonFromStreamUrl('https://torrentio.strem.fun/resolve/realdebrid/ABC123/hash/null/0/Show.S01E01.mkv'),
    'https://torrentio.strem.fun/realdebrid=ABC123',
  )
  assert.equal(addonFromStreamUrl('https://abc.download.real-debrid.com/d/XYZ/file.mkv'), null)
})

test('pickBestStream: prefers same quality, group and cached', () => {
  const current = 'Show.S01E01.1080p.WEB-DL.x264-NTb.mkv'
  const streams = [
    { name: 'Torrentio\n4k', title: 'Show.S01E02.2160p.HDR.x265-OTHER', url: 'https://x/a' },
    { name: '[RD download] Torrentio\n1080p', title: 'Show.S01E02.1080p.WEB-DL.x264-NTb', url: 'https://x/b' },
    { name: '[RD+] Torrentio\n1080p', title: 'Show.S01E02.1080p.WEB-DL.x264-NTb', url: 'https://x/c' },
    { name: '[RD+] Torrentio\n720p', title: 'Show.S01E02.720p.HDTV', url: 'https://x/d' },
    { name: 'no url', infoHash: 'abc' },
  ]
  assert.equal(pickBestStream(streams, current)?.url, 'https://x/c')
  assert.equal(pickBestStream([], current), null)
})

import { shouldOfferResume } from '../src/lib/resume'

test('resume: only offered between the first minute and the last 5%', () => {
  assert.equal(shouldOfferResume(30, 3000), false)
  assert.equal(shouldOfferResume(600, 3000), true)
  assert.equal(shouldOfferResume(2900, 3000), false)
  assert.equal(shouldOfferResume(600, 0), true) // unknown duration
})

test('sleep timer: TV-side playback limit in a one-item queue', () => {
  const now = 1_000_000
  assert.equal(sleepPlaybackDuration('off', null, now), undefined)
  assert.equal(sleepPlaybackDuration('end', null, now), undefined)
  assert.equal(sleepPlaybackDuration(30, now + 30 * 60000, now), 1800)
  assert.equal(sleepPlaybackDuration(30, now - 1000, now), 5)

  const stream = describeStream('https://x/The.Matrix.1999.mkv')
  const look = { fontScale: 1, color: 'white' as const, background: 'none' as const }
  const timed = buildLoadRequest({ stream, vttUrl: 'https://r/vtt', look, startTime: 120, playbackDuration: 1800 }) as any
  assert.equal(timed.mediaInfo, undefined)
  assert.equal(timed.queueData.items.length, 1)
  assert.equal(timed.queueData.items[0].playbackDuration, 1800)
  assert.equal(timed.queueData.items[0].startTime, 120)
  assert.deepEqual(timed.queueData.items[0].activeTrackIds, [1])
  assert.equal(timed.queueData.items[0].mediaInfo.contentUrl, stream.url)
  const plain = buildLoadRequest({ stream, vttUrl: null, look }) as any
  assert.equal(plain.queueData, undefined)
  assert.equal(plain.mediaInfo.contentUrl, stream.url)
})

test('subtitle look', () => {
  const y = textStyle({ fontScale: 1.5, color: 'yellow', background: 'box' }) as any
  assert.equal(y.foregroundColor, '#FFD65CFF')
  assert.equal(y.backgroundColor, '#000000B3')
  assert.equal(y.fontScale, 1.5)
  const w = textStyle({ fontScale: 1, color: 'white', background: 'none' }) as any
  assert.equal(w.edgeType, 'outline')
  assert.equal(w.backgroundColor, '#00000000')
})

import { hasDolbyAudio, unsupportedAudio } from '../src/lib/streams'

test('audio: DTS/TrueHD flagged, Dolby recognised', () => {
  assert.equal(unsupportedAudio('Movie.2019.2160p.UHD.BluRay.REMUX.HDR.HEVC.DTS-HD.MA.7.1-GRP.mkv'), 'DTS')
  assert.equal(unsupportedAudio('Movie 2019 1080p BluRay DTS x264'), 'DTS')
  assert.equal(unsupportedAudio('Movie.2019.2160p.BluRay.REMUX.TrueHD.Atmos.7.1.mkv'), 'Dolby TrueHD')
  assert.equal(unsupportedAudio('Movie.2019.1080p.WEB-DL.DDP5.1.Atmos.H.264.mkv'), null)
  assert.equal(unsupportedAudio('Midsts.of.Time.2020.mkv'), null) // "dts" inside a word
  assert.ok(hasDolbyAudio('Movie.2019.1080p.WEB-DL.DDP5.1.H.264'))
  assert.ok(hasDolbyAudio('Movie 2019 1080p AC3 x264'))
  assert.ok(hasDolbyAudio('Show S01E01 1080p WEB EAC3 5.1'))
  assert.ok(!hasDolbyAudio('Movie 2019 1080p DTS'))
})

test('pickBestStream: Dolby alternative for a DTS remux', () => {
  const current = 'Movie.2019.2160p.UHD.BluRay.REMUX.HDR.HEVC.DTS-HD.MA.7.1-GRP.mkv'
  const streams = [
    { name: '[RD+] Torrentio\n4k', title: 'Movie.2019.2160p.BluRay.REMUX.TrueHD.Atmos', url: 'https://x/truehd' },
    { name: '[RD+] Torrentio\n4k', title: current, url: 'https://x/current' },
    { name: '[RD+] Torrentio\n1080p', title: 'Movie.2019.1080p.WEB-DL.DDP5.1.H.264', url: 'https://x/1080' },
    { name: '[RD+] Torrentio\n4k', title: 'Movie.2019.2160p.WEB-DL.DDP5.1.Atmos.HDR.HEVC', url: 'https://x/4kddp' },
  ]
  const opts = { requireSupportedAudio: true, excludeUrl: 'https://x/current' }
  assert.equal(pickBestStream(streams, current, opts)?.url, 'https://x/4kddp')
  assert.equal(pickBestStream(streams.slice(0, 2), current, opts), null)
  // Without the requirement (next episode), DTS still loses to a playable version.
  assert.equal(pickBestStream(streams, current)?.url, 'https://x/4kddp')
})
