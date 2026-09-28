// Media Provider Tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { providerRegistry } from '@/services/media/MediaProvider';
import { InstagramProvider } from '@/services/media/InstagramProvider';

describe('MediaProvider', () => {
  let instagramProvider: InstagramProvider;

  beforeEach(() => {
    instagramProvider = new InstagramProvider();
    // Clear registry and re-register
    (providerRegistry as any).providers.clear();
    providerRegistry.register(instagramProvider);
  });

  describe('InstagramProvider', () => {
    it('should have correct name and supported domains', () => {
      expect(instagramProvider.name).toBe('Instagram');
      expect(instagramProvider.supportedDomains).toEqual(['instagram.com', 'www.instagram.com']);
    });

    it('should validate Instagram Reel URLs', async () => {
      const validUrls = [
        'https://www.instagram.com/reel/ABC123/',
        'https://instagram.com/reel/ABC123/',
        'https://www.instagram.com/p/XYZ789/',
      ];

      for (const url of validUrls) {
        const result = await instagramProvider.validateUrl(url);
        expect(result.valid).toBe(true);
        expect(result.shortCode).toBeDefined();
      }
    });

    it('should reject non-Instagram URLs', async () => {
      const result = await instagramProvider.validateUrl('https://example.com/reel/ABC123/');
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('UNSUPPORTED_URL');
    });

    it('should reject invalid URL formats', async () => {
      const result = await instagramProvider.validateUrl('not-a-url');
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
    });

    it('should extract short code correctly', async () => {
      const testCases = [
        { url: 'https://www.instagram.com/reel/ABC123/', expected: 'ABC123' },
        { url: 'https://www.instagram.com/p/XYZ789/', expected: 'XYZ789' },
      ];

      for (const { url, expected } of testCases) {
        const result = await instagramProvider.validateUrl(url);
        expect(result.shortCode).toBe(expected);
      }
    });
  });

  describe('ProviderRegistry', () => {
    it('should find provider for Instagram URLs', () => {
      const provider = providerRegistry.getProvider('https://www.instagram.com/reel/ABC123/');
      expect(provider).toBe(instagramProvider);
    });

    it('should find provider for subdomain', () => {
      const provider = providerRegistry.getProvider('https://instagram.com/reel/ABC123/');
      expect(provider).toBe(instagramProvider);
    });

    it('should return null for unsupported domains', () => {
      const provider = providerRegistry.getProvider('https://example.com/reel/ABC123/');
      expect(provider).toBeNull();
    });

    it('should return all registered providers', () => {
      const providers = providerRegistry.getAllProviders();
      expect(providers).toContain(instagramProvider);
    });
  });
});
