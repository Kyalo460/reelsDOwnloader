// Direct URL Processor Tests

import { describe, it, expect, vi } from 'vitest';
import {
  DirectUrlProcessor,
  buildDirectVariants,
  cleanTitle,
  decodeEscapedValue,
  extractFromHtml,
  extractFromJson,
  extractMediaUrlCandidates,
  extractMediaVersions,
  extractShortCode,
} from '@/services/media/DirectUrlProcessor';

const SHORT_CODE = 'ABC123';
const REEL_URL = `https://www.instagram.com/reel/${SHORT_CODE}/`;
const CDN_1080 = 'https://scontent.cdninstagram.com/v/t50/reel-1080.mp4?_nc_ht=ig&oe=ABC';

// Instagram serves escaped JSON (`https:\/\/…`, `\u0026`) inside the page body.
const REEL_PAGE_HTML = String.raw`<!DOCTYPE html>
<html>
  <head>
    <title>Golden hour at the pier • Instagram</title>
    <meta property="og:title" content="Golden hour at the pier • Instagram" />
    <meta property="og:image" content="https://scontent.cdninstagram.com/v/t51/thumb-og.jpg" />
    <meta property="og:video" content="https://scontent.cdninstagram.com/v/t50/reel-1080.mp4?_nc_ht=ig&amp;oe=ABC" />
    <meta property="og:video:duration" content="27" />
  </head>
  <body>
    <script type="application/json">{"shortcode_media":{"is_video":true,"video_duration":27.4,"display_url":"https:\/\/scontent.cdninstagram.com\/v\/t51\/thumb.jpg","edge_media_to_caption":{"edges":[{"node":{"text":"Golden hour at the pier 🌅 #sunset #waves @friend"}}]},"owner":{"username":"waves","is_private":false},"video_versions":[{"type":101,"width":1080,"height":1920,"url":"https:\/\/scontent.cdninstagram.com\/v\/t50\/reel-1080.mp4?_nc_ht=ig\u0026oe=ABC"},{"type":102,"width":720,"height":1280,"url":"https:\/\/scontent.cdninstagram.com\/v\/t50\/reel-720.mp4"},{"type":103,"width":480,"height":854,"url":"https:\/\/scontent.cdninstagram.com\/v\/t50\/reel-480.mp4"}]}}</script>
  </body>
</html>`;

const PRIVATE_PAGE = String.raw`<html><head><title>Instagram</title></head><body>{"is_private":true}</body></html>`;

const NOT_FOUND_PAGE = String.raw`<html><head><title>Page not found • Instagram</title></head><body><h2>Sorry, this page isn't available.</h2></body></html>`;

const LOGIN_WALL_PAGE = String.raw`<html><head><title>Login • Instagram</title></head><body>{"require_login":true}</body></html>`;

const IMAGE_ONLY_PAGE = String.raw`<html><head><meta property="og:image" content="https://cdn/thumb.jpg" /></head><body>{"is_video":false,"display_url":"https:\/\/cdn\/thumb.jpg"}</body></html>`;

const EMPTY_PAGE = '<html><head><title>Instagram</title></head><body></body></html>';

const EMBED_PAGE = String.raw`<html><body><video src="https:\/\/scontent.cdninstagram.com\/v\/t50\/reel-480.mp4"></video><script>{"video_url":"https:\/\/scontent.cdninstagram.com\/v\/t50\/reel-480.mp4"}</script></body></html>`;

const JSON_VIEW = JSON.stringify({
  items: [
    {
      is_video: true,
      video_duration: 12.6,
      display_url: 'https://cdn/thumb-json.jpg',
      video_versions: [
        { type: 101, width: 720, height: 1280, url: 'https://cdn/reel-720.mp4' },
        { type: 102, width: 480, height: 854, url: 'https://cdn/reel-480.mp4' },
      ],
    },
  ],
});

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestedUrls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
  return fetchImpl.mock.calls.map((call) => String(call[0]));
}

describe('DirectUrlProcessor', () => {
  describe('extractShortCode', () => {
    it('reads reel, reels and post URLs', () => {
      expect(extractShortCode('https://www.instagram.com/reel/ABC123/')).toBe('ABC123');
      expect(extractShortCode('https://instagram.com/reels/XYZ789?igsh=abc')).toBe('XYZ789');
      expect(extractShortCode('https://www.instagram.com/p/Post_1-2/')).toBe('Post_1-2');
    });

    it('returns undefined when the URL has no shortcode', () => {
      expect(extractShortCode('https://www.instagram.com/explore/tags/sunset/')).toBeUndefined();
    });
  });

  describe('decodeEscapedValue', () => {
    it('unescapes JSON and HTML escapes used by Instagram', () => {
      expect(
        decodeEscapedValue(
          'https:\\/\\/cdn.instagram.com\\/v\\/t50\\/a.mp4?_nc_ht=ig\\u0026oe=ABC&amp;x=1'
        )
      ).toBe('https://cdn.instagram.com/v/t50/a.mp4?_nc_ht=ig&oe=ABC&x=1');
    });
  });

  describe('extractMediaVersions', () => {
    it('returns every rendition with its dimensions', () => {
      const versions = extractMediaVersions(REEL_PAGE_HTML);

      expect(versions).toHaveLength(3);
      expect(versions[0]).toEqual({ url: CDN_1080, width: 1080, height: 1920 });
      expect(versions[2]).toEqual({
        url: 'https://scontent.cdninstagram.com/v/t50/reel-480.mp4',
        width: 480,
        height: 854,
      });
    });
  });

  describe('extractMediaUrlCandidates', () => {
    it('prefers the og:video meta tag and also finds embedded video_url values', () => {
      expect(extractMediaUrlCandidates(REEL_PAGE_HTML)[0]).toBe(CDN_1080);
      expect(extractMediaUrlCandidates(EMBED_PAGE)[0]).toBe(
        'https://scontent.cdninstagram.com/v/t50/reel-480.mp4'
      );
    });
  });

  describe('cleanTitle', () => {
    it('keeps the first caption line without hashtags or mentions', () => {
      expect(cleanTitle('Golden hour at the pier 🌅 #sunset @friend\nsecond line')).toBe(
        'Golden hour at the pier 🌅'
      );
    });

    it('returns undefined for empty captions', () => {
      expect(cleanTitle('\n   \n')).toBeUndefined();
    });
  });

  describe('extractFromHtml', () => {
    it('pulls metadata, media URL and safety flags out of the page', () => {
      const extracted = extractFromHtml(REEL_PAGE_HTML, SHORT_CODE);

      expect(extracted.title).toBe('Golden hour at the pier 🌅');
      expect(extracted.thumbnail).toBe('https://scontent.cdninstagram.com/v/t51/thumb.jpg');
      expect(extracted.duration).toBe(27.4);
      expect(extracted.mediaUrl).toBe(CDN_1080);
      expect(extracted.width).toBe(1080);
      expect(extracted.ownerUsername).toBe('waves');
      expect(extracted.isVideo).toBe(true);
      expect(extracted.isPrivate).toBe(false);
      expect(extracted.requiresLogin).toBe(false);
      expect(extracted.notFound).toBe(false);
    });

    it('flags private, missing and login-walled pages', () => {
      expect(extractFromHtml(PRIVATE_PAGE, SHORT_CODE).isPrivate).toBe(true);
      expect(extractFromHtml(NOT_FOUND_PAGE, SHORT_CODE).notFound).toBe(true);
      expect(extractFromHtml(LOGIN_WALL_PAGE, SHORT_CODE).requiresLogin).toBe(true);
    });
  });

  describe('extractFromJson', () => {
    it('extracts from the public JSON view of the page', () => {
      const extracted = extractFromJson(JSON_VIEW, SHORT_CODE);

      expect(extracted.versions).toHaveLength(2);
      expect(extracted.mediaUrl).toBe('https://cdn/reel-720.mp4');
      expect(extracted.thumbnail).toBe('https://cdn/thumb-json.jpg');
      expect(extracted.duration).toBe(12.6);
    });
  });

  describe('buildDirectVariants', () => {
    it('maps the located renditions to quality tiers, largest first', () => {
      const variants = buildDirectVariants(
        SHORT_CODE,
        CDN_1080,
        extractMediaVersions(REEL_PAGE_HTML)
      );

      expect(variants.map((variant) => variant.quality)).toEqual(['original', 'hd', 'sd']);
      expect(variants.map((variant) => variant.width)).toEqual([1080, 720, 480]);
      expect(variants[0]?.sourceUrl).toBe(CDN_1080);
      expect(variants[0]?.downloadUrl).toBe('/api/reels/download/ig_ABC123/original');
      expect(variants.every((variant) => variant.format === 'mp4')).toBe(true);
    });

    it('falls back to a single original variant when only one URL was located', () => {
      const variants = buildDirectVariants(SHORT_CODE, 'https://cdn/only.mp4', []);

      expect(variants).toHaveLength(1);
      expect(variants[0]?.quality).toBe('original');
      expect(variants[0]?.sourceUrl).toBe('https://cdn/only.mp4');
    });
  });

  describe('process', () => {
    it('requests the publicly accessible page and locates the media URL', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(htmlResponse(REEL_PAGE_HTML));
      const processor = new DirectUrlProcessor({ fetchImpl });

      const result = await processor.process(
        'https://www.instagram.com/reel/ABC123/?igsh=tracking'
      );

      expect(requestedUrls(fetchImpl)).toEqual([REEL_URL]);

      const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(init?.method).toBe('GET');
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['User-Agent']).toContain('Mozilla/5.0');
      expect(headers.Referer).toBe('https://www.instagram.com/');

      expect(result.id).toBe('ig_ABC123');
      expect(result.shortCode).toBe('ABC123');
      expect(result.title).toBe('Golden hour at the pier 🌅');
      expect(result.thumbnail).toBe('https://scontent.cdninstagram.com/v/t51/thumb.jpg');
      expect(result.duration).toBe(27);
      expect(result.media.map((variant) => variant.quality)).toEqual(['original', 'hd', 'sd']);
      expect(result.media[0]?.sourceUrl).toBe(CDN_1080);
      expect(result.media[2]?.sourceUrl).toBe(
        'https://scontent.cdninstagram.com/v/t50/reel-480.mp4'
      );
    });

    it('never talks to the Meta Graph API', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(htmlResponse(REEL_PAGE_HTML));

      await new DirectUrlProcessor({ fetchImpl }).process(REEL_URL);

      const urls = requestedUrls(fetchImpl);
      expect(urls.every((url) => url.startsWith('https://www.instagram.com/'))).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('keeps the post path for /p/ URLs', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(htmlResponse(REEL_PAGE_HTML));

      await new DirectUrlProcessor({ fetchImpl }).process('https://instagram.com/p/ABC123');

      expect(requestedUrls(fetchImpl)).toEqual(['https://www.instagram.com/p/ABC123/']);
    });

    it('falls back to the public JSON view when the page has no media', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(htmlResponse(EMPTY_PAGE))
        .mockResolvedValueOnce(jsonResponse(JSON_VIEW));

      const result = await new DirectUrlProcessor({ fetchImpl }).process(REEL_URL);

      expect(requestedUrls(fetchImpl)).toEqual([REEL_URL, `${REEL_URL}?__a=1&__d=dis`]);
      expect(result.media[0]?.width).toBe(720);
      expect(result.media[1]?.width).toBe(480);
    });

    it('falls back to the public embed page as a last resort', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(htmlResponse(EMPTY_PAGE))
        .mockResolvedValueOnce(htmlResponse(EMPTY_PAGE))
        .mockResolvedValueOnce(htmlResponse(EMBED_PAGE));

      const result = await new DirectUrlProcessor({ fetchImpl }).process(REEL_URL);

      expect(requestedUrls(fetchImpl)).toEqual([
        REEL_URL,
        `${REEL_URL}?__a=1&__d=dis`,
        `${REEL_URL}embed/captioned/`,
      ]);
      expect(result.media[0]?.sourceUrl).toBe(
        'https://scontent.cdninstagram.com/v/t50/reel-480.mp4'
      );
    });

    it('reports private content', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(htmlResponse(PRIVATE_PAGE));

      await expect(new DirectUrlProcessor({ fetchImpl }).process(REEL_URL)).rejects.toThrow(
        /PRIVATE_CONTENT/
      );
    });

    it('reports a deleted or missing reel', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(htmlResponse(NOT_FOUND_PAGE));

      await expect(new DirectUrlProcessor({ fetchImpl }).process(REEL_URL)).rejects.toThrow(
        /NOT_FOUND/
      );
    });

    it('reports a login wall', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(htmlResponse(LOGIN_WALL_PAGE));

      await expect(new DirectUrlProcessor({ fetchImpl }).process(REEL_URL)).rejects.toThrow(
        /NOT_PERMITTED/
      );
    });

    it('reports posts that are not videos', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(htmlResponse(IMAGE_ONLY_PAGE));

      await expect(new DirectUrlProcessor({ fetchImpl }).process(REEL_URL)).rejects.toThrow(
        /NOT_PERMITTED/
      );
    });

    it('reports rate limiting', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(htmlResponse('too many requests', 429));

      await expect(new DirectUrlProcessor({ fetchImpl }).process(REEL_URL)).rejects.toThrow(
        /RATE_LIMITED/
      );
    });

    it('reports unreachable pages', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));

      await expect(new DirectUrlProcessor({ fetchImpl }).process(REEL_URL)).rejects.toThrow(
        /MEDIA_UNAVAILABLE/
      );
    });

    it('rejects URLs without a shortcode', async () => {
      const fetchImpl = vi.fn();

      await expect(
        new DirectUrlProcessor({ fetchImpl }).process('https://www.instagram.com/explore/')
      ).rejects.toThrow(/INVALID_URL/);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});
