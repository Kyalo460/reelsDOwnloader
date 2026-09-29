// Media Resolver Tests

import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  metricUpsert: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    reelResolution = { findUnique: prismaMocks.findUnique, upsert: prismaMocks.upsert };
    adminMetric = { upsert: prismaMocks.metricUpsert };
    download = { create: vi.fn() };
  },
}));

import { MediaResolver, canonicalizeMedia, stripSourceUrls } from '@/services/media/MediaResolver';
import { providerRegistry } from '@/services/media/MediaProvider';
import { DirectUrlError } from '@/services/media/DirectUrlProcessor';
import type { MediaProvider } from '@/services/media/MediaProvider';
import type { MediaResolutionResult } from '@/types';

const SOURCE_URL = 'https://scontent.cdninstagram.com/v/t50/reel-1080.mp4';
const SHORT_CODE = 'FAKE123';
const REEL_URL = `https://www.instagram.com/reel/${SHORT_CODE}/`;

const resolvedMedia: MediaResolutionResult = {
  id: `ig_${SHORT_CODE}`,
  title: 'Fake reel',
  thumbnail: 'https://cdn/thumb.jpg',
  duration: 12,
  shortCode: SHORT_CODE,
  media: [
    {
      quality: 'original',
      format: 'mp4',
      downloadUrl: `/api/reels/download/ig_${SHORT_CODE}/original`,
      sourceUrl: SOURCE_URL,
      width: 1080,
      height: 1920,
    },
  ],
};

const resolveMediaMock = vi.fn(async () => resolvedMedia);

// Stand-in for InstagramProvider: MediaResolver only needs the provider contract.
const fakeProvider: MediaProvider = {
  name: 'FakeInstagram',
  supportedDomains: ['instagram.com', 'www.instagram.com'],
  validateUrl: async () => ({ valid: true, shortCode: SHORT_CODE }),
  resolveMedia: resolveMediaMock,
  getDownloadStream: async () => new Response(),
  getMediaRequestHeaders: () => ({}),
};

function upsertArgs() {
  return prismaMocks.upsert.mock.calls[0]?.[0] as {
    create: { id: string; url: string; media: Array<{ sourceUrl?: string; downloadUrl: string }> };
    update: { media: Array<{ sourceUrl?: string; downloadUrl: string }> };
  };
}

describe('MediaResolver', () => {
  beforeEach(() => {
    resolveMediaMock.mockClear().mockResolvedValue(resolvedMedia);
    providerRegistry.register(fakeProvider);

    prismaMocks.findUnique.mockReset().mockResolvedValue(null);
    prismaMocks.upsert.mockReset().mockResolvedValue({ id: `ig_${SHORT_CODE}` });
    prismaMocks.metricUpsert.mockReset().mockResolvedValue({});
  });

  describe('resolve', () => {
    it('persists the located media URL and keeps it out of the response', async () => {
      const resolver = new MediaResolver();

      const result = await resolver.resolve(REEL_URL, { ipAddress: '203.0.113.9' });

      expect(result.id).toBe(`ig_${SHORT_CODE}`);

      // API response: internal URL only, no direct media URL.
      expect(result.media[0]?.downloadUrl).toBe(`/api/reels/download/ig_${SHORT_CODE}/original`);
      expect(result.media[0]?.sourceUrl).toBeUndefined();

      // Persisted row: the located media URL is available for streaming.
      const args = upsertArgs();
      expect(args.create.id).toBe(`ig_${SHORT_CODE}`);
      expect(args.create.media[0]?.sourceUrl).toBe(SOURCE_URL);
      expect(args.create.url).toBe(REEL_URL);
    });

    it('reuses an existing record id so issued download links keep working', async () => {
      prismaMocks.findUnique
        .mockResolvedValueOnce(null) // database cache lookup
        .mockResolvedValueOnce({ id: 'existing_cuid' }); // persistResolution lookup

      const resolver = new MediaResolver();
      const result = await resolver.resolve(REEL_URL, { ipAddress: '203.0.113.9' });

      expect(result.id).toBe('existing_cuid');
      expect(result.media[0]?.downloadUrl).toBe('/api/reels/download/existing_cuid/original');
      expect(upsertArgs().update.media[0]?.downloadUrl).toBe(
        '/api/reels/download/existing_cuid/original'
      );
    });

    it('maps provider error codes onto the API error codes', async () => {
      resolveMediaMock.mockRejectedValueOnce(
        new DirectUrlError('PRIVATE_CONTENT', 'This content is from a private account')
      );

      const resolver = new MediaResolver();

      await expect(resolver.resolve(REEL_URL, { ipAddress: '203.0.113.9' })).rejects.toMatchObject({
        code: 'PRIVATE_CONTENT',
      });
    });
  });

  describe('media helpers', () => {
    it('canonicalizeMedia points variants at the resolution record', () => {
      const media = canonicalizeMedia(resolvedMedia.media, 'ig_XYZ');

      expect(media[0]?.downloadUrl).toBe('/api/reels/download/ig_XYZ/original');
      expect(media[0]?.sourceUrl).toBe(SOURCE_URL);
    });

    it('stripSourceUrls removes only the direct media URL', () => {
      const media = stripSourceUrls(resolvedMedia.media);

      expect(media[0]).not.toHaveProperty('sourceUrl');
      expect(media[0]?.downloadUrl).toBe(`/api/reels/download/ig_${SHORT_CODE}/original`);
      expect(media[0]?.width).toBe(1080);
    });
  });
});
