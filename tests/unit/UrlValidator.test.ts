// URL Validator Tests

import { describe, it, expect } from 'vitest';
import { urlValidator } from '@/services/validation/UrlValidator';

describe('UrlValidator', () => {
  describe('validate', () => {
    it('should accept valid Instagram Reel URLs', () => {
      const validUrls = [
        'https://www.instagram.com/reel/ABC123/',
        'https://www.instagram.com/reel/ABC123',
        'https://instagram.com/reel/ABC123/',
        'https://instagram.com/reel/ABC123',
        'https://www.instagram.com/p/ABC123/',
        'https://www.instagram.com/p/ABC123',
        'https://instagram.com/p/ABC123/',
        'https://instagram.com/p/ABC123',
        'https://www.instagram.com/reel/ABC_DEF-123/',
        'https://www.instagram.com/reel/abc123/',
      ];

      for (const url of validUrls) {
        const result = urlValidator.validate(url);
        expect(result.valid).toBe(true);
        expect(result.shortCode).toBeDefined();
      }
    });

    it('should accept the URLs people actually paste', () => {
      // Shapes produced by the Instagram app's share/copy-link actions.
      const validUrls = [
        'https://www.instagram.com/reel/ABC123/?igshid=abc123',
        'https://www.instagram.com/reel/ABC123/?igsh=MQ3xyz',
        'https://www.instagram.com/reel/ABC123/?utm_source=ig_web_copy_link',
        'https://www.instagram.com/reel/ABC123#media',
        'https://instagram.com/reels/ABC123',
        'https://www.instagram.com/tv/ABC123/',
        'https://www.instagram.com/p/ABC123/?img_index=1',
        'https://www.instagram.com/share/reel/ABC123/',
        // Pasted without a scheme.
        'instagram.com/reel/ABC123',
        'www.instagram.com/reel/ABC123/',
      ];

      for (const url of validUrls) {
        const result = urlValidator.validate(url);
        expect(result.valid, url).toBe(true);
        expect(result.shortCode, url).toBe('ABC123');
      }
    });

    it('should return a canonical URL with the query string stripped', () => {
      const result = urlValidator.validate(
        'https://www.instagram.com/reel/ABC123/?igshid=xyz#media'
      );
      expect(result.valid).toBe(true);
      expect(result.url).toBe('https://www.instagram.com/reel/ABC123');
    });

    it('should reject empty URLs', () => {
      const result = urlValidator.validate('');
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
    });

    it('should reject whitespace-only URLs', () => {
      const result = urlValidator.validate('   ');
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
    });

    it('should reject non-HTTPS URLs', () => {
      const result = urlValidator.validate('http://www.instagram.com/reel/ABC123/');
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
    });

    it('should reject non-supported domains', () => {
      const invalidUrls = [
        'https://www.facebook.com/reel/ABC123/',
        'https://example.com/reel/ABC123/',
        'https://evil.com/reel/ABC123/',
      ];

      for (const url of invalidUrls) {
        const result = urlValidator.validate(url);
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('UNSUPPORTED_URL');
      }
    });

    it('should accept valid YouTube URLs', () => {
      const validUrls = [
        'https://www.youtube.com/watch?v=ABC12345678',
        'https://youtu.be/ABC12345678',
        'https://www.youtube.com/shorts/ABC12345678',
        'https://youtube.com/watch?v=ABC12345678',
      ];

      for (const url of validUrls) {
        const result = urlValidator.validate(url);
        expect(result.valid, url).toBe(true);
        expect(result.shortCode).toBeDefined();
      }
    });

    it('should reject invalid URL formats', () => {
      const invalidUrls = [
        'not-a-url',
        'https://instagram.com/invalid/path',
        'https://www.instagram.com/reel/', // missing shortcode
        'https://www.instagram.com/reel', // missing shortcode
        'https://www.instagram.com/explore/tags/sunset/',
        'https://www.instagram.com/stories/someone/12345/',
        'https://www.instagram.com/reel/ABC123/extra/segments/',
      ];

      for (const url of invalidUrls) {
        const result = urlValidator.validate(url);
        expect(result.valid, url).toBe(false);
        expect(['INVALID_URL', 'UNSUPPORTED_URL'], url).toContain(result.error?.code);
      }
    });

    it('should reject non-http(s) schemes', () => {
      const invalidUrls = [
        'javascript:alert(1)',
        'file:///etc/passwd',
        'ftp://instagram.com/reel/ABC123',
      ];

      for (const url of invalidUrls) {
        const result = urlValidator.validate(url);
        expect(result.valid, url).toBe(false);
        expect(['INVALID_URL', 'UNSUPPORTED_URL'], url).toContain(result.error?.code);
      }
    });

    it('should not let a lookalike domain slip through the allowlist', () => {
      const lookalikes = [
        'https://instagram.com.evil.example/reel/ABC123',
        'https://notinstagram.com/reel/ABC123',
        'https://instagram.co/reel/ABC123',
        'https://evilinstagram.com/reel/ABC123',
      ];

      for (const url of lookalikes) {
        const result = urlValidator.validate(url);
        expect(result.valid, url).toBe(false);
        expect(result.error?.code, url).toBe('UNSUPPORTED_URL');
      }
    });

    it('should reject URLs exceeding max length', () => {
      const longUrl = 'https://www.instagram.com/reel/' + 'a'.repeat(2050) + '/';
      const result = urlValidator.validate(longUrl);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
    });

    it('should reject localhost and private IPs', () => {
      const blockedUrls = [
        'https://localhost/reel/ABC123/',
        'https://127.0.0.1/reel/ABC123/',
        'https://192.168.1.1/reel/ABC123/',
        'https://10.0.0.1/reel/ABC123/',
        'https://169.254.169.254/reel/ABC123/',
      ];

      for (const url of blockedUrls) {
        const result = urlValidator.validate(url);
        expect(result.valid).toBe(false);
        expect(['UNSUPPORTED_URL', 'NOT_PERMITTED']).toContain(result.error?.code);
      }
    });

    it('should extract short code correctly', () => {
      const testCases = [
        { url: 'https://www.instagram.com/reel/ABC123/', expected: 'ABC123' },
        { url: 'https://www.instagram.com/reel/ABC_DEF-123/', expected: 'ABC_DEF-123' },
        { url: 'https://www.instagram.com/p/XYZ789/', expected: 'XYZ789' },
      ];

      for (const { url, expected } of testCases) {
        const result = urlValidator.validate(url);
        expect(result.valid).toBe(true);
        expect(result.shortCode).toBe(expected);
      }
    });
  });
});
