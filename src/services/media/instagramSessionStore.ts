// Durable storage for the Instagram session.
//
// Why this exists: a Vercel deployment is an immutable artifact, so an env var
// change only takes effect on a redeploy, and anything held in memory is
// discarded on the next cold start. Session cookies therefore have to live
// somewhere that outlives a single function invocation. This repo already runs
// Postgres through Prisma, so the session is one row read at request time -
// refreshing it is a write, not a rebuild.

import { getPrisma } from '@/lib/prisma';

/** Everything needed to replay a session, minus the cookies themselves. */
export interface StoredInstagramSession {
  cookies: string;
  userAgent?: string;
}

const SINGLETON_ID = 'default';

/**
 * Reads the stored session, or null when there is none.
 *
 * Never throws: this runs on the hot path of every authenticated resolution,
 * and a database outage should degrade to "no session" rather than fail the
 * request. The in-memory and environment sources are still tried.
 */
export async function readStoredInstagramSession(): Promise<StoredInstagramSession | null> {
  const prisma = getPrisma();
  if (!prisma) return null;

  try {
    const row = await prisma.instagramSessionStore.findUnique({
      where: { id: SINGLETON_ID },
      select: { cookies: true, userAgent: true, invalidatedAt: true },
    });

    if (!row || row.invalidatedAt || !row.cookies.trim()) return null;

    return { cookies: row.cookies, userAgent: row.userAgent ?? undefined };
  } catch {
    return null;
  }
}

/**
 * Persists a session, replacing any previous one.
 *
 * Clearing `invalidatedAt` matters: a cookie value that Instagram rejected once
 * may be replaced by a fresh export of the same account, and must not stay
 * permanently disabled.
 */
export async function writeStoredInstagramSession(
  session: StoredInstagramSession
): Promise<{ ok: true } | { ok: false; error: string }> {
  const prisma = getPrisma();
  if (!prisma) {
    return {
      ok: false,
      error:
        'DATABASE_URL is not configured, so the session cannot be stored durably. ' +
        'Set INSTAGRAM_SESSION_COOKIES in the environment as a fallback.',
    };
  }

  try {
    await prisma.instagramSessionStore.upsert({
      where: { id: SINGLETON_ID },
      update: {
        cookies: session.cookies,
        userAgent: session.userAgent ?? null,
        invalidatedAt: null,
      },
      create: {
        id: SINGLETON_ID,
        cookies: session.cookies,
        userAgent: session.userAgent ?? null,
      },
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to store the session',
    };
  }
}

/**
 * Marks the stored session as rejected by Instagram.
 *
 * Recorded rather than deleted so a rejected cookie is not silently retried on
 * every request, which would look like a working session while serving nothing.
 */
export async function invalidateStoredInstagramSession(): Promise<void> {
  const prisma = getPrisma();
  if (!prisma) return;

  try {
    await prisma.instagramSessionStore.updateMany({
      where: { id: SINGLETON_ID, invalidatedAt: null },
      data: { invalidatedAt: new Date() },
    });
  } catch {
    // Best-effort. The in-memory layer already dropped the session.
  }
}
