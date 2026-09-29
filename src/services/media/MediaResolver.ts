// Media Resolver - Orchestrates media resolution

import { providerRegistry, MediaProvider } from './MediaProvider';
import type { MediaResolutionResult, ErrorCode, ValidationResult } from '@/types';
import { ERROR_STATUS_MAP } from '@/types';
import { PrismaClient } from '@prisma/client';
import { hashString } from '@/lib/utils';
import { parseInstagramMediaUrl } from '@/lib/instagramUrl';

const prisma = new PrismaClient();

export interface ResolutionOptions {
  ipAddress: string;
  userId?: string;
}

export interface CachedResolution {
  id: string;
  data: MediaResolutionResult;
  expiresAt: Date;
}

export class MediaResolver {
  private cache: Map<string, CachedResolution> = new Map();
  private readonly cacheTtl = 1800000; // 30 minutes

  async resolve(url: string, options: ResolutionOptions): Promise<MediaResolutionResult> {
    // Normalise once here so the cache key, provider lookup, validation and
    // page fetch all agree, no matter how the URL was pasted.
    const media = parseInstagramMediaUrl(url);
    if (!media) {
      throw this.createError('INVALID_URL', 'Invalid Instagram Reel URL');
    }
    const shortCode = media.shortCode;
    const target = media.url;

    // Check memory cache first
    const cached = this.getFromCache(shortCode);
    if (cached) {
      await this.recordResolution(shortCode, options, true);
      return cached;
    }

    // Check database cache
    const dbCached = await this.getFromDatabase(shortCode);
    if (dbCached) {
      this.setCache(shortCode, dbCached);
      await this.recordResolution(shortCode, options, true);
      return dbCached.data;
    }

    // Get provider
    const provider = providerRegistry.getProvider(target);
    if (!provider) {
      throw this.createError('UNSUPPORTED_URL', 'No provider available for this URL');
    }

    // Validate URL
    const validation = await provider.validateUrl(target);
    if (!validation.valid) {
      throw this.createError(
        (validation.error?.code as ErrorCode) || 'INVALID_URL',
        validation.error?.message || 'URL validation failed'
      );
    }

    // Resolve media
    let result: MediaResolutionResult;
    try {
      result = await provider.resolveMedia(target);
    } catch (error) {
      await this.recordResolution(shortCode, options, false, error);
      throw this.mapProviderError(error);
    }

    // Persist the located media URL and canonicalise the client-facing URLs so
    // every variant points at a resolvable resolution record.
    const persisted = await this.persistResolution(result, options, target);

    // The located direct media URL stays server-side: clients only ever receive
    // the internal download endpoint.
    const publicResult: MediaResolutionResult = {
      ...result,
      id: persisted.id,
      media: stripSourceUrls(persisted.media),
    };

    this.setCache(shortCode, {
      id: persisted.id,
      data: publicResult,
      expiresAt: new Date(Date.now() + this.cacheTtl),
    });

    await this.recordResolution(shortCode, options, true);

    return publicResult;
  }

  private getFromCache(shortCode: string): MediaResolutionResult | null {
    const cached = this.cache.get(shortCode);
    if (cached && cached.expiresAt > new Date()) {
      return cached.data;
    }
    if (cached) {
      this.cache.delete(shortCode);
    }
    return null;
  }

  private setCache(shortCode: string, cached: CachedResolution): void {
    this.cache.set(shortCode, cached);
  }

  private async getFromDatabase(shortCode: string): Promise<CachedResolution | null> {
    const record = await prisma.reelResolution.findUnique({
      where: { shortCode },
    });

    if (!record || record.status !== 'RESOLVED') {
      return null;
    }

    if (record.expiresAt < new Date()) {
      return null;
    }

    const media = stripSourceUrls(record.media as unknown as MediaResolutionResult['media']);

    return {
      id: record.id,
      data: {
        id: record.id,
        title: record.title || '',
        thumbnail: record.thumbnailUrl || '',
        duration: record.duration || 0,
        media,
        shortCode: record.shortCode,
      },
      expiresAt: record.expiresAt,
    };
  }

  private async persistResolution(
    result: MediaResolutionResult,
    options: ResolutionOptions,
    originalUrl: string
  ): Promise<{ id: string; media: MediaResolutionResult['media'] }> {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const existing = await prisma.reelResolution.findUnique({
      where: { shortCode: result.shortCode },
      select: { id: true },
    });

    // Reuse the existing record id (links already handed out keep working),
    // otherwise adopt the provider id (`ig_<shortcode>`).
    const resolutionId = existing?.id ?? result.id;
    const media = canonicalizeMedia(result.media, resolutionId);

    await prisma.reelResolution.upsert({
      where: { shortCode: result.shortCode },
      update: {
        title: result.title,
        thumbnailUrl: result.thumbnail,
        duration: result.duration,
        status: 'RESOLVED',
        media: media as any,
        errorCode: null,
        errorMessage: null,
        expiresAt,
        updatedAt: new Date(),
      },
      create: {
        id: resolutionId,
        url: originalUrl,
        shortCode: result.shortCode,
        title: result.title,
        thumbnailUrl: result.thumbnail,
        duration: result.duration,
        status: 'RESOLVED',
        media: media as any,
        ipHash: hashString(options.ipAddress),
        userId: options.userId,
        expiresAt,
      },
    });

    // The id is deterministic (`ig_<shortcode>`) or the id of the record that
    // already existed, so the media URLs we just stored stay resolvable.
    return { id: resolutionId, media };
  }

  private async recordResolution(
    shortCode: string,
    options: ResolutionOptions,
    success: boolean,
    error?: unknown
  ): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.adminMetric.upsert({
      where: { date: today },
      update: {
        totalRequests: { increment: 1 },
        successfulResolutions: { increment: success ? 1 : 0 },
        failedResolutions: { increment: success ? 0 : 1 },
        errors: { increment: success ? 0 : 1 },
      },
      create: {
        date: today,
        totalRequests: 1,
        successfulResolutions: success ? 1 : 0,
        failedResolutions: success ? 0 : 1,
        errors: success ? 0 : 1,
      },
    });
  }

  private createError(code: ErrorCode, message: string): Error {
    const error = new Error(message) as Error & { code: ErrorCode };
    error.code = code;
    return error;
  }

  private mapProviderError(error: unknown): Error {
    if (error instanceof Error) {
      // Direct URL processing (and other providers) attach a machine-readable
      // code, which is more reliable than matching on message text.
      const explicitCode = (error as Error & { code?: ErrorCode }).code;
      if (explicitCode && explicitCode in ERROR_STATUS_MAP) {
        return this.createError(explicitCode, error.message);
      }

      const message = error.message;

      if (message.includes('NOT_FOUND') || message.includes('404')) {
        return this.createError('NOT_FOUND', 'Reel not found or has been deleted');
      }
      if (message.includes('PRIVATE_CONTENT') || message.includes('private')) {
        return this.createError('PRIVATE_CONTENT', 'This content is from a private account');
      }
      if (message.includes('RATE_LIMITED') || message.includes('429')) {
        return this.createError('RATE_LIMITED', 'Too many requests. Please try again later');
      }
      if (message.includes('NOT_PERMITTED') || message.includes('not permitted')) {
        return this.createError('NOT_PERMITTED', 'This content cannot be downloaded');
      }
      if (message.includes('MEDIA_UNAVAILABLE') || message.includes('unavailable')) {
        return this.createError('MEDIA_UNAVAILABLE', 'Media is not available for download');
      }
    }

    return this.createError('INTERNAL_ERROR', 'Failed to resolve media');
  }

  async invalidateCache(shortCode: string): Promise<void> {
    this.cache.delete(shortCode);
    await prisma.reelResolution.updateMany({
      where: { shortCode },
      data: { status: 'EXPIRED' },
    });
  }

  async cleanup(): Promise<number> {
    const result = await prisma.reelResolution.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    return result.count;
  }
}

/**
 * Points every variant's `downloadUrl` at the persisted resolution record while
 * keeping the located direct media URL (`sourceUrl`) for server-side streaming.
 */
export function canonicalizeMedia(
  media: MediaResolutionResult['media'],
  resolutionId: string
): MediaResolutionResult['media'] {
  return media.map((variant) => ({
    ...variant,
    downloadUrl: `/api/reels/download/${resolutionId}/${variant.quality}`,
  }));
}

/** Removes the server-side direct media URLs from a client-facing payload. */
export function stripSourceUrls(
  media: MediaResolutionResult['media']
): MediaResolutionResult['media'] {
  return media.map(({ sourceUrl: _sourceUrl, ...variant }) => variant);
}

export const mediaResolver = new MediaResolver();
