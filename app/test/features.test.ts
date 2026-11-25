import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMetadata } from '../src/lib/cast'
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
