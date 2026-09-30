// YouTube Provider Implementation
//
// Resolves YouTube videos using yt-dlp to extract direct media URLs and metadata.
// Requires yt-dlp to be available in the environment.

import { BaseMediaProvider, providerRegistry } from './MediaProvider';
import { youtubeDirectProcessor, extractVideoId } from './YouTubeDirectProcessor';
import type { MediaResolutionResult } from '@/types';

export class YouTubeProvider extends BaseMediaProvider {
  readonly name = 'YouTube';
  readonly supportedDomains = [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'youtu.be',
    'www.youtu.be',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
  ];

  private readonly processor = youtubeDirectProcessor;

  protected extractIdentifier(url: string): string | undefined {
    return extractVideoId(url);
  }

  protected async fetchMediaInfo(url: string): Promise<MediaResolutionResult> {
    const videoId = this.extractIdentifier(url);
    if (!videoId) {
      throw new Error('INVALID_URL - Could not extract a YouTube video ID from the URL');
    }

    return this.processor.process(url, videoId);
  }

  protected createDownloadUrl(resolutionId: string, quality: string): string {
    return `/api/reels/download/${resolutionId}/${quality}`;
  }

  getMediaRequestHeaders(_mediaUrl: string): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.youtube.com/',
      Origin: 'https://www.youtube.com',
    };
  }
}

providerRegistry.register(new YouTubeProvider());
