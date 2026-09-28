// Download Service - Handles streaming downloads

import { MediaProvider, providerRegistry } from './MediaProvider';
import { PrismaClient } from '@prisma/client';
import { hashString } from '@/lib/utils';

const prisma = new PrismaClient();

export interface DownloadOptions {
  resolutionId: string;
  quality: string;
  ipAddress: string;
  userId?: string;
}

export interface StreamResult {
  stream: ReadableStream;
  headers: Record<string, string>;
  fileName: string;
}

export class DownloadService {
  private readonly maxFileSize = 100 * 1024 * 1024; // 100MB
  private readonly requestTimeout = 30000; // 30 seconds

  async prepareDownload(options: DownloadOptions): Promise<StreamResult> {
    // Get resolution record
    const resolution = await prisma.reelResolution.findUnique({
      where: { id: options.resolutionId },
    });

    if (!resolution) {
      throw new Error('NOT_FOUND');
    }

    if (resolution.status !== 'RESOLVED') {
      throw new Error('EXPIRED');
    }

    // Find media variant
    const mediaVariants = resolution.media as Array<{
      quality: string;
      format: string;
      downloadUrl: string;
    }>;

    const variant = mediaVariants.find((v) => v.quality === options.quality);
    if (!variant) {
      throw new Error('NOT_FOUND');
    }

    // Get provider to fetch actual stream
    const provider = providerRegistry.getProvider(resolution.url);
    if (!provider) {
      throw new Error('INTERNAL_ERROR');
    }

    // Stream from source
    const sourceResponse = await this.fetchWithTimeout(variant.downloadUrl, {
      headers: {
        'User-Agent': 'ReelDownloader/1.0',
        Accept: 'video/mp4,video/webm,*/*',
      },
    });

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
    if (contentLength && parseInt(contentLength) > this.maxFileSize) {
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

    // Record download
    await this.recordDownload({
      resolutionId: options.resolutionId,
      quality: variant.quality,
      format: variant.format,
      fileSize: contentLength ? parseInt(contentLength) : null,
      ipAddress: options.ipAddress,
      userId: options.userId,
    });

    return { stream, headers, fileName };
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

export const downloadService = new DownloadService();
