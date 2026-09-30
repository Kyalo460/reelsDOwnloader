// Instagram Provider Implementation
//
// Resolves reels with direct URL processing: the provider requests the publicly
// accessible Instagram page for the pasted URL and locates the direct media URL
// inside the response. Meta's official Graph API (graph.facebook.com) is
// intentionally not used, so no access token or app credentials are required.
//
// When a signed-in session has been configured (see InstagramSession), the
// public read is still attempted first and the session is only used to recover
// the reels Instagram withholds from anonymous visitors.

import { BaseMediaProvider, providerRegistry } from './MediaProvider';
import {
  BROWSER_USER_AGENT,
  INSTAGRAM_ORIGIN,
  directUrlProcessor,
  extractShortCode,
} from './DirectUrlProcessor';
import { fetchWithSession, getInstagramCookieHeader } from './InstagramSession';
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
    try {
      return await this.processor.process(url, shortCode);
    } catch (error) {
      // The public read is the cheap, unauthenticated path and stays first. The
      // session is only worth spending when it failed for a reason a signed-in
      // request can actually fix - a withheld video, not a deleted or private
      // reel, which no amount of authentication will resolve.
      if (!this.shouldRetryWithSession(error)) {
        throw error;
      }

      const kind = /\/(?:reels?|tv)\//i.test(url) ? 'reel' : 'p';
      const authenticated = await fetchWithSession(shortCode, kind);
      if (!authenticated) {
        throw error;
      }

      return authenticated;
    }
  }

  /**
   * Only AUTH_REQUIRED benefits from a retry. It is Instagram's explicit
   * statement that the reel exists and the video exists, but is not being served
   * to an anonymous request - exactly the gap a session closes.
   */
  private shouldRetryWithSession(error: unknown): boolean {
    if (!getInstagramCookieHeader()) return false;

    const code = (error as { code?: string } | null)?.code;
    return code === 'AUTH_REQUIRED';
  }

  protected createDownloadUrl(resolutionId: string, quality: string): string {
    return `/api/reels/download/${resolutionId}/${quality}`;
  }

  /**
   * Instagram's CDN serves the located media URL only when the request looks
   * like it originates from the Instagram page. A configured session is
   * included so renditions that stay gated behind the login are still reachable.
   */
  getMediaRequestHeaders(_mediaUrl: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: 'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: `${INSTAGRAM_ORIGIN}/`,
      Origin: INSTAGRAM_ORIGIN,
    };

    const cookieHeader = getInstagramCookieHeader();
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    return headers;
  }
}

// Register the provider
providerRegistry.register(new InstagramProvider());
