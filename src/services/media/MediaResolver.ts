// Media Resolver - Orchestrates media resolution

import { providerRegistry, MediaProvider } from './MediaProvider';
import type { MediaResolutionResult, ErrorCode } from '@/types';
import { ValidationResult } from '@/types';
import { PrismaClient } from '@prisma/client';
import { hashString } from '@/lib/utils';

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
    const shortCode = this.extractShortCode(url);
    if (!shortCode) {
      throw this.createError('INVALID_URL', 'Invalid Instagram Reel URL');
    }

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
    const provider = providerRegistry.getProvider(url);
    if (!provider) {
      throw this.createError('UNSUPPORTED_URL', 'No provider available for this URL');
    }

    // Validate URL
    const validation = await provider.validateUrl(url);
    if (!validation.valid) {
      throw this.createError(
        (validation.error?.code as ErrorCode) || 'INVALID_URL',
        validation.error?.message || 'URL validation failed'
      );
    }

    // Resolve media
    let result: MediaResolutionResult;
    try {
      result = await provider.resolveMedia(url);
    } catch (error) {
      await this.recordResolution(shortCode, options, false, error);
      throw this.mapProviderError(error);
    }

    // Cache result
    this.setCache(shortCode, {
      id: result.id,
      data: result,
      expiresAt: new Date(Date.now() + this.cacheTtl),
    });

    // Persist to database
    await this.persistResolution(result, options);

    await this.recordResolution(shortCode, options, true);

    return result;
  }

  private extractShortCode(url: string): string | undefined {
    const match = url.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/);
    return match ? match[2] : undefined;
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

    const media = record.media as unknown as MediaResolutionResult['media'];

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
    options: ResolutionOptions
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await prisma.reelResolution.upsert({
      where: { shortCode: result.shortCode },
      update: {
        title: result.title,
        thumbnailUrl: result.thumbnail,
        duration: result.duration,
        status: 'RESOLVED',
        media: result.media as any,
        errorCode: null,
        errorMessage: null,
        expiresAt,
        updatedAt: new Date(),
      },
      create: {
        url: `https://www.instagram.com/reel/${result.shortCode}/`,
        shortCode: result.shortCode,
        title: result.title,
        thumbnailUrl: result.thumbnail,
        duration: result.duration,
        status: 'RESOLVED',
        media: result.media as any,
        ipHash: hashString(options.ipAddress),
        userId: options.userId,
        expiresAt,
      },
    });
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

export const mediaResolver = new MediaResolver();
