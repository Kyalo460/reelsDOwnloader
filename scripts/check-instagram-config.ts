// Reports whether the Instagram session fallback is actually wired up.
//
//   npm run auth:check
//
// Exists because "the reel still fails" was ambiguous: no account configured,
// no admin key, wrong file loaded, and a refused login all produced the same
// error. This prints which one applies, without needing a failing reel.

import {
  canAttemptInstagramSession,
  getInstagramSessionFailure,
  resolveBrowserExecutable,
} from '../src/services/media/InstagramSession';

/** Values present in .env are only visible to Next.js, not to a bare tsx run. */
async function reportFromDotEnv(): Promise<Record<string, string>> {
  const { readFileSync, existsSync } = await import('fs');

  if (!existsSync('.env')) return {};

  const parsed: Record<string, string> = {};

  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match?.[1]) parsed[match[1]] = (match[2] ?? '').trim();
  }

  return parsed;
}

function describe(value: string | undefined): string {
  if (value === undefined) return 'absent from .env';
  if (value === '') return 'PRESENT BUT EMPTY';
  return `set (${value.length} chars)`;
}

async function main(): Promise<void> {
  const dotenv = await reportFromDotEnv();

  const keys = [
    'INSTAGRAM_USERNAME',
    'INSTAGRAM_PASSWORD',
    'INSTAGRAM_2FA_SECRET',
    'ADMIN_API_KEY',
  ];

  console.log('Instagram session configuration\n');

  for (const key of keys) {
    const fromFile = dotenv[key];
    const fromProcess = process.env[key];

    // process.env wins at runtime; .env is what Next.js will load on start.
    const effective = fromProcess ?? fromFile;
    console.log(`  ${key.padEnd(22)} ${describe(effective)}`);
  }

  const browser = resolveBrowserExecutable();
  console.log(`  ${'BROWSER'.padEnd(22)} ${browser ?? 'none found (needs Playwright download)'}`);
  console.log('');

  const username = process.env.INSTAGRAM_USERNAME ?? dotenv.INSTAGRAM_USERNAME;
  const password = process.env.INSTAGRAM_PASSWORD ?? dotenv.INSTAGRAM_PASSWORD;

  let problems = 0;

  if (!username || !password) {
    problems++;
    console.log('FALLBACK DISABLED - no Instagram account configured.');
    console.log('  Edit .env and set INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD,');
    console.log('  with no leading "#". Then restart the app.');
    console.log('  Reels that need a signed-in session will keep failing until then.');
  } else if (canAttemptInstagramSession()) {
    console.log('Fallback ENABLED - credentials were read and a login will be attempted');
    console.log('  on the first reel Instagram refuses to serve anonymously.');
    console.log('  That first attempt takes 15-30s while the browser logs in.');
  } else {
    problems++;
    console.log('FALLBACK DISABLED - credentials exist in .env but were not loaded.');
    console.log('  The running process has not picked up .env; restart the app.');
  }

  if (!browser) {
    problems++;
    console.log('');
    console.log('No local Chrome/Edge found. Run: npx playwright install chromium');
  }

  const failure = getInstagramSessionFailure();
  if (failure) {
    console.log('');
    console.log(`Last session failure: ${failure}`);
  }

  process.exitCode = problems > 0 ? 1 : 0;
}

void main();
