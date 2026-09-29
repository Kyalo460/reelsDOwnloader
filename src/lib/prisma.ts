// Shared Prisma client
//
// Every route and service used to build its own `new PrismaClient()`. Each
// client owns a connection pool, so on serverless that means one pool per
// module per cold start and Postgres runs out of connections. A single
// lazily-created client keeps the pool bounded.
//
// `DATABASE_URL` is also treated as optional. Resolution itself needs no
// database - it is only a cache, a place to keep the located media URL and a
// metrics sink - so a deployment without one degrades to the in-memory stores
// instead of throwing on every request.

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient | null };

function createClient(): PrismaClient | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

/** The shared client, or null when no `DATABASE_URL` is configured. */
export function getPrisma(): PrismaClient | null {
  if (globalForPrisma.prisma === undefined) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

/** True when a database is configured and the shared client is available. */
export function isDatabaseConfigured(): boolean {
  return getPrisma() !== null;
}

/**
 * The shared client, for the admin/history paths that have no useful degraded
 * mode. Throws a clear error instead of Prisma's own "environment variable not
 * found" so the cause is obvious in the logs.
 */
export function requirePrisma(): PrismaClient {
  const prisma = getPrisma();
  if (!prisma) {
    throw new Error('DATABASE_URL is not configured');
  }
  return prisma;
}
