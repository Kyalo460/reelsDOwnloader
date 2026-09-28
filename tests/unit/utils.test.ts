// Utility Function Tests

import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  formatDuration,
  sanitizeFilename,
  truncate,
  hashString,
  isValidUrl,
  getDomain,
  isInstagramReelUrl,
  extractShortCode,
  generateId,
} from '@/lib/utils';

describe('Utility Functions', () => {
  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 Bytes');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1024 * 1024)).toBe('1 MB');
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
      expect(formatBytes(1536)).toBe('1.5 KB');
    });
  });

  describe('formatDuration', () => {
    it('should format duration correctly', () => {
      expect(formatDuration(0)).toBe('0:00');
      expect(formatDuration(30)).toBe('0:30');
      expect(formatDuration(60)).toBe('1:00');
      expect(formatDuration(90)).toBe('1:30');
      expect(formatDuration(3661)).toBe('61:01');
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove invalid characters', () => {
      expect(sanitizeFilename('normal-file.mp4')).toBe('normal-file.mp4');
      expect(sanitizeFilename('file<>:"/\\|?*.mp4')).toBe('file.mp4');
      expect(sanitizeFilename('file with spaces.mp4')).toBe('file-with-spaces.mp4');
      expect(sanitizeFilename('file---multiple---hyphens.mp4')).toBe('file-multiple-hyphens.mp4');
      expect(sanitizeFilename('-leading-hyphen.mp4')).toBe('leading-hyphen.mp4');
      expect(sanitizeFilename('trailing-hyphen-.mp4')).toBe('trailing-hyphen.mp4');
    });

    it('should limit length', () => {
      const longName = 'a'.repeat(150);
      expect(sanitizeFilename(longName).length).toBe(100);
    });

    it('should handle empty string', () => {
      expect(sanitizeFilename('')).toBe('');
    });
  });

  describe('truncate', () => {
    it('should truncate long strings', () => {
      expect(truncate('hello world', 8)).toBe('hello...');
      expect(truncate('short', 10)).toBe('short');
      expect(truncate('exact', 5)).toBe('exact');
    });
  });

  describe('hashString', () => {
    it('should produce consistent hashes', () => {
      const hash1 = hashString('test');
      const hash2 = hashString('test');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      expect(hashString('test1')).not.toBe(hashString('test2'));
    });

    it('should handle empty string', () => {
      expect(hashString('')).toBe('0');
    });
  });

  describe('isValidUrl', () => {
    it('should validate URLs correctly', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('https://example.com/path?query=1')).toBe(true);
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl('')).toBe(false);
    });
  });

  describe('getDomain', () => {
    it('should extract domain correctly', () => {
      expect(getDomain('https://www.instagram.com/reel/ABC123/')).toBe('www.instagram.com');
      expect(getDomain('https://instagram.com/reel/ABC123/')).toBe('instagram.com');
      expect(getDomain('invalid')).toBe('');
    });
  });

  describe('isInstagramReelUrl', () => {
    it('should identify Instagram Reel URLs', () => {
      expect(isInstagramReelUrl('https://www.instagram.com/reel/ABC123/')).toBe(true);
      expect(isInstagramReelUrl('https://instagram.com/reel/ABC123/')).toBe(true);
      expect(isInstagramReelUrl('https://www.instagram.com/p/ABC123/')).toBe(true);
      expect(isInstagramReelUrl('https://www.facebook.com/reel/ABC123/')).toBe(false);
      expect(isInstagramReelUrl('https://example.com/reel/ABC123/')).toBe(false);
    });
  });

  describe('extractShortCode', () => {
    it('should extract short codes from various URL formats', () => {
      expect(extractShortCode('https://www.instagram.com/reel/ABC123/')).toBe('ABC123');
      expect(extractShortCode('https://www.instagram.com/p/XYZ789/')).toBe('XYZ789');
      expect(extractShortCode('https://instagram.com/reel/abc_def/')).toBe('abc_def');
      expect(extractShortCode('https://example.com/reel/ABC123/')).toBeUndefined();
      expect(extractShortCode('invalid')).toBeUndefined();
    });
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
      expect(id1.length).toBeGreaterThan(0);
    });

    it('should include prefix when provided', () => {
      const id = generateId('prefix_');
      expect(id.startsWith('prefix_')).toBe(true);
    });
  });
});
