// Instagram Provider Implementation
//
// Resolves reels with direct URL processing: the provider requests the publicly
// accessible Instagram page for the pasted URL and locates the direct media URL
// inside the response. Meta's official Graph API (graph.facebook.com) is
// intentionally not used, so no access token or app credentials are required.

import { BaseMediaProvider, providerRegistry } from './MediaProvider';
import {
  BROWSER_USER_AGENT,
  INSTAGRAM_ORIGIN,
  directUrlProcessor,
  extractShortCode,
} from './DirectUrlProcessor';
import type { MediaResolutionResult } from '@/types';

export class InstagramProvider extends BaseMediaProvider {
  readonly name = 'Instagram';
  readonly supportedDomains = ['instagram.com', 'www.instagram.com'];

  private readonly processor = directUrlProcessor;

  protected extractIdentifier(url: string): string | undefined {
    return extractShortCode(url);
  }

  protected async fetchMediaInfo(url: string): Promise<MediaResolutionResult> {
    const shortCode = this.extractIdentifier(url);
    if (!shortCode) {
      throw new Error('INVALID_URL - Could not extract media identifier from URL');
    }

    // Direct URL processing: request the public page and locate the media URL.
    return this.processor.process(url, shortCode);
  }

  protected createDownloadUrl(resolutionId: string, quality: string): string {
    return `/api/reels/download/${resolutionId}/${quality}`;
  }

  /**
   * Instagram's CDN serves the located media URL only when the request looks
   * like it originates from the Instagram page.
   */
  getMediaRequestHeaders(_mediaUrl: string): Record<string, string> {
    return {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: 'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: `${INSTAGRAM_ORIGIN}/`,
      Origin: INSTAGRAM_ORIGIN,
    };
  }
}

// Register the provider
providerRegistry.register(new InstagramProvider());
