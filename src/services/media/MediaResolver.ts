// Media Resolver - Orchestrates media resolution

// Registers the Instagram provider in the shared registry. It is a side-effect
// import on purpose: without it the registry stays empty at runtime and every
// URL is rejected as UNSUPPORTED_URL.
import './InstagramProvider';
// Registers the YouTube provider
import './YouTubeProvider';
import { providerRegistry } from './MediaProvider';
import { resolutionStore } from './resolutionStore';
import type { MediaResolutionResult, ErrorCode, Platform } from '@/types';
import { ERROR_STATUS_MAP } from '@/types';
import { getPrisma } from '@/lib/prisma';
import { hashString } from '@/lib/utils';
import { parseInstagramMediaUrl } from '@/lib/instagramUrl';
import { parseYouTubeUrl } from '@/lib/youtubeUrl';

export interface ResolutionOptions {
  ipAddress: string;
  userId?: string;
}

export interface CachedResolution {
  id: string;
  data: MediaResolutionResult;
  expiresAt: Date;
}

interface ParsedMedia {
  shortCode: string;
  url: string;
  platform: Platform;
}

function parseMediaUrl(url: string): ParsedMedia | null {
  // Try Instagram first
  const instagram = parseInstagramMediaUrl(url);
  if (instagram) {
    return {
      shortCode: instagram.shortCode,
      url: instagram.url,
      platform: 'instagram',
    };
  }

  // Try YouTube
  const youtube = parseYouTubeUrl(url);
  if (youtube) {
    return {
      shortCode: youtube.videoId,
      url: youtube.url,
      platform: 'youtube',
    };
  }

  return null;
}

export class MediaResolver {
  private cache: Map<string, CachedResolution> = new Map();
  private readonly cacheTtl = 1800000; // 30 minutes

  async resolve(url: string, options: ResolutionOptions): Promise<MediaResolutionResult> {
    // Normalise once here so the cache key, provider lookup, validation and
    // page fetch all agree, no matter how the URL was pasted.
    const media = parseMediaUrl(url);
    if (!media) {
      throw this.createError(
        'INVALID_URL',
        'Invalid URL - only Instagram Reels and YouTube videos are supported'
      );
    }

    // Use a platform-prefixed key to avoid cache collisions between platforms
    // that might share a shortcode/space
    const cacheKey = `${media.platform}_${media.shortCode}`;
    const shortCode = cacheKey;
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

  private async getFromDatabase(cacheKey: string): Promise<CachedResolution | null> {
    const prisma = getPrisma();
    if (!prisma) return null;

    // Map the platform-prefixed cache key back to the provider ID format
    // stored in the database (e.g., "instagram_ABC123" -> "ig_ABC123",
    // "youtube_ABC123" -> "yt_ABC123")
    const dbShortCode = cacheKey.replace(/^instagram_/, 'ig_').replace(/^youtube_/, 'yt_');

    // Try the platform-specific ID first
    const record =
      (await prisma.reelResolution.findUnique({
        where: { shortCode: dbShortCode },
      })) ??
      // Fall back to the raw cache key for backward compatibility
      (await prisma.reelResolution.findUnique({
        where: { shortCode: cacheKey },
      }));

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
        platform: (record.id.startsWith('yt_') ? 'youtube' : 'instagram') as Platform,
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
    const prisma = getPrisma();

    // Use the provider's id (which includes platform prefix like `ig_` or `yt_`)
    // as the database shortCode to avoid conflicts between platforms.
    const dbShortCode = result.id;

    // Reuse the existing record id (links already handed out keep working),
    // otherwise adopt the provider id.
    const existing = prisma
      ? await prisma.reelResolution.findUnique({
          where: { shortCode: dbShortCode },
          select: { id: true },
        })
      : null;

    const resolutionId = existing?.id ?? result.id;
    const media = canonicalizeMedia(result.media, resolutionId);
    const ipHash = hashString(options.ipAddress);

    if (!prisma) {
      // No database: keep the located media URL in memory so the download
      // endpoint can still stream it for the lifetime of this instance.
      resolutionStore.put({
        id: resolutionId,
        url: originalUrl,
        shortCode: result.shortCode,
        title: result.title,
        thumbnail: result.thumbnail,
        duration: result.duration,
        media,
        ipHash,
        userId: options.userId,
        expiresAt,
      });

      return { id: resolutionId, media };
    }

    await prisma.reelResolution.upsert({
      where: { shortCode: dbShortCode },
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
        shortCode: dbShortCode,
        title: result.title,
        thumbnailUrl: result.thumbnail,
        duration: result.duration,
        status: 'RESOLVED',
        media: media as any,
        ipHash,
        userId: options.userId,
        expiresAt,
      },
    });

    // The id is deterministic (`ig_<shortcode>` or `yt_<videoId>`) or the id of the record
    // that already existed, so the media URLs we just stored stay resolvable.
    return { id: resolutionId, media };
  }

  private async recordResolution(
    shortCode: string,
    options: ResolutionOptions,
    success: boolean,
    _error?: unknown
  ): Promise<void> {
    const prisma = getPrisma();
    if (!prisma) return;

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
        return this.createError(explicitCode, this.userFacingMessage(explicitCode, error.message));
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
      if (message.includes('AUTH_REQUIRED')) {
        return this.createError(
          'AUTH_REQUIRED',
          'Instagram requires a signed-in session to serve this reel'
        );
      }
      if (message.includes('MEDIA_UNAVAILABLE') || message.includes('unavailable')) {
        return this.createError('MEDIA_UNAVAILABLE', 'Media is not available for download');
      }
    }

    return this.createError('INTERNAL_ERROR', 'Failed to resolve media');
  }

  /**
   * Providers prefix their messages with the error code (`NOT_FOUND - …`) so
   * string matching keeps working. That prefix is an implementation detail and
   * must never reach the UI, so it is stripped and replaced with wording that
   * tells the user what actually happened.
   */
  private userFacingMessage(code: ErrorCode, rawMessage: string): string {
    const message = rawMessage.replace(/^[A-Z_]+\s*-\s*/, '').trim();

    switch (code) {
      case 'AUTH_REQUIRED':
        return 'This reel exists, but Instagram only serves its video to a signed-in session, so it cannot be downloaded anonymously.';
      case 'NOT_FOUND':
        return 'Reel not found or has been deleted';
      case 'PRIVATE_CONTENT':
        return 'This content is from a private account';
      case 'RATE_LIMITED':
        return 'Too many requests. Please try again later';
      case 'NOT_PERMITTED':
        return 'This content cannot be downloaded';
      case 'MEDIA_UNAVAILABLE':
        return 'Media is not available for download';
      default:
        return message || 'Failed to resolve media';
    }
  }

  async invalidateCache(cacheKey: string): Promise<void> {
    this.cache.delete(cacheKey);
    resolutionStore.deleteByShortCode(
      cacheKey.replace(/^instagram_/, 'ig_').replace(/^youtube_/, 'yt_')
    );

    const prisma = getPrisma();
    if (!prisma) return;

    const dbShortCode = cacheKey.replace(/^instagram_/, 'ig_').replace(/^youtube_/, 'yt_');

    await prisma.reelResolution.updateMany({
      where: { shortCode: dbShortCode },
      data: { status: 'EXPIRED' },
    });
  }

  async cleanup(): Promise<number> {
    resolutionStore.prune();

    const prisma = getPrisma();
    if (!prisma) return 0;

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
