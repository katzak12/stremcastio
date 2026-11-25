import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSource } from './altstore-source.mjs'

test('source mirrors the built app exactly', () => {
  const info = {
    CFBundleIdentifier: 'app.stremcastio',
    CFBundleShortVersionString: '0.2.0',
    CFBundleVersion: '2',
    MinimumOSVersion: '15.1',
    NSLocalNetworkUsageDescription: 'Find your Chromecast',
    NSBonjourServices: ['_googlecast._tcp'],
    UIRequiredDeviceCapabilities: ['arm64'],
  }
  const s = buildSource({ info, ipaSize: 12345, tag: 'v0.2.0', date: '2026-11-25' })
  const app = s.apps[0]
  assert.equal(app.bundleIdentifier, 'app.stremcastio')
  const v = app.versions[0]
  assert.deepEqual(
    [v.version, v.buildVersion, v.size, v.minOSVersion, v.date],
    ['0.2.0', '2', 12345, '15.1', '2026-11-25'],
  )
  assert.equal(v.downloadURL, 'https://github.com/katzak12/stremcastio/releases/download/v0.2.0/StremCastio.ipa')
  assert.deepEqual(app.appPermissions, { entitlements: [], privacy: { NSLocalNetworkUsageDescription: 'Find your Chromecast' } })
  assert.equal(app.category, 'entertainment')
})
