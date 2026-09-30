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
  closeInstagramSession,
  getInstagramSession,
  initializeInstagramSession,
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

  let body: { username?: string; password?: string; twoFactorSecret?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const { username, password, twoFactorSecret } = body;

  if (!username || !password) {
    return NextResponse.json({ error: 'username and password are required' }, { status: 400 });
  }

  try {
    const session = await initializeInstagramSession({ username, password, twoFactorSecret });

    return NextResponse.json({
      success: true,
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
    authenticated: session !== null,
    expiresAt: session?.expiresAt ?? null,
  });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const denied = requireAdminAuth(request);
  if (denied) return denied;

  await closeInstagramSession();

  return NextResponse.json({ success: true });
}
