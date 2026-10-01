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
import {
  invalidateStoredInstagramSession,
  readStoredInstagramSession,
  writeStoredInstagramSession,
} from './instagramSessionStore';
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
  /**
   * How the session was obtained. A supplied-cookie session skips the browser
   * entirely, which matters on hosts where no Chromium can be installed.
   */
  source: 'login' | 'supplied-cookies';
}

const globalForSession = globalThis as unknown as {
  igBrowser?: Browser | null;
  igContext?: BrowserContext | null;
  igSession?: InstagramSession | null;
  /**
   * undefined means "not evaluated yet". That third state is what makes the
   * seeding below safe to defer: evaluating at module load would read
   * process.env before a caller had a chance to load .env, and an unconfigured
   * result would then stick for the life of the process.
   */
  igCredentials?: InstagramCredentials | null;
  igLoginInFlight?: Promise<InstagramSession | null> | null;
  igFailure?: string | null;
  igCookiesEvaluated?: boolean;
  /**
   * The exact INSTAGRAM_SESSION_COOKIES value the current supplied session was
   * built from, so a re-export is noticed immediately rather than being masked
   * by the stored session until its TTL lapses.
   */
  igCookieFingerprint?: string | null;
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

/**
 * Evaluates the environment credentials on first use.
 *
 * Deferred rather than run at module load because import order decides when a
 * module body executes, and process.env is not guaranteed to be populated yet
 * at that point - anything importing this module before the .env loader runs
 * would otherwise permanently record "no credentials configured".
 */
function ensureCredentialsSeeded(): void {
  if (globalForSession.igCredentials === undefined) {
    globalForSession.igCredentials = credentialsFromEnv();
  }
}

/**
 * Session cookies supplied directly, if the operator provided them.
 *
 * This is the only mode that works on a host where Chromium cannot be
 * installed - a serverless sandbox, most notably, where the filesystem is
 * ephemeral and every cold start begins with no browser and no login. Sign in
 * once in a real browser, export the cookies, and the app replays them.
 *
 * It also sidesteps automated login entirely, which is the behaviour most
 * likely to get an account flagged.
 *
 * Accepts either a cookie header ("a=1; b=2") or a JSON array of
 * browser-exported cookie objects, since both are what people actually have.
 */
function cookiesFromEnv(): Cookie[] | null {
  const raw = process.env.INSTAGRAM_SESSION_COOKIES?.trim();
  if (!raw) return null;

  // Browser extensions and devtools export JSON; accept that shape directly.
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const list = Array.isArray(parsed)
        ? parsed
        : ((parsed as { cookies?: unknown[] } | null)?.cookies ?? []);

      const cookies = (list as Array<Record<string, unknown>>)
        .filter((entry) => typeof entry?.name === 'string' && typeof entry?.value === 'string')
        .map((entry) => ({
          name: entry.name as string,
          value: entry.value as string,
          domain: typeof entry.domain === 'string' ? entry.domain : '.instagram.com',
          path: typeof entry.path === 'string' ? entry.path : '/',
          // -1 is Playwright's "session cookie, no expiry", which is what these
          // are. Re-expiry is handled by the session TTL, not the cookie.
          expires: typeof entry.expires === 'number' ? entry.expires : -1,
          httpOnly: entry.httpOnly === true,
          secure: entry.secure !== false,
          sameSite: 'Lax' as const,
        }));

      if (cookies.length === 0) {
        globalForSession.igFailure =
          'INSTAGRAM_SESSION_COOKIES contains JSON but no usable cookies were found in it.';
        return null;
      }

      return cookies;
    } catch {
      globalForSession.igFailure =
        'INSTAGRAM_SESSION_COOKIES looks like JSON but could not be parsed.';
      return null;
    }
  }
  return parseCookieHeader(raw);
}

/** A session built from supplied cookies, or null when none are configured. */
function suppliedCookieSession(): InstagramSession | null {
  const cookies = cookiesFromEnv();
  if (!cookies) return null;

  return sessionFromCookies(cookies);
}

/**
 * Validates a cookie set and builds a session, or records why it cannot.
 *
 * Split from suppliedCookieSession so the same validation applies to cookies
 * arriving from the database, which have not been through the env parser.
 */
function sessionFromCookies(cookies: Cookie[]): InstagramSession | null {
  if (!cookies.some((cookie) => cookie.name === 'sessionid')) {
    globalForSession.igFailure =
      'The Instagram cookies contain no "sessionid" cookie, so they cannot authenticate. ' +
      'Copy it while signed in to Instagram.';
    return null;
  }

  return {
    cookies,
    userAgent: process.env.INSTAGRAM_USER_AGENT?.trim() || DESKTOP_USER_AGENT,
    // Cookies carry their own expiry, but nothing here re-reads it, so this is
    // a refresh checkpoint rather than a claim about Instagram's session life.
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    source: 'supplied-cookies',
  };
}

/** Parses a cookie header string into Playwright cookie objects. */
function parseCookieHeader(raw: string): Cookie[] {
  const cookies: Cookie[] = [];

  for (const pair of raw.split(';')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!name) continue;

    cookies.push({
      name,
      value,
      domain: '.instagram.com',
      path: '/',
      // Session cookie; expiry is tracked by the session TTL instead.
      expires: -1,
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    });
  }

  return cookies;
}

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
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    // Linux and other POSIX hosts, including containers and sandboxes where
    // Playwright's own download was never run. Snap, flatpak, and the Debian
    // chromium package all install to paths that are easy to miss.
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/opt/google/chrome/chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/bin/microsoft-edge',
      '/opt/microsoft/msedge/msedge',
      '/usr/bin/brave-browser'
    );

    const home = process.env.HOME;
    if (home) {
      candidates.push(
        `${home}/.cache/ms-playwright` // handled separately below
      );
    }

    // Flatpak Google Chrome.
    const xdgDataHome = process.env.XDG_DATA_HOME || (home ? `${home}/.local/share` : null);
    if (xdgDataHome) {
      candidates.push(`${xdgDataHome}/flathub/apps/com.google.Chrome/current/active/files/chrome`);
    }
  }

  return candidates.filter(
    (candidate) => !candidate.endsWith('ms-playwright') && existsSync(candidate)
  );
}

/** A usable browser executable path, or null when none could be found. */
export function resolveBrowserExecutable(): string | null {
  return candidateBrowsers()[0] ?? null;
}

/**
 * Launches a Chromium browser, trying each strategy in turn.
 *
 * Playwright's bundled build is only present when `npx playwright install` has
 * been run, so relying on it as the fallback means an unhelpful
 * "Executable doesn't exist at ...chromium_headless_shell..." error on any host
 * where that step was skipped. A system Chrome is tried first, then Playwright's
 * `chrome` channel (which locates a system install itself), and only then the
 * bundled build.
 */
async function launchBrowser(): Promise<Browser> {
  const executablePath = resolveBrowserExecutable();

  if (executablePath) {
    return chromium.launch({
      headless: true,
      executablePath,
      args: ['--disable-blink-features=AutomationControlled'],
    });
  }

  // No system binary was found by path. `channel: 'chrome'` asks Playwright to
  // locate a system Google Chrome install, which covers layouts the path list
  // above misses.
  const attempts: Array<{ label: string; options: Parameters<typeof chromium.launch>[0] }> = [
    {
      label: "system Chrome (channel 'chrome')",
      options: {
        headless: true,
        channel: 'chrome',
        args: ['--disable-blink-features=AutomationControlled'],
      },
    },
    {
      label: "system Chromium (channel 'chromium')",
      options: {
        headless: true,
        channel: 'chromium',
        args: ['--disable-blink-features=AutomationControlled'],
      },
    },
    {
      label: "Playwright's bundled Chromium",
      options: {
        headless: true,
        args: ['--disable-blink-features=AutomationControlled'],
      },
    },
  ];

  const failures: string[] = [];

  for (const attempt of attempts) {
    try {
      return await chromium.launch(attempt.options);
    } catch (error) {
      failures.push(
        `  ${attempt.label}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
      );
    }
  }

  throw new Error(
    [
      'No usable Chromium browser was found, so the Instagram session cannot be established.',
      ...failures,
      '  Fix this by running one of:',
      "    npx playwright install chromium        (downloads Playwright's own build)",
      '    apt-get install -y chromium google-chrome-stable',
      '    set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome',
    ].join('\n')
  );
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
  const browser = await launchBrowser();

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

/**
 * Selectors for the login form.
 *
 * Instagram ships a client-rendered app shell, and it has renamed these fields
 * before, so each field lists several known-good spellings and the first match
 * wins. A selector that stops matching shows up as an unexplained login
 * failure, so `describeLoginPage` turns that case into a readable cause.
 *
 * The first entry in each list is what the live page actually serves as of
 * 2026-09: the credential input is `name="email"` (labelled "Mobile number,
 * username or email") and the password input is `name="pass"`. Both were
 * previously `username`/`password`, and the submit control is a div rather
 * than a button, so `button[type="submit"]` matches nothing at all.
 */
const LOGIN_FIELD_SELECTORS = {
  username: [
    'input[name="email"]',
    'input[autocomplete="username"]',
    'input[id="username"]',
    'input[name="username"]',
    'input[name="phone_number"]',
    'input[placeholder*="Phone number" i]',
    'input[placeholder*="username" i]',
    'input[aria-label*="Username" i]',
    'input[type="text"]',
  ],
  password: [
    'input[name="pass"]',
    'input[autocomplete="current-password"]',
    'input[name="password"]',
    'input[type="password"]',
  ],
};

const LOGIN_SUBMIT_SELECTOR = [
  '[role="button"][aria-label="Log In"]',
  'button[type="submit"]',
  'div[role="button"]:has-text("Log in")',
  'button:has-text("Log in")',
].join(', ');

/**
 * Clicks the submit control.
 *
 * `.first()` is required: the selector is a list, and if more than one element
 * matches, Playwright's strict mode rejects the click outright rather than
 * picking one.
 */
async function clickLoginSubmit(page: Page): Promise<void> {
  await page.locator(LOGIN_SUBMIT_SELECTOR).first().click();
}

/**
 * The 2FA code field. Unverified against a live 2FA screen - it only appears
 * after a successful credential submit - so it is matched loosely by role,
 * autocomplete, placeholder and label rather than by a single name.
 */
const TWO_FACTOR_SELECTORS = [
  'input[name="verificationCode"]',
  'input[autocomplete="one-time-code"]',
  'input[placeholder*="code" i]',
  'input[aria-label*="code" i]',
  'input[aria-label*="Authentication" i]',
];

/** First selector in the list that resolves to a visible element, if any. */
async function firstVisibleSelector(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return selector;
  }

  return null;
}

/**
 * Waits for the login form to render.
 *
 * A bare timeout here previously surfaced as `page.fill: Timeout 30000ms
 * exceeded`, which says nothing about why. The failure branch below reports
 * what Instagram actually served instead, because "the form never appeared" has
 * very different causes - bot detection, a consent wall, a regional block -
 * and only one of them is fixable in this file.
 */
async function waitForLoginForm(page: Page): Promise<void> {
  const deadline = Date.now() + 45_000;

  while (Date.now() < deadline) {
    const username = await firstVisibleSelector(page, LOGIN_FIELD_SELECTORS.username);
    const password = await firstVisibleSelector(page, LOGIN_FIELD_SELECTORS.password);

    if (username && password) return;

    await page.waitForTimeout(500);
  }

  throw new Error(await describeLoginPage(page));
}

async function fillLoginField(page: Page, username: string, password: string): Promise<void> {
  const usernameSelector = await firstVisibleSelector(page, LOGIN_FIELD_SELECTORS.username);
  const passwordSelector = await firstVisibleSelector(page, LOGIN_FIELD_SELECTORS.password);

  if (!usernameSelector || !passwordSelector) {
    throw new Error(await describeLoginPage(page));
  }

  await page.fill(usernameSelector, username);
  await page.fill(passwordSelector, password);
}

/** Explains what the login page is actually showing, for the failure message. */
async function describeLoginPage(page: Page): Promise<string> {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const text = await page
    .locator('body')
    .innerText()
    .catch(() => '');

  const signals: string[] = [];
  const haystack = `${title} ${text}`.toLowerCase();

  const known: Array<[RegExp, string]> = [
    [
      /suspicious activity|unusual login|confirm it'?s you/,
      'Instagram flagged the login as suspicious',
    ],
    [/checkpoint_required|checkpoint/, 'Instagram presented a checkpoint'],
    [/captcha|verify it'?s you|are you a robot/i, 'Instagram presented a CAPTCHA'],
    [
      /temporarily blocked|try again later|too many attempts/,
      'Instagram rate limited or temporarily blocked this account',
    ],
    [/allow all cookies|accept all/, 'A cookie consent dialog is blocking the form'],
    [/this account has been disabled|your account has been disabled/, 'The account is disabled'],
    [
      /page not found|content isn't available/i,
      'Instagram served a not-found page instead of the login form',
    ],
  ];

  for (const [pattern, label] of known) {
    if (pattern.test(haystack)) signals.push(label);
  }

  const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 160);

  return [
    "Instagram's login form never rendered, so the account could not be used.",
    `  Final URL:  ${url}`,
    `  Page title: ${title || '(none)'}`,
    signals.length > 0
      ? `  Detected:   ${signals.join('; ')}`
      : '  Detected:   nothing recognisable',
    `  Page text:  ${excerpt || '(empty)'}`,
    '  This is Instagram refusing to serve the login page to an automated browser.',
    '  A manual login in a real browser, supplying session cookies, is the only reliable path.',
  ].join('\n');
}

/** Instagram's 64-character URL-safe base64 alphabet, used by shortcodes. */
const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Converts a reel shortcode into the numeric media id the internal API wants.
 *
 * A shortcode is not a separate identifier - it is the media id written in
 * base64 with Instagram's URL-safe alphabet. The two names for the same object
 * are why `/api/v1/media/<shortcode>/info/` answers `Invalid media_id`: that
 * endpoint only accepts the decoded integer.
 *
 * BigInt is required, not stylistic. Media ids currently run past 2^53, so
 * accumulating in a JS number silently loses the low digits and produces a
 * plausible-looking but wrong id.
 */
export function shortcodeToMediaId(shortcode: string): string {
  let value = 0n;

  for (const char of shortcode) {
    const index = SHORTCODE_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Shortcode contains an invalid character: ${char}`);
    }
    value = value * 64n + BigInt(index);
  }

  return value.toString();
}

async function performLogin(): Promise<InstagramSession> {
  ensureCredentialsSeeded();

  const credentials = globalForSession.igCredentials;
  if (!credentials) {
    throw new Error('No Instagram credentials are available to sign in with.');
  }

  const context = globalForSession.igContext ?? (await launchContext(credentials));

  const page = await context.newPage();

  try {
    await page.goto(`${INSTAGRAM_ORIGIN}/accounts/login/`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });

    // Instagram serves a ~635 KB JavaScript app shell with no form markup; the
    // fields only exist once its bundle runs. Waiting for the actual field is
    // therefore the only reliable readiness signal, and 'domcontentloaded'
    // alone is not.
    await waitForLoginForm(page);

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

    await fillLoginField(page, credentials.username, credentials.password);
    await clickLoginSubmit(page);

    try {
      await page.waitForURL((url) => !url.toString().includes('/accounts/login/'), {
        timeout: 30_000,
      });
    } catch {
      // waitForURL times out if Instagram stays on the login page (bad
      // credentials, or a challenge it did not navigate away from). The URL
      // check below turns that into a precise error.
    }

    // Instagram's 2FA step reuses the same shell, and its field naming has also
    // drifted, so this is matched loosely and only after a submit.
    const codeSelector = await firstVisibleSelector(page, TWO_FACTOR_SELECTORS);

    if (codeSelector) {
      if (!credentials.twoFactorSecret) {
        throw new Error(
          'Instagram requires 2FA for this account. Set INSTAGRAM_2FA_SECRET to the base32 TOTP secret.'
        );
      }

      await page.fill(codeSelector, generateTOTP(credentials.twoFactorSecret));
      await clickLoginSubmit(page);
      await page.waitForURL((url) => !url.toString().includes('/accounts/login/'), {
        timeout: 20_000,
      });
    } else if (page.url().includes('/challenge/')) {
      throw new Error(
        'Instagram presented a challenge (device confirmation or captcha) that automated login cannot clear. Log in manually and supply session cookies instead.'
      );
    }

    if (!(await isLoggedIn(page))) {
      throw new Error(
        `Instagram login failed - still on the login page (${page.url()}). ` +
          'If the credentials are correct, Instagram usually means it wants a ' +
          'confirmation code or an emailed link rather than a password.'
      );
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
      source: 'login',
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

  // Recorded here as well as in ensureFreshSession: an explicit login is
  // usually someone debugging, and the reason it failed is the whole reason
  // they asked. Without this the status endpoint reported a null failure for a
  // login that had just thrown.
  try {
    const session = await performLogin();
    globalForSession.igSession = session;
    globalForSession.igFailure = null;
    return session;
  } catch (error) {
    globalForSession.igFailure =
      error instanceof Error ? error.message : 'Instagram login failed for an unknown reason';
    throw error;
  }
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
  ensureCredentialsSeeded();
  return (
    globalForSession.igCredentials !== null ||
    (process.env.INSTAGRAM_SESSION_COOKIES?.trim().length ?? 0) > 0
  );
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
  globalForSession.igCookieFingerprint = null;

  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
}

/**
 * True on hosts that cannot run a browser at all.
 *
 * Serverless platforms have an ephemeral, read-only-ish filesystem with no
 * Chromium and no way to install one, so an automated login can only ever fail
 * there. Detecting it up front turns a confusing Playwright "executable doesn't
 * exist" dump into one sentence naming the fix.
 */
function isEphemeralHost(): boolean {
  return (
    process.env.VERCEL === '1' ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.FUNCTION_NAME) ||
    Boolean(process.env.NETLIFY) ||
    process.env.K_SERVICE !== undefined
  );
}

/**
 * Installs a session from cookies supplied at runtime.
 *
 * This exists because refreshing cookies is the routine maintenance task on a
 * deployment that cannot run a browser. Routing that through the deployment's
 * environment means a re-export needs a config change and a redeploy; accepting
 * it over the API means one request, which on a cold-starting serverless host
 * is the difference between seconds and minutes of downtime.
 *
 * Returns an error string instead of throwing, so a malformed value produces a
 * 400 with the reason rather than a 500.
 */
export function setSuppliedCookies(raw: string): { ok: true } | { ok: false; error: string } {
  const previousEnvValue = process.env.INSTAGRAM_SESSION_COOKIES;
  process.env.INSTAGRAM_SESSION_COOKIES = raw;

  const cookies = cookiesFromEnv();
  const failure = globalForSession.igFailure;

  const restoreEnv = () => {
    if (previousEnvValue === undefined) delete process.env.INSTAGRAM_SESSION_COOKIES;
    else process.env.INSTAGRAM_SESSION_COOKIES = previousEnvValue;
  };

  if (!cookies || !cookies.some((cookie) => cookie.name === 'sessionid')) {
    globalForSession.igFailure = null;
    restoreEnv();

    return {
      ok: false,
      error:
        failure ??
        'The supplied cookies contain no "sessionid" cookie, so they cannot authenticate. ' +
          'Copy it while signed in to Instagram.',
    };
  }

  const session = sessionFromCookies(cookies)!;
  session.userAgent = process.env.INSTAGRAM_USER_AGENT?.trim() || DESKTOP_USER_AGENT;

  globalForSession.igSession = session;
  globalForSession.igCookieFingerprint = raw.trim();
  globalForSession.igFailure = null;

  return { ok: true };
}

/**
 * Installs a session from cookies and persists it, so it survives a cold start.
 *
 * This is the durable counterpart to setSuppliedCookies. On a serverless
 * deployment the in-memory copy is discarded between invocations, so a session
 * that is not written down stops working exactly when it is most inconvenient.
 * A database outage is reported rather than thrown, because the in-memory
 * session is still usable for the life of the warm instance.
 */
export async function installSuppliedCookies(
  raw: string
): Promise<{ ok: true; persisted: boolean; warning?: string } | { ok: false; error: string }> {
  const result = setSuppliedCookies(raw);
  if (!result.ok) return result;

  const stored = await writeStoredInstagramSession({
    cookies: raw.trim(),
    userAgent: getInstagramSession()?.userAgent,
  });

  if (!stored.ok) {
    return {
      ok: true,
      persisted: false,
      warning: `${stored.error} The session works until this instance restarts.`,
    };
  }

  return { ok: true, persisted: true };
}

/** Re-authenticates in the background when the stored session has lapsed. */
async function ensureFreshSession(): Promise<InstagramSession | null> {
  const configuredCookies = process.env.INSTAGRAM_SESSION_COOKIES?.trim() ?? '';

  // A re-exported cookie string must take effect immediately. Without this the
  // stored session wins until its TTL lapses, so an operator refreshing expired
  // cookies would see no change for up to a day - and on a serverless host,
  // where re-exporting is the normal way to recover, that looks exactly like
  // the fix not having worked.
  if (
    globalForSession.igSession?.source === 'supplied-cookies' &&
    globalForSession.igCookieFingerprint !== configuredCookies
  ) {
    globalForSession.igSession = null;
  }

  const existing = getInstagramSession();
  if (existing) return existing;

  // Supplied cookies win over automated login, unconditionally. They need no
  // browser, which is the only way this works on a host that cannot install
  // Chromium, and they avoid the automated login Instagram is most likely to
  // challenge. Credentials are the fallback for anyone who would rather not
  // paste a session cookie into their environment.
  const supplied = suppliedCookieSession();
  if (supplied) {
    globalForSession.igSession = supplied;
    globalForSession.igCookieFingerprint = configuredCookies;
    globalForSession.igFailure = null;
    return supplied;
  }

  // Nothing in the environment: fall back to the stored session. This is the
  // path that matters on a serverless deployment, where the environment is
  // fixed at build time and in-memory state does not survive a cold start.
  const stored = await readStoredInstagramSession();
  if (stored) {
    const restored = sessionFromCookies(parseCookieHeader(stored.cookies));
    if (restored) {
      globalForSession.igSession = {
        ...restored,
        userAgent: stored.userAgent?.trim() || restored.userAgent,
      };
      globalForSession.igCookieFingerprint = stored.cookies.trim();
      globalForSession.igFailure = null;
      return globalForSession.igSession;
    }
  }

  // Preserve a cookie-specific diagnosis. If the cookies were configured but
  // unusable, that is the actionable fact, and letting a later login failure
  // overwrite it would leave the operator debugging the wrong problem.
  const cookieFailure = globalForSession.igFailure ?? null;

  ensureCredentialsSeeded();

  if (!globalForSession.igCredentials) {
    globalForSession.igFailure =
      cookieFailure ??
      'No Instagram session is configured. Set INSTAGRAM_SESSION_COOKIES, ' +
        'or INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD to sign in automatically.';
    return null;
  }

  // Credentials alone are not enough here: this host cannot run a browser, so
  // the login can only fail. Say that once, plainly, instead of letting
  // Playwright emit its executable-not-found dump on every gated reel.
  if (isEphemeralHost()) {
    globalForSession.igFailure =
      (cookieFailure ? `${cookieFailure}\n  ` : '') +
      'This deployment cannot run a browser, so automatic Instagram login is not possible. ' +
      'Set INSTAGRAM_SESSION_COOKIES to the cookies from a browser signed in to Instagram ' +
      '(cookie header string, or a JSON export). No Chromium install is required in that mode.';
    return null;
  }

  if (!globalForSession.igLoginInFlight) {
    globalForSession.igLoginInFlight = performLogin()
      .then((session) => {
        globalForSession.igSession = session;
        globalForSession.igFailure = null;
        return session;
      })
      .catch((error: unknown) => {
        // The reason a login failed is the single most useful thing to surface.
        // Without it every failure mode collapses into one anonymous-looking
        // error and there is nothing to act on. A pre-existing cookie problem is
        // kept alongside it, since when both are configured the cookie export is
        // usually the one the operator got wrong.
        const loginFailure =
          error instanceof Error ? error.message : 'Instagram login failed for an unknown reason';

        globalForSession.igFailure = cookieFailure
          ? `${cookieFailure}\n  (Automated login was also attempted and failed: ${loginFailure})`
          : loginFailure;

        return null;
      })
      .finally(() => {
        globalForSession.igLoginInFlight = null;
      });
  }

  return (await globalForSession.igLoginInFlight) ?? null;
}

/**
 * Why the authenticated path could not produce media, or null if it has not
 * failed since the last successful login.
 */
export function getInstagramSessionFailure(): string | null {
  return globalForSession.igFailure ?? null;
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

  // The internal endpoint rejects a shortcode outright ("Invalid media_id"), so
  // it has to be addressed by the decoded numeric id.
  let mediaId: string;
  try {
    mediaId = shortcodeToMediaId(shortCode);
  } catch (error) {
    globalForSession.igFailure =
      error instanceof Error ? error.message : 'Could not interpret the reel shortcode';
    return null;
  }

  const base = `${INSTAGRAM_ORIGIN}/${kind}/${shortCode}/`;
  const targets: AuthenticatedTarget[] = [
    { url: `${INSTAGRAM_ORIGIN}/api/v1/media/${mediaId}/info/`, kind: 'json' },
    // A plain cookie replay of the public page still gets the login wall, but
    // it is kept as a cheap second chance in case the endpoint form changes.
    { url: base, kind: 'html' },
  ];

  // Each target gets its own timeout and its own controller. One shared
  // controller meant a single slow target aborted the whole loop and left every
  // later target holding an already-aborted signal, so a transient hang
  // silently disabled the fallback for the rest of the call.
  const attempts: string[] = [];

  for (const target of targets) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

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
        // Recorded durably too, or a cold start would resurrect cookies that
        // Instagram has already rejected and retry them on every request.
        void invalidateStoredInstagramSession();
        globalForSession.igFailure = `Instagram rejected the session (HTTP ${response.status}). The cookies may have expired - re-export them while signed in to Instagram.`;
        return null;
      }

      attempts.push(`${target.kind} endpoint: HTTP ${response.status}`);

      if (!response.ok) continue;

      const body = await response.text();
      const extracted: ExtractedMedia =
        target.kind === 'json'
          ? extractFromJson(body, shortCode)
          : extractFromHtml(body, shortCode);

      if (extracted.mediaUrl || extracted.versions.length > 0) {
        return toResolutionResult(extracted);
      }

      attempts.push(`${target.kind} endpoint: responded but carried no media URL`);
    } catch (error) {
      attempts.push(
        `${target.kind} endpoint: ${
          error instanceof Error && error.name === 'AbortError'
            ? 'timed out after 12s'
            : error instanceof Error
              ? error.message.split('\n')[0]
              : String(error)
        }`
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  // Signed in, but Instagram served no media URL. Which endpoints were tried,
  // and how they answered, is the difference between "the cookies expired" and
  // "this reel is withheld" - so it is reported rather than guessed at.
  globalForSession.igFailure =
    'Signed in successfully, but Instagram returned no video file for this reel.\n' +
    `  Attempts: ${attempts.length > 0 ? attempts.join('; ') : 'none completed'}`;

  return null;
}
