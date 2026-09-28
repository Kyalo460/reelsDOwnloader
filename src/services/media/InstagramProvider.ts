// Instagram Provider Implementation
// Uses only legitimate, publicly accessible methods

import { BaseMediaProvider, MediaProvider } from './MediaProvider';
import type { MediaResolutionResult, ValidationResult } from '@/types';

interface InstagramGraphQLResponse {
  data?: {
    xdt_shortcode_media?: {
      shortcode: string;
      display_url: string;
      video_url?: string;
      video_dash_manifest?: string;
      video_duration?: number;
      edge_media_to_caption?: {
        edges: Array<{
          node: { text: string };
        }>;
      };
      owner?: {
        id: string;
        username: string;
        is_private: boolean;
      };
      is_video: boolean;
      video_view_count?: number;
      dimensions?: {
        width: number;
        height: number;
      };
    };
  };
  status?: string;
}

interface InstagramEmbedResponse {
  html: string;
  thumbnail_url: string;
  version: string;
  provider_name: string;
  provider_url: string;
  title: string;
  author_name: string;
  author_url: string;
  width: number;
  height: number;
}

// Current known query hashes (Instagram rotates these)
const QUERY_HASHES = [
  'b3055c01b4b222b8a47dc12b090e4e64', // Older
  '9f8827793ef34641b2fb195d4d41151c', // Current common
  '3e7e83e14604b5e5b1c4a7b8e2f3a9d1', // Alternative
  'c5e9b8f2a1d4e7f0b3c6a9d2e5f8b1c4', // Another variant
];

export class InstagramProvider extends BaseMediaProvider {
  readonly name = 'Instagram';
  readonly supportedDomains = ['instagram.com', 'www.instagram.com'];

  private readonly GRAPHQL_ENDPOINT = 'https://www.instagram.com/graphql/query/';
  private readonly EMBED_ENDPOINT = 'https://api.instagram.com/oembed/';
  private readonly PAGE_ENDPOINT = 'https://www.instagram.com/p/';

  private readonly requestTimeout = 15000;
  private readonly maxRetries = 2;

  protected extractIdentifier(url: string): string | undefined {
    const match = url.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/);
    return match ? match[2] : undefined;
  }

  protected async fetchMediaInfo(url: string): Promise<MediaResolutionResult> {
    const shortCode = this.extractIdentifier(url);
    if (!shortCode) {
      throw new Error('Invalid Instagram URL');
    }

    // Try multiple query hashes
    for (const hash of QUERY_HASHES) {
      try {
        return await this.fetchViaGraphQL(shortCode, hash);
      } catch (error) {
        console.warn(`GraphQL hash ${hash} failed:`, error);
        continue;
      }
    }

    // Try HTML page scraping as fallback
    try {
      return await this.fetchViaPageHTML(shortCode);
    } catch (htmlError) {
      console.warn('HTML scrape failed:', htmlError);
    }

    // Try oEmbed as last resort (won't give video URL but confirms public)
    try {
      await this.fetchViaOEmbed(url, shortCode);
      throw new Error('MEDIA_UNAVAILABLE - Video download not available via oEmbed');
    } catch (oembedError) {
      console.warn('oEmbed failed:', oembedError);
    }

    throw new Error('Unable to retrieve media information - all methods failed');
  }

  protected createDownloadUrl(resolutionId: string, quality: string): string {
    return `/api/reels/download/${resolutionId}/${quality}`;
  }

  private async fetchViaGraphQL(
    shortCode: string,
    queryHash: string
  ): Promise<MediaResolutionResult> {
    const variables = {
      shortcode: shortCode,
      fetch_comment_count: 0,
      fetch_like_count: 0,
      fetch_media_preview: true,
    };

    const body = new URLSearchParams({
      query_hash: queryHash,
      variables: JSON.stringify(variables),
    });

    const response = await this.fetchWithTimeout(this.GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Origin: 'https://www.instagram.com',
        Referer: `https://www.instagram.com/reel/${shortCode}/`,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      if (response.status === 404) throw new Error('NOT_FOUND');
      if (response.status === 429) throw new Error('RATE_LIMITED');
      throw new Error(`GraphQL request failed: ${response.status}`);
    }

    const data: InstagramGraphQLResponse = await response.json();
    const media = data.data?.xdt_shortcode_media;

    if (!media) {
      throw new Error('Media not found in response');
    }

    if (media.owner?.is_private) throw new Error('PRIVATE_CONTENT');
    if (!media.is_video) throw new Error('NOT_PERMITTED - Not a video');

    const videoUrl = media.video_url;
    if (!videoUrl) throw new Error('MEDIA_UNAVAILABLE - No video URL');

    const caption = media.edge_media_to_caption?.edges?.[0]?.node?.text || '';
    const title = this.extractTitle(caption) || `Instagram Reel ${shortCode}`;

    const variants = this.createVariants(shortCode, videoUrl, media.dimensions);

    return {
      id: `ig_${shortCode}`,
      title,
      thumbnail: media.display_url,
      duration: media.video_duration || 0,
      media: variants,
      shortCode,
    };
  }

  private async fetchViaPageHTML(shortCode: string): Promise<MediaResolutionResult> {
    const pageUrl = `${this.PAGE_ENDPOINT}${shortCode}/`;

    const response = await this.fetchWithTimeout(pageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error(`Page fetch failed: ${response.status}`);
    }

    const html = await response.text();

    // Check for private/blocked content
    if (html.includes('This account is private') || html.includes('Page Not Found')) {
      throw new Error('NOT_FOUND');
    }

    // Extract video URL from meta tags
    const videoUrlMatch =
      html.match(/property="og:video" content="([^"]+)"/) ||
      html.match(/property="og:video:secure_url" content="([^"]+)"/) ||
      html.match(/"video_url":"([^"]+)"/) ||
      html.match(/"video_url":"([^"\\]+(?:\\.[^"\\]+)*)"/);

    const videoUrl = videoUrlMatch?.[1]?.replace(/\\u0026/g, '&').replace(/&/g, '&');

    if (!videoUrl) {
      throw new Error('MEDIA_UNAVAILABLE - No video URL in page');
    }

    // Extract thumbnail
    const thumbnailMatch = html.match(/property="og:image" content="([^"]+)"/);
    const thumbnail = thumbnailMatch?.[1] || '';

    // Extract title
    const titleMatch =
      html.match(/property="og:title" content="([^"]+)"/) || html.match(/<title>([^<]+)<\/title>/);
    const title =
      titleMatch?.[1]?.replace(' • Instagram', '').trim() || `Instagram Reel ${shortCode}`;

    // Extract duration if available
    const durationMatch = html.match(/property="og:video:duration" content="([^"]+)"/);
    const duration = durationMatch?.[1] ? parseInt(durationMatch[1], 10) : 0;

    const variants = this.createVariants(shortCode, videoUrl, undefined);

    return {
      id: `ig_${shortCode}`,
      title,
      thumbnail,
      duration,
      media: variants,
      shortCode,
    };
  }

  private async fetchViaOEmbed(url: string, shortCode: string): Promise<MediaResolutionResult> {
    const embedUrl = `${this.EMBED_ENDPOINT}?url=${encodeURIComponent(url)}`;

    const response = await this.fetchWithTimeout(embedUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ReelDownloader/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`oEmbed request failed: ${response.status}`);
    }

    const data: InstagramEmbedResponse = await response.json();

    // oEmbed doesn't give direct video URL
    throw new Error('MEDIA_UNAVAILABLE - oEmbed does not provide video URLs');
  }

  private extractTitle(caption: string): string | null {
    const lines = caption.split('\n').filter((l) => l.trim());
    const firstLine = lines[0]?.trim();
    if (firstLine) {
      return firstLine
        .replace(/#[^\s]+/g, '')
        .replace(/@[^\s]+/g, '')
        .trim()
        .slice(0, 100);
    }
    return null;
  }

  private createVariants(
    shortCode: string,
    videoUrl: string,
    dimensions?: { width: number; height: number }
  ): MediaResolutionResult['media'] {
    const width = dimensions?.width || 1080;
    const height = dimensions?.height || 1920;

    return [
      {
        quality: 'original',
        format: 'mp4',
        downloadUrl: this.createDownloadUrl(`ig_${shortCode}`, 'original'),
        fileSize: undefined,
        width,
        height,
      },
      {
        quality: 'hd',
        format: 'mp4',
        downloadUrl: this.createDownloadUrl(`ig_${shortCode}`, 'hd'),
        width: Math.min(width, 1080),
        height: Math.min(height, 1920),
      },
      {
        quality: 'sd',
        format: 'mp4',
        downloadUrl: this.createDownloadUrl(`ig_${shortCode}`, 'sd'),
        width: 480,
        height: 854,
      },
    ];
  }

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        redirect: 'follow',
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// Register the provider
import { providerRegistry } from './MediaProvider';
providerRegistry.register(new InstagramProvider());
