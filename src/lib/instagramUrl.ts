// Instagram URL Parsing
//
// Single source of truth for the Instagram Reel/Post URL shapes this app
// accepts. The API validator, the media resolver and the client helpers all
// read from here, so a URL that one layer accepts is never rejected by the next.

/**
 * Path segments Instagram uses for a single media item:
 * `reel` / `reels` for Reels, `p` for posts, `tv` for IGTV.
 */
export const INSTAGRAM_MEDIA_SEGMENTS = ['reel', 'reels', 'p', 'tv'] as const;

export type InstagramMediaKind = (typeof INSTAGRAM_MEDIA_SEGMENTS)[number];

/** Hosts that serve Instagram media pages. */
export const INSTAGRAM_HOSTS = ['instagram.com', 'www.instagram.com'];

/** A validated reference to one piece of Instagram media. */
export interface InstagramMediaRef {
  /** Canonical absolute URL: lowercase host, no query string, no trailing slash. */
  url: string;
  shortCode: string;
  kind: InstagramMediaKind;
}

const SHORT_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Path values Instagram reserves in the shortcode position for listing pages
 * rather than a single piece of media (e.g. `/reels/audio/` is the audio
 * library). Real shortcodes are opaque, so these can never collide.
 */
const RESERVED_SHORTCODES = new Set([
  'audio',
  'direct',
  'explore',
  'highlights',
  'reels',
  'stories',
]);

/** `instagram.com` or any subdomain of it. */
export function isInstagramHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return INSTAGRAM_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Turns pasted text into a parseable absolute URL, or null when it cannot be
 * read as one.
 *
 * Accepts what people actually paste: text copied out of the Instagram app
 * wrapped in quotes/angle brackets, protocol-relative links
 * (`//instagram.com/reel/ABC`) and bare links without a scheme
 * (`instagram.com/reel/ABC`). Any other scheme (`javascript:`, `file:`, …)
 * is rejected here rather than being silently coerced to https.
 */
export function normalizeInstagramUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const cleaned = trimmed.replace(/^[<("'\s]+/, '').replace(/[>)"'\s]+$/, '');
  if (!cleaned) return null;

  const absolute = SCHEME_PATTERN.test(cleaned)
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

/**
 * Extracts the media reference from any Instagram Reel/Post URL, or null when
 * the input is not one.
 *
 * Unlike a strict regex match this tolerates the query strings and fragments
 * Instagram appends to shared links (`?igsh=`, `?img_index=1`, `#media`),
 * the plural `/reels/` path, IGTV `/tv/` posts and the `/share/reel/…`
 * short links produced by the mobile app.
 */
export function parseInstagramMediaUrl(input: string): InstagramMediaRef | null {
  const parsed = normalizeInstagramUrl(input);
  if (!parsed || !isInstagramHostname(parsed.hostname)) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  // Mobile share links wrap the real path: /share/reel/<shortcode>
  const path = segments[0]?.toLowerCase() === 'share' ? segments.slice(1) : segments;

  // Exactly `/<kind>/<shortcode>`; anything longer is a different page
  // (`/reel/CODE/embed/`, `/reels/audio/`, …), not the media itself.
  if (path.length !== 2) return null;

  const kind = INSTAGRAM_MEDIA_SEGMENTS.find((segment) => segment === path[0]?.toLowerCase());
  const shortCode = path[1];

  if (!kind || !shortCode || !SHORT_CODE_PATTERN.test(shortCode)) return null;
  if (RESERVED_SHORTCODES.has(shortCode.toLowerCase())) return null;

  return {
    url: `https://${parsed.hostname.toLowerCase()}/${kind}/${shortCode}`,
    shortCode,
    kind,
  };
}

/** True when the input is a usable Instagram Reel/Post URL. */
export function isInstagramMediaUrl(input: string): boolean {
  return parseInstagramMediaUrl(input) !== null;
}

/** The shortcode of an Instagram Reel/Post URL, or undefined. */
export function extractShortCodeFromInstagramUrl(input: string): string | undefined {
  return parseInstagramMediaUrl(input)?.shortCode;
}
