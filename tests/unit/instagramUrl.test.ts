// Instagram URL parsing tests

import { describe, it, expect } from 'vitest';
import {
  extractShortCodeFromInstagramUrl,
  isInstagramHostname,
  isInstagramMediaUrl,
  normalizeInstagramUrl,
  parseInstagramMediaUrl,
} from '@/lib/instagramUrl';

describe('instagramUrl', () => {
  describe('isInstagramHostname', () => {
    it('accepts Instagram and its subdomains only', () => {
      expect(isInstagramHostname('instagram.com')).toBe(true);
      expect(isInstagramHostname('www.instagram.com')).toBe(true);
      expect(isInstagramHostname('WWW.INSTAGRAM.COM')).toBe(true);
      expect(isInstagramHostname('m.instagram.com')).toBe(true);
    });

    it('rejects lookalike and unrelated hosts', () => {
      expect(isInstagramHostname('instagram.com.evil.example')).toBe(false);
      expect(isInstagramHostname('notinstagram.com')).toBe(false);
      expect(isInstagramHostname('instagram.co')).toBe(false);
      expect(isInstagramHostname('evilinstagram.com')).toBe(false);
      expect(isInstagramHostname('facebook.com')).toBe(false);
    });
  });

  describe('normalizeInstagramUrl', () => {
    it('adds a scheme to bare links', () => {
      expect(normalizeInstagramUrl('instagram.com/reel/ABC123')?.href).toBe(
        'https://instagram.com/reel/ABC123'
      );
      expect(normalizeInstagramUrl('//instagram.com/reel/ABC123')?.href).toBe(
        'https://instagram.com/reel/ABC123'
      );
    });

    it('strips wrapping quotes and angle brackets', () => {
      expect(normalizeInstagramUrl('"https://instagram.com/reel/ABC123"')?.href).toBe(
        'https://instagram.com/reel/ABC123'
      );
      expect(normalizeInstagramUrl('<https://instagram.com/reel/ABC123>')?.href).toBe(
        'https://instagram.com/reel/ABC123'
      );
    });

    it('rejects non-http(s) schemes', () => {
      expect(normalizeInstagramUrl('javascript:alert(1)')).toBeNull();
      expect(normalizeInstagramUrl('file:///etc/passwd')).toBeNull();
      expect(normalizeInstagramUrl('ftp://instagram.com/reel/ABC')).toBeNull();
    });

    it('rejects empty input', () => {
      expect(normalizeInstagramUrl('')).toBeNull();
      expect(normalizeInstagramUrl('   ')).toBeNull();
    });
  });

  describe('parseInstagramMediaUrl', () => {
    it('parses every supported media kind', () => {
      const cases = [
        { url: 'https://www.instagram.com/reel/ABC123/', kind: 'reel' },
        { url: 'https://www.instagram.com/reels/ABC123/', kind: 'reels' },
        { url: 'https://www.instagram.com/p/ABC123/', kind: 'p' },
        { url: 'https://www.instagram.com/tv/ABC123/', kind: 'tv' },
      ];

      for (const { url, kind } of cases) {
        expect(parseInstagramMediaUrl(url), url).toEqual({
          url: `https://www.instagram.com/${kind}/ABC123`,
          shortCode: 'ABC123',
          kind,
        });
      }
    });

    it('ignores query strings and fragments', () => {
      for (const url of [
        'https://www.instagram.com/reel/ABC123/?igshid=abc',
        'https://www.instagram.com/reel/ABC123/?igsh=MQ3abc&utm_source=ig_web_copy_link',
        'https://www.instagram.com/p/ABC123/?img_index=1',
        'https://www.instagram.com/reel/ABC123#media',
      ]) {
        expect(extractShortCodeFromInstagramUrl(url), url).toBe('ABC123');
      }
    });

    it('unwraps mobile share links', () => {
      expect(extractShortCodeFromInstagramUrl('https://www.instagram.com/share/reel/ABC123/')).toBe(
        'ABC123'
      );
      expect(extractShortCodeFromInstagramUrl('https://www.instagram.com/share/p/ABC123/')).toBe(
        'ABC123'
      );
    });

    it('keeps shortcodes with underscores and dashes intact', () => {
      expect(extractShortCodeFromInstagramUrl('https://www.instagram.com/p/Post_1-2/')).toBe(
        'Post_1-2'
      );
    });

    it('returns a canonical URL without query string or trailing slash', () => {
      expect(
        parseInstagramMediaUrl('https://www.instagram.com/reel/ABC123/?igshid=xyz#media')
      ).toEqual({
        url: 'https://www.instagram.com/reel/ABC123',
        shortCode: 'ABC123',
        kind: 'reel',
      });
    });

    it('lower-cases the host but preserves the shortcode case', () => {
      const result = parseInstagramMediaUrl('https://WWW.Instagram.COM/reel/AbC_123/');
      expect(result?.url).toBe('https://www.instagram.com/reel/AbC_123');
    });

    it('returns null for non-media Instagram pages', () => {
      const notMedia = [
        'https://www.instagram.com/',
        'https://www.instagram.com/explore/tags/sunset/',
        'https://www.instagram.com/stories/someone/12345/',
        'https://www.instagram.com/reel/',
        'https://www.instagram.com/reel',
        'https://www.instagram.com/reel/ABC123/embed/',
        'https://www.instagram.com/reels/audio/',
      ];

      for (const url of notMedia) {
        expect(parseInstagramMediaUrl(url), url).toBeNull();
      }
    });

    it('returns null for non-Instagram hosts', () => {
      expect(parseInstagramMediaUrl('https://example.com/reel/ABC123/')).toBeNull();
      expect(parseInstagramMediaUrl('https://facebook.com/reel/ABC123/')).toBeNull();
      expect(parseInstagramMediaUrl('https://instagram.com.evil.example/reel/ABC123')).toBeNull();
    });
  });

  describe('isInstagramMediaUrl', () => {
    it('mirrors parseInstagramMediaUrl', () => {
      expect(isInstagramMediaUrl('https://www.instagram.com/reel/ABC123/?igsh=abc')).toBe(true);
      expect(isInstagramMediaUrl('instagram.com/reel/ABC123')).toBe(true);
      expect(isInstagramMediaUrl('https://example.com/reel/ABC123/')).toBe(false);
    });
  });
});
