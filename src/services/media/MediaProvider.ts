// Media Provider Abstraction

import type { MediaVariant, MediaResolutionResult, ValidationResult } from '@/types';

export interface MediaProvider {
  readonly name: string;
  readonly supportedDomains: string[];

  validateUrl(url: string): Promise<ValidationResult>;
  resolveMedia(url: string): Promise<MediaResolutionResult>;
  getDownloadStream(mediaId: string, quality: string): Promise<Response>;
}

export abstract class BaseMediaProvider implements MediaProvider {
  abstract readonly name: string;
  abstract readonly supportedDomains: string[];

  protected abstract fetchMediaInfo(url: string): Promise<MediaResolutionResult>;
  protected abstract createDownloadUrl(resolutionId: string, quality: string): string;

  async validateUrl(url: string): Promise<ValidationResult> {
    try {
      const parsed = new URL(url);

      // Check domain
      const isSupported = this.supportedDomains.some(
        (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
      );

      if (!isSupported) {
        return {
          valid: false,
          error: {
            code: 'UNSUPPORTED_URL',
            message: `Domain ${parsed.hostname} is not supported by ${this.name} provider`,
          },
        };
      }

      // Extract identifier (short code, video ID, etc.)
      const identifier = this.extractIdentifier(url);
      if (!identifier) {
        return {
          valid: false,
          error: {
            code: 'INVALID_URL',
            message: 'Could not extract media identifier from URL',
          },
        };
      }

      return { valid: true, shortCode: identifier };
    } catch {
      return {
        valid: false,
        error: {
          code: 'INVALID_URL',
          message: 'Invalid URL format',
        },
      };
    }
  }

  async resolveMedia(url: string): Promise<MediaResolutionResult> {
    const validation = await this.validateUrl(url);
    if (!validation.valid) {
      throw new Error(validation.error?.message || 'Invalid URL');
    }

    return this.fetchMediaInfo(url);
  }

  async getDownloadStream(mediaId: string, quality: string): Promise<Response> {
    const downloadUrl = this.createDownloadUrl(mediaId, quality);
    return fetch(downloadUrl, {
      headers: {
        'User-Agent': 'ReelDownloader/1.0',
        Accept: 'video/mp4,video/webm,*/*',
      },
    });
  }

  protected abstract extractIdentifier(url: string): string | undefined;

  protected createMediaVariant(
    quality: 'original' | 'hd' | 'sd',
    format: 'mp4' | 'webm',
    downloadUrl: string,
    fileSize?: number,
    width?: number,
    height?: number
  ): MediaVariant {
    return {
      quality,
      format,
      downloadUrl,
      fileSize,
      width,
      height,
    };
  }
}

export class MediaProviderRegistry {
  private providers: Map<string, MediaProvider> = new Map();

  register(provider: MediaProvider): void {
    for (const domain of provider.supportedDomains) {
      this.providers.set(domain.toLowerCase(), provider);
    }
  }

  getProvider(url: string): MediaProvider | null {
    try {
      const hostname = new URL(url).hostname.toLowerCase();

      // Exact match first
      if (this.providers.has(hostname)) {
        return this.providers.get(hostname)!;
      }

      // Subdomain match
      for (const [domain, provider] of this.providers.entries()) {
        if (hostname.endsWith(`.${domain}`)) {
          return provider;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  getAllProviders(): MediaProvider[] {
    return Array.from(new Set(this.providers.values()));
  }
}

export const providerRegistry = new MediaProviderRegistry();
