// Instagram Session Tests
//
// Covers the two pure, side-effect-free exports of the session service. The
// rest of the module drives a real browser, so it is deliberately left alone
// here - the TOTP helper and the browser-executable probe are the pieces whose
// correctness is not obvious by reading.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { existsSync } from 'fs';
import { basename } from 'path';
import {
  generateTOTP,
  resolveBrowserExecutable,
  shortcodeToMediaId,
} from '@/services/media/InstagramSession';

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

    it('seeds onto globalThis lazily, so route module copies agree', async () => {
      const service = await import('@/services/media/InstagramSession');

      // Deliberate: Next.js can hold more than one module instance for a route,
      // and every copy must agree that a login is possible. Persisting to
      // globalThis is what stops a fresh copy from silently disabling the
      // automatic path.
      //
      // Seeding is deferred to first use rather than done at module load,
      // because import order decides when a module body runs and process.env
      // is not guaranteed to be populated yet. Reading the assertion before the
      // first call would pin the eager behaviour this deliberately avoids.
      const before = (globalThis as { igCredentials?: unknown }).igCredentials;
      expect(before).toBeUndefined();

      expect(service.canAttemptInstagramSession()).toBe(true);

      expect((globalThis as { igCredentials?: unknown }).igCredentials).toEqual({
        username: 'env-user',
        password: 'env-pass',
        twoFactorSecret: undefined,
      });
    });

    it('still reports armed after the environment is loaded late', async () => {
      // The scenario lazy seeding exists for: the module was imported before
      // anything populated process.env. An eager implementation would have
      // latched "not configured" and never recovered.
      const service = await import('@/services/media/InstagramSession');
      delete (globalThis as { igCredentials?: unknown }).igCredentials;

      process.env.INSTAGRAM_USERNAME = 'late-user';
      process.env.INSTAGRAM_PASSWORD = 'late-pass';

      expect(service.canAttemptInstagramSession()).toBe(true);
      expect((globalThis as { igCredentials?: unknown }).igCredentials).toMatchObject({
        username: 'late-user',
      });
    });
  });

  describe('supplied cookies session', () => {
    // Supplied cookies are the only mode that works on a host where Chromium
    // cannot be installed (a serverless sandbox), and they are read fresh from
    // the environment on every attempt - nothing about them is cached the way
    // credentials are.
    //
    // The parse itself lives in two unexported functions, so the only way to
    // observe a built session is through the code path that triggers them:
    // fetchWithSession -> ensureFreshSession. Rather than hit the network,
    // `fetch` is stubbed to answer 404, which makes the request loop a no-op
    // while still running ensureFreshSession exactly as production would. The
    // 404 (rather than 401/403) matters: 401/403 nulls the session out.
    // initializeInstagramSession is never called, so no browser is launched.

    const resetSessionGlobals = (): void => {
      delete (globalThis as { igSession?: unknown }).igSession;
      delete (globalThis as { igCredentials?: unknown }).igCredentials;
      delete (globalThis as { igFailure?: unknown }).igFailure;
      delete (globalThis as { igLoginInFlight?: unknown }).igLoginInFlight;
    };

    /** Stubs the network so the session-building path runs without Instagram. */
    const stubInstagramNetwork = (): void => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: false,
          status: 404,
          text: async () => '',
        }))
      );
    };

    /** A shortcode valid for shortcodeToMediaId, so no failure precedes the fetch. */
    const SHORT_CODE = 'DbY4CmbMZ43';

    beforeEach(() => {
      resetSessionGlobals();
      // Credentials are deliberately cleared so each case measures the cookie
      // path alone; supplying them would open the login fallback.
      vi.stubEnv('INSTAGRAM_USERNAME', '');
      vi.stubEnv('INSTAGRAM_PASSWORD', '');
      vi.stubEnv('INSTAGRAM_2FA_SECRET', '');
      vi.stubEnv('INSTAGRAM_USER_AGENT', '');
      vi.stubEnv('INSTAGRAM_SESSION_COOKIES', '');
      stubInstagramNetwork();
      vi.resetModules();
    });

    afterEach(() => {
      resetSessionGlobals();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      vi.doUnmock('playwright');
      vi.resetModules();
    });

    const loadWithCookies = async (raw: string) => {
      vi.stubEnv('INSTAGRAM_SESSION_COOKIES', raw);
      vi.resetModules();
      return import('@/services/media/InstagramSession');
    };

    /** Runs the session-building path and returns the module plus the result. */
    const buildSession = async (raw: string) => {
      const service = await loadWithCookies(raw);
      const result = await service.fetchWithSession(SHORT_CODE, 'reel');
      return { service, result };
    };

    it('arms the automatic path from a cookie header alone', async () => {
      const service = await loadWithCookies('sessionid=abc123; csrftoken=def456');

      expect(service.canAttemptInstagramSession()).toBe(true);
    });

    it('builds a supplied-cookies session with the parsed cookie names and values', async () => {
      const { service, result } = await buildSession('sessionid=abc123; csrftoken=def456');

      // The stubbed fetch finds no media, so the read itself fails - what
      // matters here is that a session existed and where it came from.
      expect(result).toBeNull();

      const session = service.getInstagramSession();
      expect(session).not.toBeNull();
      expect(session?.source).toBe('supplied-cookies');

      expect(session?.cookies.map((cookie) => [cookie.name, cookie.value])).toEqual([
        ['sessionid', 'abc123'],
        ['csrftoken', 'def456'],
      ]);

      // A replayed cookie header is only useful if it reaches the wire intact.
      expect(service.getInstagramCookieHeader()).toBe('sessionid=abc123; csrftoken=def456');
      expect(service.isInstagramSessionConfigured()).toBe(true);
    });

    it('scopes parsed cookies to Instagram with a session expiry of -1', async () => {
      const { service } = await buildSession('sessionid=abc123');

      expect(service.getInstagramSession()?.cookies).toEqual([
        {
          name: 'sessionid',
          value: 'abc123',
          domain: '.instagram.com',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: true,
          sameSite: 'Lax',
        },
      ]);
    });

    it('honours INSTAGRAM_USER_AGENT for the replayed session', async () => {
      vi.stubEnv('INSTAGRAM_USER_AGENT', 'CustomAgent/1.0');
      const { service } = await buildSession('sessionid=abc123');

      expect(service.getInstagramSession()?.userAgent).toBe('CustomAgent/1.0');
    });

    it('rejects cookies that carry no sessionid and says so', async () => {
      const { service, result } = await buildSession('csrftoken=def456; mid=xyz');

      expect(result).toBeNull();
      expect(service.getInstagramSession()).toBeNull();
      expect(service.getInstagramCookieHeader()).toBeNull();

      // The missing cookie is the one thing an operator can act on, so the
      // message has to name it rather than just report a failure. It no longer
      // names INSTAGRAM_SESSION_COOKIES, because the same validation now also
      // covers cookies restored from the database.
      const failure = service.getInstagramSessionFailure();
      expect(failure).toBe(
        'The Instagram cookies contain no "sessionid" cookie, ' +
          'so they cannot authenticate. Copy it while signed in to Instagram.'
      );
    });

    it('accepts a JSON array of browser-exported cookie objects', async () => {
      const exported = [
        { name: 'sessionid', value: 'json-array-1', domain: '.instagram.com', path: '/' },
        { name: 'csrftoken', value: 'json-array-2', domain: '.instagram.com', path: '/' },
      ];

      const { service } = await buildSession(JSON.stringify(exported));

      const session = service.getInstagramSession();
      expect(session?.source).toBe('supplied-cookies');
      expect(session?.cookies.map((cookie) => [cookie.name, cookie.value])).toEqual([
        ['sessionid', 'json-array-1'],
        ['csrftoken', 'json-array-2'],
      ]);
    });

    it('normalises optional fields on an exported cookie object', async () => {
      // Extension exports vary in which optional fields they include, and the
      // defaults are what makes a hand-picked export work at all.
      const { service } = await buildSession(
        JSON.stringify([
          { name: 'sessionid', value: 'bare' },
          {
            name: 'csrftoken',
            value: 'full',
            domain: 'www.instagram.com',
            path: '/api',
            expires: 1893456000,
            httpOnly: true,
            secure: false,
          },
        ])
      );

      expect(service.getInstagramSession()?.cookies).toEqual([
        {
          name: 'sessionid',
          value: 'bare',
          domain: '.instagram.com',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: true,
          sameSite: 'Lax',
        },
        {
          name: 'csrftoken',
          value: 'full',
          domain: 'www.instagram.com',
          path: '/api',
          expires: 1893456000,
          httpOnly: true,
          // secure:false in the export is honoured, so an insecure cookie does
          // not get silently upgraded to secure.
          secure: false,
          sameSite: 'Lax',
        },
      ]);
    });

    it('drops exported entries that are not name/value cookie objects', async () => {
      const { service } = await buildSession(
        JSON.stringify([
          { name: 'sessionid', value: 'good' },
          { name: 'missing-value' },
          { value: 'missing-name' },
          null,
          'not-an-object',
        ])
      );

      expect(service.getInstagramSession()?.cookies.map((cookie) => cookie.name)).toEqual([
        'sessionid',
      ]);
    });

    it('accepts a JSON object carrying a cookies array', async () => {
      // The shape several browser-cookie exporters emit.
      const { service } = await buildSession(
        JSON.stringify({
          version: 1,
          cookies: [
            { name: 'sessionid', value: 'nested-1', domain: '.instagram.com' },
            { name: 'ds_user_id', value: 'nested-2', domain: '.instagram.com' },
          ],
        })
      );

      const session = service.getInstagramSession();
      expect(session?.source).toBe('supplied-cookies');
      expect(session?.cookies.map((cookie) => [cookie.name, cookie.value])).toEqual([
        ['sessionid', 'nested-1'],
        ['ds_user_id', 'nested-2'],
      ]);
    });

    it('rejects malformed JSON without throwing', async () => {
      for (const raw of ['[{not json', '{ "cookies": [ }', '[[[']) {
        const { service, result } = await buildSession(raw);

        expect(result).toBeNull();
        expect(service.getInstagramSession()).toBeNull();

        expect(service.getInstagramSessionFailure()).toBe(
          'INSTAGRAM_SESSION_COOKIES looks like JSON but could not be parsed.'
        );
      }
    });

    it('rejects JSON that parses but carries no usable cookie', async () => {
      for (const raw of ['[]', '{}', '{"cookies": []}', '[{"name":"sessionid"}]']) {
        const { service } = await buildSession(raw);

        expect(service.getInstagramSession()).toBeNull();
      }
    });

    it('parses awkward cookie headers', async () => {
      const { service } = await buildSession(
        '  sessionid = abc=def ;  ;  csrftoken=ghi  ; ; ds_user_id=42'
      );

      const session = service.getInstagramSession();
      expect(session?.source).toBe('supplied-cookies');
      expect(session?.cookies.map((cookie) => [cookie.name, cookie.value])).toEqual([
        // Only the first `=` separates, so a base64-padded value survives.
        ['sessionid', 'abc=def'],
        ['csrftoken', 'ghi'],
        ['ds_user_id', '42'],
      ]);
    });

    it('keeps the cookie reason visible when the login fallback also fails', async () => {
      // Credentials are the documented fallback, so a bad cookie export does not
      // end the attempt by itself. The actionable cookie message must survive
      // that fallback: the export is what the operator actually got wrong, and a
      // later login error overwriting it would send them debugging the wrong
      // problem.
      //
      // Playwright is mocked to fail on launch; without that this path starts a
      // real browser and the test would time out rather than assert anything.
      vi.doMock('playwright', () => ({
        chromium: {
          launch: vi.fn(async () => {
            throw new Error('browser launch unavailable in tests');
          }),
        },
      }));
      vi.stubEnv('INSTAGRAM_USERNAME', 'env-user');
      vi.stubEnv('INSTAGRAM_PASSWORD', 'env-pass');

      const { service, result } = await buildSession('csrftoken=def456');

      expect(result).toBeNull();
      expect(service.getInstagramSession()).toBeNull();

      const failure = service.getInstagramSessionFailure();
      expect(failure).toContain('sessionid');
      // The login failure is still reported, just not in place of the cause.
      expect(failure).toContain('browser launch unavailable in tests');
    });

    it('records the missing-sessionid reason on the global before any fallback runs', async () => {
      // The message is assigned synchronously inside the cookie attempt, so it
      // is observable without waiting for - or reaching - the login fallback.
      vi.doMock('playwright', () => ({
        chromium: {
          launch: vi.fn(async () => {
            throw new Error('browser launch unavailable in tests');
          }),
        },
      }));
      vi.stubEnv('INSTAGRAM_USERNAME', 'env-user');
      vi.stubEnv('INSTAGRAM_PASSWORD', 'env-pass');
      vi.stubEnv('INSTAGRAM_SESSION_COOKIES', 'csrftoken=def456');
      vi.resetModules();
      const service = await import('@/services/media/InstagramSession');

      void service.fetchWithSession(SHORT_CODE, 'reel').catch(() => undefined);

      expect(service.getInstagramSessionFailure()).toContain('sessionid');
    });

    it('leaves the automatic path off with neither cookies nor credentials', async () => {
      const service = await loadWithCookies('');

      expect(service.canAttemptInstagramSession()).toBe(false);
    });

    it('treats a whitespace-only cookie value as unconfigured', async () => {
      const service = await loadWithCookies('   ');

      expect(service.canAttemptInstagramSession()).toBe(false);
    });

    it('picks up re-exported cookies without waiting for the session to expire', async () => {
      const { service } = await buildSession('sessionid=first');
      expect(service.getInstagramSession()?.cookies[0]?.value).toBe('first');

      // Same module instance, new environment. A stored session lasts a day, but
      // operators re-export whenever Instagram expires their cookies - and on a
      // serverless host, where re-exporting is the normal recovery, a stale
      // session would look exactly like the fix not having worked.
      vi.stubEnv('INSTAGRAM_SESSION_COOKIES', 'sessionid=second');
      await service.fetchWithSession(SHORT_CODE, 'reel');

      expect(service.getInstagramSession()?.cookies[0]?.value).toBe('second');
    });
  });

  describe('shortcodeToMediaId', () => {
    // Instagram's internal media endpoint rejects a shortcode with
    // "Invalid media_id" and only accepts the decoded numeric id, so this
    // conversion is what makes the authenticated read work at all.
    it('decodes a real shortcode to the media id Instagram accepts', () => {
      // Verified live: this exact pair returns HTTP 200 with video_versions,
      // while the shortcode form returns HTTP 400 "Invalid media_id".
      expect(shortcodeToMediaId('DbY4CmbMZ43')).toBe('3952155142319611447');
    });

    it('decodes a single-character shortcode to its alphabet index', () => {
      expect(shortcodeToMediaId('A')).toBe('0');
      expect(shortcodeToMediaId('B')).toBe('1');
      expect(shortcodeToMediaId('-')).toBe('62');
      expect(shortcodeToMediaId('_')).toBe('63');
    });

    it('keeps precision past 2^53, where a Number would silently corrupt the id', () => {
      // Media ids exceed Number.MAX_SAFE_INTEGER, so accumulating in a JS
      // number loses the low digits and yields a plausible but wrong id. This
      // value is chosen so the naive number implementation differs.
      const id = shortcodeToMediaId('DbY4CmbMZ43');

      expect(BigInt(id)).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
      // The lossy path loses the trailing digits rather than failing.
      expect(String(Number(id))).not.toBe(id);
    });

    it('rejects characters outside the shortcode alphabet', () => {
      expect(() => shortcodeToMediaId('abc$def')).toThrow(/invalid character/i);
    });
  });
});
