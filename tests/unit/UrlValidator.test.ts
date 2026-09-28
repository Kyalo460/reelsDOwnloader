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

    it('should reject non-Instagram domains', () => {
      const invalidUrls = [
        'https://www.facebook.com/reel/ABC123/',
        'https://www.youtube.com/watch?v=ABC123',
        'https://example.com/reel/ABC123/',
        'https://evil.com/reel/ABC123/',
      ];

      for (const url of invalidUrls) {
        const result = urlValidator.validate(url);
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('UNSUPPORTED_URL');
      }
    });

    it('should reject invalid URL formats', () => {
      const invalidUrls = [
        'not-a-url',
        'instagram.com/reel/ABC123',
        'www.instagram.com/reel/ABC123',
        'https://instagram.com/invalid/path',
        'https://www.instagram.com/reel/', // missing shortcode
      ];

      for (const url of invalidUrls) {
        const result = urlValidator.validate(url);
        expect(result.valid).toBe(false);
        expect(['INVALID_URL', 'UNSUPPORTED_URL']).toContain(result.error?.code);
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
