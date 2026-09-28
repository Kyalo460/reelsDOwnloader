// URL Validation Service

import type { ValidationResult, ErrorCode } from '@/types';

const INSTAGRAM_REEL_PATTERNS = [
  /^https?:\/\/(www\.)?instagram\.com\/reel\/[A-Za-z0-9_-]+\/?$/i,
  /^https?:\/\/instagram\.com\/reel\/[A-Za-z0-9_-]+\/?$/i,
  /^https?:\/\/(www\.)?instagram\.com\/p\/[A-Za-z0-9_-]+\/?$/i,
  /^https?:\/\/instagram\.com\/p\/[A-Za-z0-9_-]+\/?$/i,
];

const ALLOWED_DOMAINS = ['instagram.com', 'www.instagram.com'];
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

    // Parse URL
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return this.error('INVALID_URL', 'Invalid URL format');
    }

    // Check protocol
    if (parsed.protocol !== 'https:') {
      return this.error('INVALID_URL', 'Only HTTPS URLs are allowed');
    }

    // Check blocked hosts (before domain check)
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.includes(hostname)) {
      return this.error('NOT_PERMITTED', 'Access to local resources is not permitted');
    }

    // Check domain
    if (!ALLOWED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
      return this.error('UNSUPPORTED_URL', 'Only Instagram URLs are supported');
    }

    // Check path pattern
    const isValidPattern = INSTAGRAM_REEL_PATTERNS.some((pattern) => pattern.test(trimmed));
    if (!isValidPattern) {
      return this.error('UNSUPPORTED_URL', 'URL must be an Instagram Reel or Post URL');
    }

    // Extract short code
    const shortCodeMatch = trimmed.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/);
    const shortCode = shortCodeMatch ? shortCodeMatch[2] : null;

    return {
      valid: true,
      shortCode: shortCode || undefined,
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
