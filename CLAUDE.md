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
- `.github/workflows/`: android.yml (APK, works), ios.yml (unsigned IPA), relay.yml (tests + deploy).
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
- Not yet verified on real hardware: casting with subtitles end-to-end, the Android intent-extras bridge, and whether Stremio passes subtitles.

## Conventions
- Never put passwords or tokens in chat or code; Guus enters credentials himself.
- Commit trailers: Co-Authored-By: Claude.
