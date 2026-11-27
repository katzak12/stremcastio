import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hlsForAudio, matchRdAudio, parseRdAudio, rdIdFromDownloadUrl, rdKeyFromStreamUrl } from '../src/lib/realDebrid'

test('rdKeyFromStreamUrl reads the key from a Torrentio link', () => {
  assert.equal(rdKeyFromStreamUrl('https://torrentio.strem.fun/resolve/realdebrid/ABC123/hash/null/0/file.mkv'), 'ABC123')
  assert.equal(rdKeyFromStreamUrl('https://torrentio.strem.fun/resolve/alldebrid/ABC123/hash/null/0/file.mkv'), null)
  assert.equal(rdKeyFromStreamUrl('https://example.com/movie.mkv'), null)
})

test('rdIdFromDownloadUrl finds the download id', () => {
  assert.equal(rdIdFromDownloadUrl('https://42.download.real-debrid.com/d/XYZ789QW/Toy.Story.5.mkv'), 'XYZ789QW')
  assert.equal(rdIdFromDownloadUrl('https://real-debrid.com/d/XYZ789QW'), 'XYZ789QW')
  assert.equal(rdIdFromDownloadUrl('https://torrentio.strem.fun/resolve/realdebrid/K/h/n/0/f.mkv'), null)
})

const INFOS = {
  details: {
    audio: {
      por1: { stream: '0:1', lang: 'Portuguese', lang_iso: 'por', codec: 'eac3', channels: 5.1 },
      eng1: { stream: '0:2', lang: 'English', lang_iso: 'eng', codec: 'truehd', channels: 7.1 },
      eng2: { stream: '0:3', lang: 'English', lang_iso: 'eng', codec: 'ac3', channels: 5.1 },
    },
  },
}

test('parseRdAudio and matchRdAudio pick the same track by language and position', () => {
  const rd = parseRdAudio(INFOS)
  assert.deepEqual(rd.map((a) => a.key), ['por1', 'eng1', 'eng2'])
  assert.equal(matchRdAudio(rd, { language: 'eng' }, 1)?.key, 'eng2')
  assert.equal(matchRdAudio(rd, { language: 'en' }, 0)?.key, 'eng1')
  assert.equal(matchRdAudio(rd, { language: 'por' }, 5)?.key, 'por1')
  assert.deepEqual(parseRdAudio({ details: { audio: [] } }), [])
  assert.deepEqual(parseRdAudio(null), [])
})

test('hlsForAudio swaps the audio key in an RD HLS path', () => {
  const url = 'https://xyz.real-debrid.com/t/ABC/por1/none/aac/full.m3u8'
  assert.equal(hlsForAudio(url, ['por1', 'eng1', 'eng2'], 'eng2'), 'https://xyz.real-debrid.com/t/ABC/eng2/none/aac/full.m3u8')
  assert.equal(hlsForAudio(url, ['por1'], 'por1'), url)
  assert.equal(hlsForAudio('https://x.real-debrid.com/t/ABC/full.m3u8', ['eng1'], 'eng1'), 'https://x.real-debrid.com/t/ABC/full.m3u8')
})
