// Admin Service - For admin dashboard

import { PrismaClient } from '@prisma/client';
import type { AdminMetrics } from '@/types';

const prisma = new PrismaClient();

export interface TimeRange {
  from: Date;
  to: Date;
}

export interface SystemHealth {
  database: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
}

export class AdminService {
  async getMetrics(range: TimeRange): Promise<AdminMetrics[]> {
    const metrics = await prisma.adminMetric.findMany({
      where: {
        date: {
          gte: range.from,
          lte: range.to,
        },
      },
      orderBy: { date: 'asc' },
    });

    return metrics.map((m) => ({
      ...m,
      date: m.date.toISOString().split('T')[0] as string,
      storageUsedBytes: Number(m.storageUsedBytes),
    }));
  }

  async getAggregatedMetrics(range: TimeRange): Promise<{
    totalRequests: number;
    successfulResolutions: number;
    failedResolutions: number;
    totalDownloads: number;
    rateLimitEvents: number;
    errors: number;
    avgLatencyMs: number;
  }> {
    const metrics = await prisma.adminMetric.aggregate({
      where: {
        date: {
          gte: range.from,
          lte: range.to,
        },
      },
      _sum: {
        totalRequests: true,
        successfulResolutions: true,
        failedResolutions: true,
        totalDownloads: true,
        rateLimitEvents: true,
        errors: true,
      },
      _avg: {
        avgLatencyMs: true,
      },
    });

    return {
      totalRequests: metrics._sum.totalRequests || 0,
      successfulResolutions: metrics._sum.successfulResolutions || 0,
      failedResolutions: metrics._sum.failedResolutions || 0,
      totalDownloads: metrics._sum.totalDownloads || 0,
      rateLimitEvents: metrics._sum.rateLimitEvents || 0,
      errors: metrics._sum.errors || 0,
      avgLatencyMs: metrics._avg.avgLatencyMs || 0,
    };
  }

  async getTopErrors(
    range: TimeRange,
    limit = 10
  ): Promise<
    Array<{
      errorCode: string;
      count: number;
    }>
  > {
    const errors = await prisma.reelResolution.groupBy({
      by: ['errorCode'],
      where: {
        errorCode: { not: null },
        createdAt: {
          gte: range.from,
          lte: range.to,
        },
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    return errors.map((e: { errorCode: string | null; _count: { id: number } }) => ({
      errorCode: e.errorCode || 'UNKNOWN',
      count: e._count.id,
    }));
  }

  async getRecentResolutions(limit = 50): Promise<
    Array<{
      id: string;
      shortCode: string;
      title: string | null;
      status: string;
      ipHash: string;
      userId: string | null;
      createdAt: Date;
      errorCode: string | null;
    }>
  > {
    return prisma.reelResolution.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        shortCode: true,
        title: true,
        status: true,
        ipHash: true,
        userId: true,
        createdAt: true,
        errorCode: true,
      },
    });
  }

  async getSystemHealth(): Promise<SystemHealth> {
    const dbStatus = await this.checkDatabase();
    const redisStatus = await this.checkRedis();

    return {
      database: dbStatus,
      redis: redisStatus,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };
  }

  async getStorageUsage(): Promise<{
    database: { tables: number; size: string };
    redis: { keys: number; memory: string };
  }> {
    // Database size (PostgreSQL specific)
    const dbSize = await prisma.$queryRaw<[{ size: string }]>`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `;

    const tableCount = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT count(*)::bigint as count FROM information_schema.tables 
      WHERE table_schema = 'public'
    `;

    // Redis info (would need Redis client)
    return {
      database: {
        tables: Number(tableCount[0]?.count || 0),
        size: dbSize[0]?.size || 'unknown',
      },
      redis: {
        keys: 0,
        memory: 'unknown',
      },
    };
  }

  async getActiveJobs(): Promise<
    Array<{
      id: string;
      type: string;
      status: string;
      progress: number;
      createdAt: Date;
    }>
  > {
    // This would integrate with a job queue like BullMQ
    // For now, return empty array
    return [];
  }

  private async checkDatabase(): Promise<'connected' | 'disconnected'> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return 'connected';
    } catch {
      return 'disconnected';
    }
  }

  private async checkRedis(): Promise<'connected' | 'disconnected'> {
    try {
      const redis = await import('ioredis');
      const client = new redis.default(process.env.REDIS_URL || 'redis://localhost:6379');
      await client.ping();
      await client.quit();
      return 'connected';
    } catch {
      return 'disconnected';
    }
  }

  async cleanupExpiredResolutions(): Promise<number> {
    const result = await prisma.reelResolution.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    return result.count;
  }

  async cleanupOldMetrics(daysToKeep = 90): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);

    const result = await prisma.adminMetric.deleteMany({
      where: { date: { lt: cutoff } },
    });
    return result.count;
  }
}

export const adminService = new AdminService();
