// YouTube Direct URL Processor
//
// Resolves YouTube videos by using yt-dlp to extract direct media URLs and metadata.
// Falls back to an oEmbed-based approach when yt-dlp is not available.

import type { MediaResolutionResult, MediaVariant } from '@/types';
import { getYouTubeThumbnailUrl } from '@/lib/youtubeUrl';

interface SpawnHandle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stdout?: { on(event: string, listener: (...args: any[]) => void): void };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stderr?: { on(event: string, listener: (...args: any[]) => void): void };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void;
  kill(signal?: string): void;
}

type SpawnFn = (
  cmd: string,
  args: string[],
  options: { stdio: ['ignore', 'pipe', 'pipe'] }
) => SpawnHandle;

export type YouTubeDirectErrorCode =
  | 'INVALID_URL'
  | 'NOT_FOUND'
  | 'PRIVATE_CONTENT'
  | 'MEDIA_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'NOT_PERMITTED'
  | 'AUTH_REQUIRED'
  | 'YTDLP_ERROR'
  | 'YTDLP_NOT_FOUND';

export class YouTubeDirectError extends Error {
  readonly code: YouTubeDirectErrorCode;

  constructor(code: YouTubeDirectErrorCode, detail: string) {
    super(`${code} - ${detail}`);
    this.name = 'YouTubeDirectError';
    this.code = code;
  }
}

interface YtdlpVideoInfo {
  id: string;
  title: string;
  thumbnail?: string;
  duration?: number;
  formats?: YtdlpFormat[];
  is_live?: boolean;
  availability?: string;
}

interface YtdlpFormat {
  format_id: string;
  url?: string;
  ext: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  fps?: number;
  tbr?: number;
  filesize?: number;
  quality?: number;
  format_note?: string;
  protocol?: string;
  http_headers?: Record<string, string>;
}

interface ExtractedYouTubeMedia {
  videoId: string;
  title: string;
  thumbnail: string;
  duration: number;
  formats: YtdlpFormat[];
  isLive: boolean;
  requiresAuth: boolean;
  isPrivate: boolean;
  notFound: boolean;
}

const QUALITY_TIERS: MediaVariant['quality'][] = ['original', 'hd', 'sd'];

function versionArea(format: YtdlpFormat): number {
  return (format.width ?? 0) * (format.height ?? 0);
}

function hasVideoTrack(format: YtdlpFormat): boolean {
  return format.vcodec !== 'none' && format.vcodec !== undefined;
}

function selectBestFormats(formats: YtdlpFormat[]): YtdlpFormat[] {
  const videoFormats = formats.filter((f) => hasVideoTrack(f) && f.url);
  const deduped = new Map<string, YtdlpFormat>();

  for (const format of videoFormats) {
    const key = `${format.width}x${format.height}-${format.ext}`;
    const existing = deduped.get(key);
    if (!existing || (format.tbr ?? 0) > (existing.tbr ?? 0)) {
      deduped.set(key, format);
    }
  }

  const ordered = [...deduped.values()].sort((a, b) => versionArea(b) - versionArea(a));
  return ordered.slice(0, QUALITY_TIERS.length);
}

// YouTube oEmbed API response shape
interface YouTubeOembedResponse {
  title: string;
  thumbnail_url: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  duration_seconds?: string;
  width?: number;
  height?: number;
}

export class YouTubeDirectProcessor {
  private readonly timeoutMs: number;
  private readonly ytdlpPath: string;

  constructor(options: { timeoutMs?: number; ytdlpPath?: string } = {}) {
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.ytdlpPath = options.ytdlpPath ?? 'yt-dlp';
  }

  async process(url: string, videoId?: string): Promise<MediaResolutionResult> {
    const id = videoId ?? extractVideoId(url);
    if (!id) {
      throw new YouTubeDirectError(
        'INVALID_URL',
        'Could not extract a YouTube video ID from the URL'
      );
    }

    try {
      const extracted = await this.fetchVideoInfo(id);
      return this.toResolutionResult(extracted);
    } catch (error) {
      // yt-dlp failed (binary missing on serverless, timeout, etc.):
      // fall back to YouTube's public oEmbed API for title/thumbnail/duration.
      // oEmbed does not provide direct media URLs, so downloads are unsupported
      // in this path - but metadata still lets the UI show the video info.
      const originalError =
        error instanceof YouTubeDirectError
          ? error
          : new YouTubeDirectError('YTDLP_ERROR', String(error));

      try {
        const extracted = await this.fetchVideoInfoOembed(id);
        return this.toResolutionResultOembed(id, extracted);
      } catch (oembedError) {
        // If oEmbed also failed with NOT_FOUND, the video likely doesn't exist.
        // Prefer that error over the yt-dlp error since it's more accurate.
        if (oembedError instanceof YouTubeDirectError && oembedError.code === 'NOT_FOUND') {
          throw oembedError;
        }
        throw originalError;
      }
    }
  }

  private async fetchVideoInfo(videoId: string): Promise<ExtractedYouTubeMedia> {
    const { spawn } = await this.safeSpawnImport();

    const args = [
      '--no-warnings',
      '--dump-json',
      '--no-playlist',
      '--skip-download',
      '--format',
      'bestvideo+bestaudio/best',
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    const { stdout, stderr, exitCode } = await this.runYtdlp(spawn, args);

    if (exitCode !== 0) {
      const errorMessage = stderr.toString().trim();
      throw this.classifyYtdlpError(errorMessage);
    }

    try {
      const info: YtdlpVideoInfo = JSON.parse(stdout.toString().trim());
      return this.extractMedia(info);
    } catch {
      throw new YouTubeDirectError('YTDLP_ERROR', 'Failed to parse yt-dlp output');
    }
  }

  private extractMedia(info: YtdlpVideoInfo): ExtractedYouTubeMedia {
    const isLive = info.is_live === true;
    const availability = info.availability;

    let requiresAuth = false;
    let isPrivate = false;
    let notFound = false;

    if (availability === 'private' || availability === 'needs_auth') {
      requiresAuth = true;
      isPrivate = true;
    } else if (availability === 'subscriber_only') {
      requiresAuth = true;
    }

    if (!info.title || info.title === '[Private video]' || info.title === '[Deleted video]') {
      notFound = true;
    }

    const formats = info.formats ?? [];

    return {
      videoId: info.id,
      title: info.title ?? `YouTube Video ${info.id}`,
      thumbnail: info.thumbnail ?? `https://img.youtube.com/vi/${info.id}/hqdefault.jpg`,
      duration: Math.round(info.duration ?? 0),
      formats,
      isLive,
      requiresAuth,
      isPrivate,
      notFound,
    };
  }

  private toResolutionResult(extracted: ExtractedYouTubeMedia): MediaResolutionResult {
    if (extracted.notFound) {
      throw new YouTubeDirectError('NOT_FOUND', 'Video not found or has been deleted');
    }

    if (extracted.isPrivate) {
      throw new YouTubeDirectError('PRIVATE_CONTENT', 'This video is private');
    }

    if (extracted.requiresAuth) {
      throw new YouTubeDirectError('AUTH_REQUIRED', 'This video requires authentication to view');
    }

    if (extracted.isLive) {
      throw new YouTubeDirectError('NOT_PERMITTED', 'Live streams cannot be downloaded');
    }

    const selectedFormats = selectBestFormats(extracted.formats);

    if (selectedFormats.length === 0) {
      throw new YouTubeDirectError('MEDIA_UNAVAILABLE', 'No downloadable video formats found');
    }

    const media = selectedFormats.map((format, index) => ({
      quality: QUALITY_TIERS[index] ?? 'sd',
      format: format.ext === 'webm' ? 'webm' : ('mp4' as 'mp4' | 'webm'),
      downloadUrl: `/api/reels/download/yt_${extracted.videoId}/${QUALITY_TIERS[index] ?? 'sd'}`,
      sourceUrl: format.url!,
      fileSize: format.filesize,
      width: format.width,
      height: format.height,
      bitrate: format.tbr ? Math.round(format.tbr * 1000) : undefined,
    }));

    return {
      id: `yt_${extracted.videoId}`,
      title: extracted.title,
      thumbnail: extracted.thumbnail,
      duration: extracted.duration,
      media,
      shortCode: extracted.videoId,
      platform: 'youtube',
    };
  }

  // oEmbed fallback when yt-dlp is not available
  private async fetchVideoInfoOembed(videoId: string): Promise<YouTubeOembedResponse> {
    const response = await fetch(
      `https://www.youtube-nocookie.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      }
    );

    if (!response.ok) {
      throw new YouTubeDirectError('NOT_FOUND', `YouTube oEmbed returned HTTP ${response.status}`);
    }

    return response.json() as Promise<YouTubeOembedResponse>;
  }

  private toResolutionResultOembed(
    videoId: string,
    oembed: YouTubeOembedResponse
  ): MediaResolutionResult {
    const thumbnail = oembed.thumbnail_url || getYouTubeThumbnailUrl(videoId, 'hq');
    const duration = oembed.duration_seconds ? parseInt(oembed.duration_seconds, 10) : 0;

    // oEmbed is a metadata-only API: it exposes no media URLs and no renditions.
    // Returning placeholder variants here would advertise downloads that cannot
    // possibly succeed, so `media` stays empty and the UI reports the video as
    // metadata-only. This matches the documented contract that `media[]` lists
    // only renditions actually located on the source.
    return {
      id: `yt_${videoId}`,
      title: oembed.title,
      thumbnail,
      duration,
      media: [],
      shortCode: videoId,
      platform: 'youtube',
    };
  }

  private classifyYtdlpError(stderr: string): YouTubeDirectError {
    const lower = stderr.toLowerCase();

    if (lower.includes('video unavailable') || lower.includes('not available')) {
      return new YouTubeDirectError('NOT_FOUND', 'Video not found or unavailable');
    }
    if (lower.includes('private video') || lower.includes('private')) {
      return new YouTubeDirectError('PRIVATE_CONTENT', 'This video is private');
    }
    if (lower.includes('sign in') || lower.includes('login') || lower.includes('authentication')) {
      return new YouTubeDirectError('AUTH_REQUIRED', 'This video requires authentication');
    }
    if (lower.includes('age') || lower.includes('age-restricted') || lower.includes('age_limit')) {
      return new YouTubeDirectError(
        'AUTH_REQUIRED',
        'This video is age-restricted and requires authentication'
      );
    }
    if (lower.includes('live stream') || lower.includes('is live')) {
      return new YouTubeDirectError('NOT_PERMITTED', 'Live streams cannot be downloaded');
    }
    if (lower.includes('rate') || lower.includes('429') || lower.includes('too many requests')) {
      return new YouTubeDirectError('RATE_LIMITED', 'YouTube is rate limiting requests');
    }
    if (lower.includes('copyright') || lower.includes('blocked') || lower.includes('geo')) {
      return new YouTubeDirectError(
        'NOT_PERMITTED',
        'This video is blocked or unavailable in your region'
      );
    }
    if (lower.includes('yt-dlp: command not found') || lower.includes('no such file')) {
      return new YouTubeDirectError(
        'YTDLP_NOT_FOUND',
        'yt-dlp is not installed in the environment'
      );
    }

    return new YouTubeDirectError('YTDLP_ERROR', stderr || 'Unknown yt-dlp error');
  }

  private async safeSpawnImport(): Promise<{ spawn: SpawnFn }> {
    // Use dynamic import to avoid module loading issues in serverless environments
    const mod = await import('child_process');
    return { spawn: mod.spawn as SpawnFn };
  }

  private async runYtdlp(
    spawnFn: SpawnFn,
    args: string[]
  ): Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawnFn(this.ytdlpPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);

      child.stdout?.on('data', (chunk) => {
        stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
      });

      child.stderr?.on('data', (chunk) => {
        stderr = Buffer.concat([stderr, Buffer.from(chunk)]);
      });

      const timeoutId = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new YouTubeDirectError('YTDLP_ERROR', 'yt-dlp timed out'));
      }, this.timeoutMs);

      child.on('close', (exitCode: number) => {
        clearTimeout(timeoutId);
        resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
      });

      child.on('error', (error: { code?: string; message: string }) => {
        clearTimeout(timeoutId);
        if (error.code === 'ENOENT') {
          reject(new YouTubeDirectError('YTDLP_NOT_FOUND', 'yt-dlp not found in PATH'));
        } else {
          reject(new YouTubeDirectError('YTDLP_ERROR', error.message));
        }
      });
    });
  }
}

export const youtubeDirectProcessor = new YouTubeDirectProcessor();

export function extractVideoId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'youtu.be' || hostname === 'www.youtu.be') {
      return parsed.pathname.slice(1);
    }

    if (parsed.pathname.startsWith('/shorts/')) {
      return parsed.pathname.split('/')[2];
    }

    if (parsed.pathname.startsWith('/embed/')) {
      return parsed.pathname.split('/')[2];
    }

    return parsed.searchParams.get('v') ?? undefined;
  } catch {
    return undefined;
  }
}
