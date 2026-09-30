// URL Validation Service

import type { ValidationResult, ErrorCode } from '@/types';
import {
  isInstagramHostname,
  normalizeInstagramUrl,
  parseInstagramMediaUrl,
  type InstagramMediaRef,
} from '@/lib/instagramUrl';
import {
  isYouTubeHostname,
  normalizeYouTubeUrl,
  parseYouTubeUrl,
  type YouTubeMediaRef,
} from '@/lib/youtubeUrl';

const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '169.254.169.254', '0.0.0.0'];

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

/** Hostname without the brackets `URL` adds around IPv6 literals. */
function bareHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/** Try to parse URL with generic parser to get hostname for domain check. */
function parseUrlForHostname(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Handle bare domains and protocol-relative URLs
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : trimmed.startsWith('//')
      ? `https:${trimmed}`
      : `https://${trimmed}`;

  try {
    return new URL(absolute);
  } catch {
    return null;
  }
}

export class UrlValidator {
  private readonly maxUrlLength = 2048;

  validate(url: string): ValidationResult {
    // Check empty
    if (!url || !url.trim()) {
      return this.error('INVALID_URL', 'URL is required');
    }

    const trimmed = url.trim();

    // Check length
    if (trimmed.length > this.maxUrlLength) {
      return this.error(
        'INVALID_URL',
        `URL exceeds maximum length of ${this.maxUrlLength} characters`
      );
    }

    // First, try to parse URL to get hostname for domain check
    const parsedUrl = parseUrlForHostname(trimmed);
    if (!parsedUrl) {
      return this.error('INVALID_URL', 'Invalid URL format');
    }

    const hostname = bareHostname(parsedUrl.hostname).toLowerCase();

    // Check protocol
    if (parsedUrl.protocol !== 'https:') {
      return this.error('INVALID_URL', 'Only HTTPS URLs are allowed');
    }

    // Check blocked hosts (before domain check)
    if (
      BLOCKED_HOSTS.includes(hostname) ||
      PRIVATE_IP_RANGES.some((range) => range.test(hostname))
    ) {
      return this.error('NOT_PERMITTED', 'Access to local resources is not permitted');
    }

    // Check if it's a supported domain
    const isInstagramDomain = isInstagramHostname(hostname);
    const isYouTubeDomain = isYouTubeHostname(hostname);

    if (!isInstagramDomain && !isYouTubeDomain) {
      return this.error('UNSUPPORTED_URL', 'Only Instagram and YouTube URLs are supported');
    }

    // Now try to parse the specific media format using platform-specific normalizers
    let parsed: URL | null = null;
    let media: InstagramMediaRef | YouTubeMediaRef | null = null;
    let isInstagram = false;

    if (isInstagramDomain) {
      parsed = normalizeInstagramUrl(trimmed);
      media = parsed ? parseInstagramMediaUrl(trimmed) : null;
      isInstagram = true;
    } else {
      parsed = normalizeYouTubeUrl(trimmed);
      media = parsed ? parseYouTubeUrl(trimmed) : null;
      isInstagram = false;
    }

    if (!parsed || !media) {
      return this.error('INVALID_URL', 'Invalid URL format');
    }

    const shortCode = isInstagram
      ? (media as InstagramMediaRef).shortCode
      : (media as YouTubeMediaRef).videoId;

    return {
      valid: true,
      shortCode,
      url: media.url,
    };
  }

  async validateWithDns(url: string): Promise<ValidationResult> {
    const basicValidation = this.validate(url);
    if (!basicValidation.valid) {
      return basicValidation;
    }

    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;

      // In a real implementation, you'd do DNS resolution here
      // For now, we skip actual DNS resolution to avoid SSRF risk
      // But you could use a safe DNS resolver library

      return basicValidation;
    } catch {
      return this.error('INVALID_URL', 'Failed to validate URL');
    }
  }

  private error(code: ErrorCode, message: string): ValidationResult {
    return {
      valid: false,
      error: { code, message },
    };
  }
}

export const urlValidator = new UrlValidator();
