// URL Validation Service

import type { ValidationResult, ErrorCode } from '@/types';
import {
  isInstagramHostname,
  normalizeInstagramUrl,
  parseInstagramMediaUrl,
} from '@/lib/instagramUrl';

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
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
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

    // Parse URL. Normalisation tolerates pasted text: a missing scheme,
    // surrounding quotes and trailing `?igsh=…` / `#media` fragments.
    const parsed = normalizeInstagramUrl(trimmed);
    if (!parsed) {
      return this.error('INVALID_URL', 'Invalid URL format');
    }

    // We always request the page ourselves, so never downgrade to plaintext.
    if (parsed.protocol !== 'https:') {
      return this.error('INVALID_URL', 'Only HTTPS URLs are allowed');
    }

    // Check blocked hosts (before domain check)
    const hostname = bareHostname(parsed.hostname).toLowerCase();
    if (
      BLOCKED_HOSTS.includes(hostname) ||
      PRIVATE_IP_RANGES.some((range) => range.test(hostname))
    ) {
      return this.error('NOT_PERMITTED', 'Access to local resources is not permitted');
    }

    // Check domain
    if (!isInstagramHostname(hostname)) {
      return this.error('UNSUPPORTED_URL', 'Only Instagram URLs are supported');
    }

    // Check path pattern: /reel, /reels, /p or /tv followed by a shortcode,
    // with or without a query string, fragment or trailing slash.
    const media = parseInstagramMediaUrl(trimmed);
    if (!media) {
      return this.error('UNSUPPORTED_URL', 'URL must be an Instagram Reel or Post URL');
    }

    return {
      valid: true,
      shortCode: media.shortCode,
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
