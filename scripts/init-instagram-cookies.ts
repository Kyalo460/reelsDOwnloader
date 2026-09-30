// Establishes the Instagram session before the app starts serving requests.
//
//   npm run auth:instagram
//
// Reads INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD and the optional
// INSTAGRAM_2FA_SECRET. The session lives in the process that logs in, so a
// standalone run like this is only a connectivity check: the Next.js server
// needs its own login via POST /api/auth/instagram/session (or by calling
// initializeInstagramSession during startup).

import {
  closeInstagramSession,
  initializeInstagramSession,
  resolveBrowserExecutable,
} from '../src/services/media/InstagramSession';

async function main(): Promise<void> {
  const username = process.env.INSTAGRAM_USERNAME;
  const password = process.env.INSTAGRAM_PASSWORD;
  const twoFactorSecret = process.env.INSTAGRAM_2FA_SECRET;

  if (!username || !password) {
    console.error('Set INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD before running this script.');
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
