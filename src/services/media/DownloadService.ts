// Download Service - Handles streaming downloads

import { providerRegistry } from './MediaProvider';
import { PrismaClient } from '@prisma/client';
import { hashString } from '@/lib/utils';

const prisma = new PrismaClient();

type StoredResolution = NonNullable<Awaited<ReturnType<typeof prisma.reelResolution.findUnique>>>;

export interface DownloadOptions {
  resolutionId: string;
  quality: string;
  ipAddress: string;
  userId?: string;
  /** Optional `Range` header forwarded to the source for partial downloads. */
  rangeHeader?: string;
}

export interface StreamResult {
  stream: ReadableStream;
  headers: Record<string, string>;
  fileName: string;
  /** Upstream status: 200 for a full body, 206 for a partial (range) response. */
  status: number;
}

/** The subset of a persisted media variant the download path cares about. */
export interface StoredMediaVariant {
  quality: string;
  format: string;
  /** Internal download endpoint handed to clients. Never a media source. */
  downloadUrl?: string;
  /** Direct media URL located on the public Instagram page. */
  sourceUrl?: string;
}

export class DownloadService {
  private readonly maxFileSize = 100 * 1024 * 1024; // 100MB
  private readonly requestTimeout = 30000; // 30 seconds

  async prepareDownload(options: DownloadOptions): Promise<StreamResult> {
    // Resolutions are addressed by the id returned from /api/reels/resolve.
    // Rows persisted by the provider use the `ig_<shortcode>` id, so fall back
    // to a shortcode lookup to stay compatible with earlier records.
    const resolution = await this.findResolution(options.resolutionId);

    if (!resolution) {
      throw new Error('NOT_FOUND');
    }

    if (resolution.status !== 'RESOLVED' || resolution.expiresAt < new Date()) {
      throw new Error('EXPIRED');
    }

    const variants = resolution.media as unknown as StoredMediaVariant[];
    const variant = variants.find((v) => v.quality === options.quality);
    if (!variant) {
      throw new Error('NOT_FOUND');
    }

    // The direct media URL located on the public Instagram page is the actual
    // source we stream from. Instagram signs those URLs, so a missing source
    // means the client should resolve the reel again.
    const sourceUrl = resolveSourceUrl(variant);
    if (!sourceUrl) {
      throw new Error('EXPIRED');
    }

    const provider = providerRegistry.getProvider(resolution.url);
    const requestHeaders: Record<string, string> = {
      ...(provider?.getMediaRequestHeaders(sourceUrl) ?? DEFAULT_MEDIA_HEADERS),
    };

    if (options.rangeHeader) {
      requestHeaders.Range = options.rangeHeader;
    }

    const sourceResponse = await this.fetchWithTimeout(sourceUrl, { headers: requestHeaders });

    // Signed CDN links expire or get revoked -> ask the client to re-resolve.
    if (
      sourceResponse.status === 401 ||
      sourceResponse.status === 403 ||
      sourceResponse.status === 410
    ) {
      throw new Error('EXPIRED');
    }

    if (!sourceResponse.ok) {
      throw new Error('MEDIA_UNAVAILABLE');
    }

    // Validate content type
    const contentType = sourceResponse.headers.get('content-type');
    if (!contentType?.startsWith('video/')) {
      throw new Error('MEDIA_UNAVAILABLE');
    }

    // Check content length
    const contentLength = sourceResponse.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > this.maxFileSize) {
      throw new Error('FILE_TOO_LARGE');
    }

    // Create streaming response
    const stream = this.createSizeLimitedStream(sourceResponse.body!);

    const fileName = this.generateFileName(
      resolution.title || 'reel',
      variant.quality,
      variant.format
    );

    const headers: Record<string, string> = {
      'Content-Type': contentType || 'video/mp4',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    };

    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }

    const contentRange = sourceResponse.headers.get('content-range');
    if (contentRange) {
      headers['Content-Range'] = contentRange;
    }

    // Record download
    await this.recordDownload({
      resolutionId: resolution.id,
      quality: variant.quality,
      format: variant.format,
      fileSize: contentLength ? parseInt(contentLength, 10) : null,
      ipAddress: options.ipAddress,
      userId: options.userId,
    });

    return { stream, headers, fileName, status: sourceResponse.status };
  }

  private async findResolution(resolutionId: string): Promise<StoredResolution | null> {
    const direct = await prisma.reelResolution.findUnique({ where: { id: resolutionId } });
    if (direct) return direct;

    const shortCode = shortCodeFromResolutionId(resolutionId);
    if (!shortCode) return null;

    return prisma.reelResolution.findUnique({ where: { shortCode } });
  }

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private createSizeLimitedStream(source: ReadableStream): ReadableStream {
    const maxFileSize = this.maxFileSize;
    let totalBytes = 0;

    return new ReadableStream({
      async start(controller) {
        const reader = source.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            totalBytes += value.length;
            if (totalBytes > maxFileSize) {
              controller.error(new Error('File size exceeded during streaming'));
              break;
            }

            controller.enqueue(value);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
    });
  }

  private generateFileName(title: string, quality: string, format: string): string {
    const sanitized = title
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);

    return `${sanitized || 'reel'}-${quality}.${format}`;
  }

  private async recordDownload(data: {
    resolutionId: string;
    quality: string;
    format: string;
    fileSize: number | null;
    ipAddress: string;
    userId?: string;
  }): Promise<void> {
    await prisma.download.create({
      data: {
        resolutionId: data.resolutionId,
        mediaQuality: data.quality,
        mediaFormat: data.format,
        fileSize: data.fileSize ? BigInt(data.fileSize) : null,
        ipHash: hashString(data.ipAddress),
        userId: data.userId,
      },
    });

    // Update daily metrics
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.adminMetric.upsert({
      where: { date: today },
      update: {
        totalDownloads: { increment: 1 },
      },
      create: {
        date: today,
        totalDownloads: 1,
      },
    });
  }

  async getDownloadStats(resolutionId: string): Promise<{
    totalDownloads: number;
    byQuality: Record<string, number>;
  }> {
    const downloads = await prisma.download.groupBy({
      by: ['mediaQuality'],
      where: { resolutionId },
      _count: { id: true },
    });

    const byQuality: Record<string, number> = {};
    let total = 0;

    for (const d of downloads) {
      byQuality[d.mediaQuality] = d._count.id;
      total += d._count.id;
    }

    return { totalDownloads: total, byQuality };
  }
}

const DEFAULT_MEDIA_HEADERS: Record<string, string> = {
  'User-Agent': 'ReelDownloader/1.0',
  Accept: 'video/mp4,video/webm,*/*',
};

/**
 * Only absolute, non-internal URLs are streamable sources. Rows written before
 * direct URL processing (and the seeded fixtures) carry the relative API path
 * only, which is not a media source.
 */
export function resolveSourceUrl(
  variant: Pick<StoredMediaVariant, 'sourceUrl' | 'downloadUrl'>
): string | null {
  const candidate = variant.sourceUrl || variant.downloadUrl;
  if (!candidate || !/^https?:\/\//i.test(candidate)) return null;
  if (isInternalApiUrl(candidate)) return null;
  return candidate;
}

/** True when the URL points back at this app's own API instead of the CDN. */
export function isInternalApiUrl(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith('/api/');
  } catch {
    return true;
  }
}

/** `ig_ABC123` -> `ABC123`, so legacy provider ids still resolve. */
export function shortCodeFromResolutionId(resolutionId: string): string | null {
  const match = /^ig_([A-Za-z0-9_-]+)$/.exec(resolutionId);
  return match?.[1] ?? null;
}

export const downloadService = new DownloadService();
