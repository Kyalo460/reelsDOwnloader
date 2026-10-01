// Instagram Session Service
//
// Holds a signed-in Instagram session (cookies) so the public-page scraper can
// fall back to an authenticated read when Instagram withholds the video file
// from anonymous visitors.
//
// A session is optional. When none is configured every call site behaves
// exactly as before, so this must never be a hard dependency of resolution.
//
// WARNING: automating an Instagram login violates Instagram's Terms of Use and
// is the single most likely reason the account used here gets banned. Use a
// throwaway account, never a personal one.

import { existsSync } from 'fs';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Cookie, Page } from 'playwright';
import { createHmac } from 'crypto';
import {
  INSTAGRAM_ORIGIN,
  extractFromHtml,
  extractFromJson,
  toResolutionResult,
  type ExtractedMedia,
} from './DirectUrlProcessor';
import type { MediaResolutionResult } from '@/types';

/** Instagram's public web client id. Requests to the internal API must send it. */
const IG_APP_ID = '936619743392459';

const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface InstagramCredentials {
  username: string;
  password: string;
  /** Base32 TOTP secret, required for accounts with 2FA enabled. */
  twoFactorSecret?: string;
}

export interface InstagramSession {
  cookies: Cookie[];
  userAgent: string;
  expiresAt: number;
}

const globalForSession = globalThis as unknown as {
  igBrowser?: Browser | null;
  igContext?: BrowserContext | null;
  igSession?: InstagramSession | null;
  igCredentials?: InstagramCredentials | null;
  igLoginInFlight?: Promise<InstagramSession> | null;
};

/**
 * Credentials from the environment, if the operator configured them.
 *
 * This is what makes the session automatic: a deployment that sets
 * INSTAGRAM_USERNAME/INSTAGRAM_PASSWORD never has to call
 * initializeInstagramSession. The first reel that Instagram refuses to serve
 * anonymously triggers the login on demand, and the session is reused from
 * then on.
 *
 * Login is deliberately lazy rather than done at boot. It launches a real
 * browser and Instagram may present a device-confirmation challenge, and
 * paying that cost on every deploy - including for deployments that never
 * resolve an auth-gated reel - would be the wrong trade.
 */
function credentialsFromEnv(): InstagramCredentials | null {
  const username = process.env.INSTAGRAM_USERNAME;
  const password = process.env.INSTAGRAM_PASSWORD;

  if (!username || !password) return null;

  return {
    username,
    password,
    twoFactorSecret: process.env.INSTAGRAM_2FA_SECRET || undefined,
  };
}

// Seeded at module load so the automatic path works without any explicit
// initialisation call. initializeInstagramSession still overrides this when a
// caller supplies credentials explicitly.
globalForSession.igCredentials ??= credentialsFromEnv();

/**
 * Browser binaries to try when Playwright's own download is unavailable.
 *
 * `npx playwright install chromium` fetches from cdn.playwright.dev, which is
 * unreachable from some networks. A locally installed Chrome or Edge is a
 * drop-in substitute: Playwright drives any Chromium build via CDP.
 */
function candidateBrowsers(): string[] {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const candidates = configured ? [configured] : [];

  if (process.platform === 'win32') {
    const roots = [
      process.env['PROGRAMFILES'],
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
    ].filter((value): value is string => Boolean(value));

    for (const root of roots) {
      candidates.push(
        `${root}\\Google\\Chrome\\Application\\chrome.exe`,
        `${root}\\Microsoft\\Edge\\Application\\msedge.exe`
      );
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge'
    );
  }

  return candidates.filter((candidate) => existsSync(candidate));
}

/** A usable browser executable path, or null to use Playwright's bundled build. */
export function resolveBrowserExecutable(): string | null {
  return candidateBrowsers()[0] ?? null;
}

function base32ToBuffer(base32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';

  for (const char of base32.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
}

function intToBigEndianBytes(value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(Math.floor(value)));
  return bytes;
}

/** RFC 6238 TOTP, as used by Instagram's authenticator-app 2FA. */
export function generateTOTP(secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30);
  const digest = createHmac('sha1', base32ToBuffer(secret))
    .update(intToBigEndianBytes(counter))
    .digest();

  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  return (binary % 1_000_000).toString().padStart(6, '0');
}

function isLoggedIn(page: Page): boolean {
  return page.url().includes('/accounts/login/') === false;
}

async function launchContext(credentials: InstagramCredentials): Promise<BrowserContext> {
  const executablePath = resolveBrowserExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: DESKTOP_USER_AGENT,
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
  });

  // `navigator.webdriver` is the single most reliable bot signal. Hiding it is
  // not detection-proof, but a login that trips it fails outright.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  globalForSession.igBrowser = browser;
  globalForSession.igContext = context;
  globalForSession.igCredentials = credentials;

  return context;
}

async function performLogin(): Promise<InstagramSession> {
  const context =
    globalForSession.igContext ?? (await launchContext(globalForSession.igCredentials!));
  const credentials = globalForSession.igCredentials!;

  const page = await context.newPage();

  try {
    await page.goto(`${INSTAGRAM_ORIGIN}/accounts/login/`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });

    // Dismiss the consent interstitial if it is shown; it blocks the form.
    for (const label of [
      'Allow all cookies',
      'Accept All',
      'Allow essential and optional cookies',
    ]) {
      try {
        await page.click(`button:has-text("${label}")`, { timeout: 3_000 });
        break;
      } catch {
        // Banner absent - expected on most runs.
      }
    }

    await page.fill('input[name="username"]', credentials.username);
    await page.fill('input[name="password"]', credentials.password);
    await page.click('button[type="submit"]');

    try {
      await page.waitForURL((url) => !url.toString().includes('/accounts/login/'), {
        timeout: 30_000,
      });
    } catch {
      // waitForURL times out if Instagram stays on the login page (bad
      // credentials, or a challenge it did not navigate away from). The URL
      // check below turns that into a precise error.
    }

    if (
      await page
        .locator('input[name="verificationCode"]')
        .isVisible()
        .catch(() => false)
    ) {
      if (!credentials.twoFactorSecret) {
        throw new Error(
          'Instagram requires 2FA for this account. Set INSTAGRAM_2FA_SECRET to the base32 TOTP secret.'
        );
      }

      await page.fill('input[name="verificationCode"]', generateTOTP(credentials.twoFactorSecret));
      await page.click('button[type="submit"]');
      await page.waitForURL((url) => !url.toString().includes('/accounts/login/'), {
        timeout: 20_000,
      });
    } else if (page.url().includes('/challenge/')) {
      throw new Error(
        'Instagram presented a challenge (device confirmation or captcha) that automated login cannot clear. Log in manually and supply session cookies instead.'
      );
    }

    if (!(await isLoggedIn(page))) {
      throw new Error(`Instagram login failed - still on the login page (${page.url()})`);
    }

    const cookies = (await context.cookies()).filter((cookie) =>
      cookie.domain.includes('instagram.com')
    );

    // `sessionid` is the cookie that actually authenticates a web session.
    if (!cookies.some((cookie) => cookie.name === 'sessionid')) {
      throw new Error('Instagram login did not yield a sessionid cookie');
    }

    return {
      cookies,
      userAgent: DESKTOP_USER_AGENT,
      // Instagram sessions are server-side revocable with no published TTL.
      // A day is a conservative refresh interval, not a documented limit.
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Logs in (or re-logs in) and stores the session on the global singleton. */
export async function initializeInstagramSession(
  credentials: InstagramCredentials
): Promise<InstagramSession> {
  if (globalForSession.igContext) {
    await closeInstagramSession();
  }

  globalForSession.igCredentials = credentials;
  await launchContext(credentials);

  const session = await performLogin();
  globalForSession.igSession = session;

  return session;
}

/** The current session, or null when none is configured or it has expired. */
export function getInstagramSession(): InstagramSession | null {
  const session = globalForSession.igSession;
  if (!session) return null;

  if (Date.now() >= session.expiresAt) {
    globalForSession.igSession = null;
    return null;
  }

  return session;
}

export function isInstagramSessionConfigured(): boolean {
  return getInstagramSession() !== null;
}

/**
 * True when a login *could* be performed - credentials are available either
 * from an explicit initializeInstagramSession call or from the environment.
 *
 * This is deliberately not the same as isInstagramSessionConfigured: before the
 * first login there are no cookies yet, but the automatic path still wants to
 * try. Callers deciding whether to attempt an authenticated retry must gate on
 * this, not on having a cookie header in hand.
 */
export function canAttemptInstagramSession(): boolean {
  return globalForSession.igCredentials !== null;
}

/** Cookie header value for the current session, or null when signed out. */
export function getInstagramCookieHeader(): string | null {
  const session = getInstagramSession();
  if (!session) return null;

  return session.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

/** Clears the session and tears down the browser. Safe to call when unset. */
export async function closeInstagramSession(): Promise<void> {
  const context = globalForSession.igContext;
  const browser = globalForSession.igBrowser;

  globalForSession.igSession = null;
  globalForSession.igContext = null;
  globalForSession.igBrowser = null;

  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
}

/** Re-authenticates in the background when the stored session has lapsed. */
async function ensureFreshSession(): Promise<InstagramSession | null> {
  const existing = getInstagramSession();
  if (existing) return existing;

  if (!globalForSession.igCredentials) return null;

  if (!globalForSession.igLoginInFlight) {
    globalForSession.igLoginInFlight = performLogin()
      .then((session) => {
        globalForSession.igSession = session;
        return session;
      })
      .finally(() => {
        globalForSession.igLoginInFlight = null;
      });
  }

  return globalForSession.igLoginInFlight.catch(() => null);
}

interface AuthenticatedTarget {
  url: string;
  kind: 'json' | 'html';
}

/**
 * Authenticated read of a reel.
 *
 * The public page still renders a login wall for a plain cookie replay, so the
 * primary target is the internal media-info endpoint the web app itself calls.
 * It requires the `x-ig-app-id` header alongside the session cookies and returns
 * the `video_versions` array the anonymous path looks for.
 *
 * Returns null when no session is available or Instagram refuses the read, so
 * the caller can fall back to the anonymous result rather than failing.
 */
export async function fetchWithSession(
  shortCode: string,
  kind: 'reel' | 'p'
): Promise<MediaResolutionResult | null> {
  const session = await ensureFreshSession();
  if (!session) return null;

  const cookieHeader = getInstagramCookieHeader();
  if (!cookieHeader) return null;

  const base = `${INSTAGRAM_ORIGIN}/${kind}/${shortCode}/`;
  const targets: AuthenticatedTarget[] = [
    { url: `${INSTAGRAM_ORIGIN}/api/v1/media/${shortCode}/info/`, kind: 'json' },
    { url: base, kind: 'html' },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    for (const target of targets) {
      try {
        const response = await fetch(target.url, {
          method: 'GET',
          headers: {
            'User-Agent': session.userAgent,
            Accept:
              target.kind === 'json'
                ? 'application/json, text/plain, */*'
                : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            Referer: base,
            'X-IG-App-ID': IG_APP_ID,
            'X-ASBD-ID': '129477',
            'X-Requested-With': 'XMLHttpRequest',
            Cookie: cookieHeader,
          },
          redirect: 'follow',
          cache: 'no-store',
          signal: controller.signal,
        });

        // 401/403 mean the session is no longer valid for this content.
        if (response.status === 401 || response.status === 403) {
          globalForSession.igSession = null;
          return null;
        }

        if (!response.ok) continue;

        const body = await response.text();
        const extracted: ExtractedMedia =
          target.kind === 'json'
            ? extractFromJson(body, shortCode)
            : extractFromHtml(body, shortCode);

        if (extracted.mediaUrl || extracted.versions.length > 0) {
          return toResolutionResult(extracted);
        }
      } catch {
        // Try the next target; a single failed endpoint is not fatal.
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  return null;
}
