// Direct URL Processing
//
// Resolves a publicly accessible Instagram Reel by requesting the Instagram page
// that any anonymous visitor would receive, then extracting the reel metadata
// and locating the direct media URL inside that response.
//
// This deliberately does NOT use Meta's official Graph API
// (graph.facebook.com, /{ig-user-id}/media) and requires no access token, app
// credentials or authenticated session. Only publicly available content is
// read. Nothing is stored on disk and the located media URL stays server-side.

import type { MediaResolutionResult, MediaVariant } from '@/types';

export type DirectUrlErrorCode =
  | 'INVALID_URL'
  | 'NOT_FOUND'
  | 'PRIVATE_CONTENT'
  | 'MEDIA_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'NOT_PERMITTED'
  | 'AUTH_REQUIRED';

/**
 * Error type used by the processor. The message is prefixed with the error code
 * so existing string-based error mapping in MediaResolver keeps working.
 */
export class DirectUrlError extends Error {
  readonly code: DirectUrlErrorCode;

  constructor(code: DirectUrlErrorCode, detail: string) {
    super(`${code} - ${detail}`);
    this.name = 'DirectUrlError';
    this.code = code;
  }
}

export const INSTAGRAM_ORIGIN = 'https://www.instagram.com';

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Instagram serves logged-out visitors a JavaScript login wall instead of the
 * page body: a ~635 KB app shell with no `og:*` tags, no caption and no media.
 * A reel fetched with a plain browser User-Agent is therefore indistinguishable
 * from a deleted one, which is what produced the bogus "reel not found or has
 * been deleted" error.
 *
 * Identifying the request as the mobile app makes Instagram return the same
 * public SEO metadata any crawler receives (og:title, og:description,
 * og:image). The browser prefix is kept so Instagram's CDN and bot checks,
 * which expect a browser-shaped User-Agent, still see one.
 */
export const INSTAGRAM_APP_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2340; Google/google; Pixel 6; oriole; oriole; en_US; 458229257)';

const SHORT_CODE_PATTERN = /\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/;
const QUALITY_TIERS: MediaVariant['quality'][] = ['original', 'hd', 'sd'];

export interface MediaVersion {
  /** Direct CDN URL (already unescaped). */
  url: string;
  width?: number;
  height?: number;
}

/** Raw signals pulled out of a public Instagram page/JSON response. */
export interface ExtractedMedia {
  shortCode: string;
  mediaUrl?: string;
  versions: MediaVersion[];
  thumbnail?: string;
  title?: string;
  duration: number;
  width?: number;
  height?: number;
  isVideo: boolean;
  isPrivate: boolean;
  requiresLogin: boolean;
  notFound: boolean;
  /**
   * True when Instagram returned real metadata describing this specific reel
   * (og:title/og:description naming the account and caption). A page that
   * exists but exposes no metadata is a login wall, NOT a deleted reel, so
   * this flag is what keeps the two apart.
   */
  exists: boolean;
  ownerUsername?: string;
}

type FetchKind = 'html' | 'json';

interface FetchTarget {
  url: string;
  kind: FetchKind;
}

/** Extracts the shortcode from any Instagram reel/post URL. */
export function extractShortCode(url: string): string | undefined {
  return SHORT_CODE_PATTERN.exec(url)?.[1];
}

function htmlDecode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Instagram embeds JSON inside `<script>` tags with escaped characters
 * (`https:\/\/cdn...`, `\u0026` for `&`) and HTML-escapes metadata attributes.
 * Normalise both so the located URL can be requested as-is.
 */
export function decodeEscapedValue(value: string): string {
  const decoded = value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ');

  return htmlDecode(decoded).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstMatch(value: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(value);
  return match?.[1] ? decodeEscapedValue(match[1]) : undefined;
}

function numberMatch(value: string, pattern: RegExp): number | undefined {
  const raw = firstMatch(value, pattern);
  if (!raw) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Reads a `<meta property="...">` / `<meta name="...">` content attribute. */
export function metaContent(html: string, property: string): string | undefined {
  const name = escapeRegExp(property);
  const propertyFirst = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`,
    'i'
  );
  const contentFirst = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`,
    'i'
  );

  const match = propertyFirst.exec(html) ?? contentFirst.exec(html);
  return match?.[1] ? decodeEscapedValue(match[1]) : undefined;
}

/** All `video_versions` entries found in an embedded JSON payload. */
export function extractMediaVersions(html: string): MediaVersion[] {
  const versions: MediaVersion[] = [];
  const blockPattern = /"video_versions"\s*:\s*\[([^\]]*)\]/g;

  let block: RegExpExecArray | null;
  while ((block = blockPattern.exec(html)) !== null) {
    const objectPattern = /\{[^{}]*\}/g;
    let object: RegExpExecArray | null;

    while ((object = objectPattern.exec(block[1] ?? '')) !== null) {
      const chunk = object[0] ?? '';
      const url = firstMatch(chunk, /"url"\s*:\s*"((?:[^"\\]|\\.)+)"/);
      if (!url) continue;

      versions.push({
        url,
        width: numberMatch(chunk, /"width"\s*:\s*(\d+)/),
        height: numberMatch(chunk, /"height"\s*:\s*(\d+)/),
      });
    }
  }

  return versions;
}

/** Candidate direct media URLs, best first (og:video then embedded payload). */
export function extractMediaUrlCandidates(html: string): string[] {
  const candidates: string[] = [];

  const ogVideo = metaContent(html, 'og:video') ?? metaContent(html, 'og:video:secure_url');
  if (ogVideo) candidates.push(ogVideo);

  const patterns = [
    /"video_url"\s*:\s*"((?:[^"\\]|\\.)+)"/,
    /"contentUrl"\s*:\s*"((?:[^"\\]|\\.)+)"/,
    /<video[^>]+src=["']((?:[^"'\\]|\\.)+)["']/i,
    /<source[^>]+src=["']((?:[^"'\\]|\\.)+)["']/i,
  ];

  for (const pattern of patterns) {
    const value = firstMatch(html, pattern);
    if (value) candidates.push(value);
  }

  return candidates;
}

/** First caption line with hashtags/mentions stripped, capped at 100 chars. */
export function cleanTitle(caption: string): string | undefined {
  const firstLine = caption
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) return undefined;

  const cleaned = firstLine
    .replace(/#[^\s#]+/g, '')
    .replace(/@[^\s@]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned ? cleaned.slice(0, 100) : undefined;
}

/** `<title>` tag content with Instagram's suffix removed. */
function titleTag(html: string): string | undefined {
  const match = /<title>([^<]*)<\/title>/i.exec(html);
  if (!match?.[1]) return undefined;

  const title = decodeEscapedValue(match[1])
    .replace(/\s*[•|]\s*Instagram\s*$/i, '')
    .trim();

  return title || undefined;
}

const NOT_FOUND_PATTERN = /sorry, this page isn't available|page not found|"status"\s*:\s*"fail"/i;
const PRIVATE_PATTERN = /"is_private"\s*:\s*true|this account is private/i;
const LOGIN_WALL_PATTERN = /"require_login"\s*:\s*true|<title>[^<]*log in[^<]*<\/title>/i;

/**
 * Titles Instagram serves for its own logged-out shell and for genuinely
 * missing content. They describe the site, not the reel, so they are not
 * evidence that a reel exists.
 */
const GENERIC_TITLES = new Set(['instagram', 'instagram reel', 'page not found • instagram']);

/**
 * Decides whether a response proves the reel exists.
 *
 * Requires two independent signals so a login wall can never be mistaken for a
 * live reel: Instagram must publish a reel-specific Open Graph description, and
 * the page must be scoped to the requested shortcode. Verified behaviour:
 * a real reel yields og:title + og:description + og:image; the login wall and a
 * nonexistent shortcode yield none of them.
 */
function hasReelMetadata(
  html: string,
  ogTitle: string | undefined,
  ogDescription: string | undefined,
  ogImage: string | undefined,
  shortCode: string
): boolean {
  const title = ogTitle?.trim();
  if (!title || GENERIC_TITLES.has(title.toLowerCase())) return false;

  // The canonical/og:url must point back at the exact reel we asked for.
  // Instagram writes these URLs both verbatim (`https://…`) and slash-escaped
  // inside embedded JSON (`https:\/\/…`), so both forms are accepted.
  const scopedToReel = new RegExp(
    `https?:(?:\\\\?/){2}(?:www\\.)?instagram\\.com(?:\\\\?/)[^"']*?/${escapeRegExp(shortCode)}`,
    'i'
  ).test(html);
  if (!scopedToReel) return false;

  // Real reels always describe themselves and ship a cover image.
  return Boolean(ogDescription?.trim() || ogImage?.trim());
}

/**
 * Extracts every signal we care about from a public Instagram page body
 * (or from a JSON payload that has been stringified back to text).
 */
export function extractFromHtml(html: string, shortCode: string): ExtractedMedia {
  const versions = extractMediaVersions(html);
  const candidates = extractMediaUrlCandidates(html);
  const mediaUrl = candidates[0] ?? versions[0]?.url;
  const matchedVersion = versions.find((version) => version.url === mediaUrl);

  const caption = firstMatch(
    html,
    /"edge_media_to_caption"\s*:\s*\{\s*"edges"\s*:\s*\[\s*\{\s*"node"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/
  );
  const ogTitle = metaContent(html, 'og:title');
  const ogDescription = metaContent(html, 'og:description');
  const ogImage = metaContent(html, 'og:image');
  const duration =
    numberMatch(html, /"video_duration"\s*:\s*([\d.]+)/) ??
    numberMatch(html, /og:video:duration["'][^>]*content=["']([\d.]+)["']/i) ??
    0;

  // Instagram only renders og:title/og:description for a reel that actually
  // exists. The logged-out login wall omits them entirely, so their presence is
  // positive proof the reel is live. Instagram's generic shell title ("Instagram")
  // carries no reel information and must not be treated as proof.
  const exists = hasReelMetadata(html, ogTitle, ogDescription, ogImage, shortCode);

  return {
    shortCode,
    mediaUrl,
    versions,
    thumbnail:
      firstMatch(html, /"display_url"\s*:\s*"((?:[^"\\]|\\.)+)"/) ??
      firstMatch(html, /"thumbnail_src"\s*:\s*"((?:[^"\\]|\\.)+)"/) ??
      ogImage,
    title: cleanTitle(caption ?? '') ?? ogTitle ?? titleTag(html),
    duration,
    width: matchedVersion?.width,
    height: matchedVersion?.height,
    isVideo:
      (mediaUrl !== undefined && mediaUrl.length > 0) ||
      versions.length > 0 ||
      /"is_video"\s*:\s*true/.test(html),
    isPrivate: PRIVATE_PATTERN.test(html),
    requiresLogin: LOGIN_WALL_PATTERN.test(html),
    notFound: NOT_FOUND_PATTERN.test(html),
    exists,
    ownerUsername: firstMatch(html, /"username"\s*:\s*"([^"]+)"/),
  };
}

/** Parses an `?__a=1&__d=dis` style JSON payload with the shared extractors. */
export function extractFromJson(body: string, shortCode: string): ExtractedMedia {
  try {
    const parsed: unknown = JSON.parse(body);
    return extractFromHtml(JSON.stringify(parsed), shortCode);
  } catch {
    return extractFromHtml(body, shortCode);
  }
}

function versionArea(version: MediaVersion): number {
  return (version.width ?? 0) * (version.height ?? 0);
}

/**
 * Builds the user-selectable variants from the media URLs located in the page.
 * Instagram exposes the real renditions in `video_versions`, so those are used
 * (largest first) whenever available; otherwise the single located media URL is
 * offered as `original`. Only qualities we actually located are returned - the
 * app never fabricates a rendition the source does not provide.
 */
export function buildDirectVariants(
  shortCode: string,
  mediaUrl: string,
  versions: MediaVersion[]
): MediaVariant[] {
  const deduped = new Map<string, MediaVersion>();
  for (const version of versions) {
    if (version.url && !deduped.has(version.url)) deduped.set(version.url, version);
  }

  const ordered = [...deduped.values()].sort((a, b) => versionArea(b) - versionArea(a));
  const sources: MediaVersion[] = ordered.length > 0 ? ordered : [{ url: mediaUrl }];

  return sources.slice(0, QUALITY_TIERS.length).map((source, index) => ({
    quality: QUALITY_TIERS[index] ?? 'sd',
    format: 'mp4',
    downloadUrl: `/api/reels/download/ig_${shortCode}/${QUALITY_TIERS[index] ?? 'sd'}`,
    sourceUrl: source.url,
    width: source.width,
    height: source.height,
  }));
}

/** Converts extracted page data into the shared resolution result shape. */
export function toResolutionResult(extracted: ExtractedMedia): MediaResolutionResult {
  const mediaUrl = extracted.mediaUrl ?? extracted.versions[0]?.url;

  if (!mediaUrl) {
    throw new DirectUrlError(
      'MEDIA_UNAVAILABLE',
      'No media URL could be located in the public page response'
    );
  }

  const media = buildDirectVariants(extracted.shortCode, mediaUrl, extracted.versions);
  if (media.length === 0) {
    throw new DirectUrlError('MEDIA_UNAVAILABLE', 'No playable media variant was located');
  }

  return {
    id: `ig_${extracted.shortCode}`,
    title: extracted.title || `Instagram Reel ${extracted.shortCode}`,
    thumbnail: extracted.thumbnail ?? '',
    duration: Math.max(0, Math.round(extracted.duration)),
    media,
    shortCode: extracted.shortCode,
    platform: 'instagram',
  };
}

export interface DirectUrlProcessorOptions {
  /** Injectable fetch implementation (used by tests). */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Requests the publicly accessible Instagram page for a pasted URL and locates
 * the direct media URL in the response.
 *
 * Order of attempts (all unauthenticated, public endpoints):
 *   1. the canonical public reel/post page HTML
 *   2. the public JSON view of the same page (`?__a=1&__d=dis`)
 *   3. the public embed page (`/embed/captioned/`)
 */
export class DirectUrlProcessor {
  private readonly fetchImpl?: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: DirectUrlProcessorOptions = {}) {
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  async process(url: string, shortCode?: string): Promise<MediaResolutionResult> {
    const code = shortCode ?? extractShortCode(url);
    if (!code) {
      throw new DirectUrlError(
        'INVALID_URL',
        'Could not extract an Instagram shortcode from the URL'
      );
    }

    const failures: DirectUrlError[] = [];

    for (const target of this.buildTargets(url, code)) {
      try {
        const extracted = await this.fetchTarget(target, code);

        if (extracted.mediaUrl || extracted.versions.length > 0) {
          return toResolutionResult(extracted);
        }

        failures.push(this.classifyEmptyResponse(extracted));
      } catch (error) {
        failures.push(
          error instanceof DirectUrlError
            ? error
            : new DirectUrlError('MEDIA_UNAVAILABLE', 'Failed to read the public Instagram page')
        );
      }
    }

    throw this.pickError(failures);
  }

  private buildTargets(url: string, shortCode: string): FetchTarget[] {
    const kind = /\/(?:reels?|tv)\//i.test(url) ? 'reel' : 'p';
    const canonical = `${INSTAGRAM_ORIGIN}/${kind}/${shortCode}/`;

    return [
      { url: canonical, kind: 'html' },
      { url: `${canonical}embed/captioned/`, kind: 'html' },
    ];
  }

  private async fetchTarget(target: FetchTarget, shortCode: string): Promise<ExtractedMedia> {
    const doFetch = this.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await doFetch(target.url, {
        method: 'GET',
        headers: this.buildHeaders(target),
        redirect: 'follow',
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch {
      throw new DirectUrlError('MEDIA_UNAVAILABLE', 'Could not reach the public Instagram page');
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 404) {
      // A 404 from the embed fallback says nothing about the reel itself - the
      // embed route is unreliable - so it must not outrank a successful read of
      // the canonical page in pickError().
      throw new DirectUrlError(
        'MEDIA_UNAVAILABLE',
        'Instagram responded with HTTP 404 for this endpoint'
      );
    }
    if (response.status === 429) {
      throw new DirectUrlError('RATE_LIMITED', 'Instagram is rate limiting requests');
    }
    if (response.status === 401 || response.status === 403) {
      throw new DirectUrlError('PRIVATE_CONTENT', 'Instagram requires a login for this content');
    }
    if (!response.ok) {
      throw new DirectUrlError(
        'MEDIA_UNAVAILABLE',
        `Instagram responded with HTTP ${response.status}`
      );
    }

    const body = await response.text();
    const contentType = response.headers.get('content-type') ?? '';

    return target.kind === 'json' && /json/i.test(contentType)
      ? extractFromJson(body, shortCode)
      : extractFromHtml(body, shortCode);
  }

  private classifyEmptyResponse(extracted: ExtractedMedia): DirectUrlError {
    if (extracted.isPrivate) {
      return new DirectUrlError('PRIVATE_CONTENT', 'This content is from a private account');
    }

    // The reel demonstrably exists - Instagram returned its caption and cover -
    // but withheld the video file because the request is not signed in.
    // Reporting NOT_FOUND here was the bug that told users their live reel had
    // been deleted.
    if (extracted.exists) {
      return new DirectUrlError(
        'AUTH_REQUIRED',
        'Instagram requires a signed-in session to serve this reel. The reel exists, but its video file is not publicly retrievable'
      );
    }

    if (extracted.notFound) {
      return new DirectUrlError('NOT_FOUND', 'Reel not found or has been deleted');
    }
    if (extracted.requiresLogin) {
      return new DirectUrlError('NOT_PERMITTED', 'Instagram requires a login to view this content');
    }
    if (!extracted.isVideo && extracted.thumbnail) {
      return new DirectUrlError('NOT_PERMITTED', 'This post does not contain a video');
    }
    return new DirectUrlError(
      'MEDIA_UNAVAILABLE',
      'No media URL could be located in the public page response'
    );
  }

  private pickError(failures: DirectUrlError[]): DirectUrlError {
    // Ordered by how confidently each verdict describes the reel. AUTH_REQUIRED
    // outranks NOT_FOUND because it is backed by proof the reel exists, whereas
    // NOT_FOUND is inferred from a page that may simply have been withheld.
    const priority: DirectUrlErrorCode[] = [
      'PRIVATE_CONTENT',
      'AUTH_REQUIRED',
      'RATE_LIMITED',
      'NOT_FOUND',
      'NOT_PERMITTED',
      'MEDIA_UNAVAILABLE',
      'INVALID_URL',
    ];

    for (const code of priority) {
      const match = failures.find((failure) => failure.code === code);
      if (match) return match;
    }

    return new DirectUrlError('MEDIA_UNAVAILABLE', 'Unable to retrieve media information');
  }

  private buildHeaders(target: FetchTarget): Record<string, string> {
    return {
      // The app User-Agent is what makes Instagram return page content instead
      // of the logged-out login wall. It is the only signal that distinguishes
      // a real reel from a deleted one.
      'User-Agent': INSTAGRAM_APP_USER_AGENT,
      Accept:
        target.kind === 'json'
          ? 'application/json, text/plain, */*'
          : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      Referer: `${INSTAGRAM_ORIGIN}/`,
    };
  }
}

export const directUrlProcessor = new DirectUrlProcessor();
