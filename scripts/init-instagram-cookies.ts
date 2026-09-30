// Script to initialize Instagram cookie authentication on startup
//
// Usage: tsx scripts/init-instagram-cookies.ts

import { initializeCookieProvider } from '@/services/media/InstagramCookieProvider';

async function main() {
  const username = process.env.INSTAGRAM_USERNAME;
  const password = process.env.INSTAGRAM_PASSWORD;
  const twoFactorSecret = process.env.INSTAGRAM_2FA_SECRET;

  if (!username || !password) {
    console.error('INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD must be set in environment');
    process.exit(1);
  }

  try {
    console.log('Initializing Instagram cookie authentication...');
    const provider = await initializeCookieProvider({
      username,
      password,
      twoFactorSecret,
    });

    const session = provider.getSession();
    if (session) {
      console.log('✓ Instagram authentication successful');
      console.log(`  Session expires: ${new Date(session.expiresAt).toISOString()}`);
      console.log(`  Cookies: ${session.cookies.length} cookies`);
    } else {
      console.error('✗ Failed to get session after login');
      process.exit(1);
    }
  } catch (error) {
    console.error(
      '✗ Instagram authentication failed:',
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

main();
