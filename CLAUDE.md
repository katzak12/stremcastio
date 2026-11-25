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

## Status (2026-11-17)
- Android APK builds on GitHub Actions. Cast framework is pinned to 22.1.0, because 23.x needs Kotlin 2.4.
- iOS: GitHub macOS runners never picked up the job ("not acquired by runner", tried macos-latest, macos-15-intel, macos-26).
  Codemagic builds the IPA fine (~8 min).
- Installing on the iPhone: AltStore PAL can't install unsigned IPAs, so we use **Sideloadly** on the Mac.
  Apple ID login in Sideloadly failed (-22406, then "2FA requested second time", then -22405) after many attempts.
  Logging in on account.apple.com also failed. The password in 1Password may be outdated, or Apple rate-limited the account.
  Next step: Guus changes or verifies his Apple password via iPhone Settings, then tries Sideloadly once (Anisette: Auto).
- Relay is **not deployed yet**. Needed: GitHub secrets `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers")
  and `CLOUDFLARE_ACCOUNT_ID`. Push or re-run relay.yml, then set the repo variable `RELAY_URL` to the workers.dev URL and rebuild the app.
- Not yet verified on real hardware: casting with subtitles end-to-end, the Android intent-extras bridge, and whether Stremio passes subtitles.

## Conventions
- Never put passwords or tokens in chat or code; Guus enters credentials himself.
- Commit trailers: Co-Authored-By: Claude.
