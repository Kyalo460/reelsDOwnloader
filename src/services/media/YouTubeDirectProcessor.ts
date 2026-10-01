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

/**
 * True when the error describes the extraction path failing, not the video.
 *
 * These are the only codes that justify falling back to oEmbed: the extractor
 * never got far enough to learn anything about the video itself. Everything
 * else is a verdict about the video and must be reported unchanged.
 */
function isExtractionFailure(code: YouTubeDirectErrorCode): boolean {
  return code === 'YTDLP_ERROR' || code === 'YTDLP_NOT_FOUND';
}

/**
 * Digs yt-dlp's real error text out of a failed extraction-service response.
 *
 * The service returns `{"error": "<yt-dlp stderr>"}`, and that text is what
 * distinguishes a private video from a removed one from a bot check. Falling
 * back to the status code keeps the classifier from reporting a bare
 * "unknown error" when the body is not the JSON we expect.
 */
function extractServiceError(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const message = (parsed as { error?: unknown }).error;
      if (typeof message === 'string' && message.trim()) {
        return message;
      }
    }
  } catch {
    // Not JSON - fall through to the raw body.
  }
  return body.trim() || 'The extraction service returned an error';
}

export class YouTubeDirectProcessor {
  private readonly timeoutMs: number;
  private readonly ytdlpPath: string;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: { timeoutMs?: number; ytdlpPath?: string; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.ytdlpPath = options.ytdlpPath ?? 'yt-dlp';
    this.fetchImpl = options.fetchImpl;
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
      const originalError =
        error instanceof YouTubeDirectError
          ? error
          : new YouTubeDirectError('YTDLP_ERROR', String(error));

      // A content verdict from the extractor is authoritative: it knows whether
      // the video is private, removed, age-gated or geo-blocked. oEmbed only
      // reports whether a video exists, so letting its NOT_FOUND override would
      // relabel a private or region-locked video as deleted. Throw it as-is.
      if (!isExtractionFailure(originalError.code)) {
        throw originalError;
      }

      // The extractor itself failed - service unreachable, timed out, or hit
      // YouTube's bot check. oEmbed is public and cheap, so fall back to it for
      // title, thumbnail and duration. It exposes no media URLs, so the result
      // is preview-only rather than a broken download button.
      try {
        const extracted = await this.fetchVideoInfoOembed(id);
        return this.toResolutionResultOembed(id, extracted);
      } catch (oembedError) {
        // With the extractor down, oEmbed's existence check is the best signal
        // available, so prefer it when it can answer the question.
        if (oembedError instanceof YouTubeDirectError && oembedError.code === 'NOT_FOUND') {
          throw oembedError;
        }
        throw originalError;
      }
    }
  }

  /**
   * Resolves video metadata, preferring the hosted extraction service.
   *
   * The remote path is tried first whenever `YTDLP_SERVICE_URL` is configured,
   * because on serverless the local `spawn` below cannot work at all. The local
   * binary remains a fallback for development machines that have yt-dlp
   * installed, so the app keeps working without the service during local work.
   */
  private async fetchVideoInfo(videoId: string): Promise<ExtractedYouTubeMedia> {
    const serviceUrl = process.env.YTDLP_SERVICE_URL?.trim();

    if (serviceUrl) {
      try {
        const info = await this.fetchVideoInfoRemote(serviceUrl, videoId);
        return this.extractMedia(info);
      } catch (error) {
        // A verdict about the video itself is final. Private, removed and
        // geo-blocked are facts about the video, so a second extractor cannot
        // improve on it and retrying would only bury the real reason.
        if (error instanceof YouTubeDirectError && !isExtractionFailure(error.code)) {
          throw error;
        }
        // Otherwise the service failed (unreachable, timed out, bot check), so
        // fall through and let a local yt-dlp try, if this machine has one.
      }
    }

    return this.fetchVideoInfoLocal(videoId);
  }

  /** Calls the hosted yt-dlp wrapper and parses its yt-dlp JSON response. */
  private async fetchVideoInfoRemote(serviceUrl: string, videoId: string): Promise<YtdlpVideoInfo> {
    const token = process.env.YTDLP_SERVICE_TOKEN?.trim();
    const doFetch = this.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await doFetch(`${serviceUrl.replace(/\/+$/, '')}/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          // The service refuses all requests when it has no token configured,
          // so a missing one here is a configuration error worth surfacing.
          ...(token ? { 'X-Service-Token': token } : {}),
        },
        body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` }),
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch {
      throw new YouTubeDirectError('YTDLP_ERROR', 'Could not reach the yt-dlp extraction service');
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 401 || response.status === 403) {
      throw new YouTubeDirectError(
        'YTDLP_ERROR',
        'The yt-dlp extraction service rejected our credentials'
      );
    }
    if (response.status === 400) {
      throw new YouTubeDirectError('INVALID_URL', 'The extraction service rejected the video URL');
    }

    let body: string;
    try {
      body = await response.text();
    } catch {
      throw new YouTubeDirectError('YTDLP_ERROR', 'Could not read the extraction service response');
    }

    if (!response.ok) {
      // The service forwards yt-dlp's stderr in `error`, which carries the real
      // cause (private, removed, bot check). Reuse the same classifier the local
      // path uses so both produce identical error codes.
      throw this.classifyYtdlpError(extractServiceError(body));
    }

    try {
      return JSON.parse(body) as YtdlpVideoInfo;
    } catch {
      throw new YouTubeDirectError(
        'YTDLP_ERROR',
        'Failed to parse the extraction service response'
      );
    }
  }

  /** Runs the local yt-dlp binary. Unusable on serverless, fine on a workstation. */
  private async fetchVideoInfoLocal(videoId: string): Promise<ExtractedYouTubeMedia> {
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
