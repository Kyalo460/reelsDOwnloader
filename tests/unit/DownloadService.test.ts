// Download Service Tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createDownload: vi.fn(),
  upsertMetric: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    reelResolution = { findUnique: prismaMocks.findUnique };
    download = { create: prismaMocks.createDownload };
    adminMetric = { upsert: prismaMocks.upsertMetric };
  },
}));

// Importing the provider registers it, so the download path can reuse the
// Instagram request headers for the located media URL.
import '@/services/media/InstagramProvider';
import {
  DownloadService,
  isInternalApiUrl,
  resolveSourceUrl,
  shortCodeFromResolutionId,
} from '@/services/media/DownloadService';

const SOURCE_URL = 'https://scontent.cdninstagram.com/v/t50/reel-1080.mp4?_nc_ht=ig&oe=ABC';
const HD_SOURCE_URL = 'https://scontent.cdninstagram.com/v/t50/reel-720.mp4';

function storedResolution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ig_ABC123',
    url: 'https://www.instagram.com/reel/ABC123/',
    shortCode: 'ABC123',
    title: 'Golden hour at the pier',
    thumbnailUrl: 'https://cdn/thumb.jpg',
    duration: 27,
    status: 'RESOLVED',
    media: [
      {
        quality: 'original',
        format: 'mp4',
        downloadUrl: '/api/reels/download/ig_ABC123/original',
        sourceUrl: SOURCE_URL,
        width: 1080,
        height: 1920,
      },
      {
        quality: 'hd',
        format: 'mp4',
        downloadUrl: '/api/reels/download/ig_ABC123/hd',
        sourceUrl: HD_SOURCE_URL,
        width: 720,
        height: 1280,
      },
    ],
    errorCode: null,
    errorMessage: null,
    ipHash: 'abc123',
    userId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  };
}

function videoResponse(
  body = 'video-bytes',
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      'content-type': 'video/mp4',
      'content-length': String(body.length),
      ...(init.headers ?? {}),
    },
  });
}

describe('DownloadService', () => {
  let service: DownloadService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new DownloadService();
    fetchMock = vi.fn().mockResolvedValue(videoResponse());
    vi.stubGlobal('fetch', fetchMock);

    prismaMocks.findUnique.mockReset();
    prismaMocks.createDownload.mockReset().mockResolvedValue({ id: 'download_1' });
    prismaMocks.upsertMetric.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('prepareDownload', () => {
    it('streams the media URL that was located on the public page', async () => {
      prismaMocks.findUnique.mockResolvedValue(storedResolution());

      const result = await service.prepareDownload({
        resolutionId: 'ig_ABC123',
        quality: 'original',
        ipAddress: '203.0.113.7',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(SOURCE_URL);
      expect(result.status).toBe(200);
      expect(result.fileName).toBe('Golden-hour-at-the-pier-original.mp4');
      expect(result.headers['Content-Type']).toBe('video/mp4');
      expect(result.headers['Content-Disposition']).toContain('attachment');
      expect(result.headers['Accept-Ranges']).toBe('bytes');

      // The located media URL is never exposed to the client.
      expect(JSON.stringify(result.headers)).not.toContain('cdninstagram');

      // The body is streamed through, not buffered on disk.
      expect(await new Response(result.stream).text()).toBe('video-bytes');
    });

    it('sends Instagram request headers when fetching the media URL', async () => {
      prismaMocks.findUnique.mockResolvedValue(storedResolution());

      await service.prepareDownload({
        resolutionId: 'ig_ABC123',
        quality: 'hd',
        ipAddress: '203.0.113.7',
      });

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Referer).toBe('https://www.instagram.com/');
      expect(headers['User-Agent']).toContain('Mozilla/5.0');
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(HD_SOURCE_URL);
    });

    it('forwards Range requests and passes through the partial response', async () => {
      prismaMocks.findUnique.mockResolvedValue(storedResolution());
      fetchMock.mockResolvedValue(
        videoResponse('part', { status: 206, headers: { 'content-range': 'bytes 0-3/100' } })
      );

      const result = await service.prepareDownload({
        resolutionId: 'ig_ABC123',
        quality: 'original',
        ipAddress: '203.0.113.7',
        rangeHeader: 'bytes=0-3',
      });

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Range).toBe('bytes=0-3');
      expect(result.status).toBe(206);
      expect(result.headers['Content-Range']).toBe('bytes 0-3/100');
    });

    it('falls back to a shortcode lookup for legacy resolution ids', async () => {
      prismaMocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(storedResolution());

      const result = await service.prepareDownload({
        resolutionId: 'ig_ABC123',
        quality: 'original',
        ipAddress: '203.0.113.7',
      });

      expect(prismaMocks.findUnique).toHaveBeenNthCalledWith(1, { where: { id: 'ig_ABC123' } });
      expect(prismaMocks.findUnique).toHaveBeenNthCalledWith(2, {
        where: { shortCode: 'ABC123' },
      });
      expect(result.fileName).toBe('Golden-hour-at-the-pier-original.mp4');
    });

    it('records the download against the persisted resolution', async () => {
      prismaMocks.findUnique.mockResolvedValue(storedResolution());

      await service.prepareDownload({
        resolutionId: 'ig_ABC123',
        quality: 'original',
        ipAddress: '203.0.113.7',
      });

      expect(prismaMocks.createDownload).toHaveBeenCalledWith({
        data: expect.objectContaining({
          resolutionId: 'ig_ABC123',
          mediaQuality: 'original',
          mediaFormat: 'mp4',
        }),
      });
      expect(prismaMocks.upsertMetric).toHaveBeenCalledTimes(1);
    });

    it('throws NOT_FOUND when the resolution does not exist', async () => {
      prismaMocks.findUnique.mockResolvedValue(null);

      await expect(
        service.prepareDownload({
          resolutionId: 'ig_MISSING',
          quality: 'original',
          ipAddress: '203.0.113.7',
        })
      ).rejects.toThrow('NOT_FOUND');
    });

    it('throws NOT_FOUND for an unknown quality', async () => {
      prismaMocks.findUnique.mockResolvedValue(storedResolution());

      await expect(
        service.prepareDownload({
          resolutionId: 'ig_ABC123',
          quality: 'sd',
          ipAddress: '203.0.113.7',
        })
      ).rejects.toThrow('NOT_FOUND');
    });

    it('throws EXPIRED when the resolution has expired', async () => {
      prismaMocks.findUnique.mockResolvedValue(
        storedResolution({ expiresAt: new Date(Date.now() - 1000) })
      );

      await expect(
        service.prepareDownload({
          resolutionId: 'ig_ABC123',
          quality: 'original',
          ipAddress: '203.0.113.7',
        })
      ).rejects.toThrow('EXPIRED');
    });

    it('reports NO_DOWNLOAD_SOURCE, not EXPIRED, when no media URL was located', async () => {
      // A resolution with only the internal API path carries no streamable
      // source. Telling the client it expired would be wrong: resolving again
      // cannot produce a file.
      prismaMocks.findUnique.mockResolvedValue(
        storedResolution({
          media: [
            {
              quality: 'original',
              format: 'mp4',
              downloadUrl: '/api/reels/download/ig_ABC123/original',
            },
          ],
        })
      );

      await expect(
        service.prepareDownload({
          resolutionId: 'ig_ABC123',
          quality: 'original',
          ipAddress: '203.0.113.7',
        })
      ).rejects.toThrow('NO_DOWNLOAD_SOURCE');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws EXPIRED when Instagram rejects the stored media URL', async () => {
      prismaMocks.findUnique.mockResolvedValue(storedResolution());
      fetchMock.mockResolvedValue(new Response('denied', { status: 403 }));

      await expect(
        service.prepareDownload({
          resolutionId: 'ig_ABC123',
          quality: 'original',
          ipAddress: '203.0.113.7',
        })
      ).rejects.toThrow('EXPIRED');
    });

    it('throws FILE_TOO_LARGE when the media exceeds the limit', async () => {
      prismaMocks.findUnique.mockResolvedValue(storedResolution());
      fetchMock.mockResolvedValue(
        videoResponse('x', { headers: { 'content-length': String(200 * 1024 * 1024) } })
      );

      await expect(
        service.prepareDownload({
          resolutionId: 'ig_ABC123',
          quality: 'original',
          ipAddress: '203.0.113.7',
        })
      ).rejects.toThrow('FILE_TOO_LARGE');
    });

    it('throws MEDIA_UNAVAILABLE when the source is not a video', async () => {
      prismaMocks.findUnique.mockResolvedValue(storedResolution());
      fetchMock.mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      );

      await expect(
        service.prepareDownload({
          resolutionId: 'ig_ABC123',
          quality: 'original',
          ipAddress: '203.0.113.7',
        })
      ).rejects.toThrow('MEDIA_UNAVAILABLE');
    });
  });

  describe('resolveSourceUrl', () => {
    it('uses the located media URL', () => {
      expect(resolveSourceUrl({ sourceUrl: SOURCE_URL })).toBe(SOURCE_URL);
    });

    it('ignores the internal download endpoint', () => {
      expect(
        resolveSourceUrl({ downloadUrl: '/api/reels/download/ig_ABC123/original' })
      ).toBeNull();
      expect(
        resolveSourceUrl({ downloadUrl: 'http://localhost:3000/api/reels/download/ig_ABC123/hd' })
      ).toBeNull();
    });

    it('accepts an absolute non-internal download URL', () => {
      expect(resolveSourceUrl({ downloadUrl: HD_SOURCE_URL })).toBe(HD_SOURCE_URL);
    });

    it('returns null when nothing was stored', () => {
      expect(resolveSourceUrl({})).toBeNull();
    });
  });

  describe('helpers', () => {
    it('detects internal API URLs', () => {
      expect(isInternalApiUrl('https://example.com/api/reels/download/x/hd')).toBe(true);
      expect(isInternalApiUrl(SOURCE_URL)).toBe(false);
      expect(isInternalApiUrl('not-a-url')).toBe(true);
    });

    it('decodes provider resolution ids', () => {
      expect(shortCodeFromResolutionId('ig_ABC123')).toBe('ABC123');
      expect(shortCodeFromResolutionId('ig_A-b_1')).toBe('A-b_1');
      expect(shortCodeFromResolutionId('cm1abc123def456')).toBeNull();
    });
  });
});
