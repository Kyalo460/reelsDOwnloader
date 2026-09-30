// YouTube URL Parsing
//
// Single source of truth for the YouTube URL shapes this app accepts.
// Handles standard youtube.com, youtu.be, and various query parameter formats.

export const YOUTUBE_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtu.be',
] as const;

export const YOUTUBE_EMBED_HOSTS = ['youtube-nocookie.com', 'www.youtube-nocookie.com'] as const;

export type YouTubeHost = (typeof YOUTUBE_HOSTS)[number] | (typeof YOUTUBE_EMBED_HOSTS)[number];

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SHORTS_PATTERN = /^\/shorts\/([A-Za-z0-9_-]{11})/;
const WATCH_PATTERN = /[?&]v=([A-Za-z0-9_-]{11})/;
const EMBED_PATTERN = /^\/embed\/([A-Za-z0-9_-]{11})/;
const YOUTUBE_BE_PATTERN = /^\/([A-Za-z0-9_-]{11})/;

export interface YouTubeMediaRef {
  url: string;
  videoId: string;
  kind: 'video' | 'shorts' | 'embed';
}

export function isYouTubeHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return [...YOUTUBE_HOSTS, ...YOUTUBE_EMBED_HOSTS].some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
}

export function normalizeYouTubeUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const cleaned = trimmed.replace(/^[<("'\s]+/, '').replace(/[>)"'\s]+$/, '');
  if (!cleaned) return null;

  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(cleaned)
    ? cleaned
    : cleaned.startsWith('//')
      ? `https:${cleaned}`
      : `https://${cleaned}`;

  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }

  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
}

export function parseYouTubeUrl(input: string): YouTubeMediaRef | null {
  const parsed = normalizeYouTubeUrl(input);
  if (!parsed || !isYouTubeHostname(parsed.hostname)) return null;

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;
  const search = parsed.search;

  let videoId: string | null = null;
  let kind: YouTubeMediaRef['kind'] = 'video';

  if (hostname === 'youtu.be' || hostname === 'www.youtu.be') {
    const match = YOUTUBE_BE_PATTERN.exec(pathname);
    if (match?.[1] && VIDEO_ID_PATTERN.test(match[1])) {
      videoId = match[1];
    }
  } else if (YOUTUBE_EMBED_HOSTS.includes(hostname as (typeof YOUTUBE_EMBED_HOSTS)[number])) {
    const match = EMBED_PATTERN.exec(pathname);
    if (match?.[1] && VIDEO_ID_PATTERN.test(match[1])) {
      videoId = match[1];
      kind = 'embed';
    }
  } else {
    const shortsMatch = SHORTS_PATTERN.exec(pathname);
    if (shortsMatch?.[1] && VIDEO_ID_PATTERN.test(shortsMatch[1])) {
      videoId = shortsMatch[1];
      kind = 'shorts';
    } else {
      const watchMatch = WATCH_PATTERN.exec(search);
      if (watchMatch?.[1] && VIDEO_ID_PATTERN.test(watchMatch[1])) {
        videoId = watchMatch[1];
      }
    }
  }

  if (!videoId) return null;

  const canonicalHost = YOUTUBE_HOSTS[0];
  const canonicalUrl =
    kind === 'shorts'
      ? `https://${canonicalHost}/shorts/${videoId}`
      : `https://${canonicalHost}/watch?v=${videoId}`;

  return {
    url: canonicalUrl,
    videoId,
    kind,
  };
}

export function isYouTubeUrl(input: string): boolean {
  return parseYouTubeUrl(input) !== null;
}

export function extractVideoId(input: string): string | undefined {
  return parseYouTubeUrl(input)?.videoId;
}

export function getYouTubeThumbnailUrl(
  videoId: string,
  quality: 'default' | 'mq' | 'hq' | 'sd' | 'maxres' = 'hq'
): string {
  const qualities: Record<string, string> = {
    default: 'default',
    mq: 'mqdefault',
    hq: 'hqdefault',
    sd: 'sddefault',
    maxres: 'maxresdefault',
  };
  return `https://img.youtube.com/vi/${videoId}/${qualities[quality]}.jpg`;
}
