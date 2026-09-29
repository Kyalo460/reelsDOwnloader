// GET /health/ready

import { NextResponse } from 'next/server';
import Redis from 'ioredis';
import { getPrisma } from '@/lib/prisma';

export async function GET() {
  const checks: Record<string, 'connected' | 'disconnected' | 'not_configured'> = {
    database: 'disconnected',
    redis: 'disconnected',
  };

  // Check database
  const prisma = getPrisma();
  if (!prisma) {
    // Resolution and download both fall back to in-memory stores, so the app
    // still works - it just cannot share state across instances.
    checks.database = 'not_configured';
  } else {
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = 'connected';
    } catch {
      checks.database = 'disconnected';
    }
  }

  // Check Redis (rate limiting falls back to an in-process window)
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    checks.redis = 'not_configured';
  } else {
    try {
      const redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        lazyConnect: true,
      });
      await redis.connect();
      await redis.ping();
      await redis.quit();
      checks.redis = 'connected';
    } catch {
      checks.redis = 'disconnected';
    }
  }

  // Only an actual connection failure means "not ready"; an unconfigured
  // optional dependency degrades but still serves traffic.
  const allConnected = Object.values(checks).every(
    (v) => v === 'connected' || v === 'not_configured'
  );

  return NextResponse.json(
    {
      status: allConnected ? 'ready' : 'not ready',
      checks,
    },
    { status: allConnected ? 200 : 503 }
  );
}
