// GET /health/ready

import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();

export async function GET() {
  const checks: Record<string, 'connected' | 'disconnected'> = {
    database: 'disconnected',
    redis: 'disconnected',
  };

  // Check database
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'connected';
  } catch {
    checks.database = 'disconnected';
  }

  // Check Redis
  try {
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
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

  const allConnected = Object.values(checks).every((v) => v === 'connected');

  return NextResponse.json(
    {
      status: allConnected ? 'ready' : 'not ready',
      checks,
    },
    { status: allConnected ? 200 : 503 }
  );
}
