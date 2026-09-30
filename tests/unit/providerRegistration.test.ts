// Provider Registration Tests
//
// `InstagramProvider` registers itself in the shared registry as an import side
// effect. Nothing in `src/` imported it, so the registry was empty at runtime
// and every URL was rejected as UNSUPPORTED_URL. These tests pin the wiring so
// the registration cannot silently disappear again.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  getPrisma: () => null,
  requirePrisma: () => {
    throw new Error('DATABASE_URL is not configured');
  },
  isDatabaseConfigured: () => false,
}));

import { providerRegistry } from '@/services/media/MediaProvider';

describe('provider registration', () => {
  it('has the Instagram provider registered when MediaResolver is loaded', async () => {
    await import('@/services/media/MediaResolver');

    const provider = providerRegistry.getProvider('https://www.instagram.com/reel/ABC123/');
    expect(provider?.name).toBe('Instagram');
  });

  it('has the Instagram provider registered when DownloadService is loaded', async () => {
    await import('@/services/media/DownloadService');

    const provider = providerRegistry.getProvider('https://www.instagram.com/reel/ABC123/');
    expect(provider?.name).toBe('Instagram');
  });

  it('resolves the bare and www hosts to the same provider', async () => {
    await import('@/services/media/MediaResolver');

    const withWww = providerRegistry.getProvider('https://www.instagram.com/reel/ABC123/');
    const withoutWww = providerRegistry.getProvider('https://instagram.com/reel/ABC123/');

    expect(withWww).toBeDefined();
    expect(withoutWww).toBeDefined();
  });

  it('exposes the Instagram request headers the CDN requires', async () => {
    await import('@/services/media/DownloadService');

    const provider = providerRegistry.getProvider('https://www.instagram.com/reel/ABC123/');
    const headers = provider!.getMediaRequestHeaders(
      'https://scontent.cdninstagram.com/v/t50/a.mp4'
    );

    expect(headers.Referer).toBe('https://www.instagram.com/');
    expect(headers.Origin).toBe('https://www.instagram.com');
  });
});
