# StremCastio: notes for Claude

Cast Stremio streams to a Chromecast with working subtitles. See README.md for the full picture.

## Owner
Guus (GitHub: katzak12). Speaks Dutch: reply in Dutch. He uses an **iPhone** (iOS 27.2) and a Mac (Apple Silicon).

## Layout
- `app/`: Expo SDK 58 / React Native app (Android + iOS). UI in `src/App.tsx`; logic in `src/lib/*`
  (stream parsing, subtitle search via Stremio add-ons + Cinemeta, relay, cast load request).
  `modules/intent-extras/` is a local Expo module (Kotlin) that exposes Android intent extras (Stremio "external player" → subtitles).
- `worker/`: Cloudflare Worker "stremcastio-relay". Converts SRT/ASS → WebVTT with CORS so the Chromecast shows subtitles.
  KV namespace `subcast-subs` (id in wrangler.toml) is already created in Guus's Cloudflare account.
- `.github/workflows/`: android.yml (APK, works), ios.yml (unsigned IPA, manual only: runners never start), relay.yml (tests + deploy).
- `codemagic.yaml`: iOS build fallback. **Works**: build #1 produced StremCastio.ipa.

## Checks
- `cd app && npm test && npm run typecheck`
- `cd worker && npm test && npx tsc -p .`

## Status (2026-11-25)
- Android APK builds on GitHub Actions. Cast framework is pinned to 22.1.0, because 23.x needs Kotlin 2.4.
- iOS: GitHub macOS runners never picked up the job ("not acquired by runner", tried macos-latest, macos-15-intel, macos-26).
  Codemagic builds the IPA fine (~8 min).
- Installing on the iPhone: AltStore PAL can't install unsigned IPAs, so we use **Sideloadly** on the Mac.
  Apple ID login in Sideloadly failed (-22406, then "2FA requested second time", then -22405) after many attempts.
  Logging in on account.apple.com also failed. The password in 1Password may be outdated, or Apple rate-limited the account.
  **Solved 2026-11-25**: after resetting the Apple password, Sideloadly installed Codemagic build #2 on the iPhone
  (trusted developer + Developer Mode on). Free Apple ID: the app expires after 7 days, re-install via Sideloadly.
- Relay is **deployed** (2026-11-25) at https://stremcastio-relay.stremcastio-relay.workers.dev (KV binding SUBS).
  The URL is the default in `app/app.json` (`extra.relayUrl`); it can also be changed in the app's settings screen.
  Redeploy: `cd worker && npx wrangler deploy` (needs CLOUDFLARE_API_TOKEN). For CI deploys, relay.yml still needs the
  GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- Features added 2026-11-25 (not yet tested on the phone): UI in English by default, app language picker
  (Settings → Languages; en, es, pt, fr, it, tr, ru, ja, zh, id, nl in `src/lib/i18n.ts`), subtitle languages with
  English locked first and a searchable "+" list (`LanguagePicker.tsx`), artwork/IMDb rating/runtime/genres from
  Cinemeta (`src/lib/meta.ts`), title + poster on the TV, progress bar with tap-to-seek, settings icon same size as cast icon.
  Also: subtitle sync remembered per video + subtitle file (`syncMemory.ts`); automatic next episode: while an episode
  plays, the next one's stream (via a Stremio stream add-on, `streams.ts`; Torrentio debrid links are auto-detected)
  plus subtitle is put in the Chromecast queue. New, simpler app icon (play triangle + subtitle bars).
  Also: continue watching (`resume.ts`, asks on cast), sleep timer (TV-side via a one-item queue with
  `playbackDuration`, plus an in-app backup timer; "end of video" drops the queued next episode), Chromecast volume
  slider (CastSession get/setVolume), audio-track picker (only shown when the TV reports >1 audio track, i.e. mostly
  HLS/DASH), subtitle colour/background options applied live via setTextTrackStyle.
- Relay conversion (deployed 2026-11-25): ASS/SRT override tags {\i1}/{\b1}/{\u1} become <i>/<b>/<u>; top placement
  ({\an7-9}, legacy {\a5-7}, or an ASS style with top Alignment) becomes the VTT cue setting `line:0`; VTT
  line/position/align settings are kept; ASS vector drawings ({\p1}) are skipped. Colours/fonts are dropped on purpose:
  the TV applies one readable look (default STANDARD_LOOK in cast.ts = Netflix-style white with black outline, fontScale 1, no box; "Use the standard style" button in Settings). Whether the Chromecast honours
  `line:0` is not yet verified on hardware.
- Audio: Chromecast can't play DTS/TrueHD (no sound). The app warns when the filename says DTS/TrueHD and offers
  "Find a version with Dolby audio" (same movie/episode via the stream add-on, DD/DDP only, closest quality;
  `findPlayableAudioStream` in streams.ts). The next-episode picker also avoids DTS/TrueHD. Transcoding was rejected:
  not possible on iOS/Workers, and too costly/complex on a server.
- Sharing for free (2026-11-25): AltStore **Classic**/SideStore source, generated from the built app's Info.plist by
  `scripts/altstore-source.mjs` (AltStore refuses installs when version/permissions differ). Codemagic workflow
  `ios-release` runs on tags `v*`: builds the IPA and uploads `StremCastio.ipa` + `altstore-source.json` to that GitHub
  release (needs GITHUB_TOKEN in Codemagic env group "github"). android.yml attaches the APK to the same release
  (via `gh release upload`; softprops/action-gh-release failed on v0.2.0, so that release had no APK). A missing APK can
  be added later: run the Android workflow manually with input `release_tag` = the tag.
  Source URL: https://github.com/katzak12/stremcastio/releases/latest/download/altstore-source.json
  Release = bump `version`, `ios.buildNumber`, `android.versionCode` in app/app.json, then push tag v<version>.
  User guide: INSTALL.md (NL + EN). AltStore PAL is not an option without a paid Apple Developer account.
- 0.2.1 fixes (from Guus's test): the iOS bridge of react-native-google-cast ignores `textTrackStyle` in the load
  request (commented out) and reads foreground colour from a misspelt key `foreroundColor`; so the TV showed its own
  default (white on black box). We now call setTextTrackStyle after every load (activateSubtitles) and send both keys.
  Subtitle options: colour (white/yellow/cyan/green), edge (outline/shadow/raised/depressed/none), background
  (none/see-through/solid), font, size; "Use the TV standard" resets. Casting: last TV remembered (castConnect.ts),
  "Cast to TV" connects straight to it, waits while CONNECTING, and loadMedia retries (with a timeout) while the
  receiver starts. When already "connected" (button shows the TV name) the app pings the TV first (requestStatus, 3 s);
  a hang or a failed load drops the dead session and reconnects to the same TV once, then casts (reconnectAndCast).
- 0.2.2 audio-track choice (VLC-style, from Guus's test): the relay's `GET /tracks?u=` reads the MKV header (EBML,
  first 1 MB, follows the SeekHead if Tracks lies further) and returns the audio tracks with a cast URL each.
  The Chromecast can't switch tracks in a plain MKV, so `GET /media?u=&p=` proxies the file and changes single
  header bytes: other audio tracks get TrackType 0x20 (players skip unknown types), the chosen one FlagDefault=1.
  Only the requested range containing those bytes is read by the Worker; the rest is piped natively (FixedLengthStream).
  App (`audioTracks.ts`): picker in the Video card when a file has >1 audio track; default = last picked language
  (`settings.audioLanguage`), never TrueHD/DTS when a playable track exists, no commentary; changing it while playing
  re-casts at the same position. MP4 files are not handled (no picker). Needs the relay redeployed.
  **Not verified on hardware**: whether the Chromecast honours the patched header, and whether debrid hosts
  accept requests from Cloudflare (they may block datacenter IPs). The queued next episode still uses the default track.
- 0.2.5 (from Guus's test on a Google TV, where DD 5.1 English via /media gave no sound; cause unknown: TV volume, the
  header patch, or DD passthrough): full-screen remote (Modal) opens once per video when it starts on the TV:
  poster/title, big seek bar, −30/−10/play/+10/+30, volume slider with mute (CastSession isMute/setMute; shows
  "muted" in orange), subtitles on/off + sync, audio track, speed (setPlaybackRate), sleep timer, up next, stop.
  The main screen keeps a small "now playing" card with play/pause and "Open remote". iPhone volume buttons no longer
  change the TV volume: `plugins/withCastVolumeButtons.js` sets physicalVolumeButtonsWillControlDeviceVolume = false
  (must be listed before react-native-google-cast in app.json; verified with expo prebuild).
- 0.2.6 (Guus's LG C4 test: casting needed 3 taps: 1st only the blue cast icon, 2nd showed the title loading then
  dropped, 3rd worked; the volume slider did nothing on the TV's built-in Cast): after picking a TV the app waits
  800 ms before casting (iOS drops the "continue watching?" alert while the picker closes); when the TV goes IDLE with
  idleReason ERROR within a minute of a load, the app loads again by itself (2 retries, then "TV couldn't play");
  volume slider removed; while playing, the bottom "Cast to TV" button becomes a now-playing bar (poster, title,
  audio track, subtitles, play/pause; tap = open remote). Relay /media fetches the patched head and the rest in parallel.
  Also: "[LG] webOS TV …" in the picker is the TV's built-in Google Cast.
- 0.2.7: the now-playing bar/remote never showed with an audio track picked: the app compared the URL the TV reports
  with the relay URL it sent by exact string, and iOS re-encodes it. Now `sameMediaUrl` (stream.ts) compares decoded
  forms, also checks contentId and the last URL we loaded.
- Not yet verified on real hardware: casting with subtitles end-to-end, the Android intent-extras bridge, and whether Stremio passes subtitles.

## Conventions
- Never put passwords or tokens in chat or code; Guus enters credentials himself.
- Commit trailers: Co-Authored-By: Claude.
