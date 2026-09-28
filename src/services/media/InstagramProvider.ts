// Instagram Provider Implementation
// Uses only legitimate, publicly accessible methods

import { BaseMediaProvider, MediaProvider } from './MediaProvider';
import type { MediaResolutionResult } from '@/types';
import { ValidationResult } from '@/types';

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

export class InstagramProvider extends BaseMediaProvider {
  readonly name = 'Instagram';
  readonly supportedDomains = ['instagram.com', 'www.instagram.com'];

  private readonly GRAPHQL_ENDPOINT = 'https://www.instagram.com/graphql/query/';
  private readonly EMBED_ENDPOINT = 'https://api.instagram.com/oembed/';
  private readonly SHORTCODE_QUERY_HASH = 'b3055c01b4b222b8a47dc12b090e4e64';

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

    // Try GraphQL API first (public endpoint)
    try {
      return await this.fetchViaGraphQL(shortCode);
    } catch (graphqlError) {
      console.warn('GraphQL fetch failed, trying oEmbed:', graphqlError);

      // Fallback to oEmbed
      try {
        return await this.fetchViaOEmbed(url, shortCode);
      } catch (oembedError) {
        console.warn('oEmbed fetch failed:', oembedError);
        throw new Error('Unable to retrieve media information');
      }
    }
  }

  protected createDownloadUrl(resolutionId: string, quality: string): string {
    // In a real implementation, this would point to our download endpoint
    // that streams from the source URL
    return `/api/reels/download/${resolutionId}/${quality}`;
  }

  private async fetchViaGraphQL(shortCode: string): Promise<MediaResolutionResult> {
    const variables = {
      shortcode: shortCode,
      fetch_comment_count: 0,
      fetch_like_count: 0,
      fetch_media_preview: true,
    };

    const body = new URLSearchParams({
      query_hash: this.SHORTCODE_QUERY_HASH,
      variables: JSON.stringify(variables),
    });

    const response = await this.fetchWithTimeout(this.GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('NOT_FOUND');
      }
      if (response.status === 429) {
        throw new Error('RATE_LIMITED');
      }
      throw new Error(`GraphQL request failed: ${response.status}`);
    }

    const data: InstagramGraphQLResponse = await response.json();
    const media = data.data?.xdt_shortcode_media;

    if (!media) {
      throw new Error('Media not found in response');
    }

    // Check if private
    if (media.owner?.is_private) {
      throw new Error('PRIVATE_CONTENT');
    }

    // Check if video
    if (!media.is_video) {
      throw new Error('NOT_PERMITTED');
    }

    // Get video URL
    const videoUrl = media.video_url;
    if (!videoUrl) {
      throw new Error('MEDIA_UNAVAILABLE');
    }

    // Extract title from caption
    const caption = media.edge_media_to_caption?.edges?.[0]?.node?.text || '';
    const title = this.extractTitle(caption) || `Instagram Reel ${shortCode}`;

    // Create media variants
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

    // oEmbed doesn't give direct video URL, so we construct a best-effort
    // In practice, this would need the GraphQL API for actual video URLs
    throw new Error('MEDIA_UNAVAILABLE - oEmbed does not provide video URLs');
  }

  private extractTitle(caption: string): string | null {
    // Extract first line or first sentence as title
    const lines = caption.split('\n').filter((l) => l.trim());
    const firstLine = lines[0]?.trim();
    if (firstLine) {
      // Remove hashtags and mentions from title
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
    // In a real implementation, Instagram provides multiple quality variants
    // through the DASH manifest or separate CDN URLs
    // For now, we create a single "original" quality variant

    const width = dimensions?.width || 1080;
    const height = dimensions?.height || 1920;

    return [
      {
        quality: 'original',
        format: 'mp4',
        downloadUrl: this.createDownloadUrl(`ig_${shortCode}`, 'original'),
        fileSize: undefined, // Unknown without HEAD request
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
