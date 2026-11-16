// Everything we can learn about a video from its URL alone.

export type ParsedRelease = {
  title: string;
  year?: number;
  season?: number;
  episode?: number;
};

export type StreamInfo = ParsedRelease & {
  url: string;
  filename: string;
  contentType: string;
  /** Streams served from the phone itself (Stremio's local torrent server) can't be reached by the TV. */
  isLocalOnly: boolean;
};

const VIDEO_EXT = /\.(mkv|mp4|m4v|mov|avi|webm|ts|m2ts|m3u8|mpd|wmv|flv)$/i;

/** Stremio wraps some URLs in its local proxy: http://127.0.0.1:11470/...?...&from=<real url> */
export function unwrapProxy(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ['from', 'url', 'src']) {
      const inner = u.searchParams.get(key);
      if (inner && /^https?:\/\//i.test(inner)) return unwrapProxy(inner);
    }
  } catch {
    // not a URL
  }
  return url;
}

export function isLocalHost(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ['filename', 'name', 'file']) {
      const v = u.searchParams.get(key);
      if (v) return v;
    }
    const segments = u.pathname.split('/').filter(Boolean).map(safeDecode);
    const withExt = [...segments].reverse().find((s) => VIDEO_EXT.test(s));
    return withExt ?? segments[segments.length - 1] ?? u.hostname;
  } catch {
    return url;
  }
}

export function guessContentType(url: string, filename: string): string {
  const name = (filename || url).toLowerCase().split('?')[0];
  if (name.endsWith('.m3u8')) return 'application/x-mpegURL';
  if (name.endsWith('.mpd')) return 'application/dash+xml';
  if (name.endsWith('.webm')) return 'video/webm';
  // Chromecast plays most H.264/HEVC MKVs when they are announced as MP4.
  return 'video/mp4';
}

const JUNK =
  /\b(2160p|1080p|720p|480p|4k|uhd|hdr10?\+?|hdr|dv|dovi|dolby ?vision|web[- ]?dl|webrip|web|bluray|blu[- ]?ray|brrip|bdrip|remux|hdtv|dvdrip|x264|x265|h ?264|h ?265|hevc|avc|aac\d?(\.\d)?|ac3|eac3|ddp?\d?(\.\d)?|dts(-hd)?|truehd|atmos|10bit|8bit|proper|repack|extended|unrated|remastered|imax|multi|dual|subs?|nl|eng)\b/i;

/** "The.Matrix.1999.1080p.BluRay.x264-GRP.mkv" -> { title: "The Matrix", year: 1999 } */
export function parseRelease(filename: string): ParsedRelease {
  let name = filename.replace(VIDEO_EXT, '').replace(/\[[^\]]*\]/g, ' ');
  name = name.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();

  let season: number | undefined;
  let episode: number | undefined;
  let cut = name.length;

  const se = name.match(/\bS(\d{1,2})[ ]?E(\d{1,3})\b/i) ?? name.match(/\b(\d{1,2})x(\d{2,3})\b/i);
  if (se && se.index !== undefined) {
    season = Number(se[1]);
    episode = Number(se[2]);
    cut = Math.min(cut, se.index);
  } else {
    const seasonOnly = name.match(/\b(?:S|Season )(\d{1,2})\b/i);
    if (seasonOnly?.index !== undefined) cut = Math.min(cut, seasonOnly.index);
  }

  let year: number | undefined;
  const years = [...name.matchAll(/\(?\b(19\d{2}|20\d{2})\b\)?/g)];
  // The last year-like number before the S/E marker is the release year
  // (titles such as "2001 A Space Odyssey 1968" keep their first number).
  const candidates = years.filter((m) => (m.index ?? 0) > 0 && (m.index ?? 0) <= cut);
  const y = candidates[candidates.length - 1];
  if (y && y.index !== undefined) {
    year = Number(y[1]);
    cut = Math.min(cut, y.index);
  }

  // Without a year or episode marker, fall back to cutting at the first
  // quality/codec tag. (With one, the title is already isolated and tags such
  // as "Web" in "Charlotte's Web" must stay.)
  if (year === undefined && season === undefined) {
    const junk = name.match(JUNK);
    if (junk?.index !== undefined && junk.index > 0) cut = Math.min(cut, junk.index);
  }

  const title = name
    .slice(0, cut)
    .replace(/[-–(]+\s*$/, '')
    .trim();
  return { title: title || name, year, season, episode };
}

export function describeStream(rawUrl: string): StreamInfo {
  const url = unwrapProxy(rawUrl.trim());
  const filename = filenameFromUrl(url);
  return {
    url,
    filename,
    contentType: guessContentType(url, filename),
    isLocalOnly: isLocalHost(url),
    ...parseRelease(filename),
  };
}

/** Pull the first http(s) URL out of arbitrary text (shared text, playlists). */
export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}

/** Parse an .m3u playlist: first media URL, plus any subtitle hints. */
export function parseM3u(text: string): { url: string | null; title?: string } {
  let title: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF')) {
      const t = line.split(',').slice(1).join(',').trim();
      if (t) title = t;
    } else if (/^https?:\/\//i.test(line)) {
      return { url: line, title };
    }
  }
  return { url: null, title };
}
