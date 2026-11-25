#!/usr/bin/env node
// Builds the AltStore (Classic) / SideStore source for StremCastio from the app that was just built,
// so version, build number and privacy permissions always match the IPA exactly (AltStore refuses
// to install when they differ). Spec: https://faq.altstore.io/developers/make-a-source
//
// Usage: node scripts/altstore-source.mjs <Info.plist as JSON> <ipa> <tag> [out]
//   (on macOS: plutil -convert json -o info.json StremCastio.app/Info.plist)

import { readFileSync, statSync, writeFileSync } from 'node:fs'

export const REPO = 'katzak12/stremcastio'
const RAW = `https://raw.githubusercontent.com/${REPO}/main`

export function buildSource({ info, ipaSize, tag, date, notes }) {
  const privacy = Object.fromEntries(
    Object.entries(info)
      .filter(([k, v]) => /UsageDescription$/.test(k) && typeof v === 'string')
      .sort(([a], [b]) => a.localeCompare(b)),
  )
  return {
    name: 'StremCastio',
    subtitle: 'Cast Stremio streams to a Chromecast, with subtitles.',
    description:
      'StremCastio sends Stremio streams to your Chromecast with working subtitles, artwork, next-episode autoplay and more.',
    iconURL: `${RAW}/app/assets/icon.png`,
    website: `https://github.com/${REPO}`,
    tintColor: '#7B61FF',
    apps: [
      {
        name: 'StremCastio',
        bundleIdentifier: info.CFBundleIdentifier,
        developerName: 'katzak12',
        subtitle: 'Cast Stremio to your Chromecast, with subtitles.',
        localizedDescription:
          'Copy a stream link in Stremio, open StremCastio and cast it to your Chromecast. Subtitles are found and converted automatically; you also get artwork, IMDb rating, next-episode autoplay, continue watching, a sleep timer and volume control.',
        iconURL: `${RAW}/app/assets/icon.png`,
        tintColor: '#7B61FF',
        category: 'entertainment',
        screenshots: [],
        versions: [
          {
            version: info.CFBundleShortVersionString,
            buildVersion: info.CFBundleVersion,
            date,
            localizedDescription: notes || `StremCastio ${info.CFBundleShortVersionString}`,
            downloadURL: `https://github.com/${REPO}/releases/download/${tag}/StremCastio.ipa`,
            size: ipaSize,
            ...(info.MinimumOSVersion ? { minOSVersion: info.MinimumOSVersion } : {}),
          },
        ],
        // Built without code signing, so the IPA carries no entitlements of its own.
        appPermissions: { entitlements: [], privacy },
      },
    ],
    news: [],
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [infoPath, ipaPath, tag, out = 'altstore-source.json'] = process.argv.slice(2)
  if (!infoPath || !ipaPath || !tag) {
    console.error('usage: altstore-source.mjs <info.json> <ipa> <tag> [out]')
    process.exit(2)
  }
  const source = buildSource({
    info: JSON.parse(readFileSync(infoPath, 'utf8')),
    ipaSize: statSync(ipaPath).size,
    tag,
    date: new Date().toISOString().slice(0, 10),
    notes: process.env.RELEASE_NOTES,
  })
  writeFileSync(out, JSON.stringify(source, null, 2) + '\n')
  const v = source.apps[0].versions[0]
  console.log(`Wrote ${out}: ${v.version} (${v.buildVersion}), ${v.size} bytes, privacy keys: ${Object.keys(source.apps[0].appPermissions.privacy).join(', ') || 'none'}`)
}
