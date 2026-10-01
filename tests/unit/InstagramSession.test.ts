// Instagram Session Tests
//
// Covers the two pure, side-effect-free exports of the session service. The
// rest of the module drives a real browser, so it is deliberately left alone
// here - the TOTP helper and the browser-executable probe are the pieces whose
// correctness is not obvious by reading.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { existsSync } from 'fs';
import { basename } from 'path';
import { generateTOTP, resolveBrowserExecutable } from '@/services/media/InstagramSession';

/**
 * RFC 6238 Appendix B test vector: the ASCII secret "12345678901234567890"
 * in base32. The published 8-digit SHA-1 values are truncated to their last
 * six digits, which is what authenticator apps (and Instagram) actually send.
 */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC_VECTORS: Array<[seconds: number, expected: string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

const BROWSER_EXECUTABLE_NAMES = [
  'chrome.exe',
  'msedge.exe',
  'msedge',
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'Google Chrome',
  'Microsoft Edge',
];

const originalExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

afterEach(() => {
  if (originalExecutablePath === undefined) {
    delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  } else {
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = originalExecutablePath;
  }
});

describe('InstagramSession', () => {
  describe('generateTOTP', () => {
    it('matches the RFC 6238 SHA-1 test vectors', () => {
      for (const [seconds, expected] of RFC_VECTORS) {
        expect(generateTOTP(RFC_SECRET, seconds * 1000)).toBe(expected);
      }
    });

    it('returns a zero-padded six digit code', () => {
      const code = generateTOTP(RFC_SECRET, 1234567890 * 1000);

      expect(code).toHaveLength(6);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('is stable within a time step and advances across one', () => {
      // 1_111_111_200s is an exact multiple of the 30s step.
      const stepStart = 1_111_111_200 * 1000;
      const stepEnd = stepStart + 30_000 - 1;

      expect(generateTOTP(RFC_SECRET, stepStart)).toBe(
        generateTOTP(RFC_SECRET, stepStart + 29_999)
      );
      expect(generateTOTP(RFC_SECRET, stepEnd)).not.toBe(generateTOTP(RFC_SECRET, stepEnd + 1));
    });

    it('accepts a lowercase secret with padding, as issued by some apps', () => {
      expect(generateTOTP(RFC_SECRET.toLowerCase(), 59 * 1000)).toBe('287082');
    });

    it('defaults to the current time when no timestamp is given', () => {
      const now = 1_234_567_890_000;

      vi.spyOn(Date, 'now').mockReturnValue(now);

      expect(generateTOTP(RFC_SECRET)).toBe('005924');

      vi.restoreAllMocks();
    });
  });

  describe('resolveBrowserExecutable', () => {
    it('returns null or a path that exists on disk', () => {
      const resolved = resolveBrowserExecutable();

      if (resolved === null) {
        expect(resolved).toBeNull();
        return;
      }

      expect(typeof resolved).toBe('string');
      expect(existsSync(resolved)).toBe(true);
    });

    it('points at a recognised browser binary when it resolves anything', () => {
      const resolved = resolveBrowserExecutable();

      if (resolved === null) return;

      expect(BROWSER_EXECUTABLE_NAMES).toContain(basename(resolved));
    });

    it('honours the PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH override', () => {
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = process.execPath;

      expect(resolveBrowserExecutable()).toBe(process.execPath);
    });

    it('ignores an override that does not exist on disk', () => {
      const before = resolveBrowserExecutable();
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = '/definitely/not/a/browser';

      const after = resolveBrowserExecutable();

      expect(after).not.toBe('/definitely/not/a/browser');
      if (after !== null) expect(existsSync(after)).toBe(true);
      // Dropping the bogus override must not lose a real local install.
      if (before !== null) expect(after).toBe(before);
    });
  });

  describe('automatic session availability', () => {
    // The service reads credentials from the environment once at module load and
    // caches them on globalThis. vi.resetModules() alone does not clear that
    // cache, so both halves are reset per test to keep this deterministic
    // regardless of the ambient environment or test ordering.

    beforeEach(() => {
      delete (globalThis as { igCredentials?: unknown }).igCredentials;
      vi.stubEnv('INSTAGRAM_USERNAME', 'env-user');
      vi.stubEnv('INSTAGRAM_PASSWORD', 'env-pass');
      vi.resetModules();
    });

    afterEach(() => {
      delete (globalThis as { igCredentials?: unknown }).igCredentials;
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it('seeds credentials from the environment without any explicit init call', async () => {
      const service = await import('@/services/media/InstagramSession');

      expect(service.canAttemptInstagramSession()).toBe(true);
    });

    it('allows an authenticated attempt before any session exists', async () => {
      const service = await import('@/services/media/InstagramSession');

      // The contract the automatic path rests on: the first retry is what
      // performs the login, so the gate cannot be the cookie header - that
      // would make automatic mode permanently unreachable.
      expect(service.canAttemptInstagramSession()).toBe(true);
      expect(service.getInstagramCookieHeader()).toBeNull();
      expect(service.getInstagramSession()).toBeNull();
      expect(service.isInstagramSessionConfigured()).toBe(false);
    });

    it('leaves the automatic path off when credentials are absent', async () => {
      vi.stubEnv('INSTAGRAM_USERNAME', '');
      vi.stubEnv('INSTAGRAM_PASSWORD', '');
      vi.resetModules();

      const service = await import('@/services/media/InstagramSession');

      expect(service.canAttemptInstagramSession()).toBe(false);
    });

    it('requires a password as well as a username', async () => {
      vi.stubEnv('INSTAGRAM_PASSWORD', '');
      vi.resetModules();

      const service = await import('@/services/media/InstagramSession');

      expect(service.canAttemptInstagramSession()).toBe(false);
    });

    it('keeps seeded credentials on globalThis so route module copies agree', async () => {
      const service = await import('@/services/media/InstagramSession');

      // Deliberate: Next.js can hold more than one module instance for a route,
      // and every copy must agree that a login is possible. Persisting to
      // globalThis is what stops a fresh copy from silently disabling the
      // automatic path.
      expect((globalThis as { igCredentials?: unknown }).igCredentials).toEqual({
        username: 'env-user',
        password: 'env-pass',
        twoFactorSecret: undefined,
      });
      expect(service.canAttemptInstagramSession()).toBe(true);
    });
  });
});
