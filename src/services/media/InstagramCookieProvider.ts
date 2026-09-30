// Instagram Cookie-Based Authentication Scraper
//
// Uses Playwright to automate login and extract session cookies.
// WARNING: Violates Instagram ToS. Accounts will likely be banned.
// Use at your own risk.

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Cookie, Page } from 'playwright';
import { createHmac } from 'crypto';
import type { MediaResolutionResult } from '@/types';
import { BaseMediaProvider } from './MediaProvider';
import {
  extractShortCode,
  INSTAGRAM_ORIGIN,
  extractFromHtml,
  extractFromJson,
  toResolutionResult,
} from './DirectUrlProcessor';

interface InstagramCredentials {
  username: string;
  password: string;
  twoFactorSecret?: string; // TOTP secret for 2FA
}

interface SessionData {
  cookies: Cookie[];
  userAgent: string;
  expiresAt: number;
}

export class InstagramCookieProvider extends BaseMediaProvider {
  readonly name = 'Instagram (Cookie Auth)';
  readonly supportedDomains = ['instagram.com', 'www.instagram.com'];

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private session: SessionData | null = null;
  private credentials: InstagramCredentials | null = null;
  private loginPromise: Promise<SessionData> | null = null;

  async initialize(credentials: InstagramCredentials): Promise<void> {
    this.credentials = credentials;
    // Use system Chrome if available, otherwise download
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    this.browser = await chromium.launch({
      headless: true,
      executablePath: executablePath || undefined,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
  }

  async ensureLoggedIn(): Promise<SessionData> {
    if (this.session && Date.now() < this.session.expiresAt) {
      return this.session;
    }

    if (this.loginPromise) {
      return this.loginPromise;
    }

    this.loginPromise = this.performLogin();
    try {
      this.session = await this.loginPromise;
      return this.session;
    } finally {
      this.loginPromise = null;
    }
  }

  private async performLogin(): Promise<SessionData> {
    if (!this.context || !this.credentials) {
      throw new Error('Not initialized. Call initialize() first.');
    }

    const page = await this.context.newPage();

    try {
      // Go to login page
      await page.goto(`${INSTAGRAM_ORIGIN}/accounts/login/`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Handle cookie consent if present
      try {
        await page.click('button:has-text("Allow all cookies"), button:has-text("Accept All")', {
          timeout: 5000,
        });
      } catch {
        // No cookie banner
      }

      // Fill login form
      await page.fill('input[name="username"]', this.credentials.username);
      await page.fill('input[name="password"]', this.credentials.password);
      await page.click('button[type="submit"]');

      // Wait for navigation or 2FA
      await page.waitForURL((u) => !u.toString().includes('/accounts/login/'), { timeout: 30000 });

      // Handle 2FA if needed
      const currentUrl = page.url();
      if (currentUrl.includes('/accounts/login/two_factor') || currentUrl.includes('/challenge/')) {
        if (this.credentials.twoFactorSecret) {
          const totp = this.generateTOTP(this.credentials.twoFactorSecret);
          await page.fill('input[name="verificationCode"]', totp);
          await page.click('button[type="submit"]');
          await page.waitForURL((u) => !u.toString().includes('/accounts/login/'), {
            timeout: 15000,
          });
        } else {
          throw new Error('2FA required but no TOTP secret provided');
        }
      }

      // Handle "Save Info" / "Not Now" prompts
      try {
        await page.click('button:has-text("Not Now"), button:has-text("Not now")', {
          timeout: 5000,
        });
      } catch {
        // No prompt
      }

      // Extract cookies
      const cookies = await this.context.cookies();
      const sessionCookies = cookies.filter((c) => c.domain.includes('instagram.com'));

      if (sessionCookies.length === 0) {
        throw new Error('Login failed - no session cookies obtained');
      }

      const userAgent = await page.evaluate(() => navigator.userAgent);

      return {
        cookies: sessionCookies,
        userAgent,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      };
    } finally {
      await page.close();
    }
  }

  private generateTOTP(secret: string): string {
    // Simple TOTP implementation (RFC 6238)
    // For production, use a proper library like 'otplib'
    const epoch = Math.floor(Date.now() / 1000 / 30);
    const key = this.base32ToBuffer(secret);
    const hmac = this.hmacSha1Sync(key, Buffer.from(this.intToBytes(epoch)));
    const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
    const b1 = hmac[offset] ?? 0;
    const b2 = hmac[offset + 1] ?? 0;
    const b3 = hmac[offset + 2] ?? 0;
    const b4 = hmac[offset + 3] ?? 0;
    const code = ((b1 & 0x7f) << 24) | ((b2 & 0xff) << 16) | ((b3 & 0xff) << 8) | (b4 & 0xff);
    return (code % 1000000).toString().padStart(6, '0');
  }

  private base32ToBuffer(base32: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const char of base32.toUpperCase().replace(/=+$/, '')) {
      const idx = alphabet.indexOf(char);
      if (idx === -1) continue;
      bits += idx.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    return Buffer.from(bytes);
  }

  private intToBytes(num: number): Uint8Array {
    const bytes = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) {
      bytes[i] = num & 0xff;
      num = Math.floor(num / 256);
    }
    return bytes;
  }

  private hmacSha1Sync(key: Buffer, data: Buffer): Buffer {
    return createHmac('sha1', key).update(data).digest();
  }

  protected extractIdentifier(url: string): string | undefined {
    return extractShortCode(url);
  }

  protected async fetchMediaInfo(url: string): Promise<MediaResolutionResult> {
    const shortCode = this.extractIdentifier(url);
    if (!shortCode) {
      throw new Error('INVALID_URL - Could not extract media identifier from URL');
    }

    const session = await this.ensureLoggedIn();

    // Use the direct URL processor but with authenticated cookies
    const result = await this.fetchWithAuth(url, shortCode, session);
    return result;
  }

  private async fetchWithAuth(
    url: string,
    shortCode: string,
    session: SessionData
  ): Promise<MediaResolutionResult> {
    const code = shortCode;
    const kind = /\/(?:reels?|tv)\//i.test(url) ? 'reel' : 'p';
    const canonical = `${INSTAGRAM_ORIGIN}/${kind}/${code}/`;

    // Build cookie header
    const cookieHeader = session.cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    interface FetchTarget {
      url: string;
      kind: 'html' | 'json';
    }

    const targets: FetchTarget[] = [
      { url: canonical, kind: 'html' },
      { url: `${canonical}embed/captioned/`, kind: 'html' },
    ];

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
            Referer: `${INSTAGRAM_ORIGIN}/`,
            Cookie: cookieHeader,
          },
          redirect: 'follow',
          cache: 'no-store',
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            // Session expired, force re-login
            this.session = null;
            throw new Error('SESSION_EXPIRED');
          }
          continue;
        }

        const body = await response.text();
        const extracted =
          target.kind === 'json' ? extractFromJson(body, code) : extractFromHtml(body, code);

        if (extracted.mediaUrl || extracted.versions.length > 0) {
          return toResolutionResult(extracted);
        }

        if (extracted.exists) {
          throw new Error('AUTH_REQUIRED - Reel exists but video requires different auth');
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'SESSION_EXPIRED') {
          throw error;
        }
        // Try next target
      }
    }

    throw new Error('MEDIA_UNAVAILABLE - Could not fetch media with authenticated session');
  }

  protected createDownloadUrl(resolutionId: string, quality: string): string {
    return `/api/reels/download/${resolutionId}/${quality}`;
  }

  getMediaRequestHeaders(mediaUrl: string): Record<string, string> {
    if (!this.session) {
      return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8',
        Referer: 'https://www.instagram.com/',
      };
    }

    const cookieHeader = this.session.cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    return {
      'User-Agent': this.session.userAgent,
      Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.instagram.com/',
      Cookie: cookieHeader,
    };
  }

  async close(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    this.session = null;
  }

  getSession(): SessionData | null {
    return this.session;
  }

  setSession(session: SessionData): void {
    this.session = session;
  }
}

// Export singleton instance for use in API routes
export let cookieProvider: InstagramCookieProvider | null = null;

export async function initializeCookieProvider(
  credentials: InstagramCredentials
): Promise<InstagramCookieProvider> {
  if (cookieProvider) {
    await cookieProvider.close();
  }
  cookieProvider = new InstagramCookieProvider();
  await cookieProvider.initialize(credentials);
  return cookieProvider;
}

export function getCookieProvider(): InstagramCookieProvider | null {
  return cookieProvider;
}
