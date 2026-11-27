import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addonInstallUrls, base64Url, pickAddonBase } from '../src/lib/stremioAddon'

test('base64Url matches the relay\'s decoder (standard base64url, no padding)', () => {
  for (const s of ['https://torrentio.strem.fun/realdebrid=ABC123', 'é ü 日本', 'a', 'ab', 'abc']) {
    assert.equal(base64Url(s), Buffer.from(s, 'utf8').toString('base64url'))
  }
})

test('pickAddonBase prefers the add-on seen in the stream link', () => {
  const streamUrl = 'https://torrentio.strem.fun/resolve/realdebrid/KEY1/hash/null/0/f.mkv'
  assert.equal(pickAddonBase({ streamUrl, added: [] }), 'https://torrentio.strem.fun/realdebrid=KEY1')
  assert.equal(pickAddonBase({ detected: 'https://torrentio.strem.fun/realdebrid=KEY2', added: [] }), 'https://torrentio.strem.fun/realdebrid=KEY2')
  assert.equal(pickAddonBase({ added: ['stremio://torrentio.strem.fun/x=1/manifest.json'] }), 'https://torrentio.strem.fun/x=1')
  assert.equal(pickAddonBase({ added: [] }), null)
})

test('addonInstallUrls builds https and stremio:// links', () => {
  const u = addonInstallUrls('https://relay.dev/', 'https://torrentio.strem.fun/realdebrid=K')
  assert.match(u.manifest, /^https:\/\/relay\.dev\/stremio\/[A-Za-z0-9_-]+\/manifest\.json$/)
  assert.equal(u.stremio, u.manifest.replace('https://', 'stremio://'))
})

import { compareVersions } from '../src/lib/updates'
test('compareVersions', () => {
  assert.equal(compareVersions('0.5.3', '0.5.2'), 1)
  assert.equal(compareVersions('v0.5.2', '0.5.2'), 0)
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1)
  assert.equal(compareVersions('0.5', '0.5.1'), -1)
})
