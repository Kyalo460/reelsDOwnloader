// Core TypeScript Types

export interface MediaVariant {
  quality: 'original' | 'hd' | 'sd';
  format: 'mp4' | 'webm';
  /**
   * URL that clients call to download this variant. Always an internal
   * `/api/reels/download/:resolutionId/:quality` path.
   */
  downloadUrl: string;
  /**
   * Direct CDN media URL located inside the publicly accessible Instagram page
   * response (direct URL processing). This is what the backend streams from and
   * is therefore server-side only - it is stripped before responses go out.
   */
  sourceUrl?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  bitrate?: number;
}

export interface MediaResolutionResult {
  id: string;
  title: string;
  thumbnail: string;
  duration: number; // seconds
  media: MediaVariant[];
  shortCode: string;
}

export interface ValidationResult {
  valid: boolean;
  shortCode?: string;
  /**
   * Canonical absolute URL (normalised scheme/host, no query string or
   * fragment) to use for resolution. Present whenever `valid` is true.
   */
  url?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface ResolveRequest {
  url: string;
}

export interface ResolveResponse {
  success: true;
  data: MediaResolutionResult;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = T extends { success: true } ? T : ErrorResponse;

export type ErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_URL'
  | 'NOT_FOUND'
  | 'PRIVATE_CONTENT'
  | 'MEDIA_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'NOT_PERMITTED'
  | 'AUTH_REQUIRED'
  | 'INTERNAL_ERROR';

export const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  INVALID_URL: 400,
  UNSUPPORTED_URL: 400,
  NOT_FOUND: 404,
  PRIVATE_CONTENT: 403,
  MEDIA_UNAVAILABLE: 404,
  RATE_LIMITED: 429,
  NOT_PERMITTED: 451,
  // The reel is public but Instagram only serves the video file to a signed-in
  // session. This is distinct from NOT_FOUND, which claims the reel is gone.
  AUTH_REQUIRED: 401,
  INTERNAL_ERROR: 500,
};

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  /** `not_configured` marks an optional dependency that is not in use. */
  checks?: Record<string, 'connected' | 'disconnected' | 'not_configured'>;
}

export interface AdminMetrics {
  date: string;
  totalRequests: number;
  successfulResolutions: number;
  failedResolutions: number;
  totalDownloads: number;
  rateLimitEvents: number;
  errors: number;
  avgLatencyMs: number;
  storageUsedBytes: number;
}

export interface UserSession {
  userId: string;
  email: string;
  role: 'USER' | 'ADMIN';
  expiresAt: Date;
}

export interface DownloadHistoryEntry {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  quality: string;
  format: string;
  fileSize?: number;
  downloadedAt: Date;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
