import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audioTrackLabel, chooseAudioTrack, type FileAudioTrack } from '../src/lib/audioTracks'

const track = (t: Partial<FileAudioTrack> & { number: number }): FileAudioTrack => ({
  language: 'eng',
  codec: 'A_AC3',
  isDefault: false,
  playable: true,
  url: `https://relay/media?t=${t.number}`,
  ...t,
})

// The file from Guus's screenshot: Portuguese default, English TrueHD, English AC-3, commentary.
const FILE = [
  track({ number: 2, language: 'por', codec: 'A_EAC3', name: 'Portuguese (Brazil)', isDefault: true, channels: 6 }),
  track({ number: 3, language: 'eng', codec: 'A_TRUEHD', name: 'TrueHD Atmos 7.1', playable: false, channels: 8 }),
  track({ number: 4, language: 'eng', codec: 'A_AC3', name: 'AC-3 5.1', channels: 6 }),
  track({ number: 5, language: 'eng', codec: 'A_AC3', name: 'Commentary by Co-Director Kenna Harris', channels: 2 }),
]

test('chooseAudioTrack: preferred language, skipping TrueHD and commentary', () => {
  assert.equal(chooseAudioTrack(FILE, 'en')?.number, 4)
  assert.equal(chooseAudioTrack(FILE, 'pt')?.number, 2)
})

test('chooseAudioTrack: no preference keeps what the TV would play', () => {
  assert.equal(chooseAudioTrack(FILE)?.number, 2)
  assert.equal(chooseAudioTrack(FILE, 'nl')?.number, 2)
})

test('chooseAudioTrack: a silent default track is swapped for a playable one in the same language', () => {
  const tracks = [
    track({ number: 1, codec: 'A_TRUEHD', isDefault: true, playable: false }),
    track({ number: 2, language: 'ger', codec: 'A_AC3' }),
    track({ number: 3, codec: 'A_EAC3' }),
  ]
  assert.equal(chooseAudioTrack(tracks)?.number, 3)
  assert.equal(chooseAudioTrack([])?.number, undefined)
})

test('audioTrackLabel shows language, format and only useful names', () => {
  assert.equal(audioTrackLabel(FILE[2]), 'English · DD 5.1')
  assert.equal(audioTrackLabel(FILE[1]), 'English · TrueHD 7.1')
  assert.match(audioTrackLabel(FILE[3]), /^English · DD 2\.0 · Commentary by/)
  assert.match(audioTrackLabel(FILE[0]), /DD\+ 5\.1 · Portuguese \(Brazil\)$/)
})
