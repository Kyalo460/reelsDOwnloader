// Media Resolver (no database) Tests
//
// Resolution itself needs no database, so a deployment without DATABASE_URL
// must still resolve and still leave a streamable record behind.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  getPrisma: () => null,
  requirePrisma: () => {
    throw new Error('DATABASE_URL is not configured');
  },
  isDatabaseConfigured: () => false,
}));

import { MediaResolver } from '@/services/media/MediaResolver';
import { resolutionStore } from '@/services/media/resolutionStore';
import { providerRegistry } from '@/services/media/MediaProvider';
import { DirectUrlError } from '@/services/media/DirectUrlProcessor';
import type { MediaProvider } from '@/services/media/MediaProvider';
import type { MediaResolutionResult } from '@/types';

const SOURCE_URL = 'https://scontent.cdninstagram.com/v/t50/reel-1080.mp4';
const SHORT_CODE = 'NODB123';
const REEL_URL = `https://www.instagram.com/reel/${SHORT_CODE}/`;

const resolvedMedia: MediaResolutionResult = {
  id: `ig_${SHORT_CODE}`,
  title: 'No database reel',
  thumbnail: 'https://cdn/thumb.jpg',
  duration: 12,
  shortCode: SHORT_CODE,
  platform: 'instagram',
  media: [
    {
      quality: 'original',
      format: 'mp4',
      downloadUrl: `/api/reels/download/ig_${SHORT_CODE}/original`,
      sourceUrl: SOURCE_URL,
    },
  ],
};

const resolveMediaMock = vi.fn(async () => resolvedMedia);

const fakeProvider: MediaProvider = {
  name: 'FakeInstagram',
  supportedDomains: ['instagram.com', 'www.instagram.com'],
  validateUrl: async () => ({ valid: true, shortCode: SHORT_CODE }),
  resolveMedia: resolveMediaMock,
  getDownloadStream: async () => new Response(),
  getMediaRequestHeaders: () => ({}),
};

describe('MediaResolver without a database', () => {
  beforeEach(() => {
    resolveMediaMock.mockClear().mockResolvedValue(resolvedMedia);
    providerRegistry.register(fakeProvider);
    resolutionStore.deleteByShortCode(SHORT_CODE);
  });

  it('resolves successfully and keeps the direct media URL server-side', async () => {
    const resolver = new MediaResolver();

    const result = await resolver.resolve(REEL_URL, { ipAddress: '203.0.113.9' });

    expect(result.id).toBe(`ig_${SHORT_CODE}`);
    expect(result.media[0]?.downloadUrl).toBe(`/api/reels/download/ig_${SHORT_CODE}/original`);
    expect(result.media[0]?.sourceUrl).toBeUndefined();
  });

  it('leaves a streamable record for the download endpoint', async () => {
    const resolver = new MediaResolver();
    await resolver.resolve(REEL_URL, { ipAddress: '203.0.113.9' });

    const stored = resolutionStore.getById(`ig_${SHORT_CODE}`);
    expect(stored?.media[0]?.sourceUrl).toBe(SOURCE_URL);
  });

  it('serves a repeat resolve from the memory cache', async () => {
    const resolver = new MediaResolver();
    await resolver.resolve(REEL_URL, { ipAddress: '203.0.113.9' });
    await resolver.resolve(REEL_URL, { ipAddress: '203.0.113.9' });

    expect(resolveMediaMock).toHaveBeenCalledTimes(1);
  });

  it('still maps provider failures onto API error codes', async () => {
    resolveMediaMock.mockRejectedValueOnce(
      new DirectUrlError('PRIVATE_CONTENT', 'This content is from a private account')
    );

    const resolver = new MediaResolver();

    await expect(resolver.resolve(REEL_URL, { ipAddress: '203.0.113.9' })).rejects.toMatchObject({
      code: 'PRIVATE_CONTENT',
    });
  });

  it('cleanup is a no-op without a database', async () => {
    const resolver = new MediaResolver();
    await expect(resolver.cleanup()).resolves.toBe(0);
  });
});
