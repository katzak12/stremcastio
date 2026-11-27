# StremCastio

**Cast Stremio streams to a Chromecast — with subtitles.**

If you cast from your phone through VLC (or most other external players), the
subtitles never reach the TV. StremCastio fixes that: it sends the original video
to the Chromecast and adds the subtitle as a proper Chromecast text track.
There's no re-encoding and no quality loss, and your phone can go to sleep
while you watch.

- Android and iOS (iPhone/iPad), from one codebase (Expo / React Native)
- One tap from Stremio on Android: the subtitle you picked in Stremio comes along
- Finds subtitles automatically via the same add-ons Stremio uses (OpenSubtitles v3 by default, plus your own)
- Subtitle sync (earlier/later) and size controls
- Works with every Google Cast device: Chromecast, Google TV, TVs with Chromecast built-in

## Why the subtitles disappear

The Chromecast only shows subtitles that are **WebVTT** and served with
**CORS headers**. Subtitle sources (OpenSubtitles, Stremio add-ons) serve SRT
without CORS, and VLC doesn't convert them. So the receiver drops them.

StremCastio solves this with a tiny **subtitle relay**: a free Cloudflare Worker
that fetches the subtitle, converts SRT/ASS/SSA to WebVTT (and fixes encodings
such as Windows-1252), then serves it with the right headers. The relay only
ever sees the subtitle file. The video goes straight from your debrid service
to the TV.

```
Stremio ──link──▶ StremCastio (phone) ──"play this + this subtitle"──▶ Chromecast
                                                         │            │
                                       video ◀───────────┘            │
                     (Real-Debrid etc.)                               │
                                       subtitle.vtt ◀── relay ◀── OpenSubtitles / add-on
```

## Install

| Platform | How |
|---|---|
| Android | Download `StremCastio.apk` from [Releases](../../releases) and open it. |
| iPhone / iPad | Add the source `https://github.com/katzak12/stremcastio/releases/latest/download/altstore-source.json` in **AltStore Classic** or **SideStore**, or install `StremCastio.ipa` from [Releases](../../releases) with **Sideloadly**. |

Step-by-step instructions (Dutch and English): [INSTALL.md](INSTALL.md).

## Use it with Stremio

**Android (one tap):**
1. Stremio → Settings → Player → *External player* → **Let Android choose**.
2. Start a stream, then pick **StremCastio**.
3. Tap **Cast to TV** and choose your TV.

**iPhone:**
1. In Stremio, copy the stream's link.
2. Open StremCastio and tap **Paste**. StremCastio recognises the movie or episode and finds subtitles.
3. Tap **Cast to TV**.

You can also open `stremcastio://cast?url=<stream>&sub=<subtitle>` from Shortcuts or other apps.

## The relay (nothing to set up)

Subtitles need a small converter, the relay: Chromecast only shows WebVTT served with CORS. The app uses a shared
relay by default, so there is nothing to set up. It only converts subtitles (and reads a file's track list):
video never passes through it (`MEDIA_PROXY = "off"` in `worker/wrangler.toml`). Converted subtitles are cached.
It runs on Cloudflare's free plan, which never bills: if it ever hits the daily limit (100,000 requests; a viewer
needs a few per film), it simply stops for the rest of that day.

Choosing another spoken language, or playing TrueHD/DTS audio, goes through the viewer's own Real-Debrid
(the key in a Torrentio link, or Settings → Real-Debrid), not through the relay.

**Your own relay (optional).** For independence, deploy your own copy, free, in about 3 minutes:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/katzak12/stremcastio/tree/main/worker)

Log in (a free Cloudflare and GitHub account), tap **Deploy**, then copy the address ending in `.workers.dev` and go
back to the app: it checks the address and fills it in (same button under **Settings → Relay**). On your own relay
you can set `MEDIA_PROXY = "on"` to also switch audio tracks for viewers without Real-Debrid (the film then passes
through your relay).

## Build it yourself

GitHub Actions builds everything on every push to `main`:

- **Android APK**: `.github/workflows/android.yml`. Without secrets it's
  signed with a debug key, which is fine for sideloading. For a stable release
  key, add `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`.
- **iOS IPA**: `.github/workflows/ios.yml`. Unsigned, because AltStore/SideStore re-sign it on install.
- Push a tag like `v0.1.0` to attach both files to a GitHub Release.

Local development:

```bash
cd app
npm install
npm test            # logic tests
npm run typecheck
npx expo run:android   # or run:ios on a Mac (needs a dev build; Expo Go won't work)

cd ../worker
npm install
npm test
npx wrangler dev
```

## Limitations

- **Formats:** the Chromecast plays the original file, so the stream must use
  codecs your Chromecast supports. Most H.264/HEVC + AAC/AC3 files work. If a
  stream won't start or has no sound (often DTS audio or heavy 4K remuxes),
  pick another stream in Stremio.
- **Torrents without debrid** run on the phone itself (`127.0.0.1`), and the TV can't reach them.
- **Same network:** phone and Chromecast must be on the same Wi-Fi/LAN, not a
  guest network. With several routers, make sure they share one network.
- **iOS sideloading** with a free Apple ID needs refreshing every 7 days (AltStore/SideStore do this automatically).

## Privacy

The app talks to: Cinemeta (to identify the title), your subtitle add-ons, the
relay (subtitle files only, cached briefly) and your Chromecast. No accounts,
no analytics.

## Layout

```
app/       Expo app (src/App.tsx UI, src/lib/* logic, modules/intent-extras Android intent bridge)
worker/    Cloudflare Worker subtitle relay + tests
.github/   CI: APK, IPA, relay deploy
```

MIT licensed.
