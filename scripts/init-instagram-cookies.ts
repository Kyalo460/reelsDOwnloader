// Establishes the Instagram session before the app starts serving requests.
//
//   npm run auth:instagram
//
// Reads INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD and the optional
// INSTAGRAM_2FA_SECRET. The session lives in the process that logs in, so a
// standalone run like this is only a connectivity check: the Next.js server
// needs its own login via POST /api/auth/instagram/session (or by calling
// initializeInstagramSession during startup).
//
// .env is loaded with @next/env, the same loader the app uses. Without it a
// `tsx` run sees an empty environment and reports the account as unconfigured
// even when .env is correct.

import { loadEnvConfig } from '@next/env';
import {
  closeInstagramSession,
  initializeInstagramSession,
  resolveBrowserExecutable,
} from '../src/services/media/InstagramSession';

function loadEnvironment(): void {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production', {
    info() {},
    error() {},
  });
}

async function main(): Promise<void> {
  loadEnvironment();

  const username = process.env.INSTAGRAM_USERNAME;
  const password = process.env.INSTAGRAM_PASSWORD;
  const twoFactorSecret = process.env.INSTAGRAM_2FA_SECRET;

  if (!username || !password) {
    console.error(
      'INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD are not set.\n' +
        'Add them to .env with no leading "#", then run this again.'
    );
    process.exitCode = 1;
    return;
  }

  const executablePath = resolveBrowserExecutable();
  console.log(
    executablePath
      ? `Using local browser: ${executablePath}`
      : "No local Chrome/Edge found; falling back to Playwright's bundled Chromium."
  );

  try {
    console.log(`Signing in as ${username}...`);
    const session = await initializeInstagramSession({ username, password, twoFactorSecret });

    console.log('Login succeeded.');
    console.log(`  Session cookies: ${session.cookies.length}`);
    console.log(`  Valid until:     ${new Date(session.expiresAt).toISOString()}`);
  } catch (error) {
    console.error(`Login failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await closeInstagramSession();
  }
}

void main();
