// Reports whether the Instagram session fallback is actually wired up.
//
//   npm run auth:check
//
// Exists because "the reel still fails" was ambiguous: no account configured,
// no admin key, wrong file loaded, and a refused login all produced the same
// error. This prints which one applies, without needing a failing reel.
//
// The environment is loaded with @next/env - the same loader Next.js uses at
// startup - rather than parsed here. An earlier version parsed .env for display
// but left process.env untouched, so it reported the script's own empty
// environment as if it were the app's, and told a correctly configured
// deployment that its credentials "were not loaded".

import { loadEnvConfig } from '@next/env';

/** Populates process.env exactly as `next dev` / `next start` would. */
function loadEnvironment(): void {
  const dev = process.env.NODE_ENV !== 'production';

  loadEnvConfig(process.cwd(), dev, {
    info() {},
    error() {},
  });
}

function describe(value: string | undefined): string {
  if (value === undefined) return 'NOT SET';
  if (value.trim() === '') return 'PRESENT BUT EMPTY';
  return `set (${value.length} chars)`;
}

async function main(): Promise<void> {
  loadEnvironment();

  // Imported after loading so the module-load credential seeding inside
  // InstagramSession sees the same environment the app will see.
  const session = await import('../src/services/media/InstagramSession');

  const keys = [
    'INSTAGRAM_USERNAME',
    'INSTAGRAM_PASSWORD',
    'INSTAGRAM_2FA_SECRET',
    'ADMIN_API_KEY',
  ];

  console.log('Instagram session configuration\n');

  for (const key of keys) {
    console.log(`  ${key.padEnd(22)} ${describe(process.env[key])}`);
  }

  const browser = session.resolveBrowserExecutable();
  console.log(
    `  ${'BROWSER'.padEnd(22)} ${browser ?? 'NOT FOUND (run: npx playwright install chromium)'}`
  );
  console.log('');

  let problems = 0;

  if (!session.canAttemptInstagramSession()) {
    problems++;
    console.log('FALLBACK DISABLED - no Instagram account configured.');
    console.log('  Set INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD in .env, with no leading "#".');
    console.log('  Reels that need a signed-in session will keep failing until then.');
  } else {
    console.log('Fallback ENABLED - credentials loaded; a login will be attempted on the first');
    console.log('  reel Instagram refuses to serve anonymously (that first attempt takes ~40s).');

    if (!process.env.INSTAGRAM_2FA_SECRET) {
      console.log('');
      console.log('  Note: INSTAGRAM_2FA_SECRET is empty. If the account uses an authenticator');
      console.log('  app, set it or the login will stop at the code prompt.');
    }
  }

  if (!process.env.ADMIN_API_KEY) {
    problems++;
    console.log('');
    console.log('ADMIN_API_KEY is not set, so /api/auth/instagram/session returns 503.');
  }

  if (!browser) {
    problems++;
    console.log('');
    console.log('No local Chrome/Edge found. Run: npx playwright install chromium');
  }

  const failure = session.getInstagramSessionFailure();
  if (failure) {
    console.log('');
    console.log(`Last session failure: ${failure}`);
  }

  console.log('');
  console.log(
    problems > 0
      ? 'Result: NOT ready.'
      : 'Result: ready. Restart the app so it picks up .env, then retry the reel.'
  );

  process.exitCode = problems > 0 ? 1 : 0;
}

void main();
