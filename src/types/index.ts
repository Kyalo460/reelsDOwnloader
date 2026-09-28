// Core TypeScript Types

export interface MediaVariant {
  quality: 'original' | 'hd' | 'sd';
  format: 'mp4' | 'webm';
  downloadUrl: string;
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
  | 'INTERNAL_ERROR';

export const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  INVALID_URL: 400,
  UNSUPPORTED_URL: 400,
  NOT_FOUND: 404,
  PRIVATE_CONTENT: 403,
  MEDIA_UNAVAILABLE: 404,
  RATE_LIMITED: 429,
  NOT_PERMITTED: 451,
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
  checks?: Record<string, 'connected' | 'disconnected' | 'unknown'>;
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
