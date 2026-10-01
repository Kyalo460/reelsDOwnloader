// Instagram session authentication endpoints
//
// POST /api/auth/instagram/session  { username, password, twoFactorSecret? }
// GET  /api/auth/instagram/session  -> current session status
// DELETE /api/auth/instagram/session -> log out and close the browser
//
// These endpoints take a plaintext Instagram password. There is no user model
// in this app, so they are guarded by a shared admin token and must never be
// exposed publicly. See requireAdminAuth below.

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  canAttemptInstagramSession,
  closeInstagramSession,
  getInstagramSession,
  getInstagramSessionFailure,
  initializeInstagramSession,
  installSuppliedCookies,
} from '@/services/media/InstagramSession';

/**
 * Rejects the request unless it carries the admin secret.
 *
 * Without this the route is an unauthenticated credential-accepting endpoint
 * on the public web, so a missing secret is treated as a hard failure rather
 * than an open default.
 */
function requireAdminAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.ADMIN_API_KEY;

  if (!secret) {
    return NextResponse.json(
      { error: 'Session auth is disabled: set ADMIN_API_KEY to enable it' },
      { status: 503 }
    );
  }

  const provided = request.headers.get('x-admin-key');
  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denied = requireAdminAuth(request);
  if (denied) return denied;

  let body: { username?: string; password?: string; twoFactorSecret?: string; cookies?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const { username, password, twoFactorSecret, cookies } = body;

  // Cookie installation needs no browser, so it is the only mode that works on
  // a serverless deployment - and it is the cheap way to refresh an expiring
  // session without editing environment variables and redeploying.
  if (typeof cookies === 'string' && cookies.trim().length > 0) {
    const result = await installSuppliedCookies(cookies);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const session = getInstagramSession();

    return NextResponse.json({
      success: true,
      source: session?.source ?? 'supplied-cookies',
      cookieCount: session?.cookies.length ?? 0,
      expiresAt: session?.expiresAt ?? null,
      // False when there is no database: the session then lives only in this
      // instance's memory and is lost on the next cold start.
      persisted: result.persisted,
      ...(result.warning ? { warning: result.warning } : {}),
    });
  }

  if (!username || !password) {
    return NextResponse.json(
      { error: 'Provide either "cookies" or "username" and "password".' },
      { status: 400 }
    );
  }

  try {
    const session = await initializeInstagramSession({ username, password, twoFactorSecret });

    return NextResponse.json({
      success: true,
      source: session.source,
      expiresAt: session.expiresAt,
      cookieCount: session.cookies.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Instagram login failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const denied = requireAdminAuth(request);
  if (denied) return denied;

  const session = getInstagramSession();

  return NextResponse.json({
    // `credentialsConfigured` is the field to check first. When it is false the
    // automatic fallback is inert and every auth-gated reel will fail, because
    // InstagramSession never has anything to sign in with.
    credentialsConfigured: canAttemptInstagramSession(),
    authenticated: session !== null,
    // 'supplied-cookies' needs no browser, so it is the mode that works on a
    // host where Chromium cannot be installed.
    source: session?.source ?? null,
    browserRequired: session === null || session.source === 'login',
    expiresAt: session?.expiresAt ?? null,
    cookieCount: session?.cookies.length ?? 0,
    lastFailure: getInstagramSessionFailure(),
  });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const denied = requireAdminAuth(request);
  if (denied) return denied;

  await closeInstagramSession();

  return NextResponse.json({ success: true });
}
