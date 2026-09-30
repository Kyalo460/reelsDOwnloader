// API route to initialize Instagram cookie-based authentication
//
// POST /api/auth/instagram/cookie
// Body: { username: string, password: string, twoFactorSecret?: string }

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  initializeCookieProvider,
  getCookieProvider,
} from '@/services/media/InstagramCookieProvider';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { username, password, twoFactorSecret } = body;

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }

    const provider = await initializeCookieProvider({
      username,
      password,
      twoFactorSecret,
    });

    const session = provider.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Failed to establish session' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Instagram cookie authentication initialized',
      sessionExpiresAt: session.expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  const provider = getCookieProvider();
  const session = provider?.getSession();

  return NextResponse.json({
    authenticated: !!session,
    sessionExpiresAt: session?.expiresAt || null,
  });
}
