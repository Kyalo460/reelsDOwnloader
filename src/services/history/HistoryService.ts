// History Service - For authenticated users

import { requirePrisma } from '@/lib/prisma';
import type { DownloadHistoryEntry, PaginatedResponse } from '@/types';

export interface HistoryOptions {
  userId: string;
  page?: number;
  pageSize?: number;
}

export class HistoryService {
  private readonly defaultPageSize = 20;
  private readonly maxPageSize = 100;

  /** History is a database-only feature: there is no useful degraded mode. */
  private get prisma() {
    return requirePrisma();
  }

  async getHistory(options: HistoryOptions): Promise<PaginatedResponse<DownloadHistoryEntry>> {
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(
      this.maxPageSize,
      Math.max(1, options.pageSize || this.defaultPageSize)
    );
    const skip = (page - 1) * pageSize;

    const [resolutions, total] = await Promise.all([
      requirePrisma().reelResolution.findMany({
        where: { userId: options.userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          downloads: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      requirePrisma().reelResolution.count({
        where: { userId: options.userId },
      }),
    ]);

    const data: DownloadHistoryEntry[] = resolutions.map(
      (r: {
        id: string;
        url: string;
        title: string | null;
        thumbnailUrl: string | null;
        downloads: Array<{
          mediaQuality: string;
          mediaFormat: string;
          fileSize: bigint | null;
          createdAt: Date;
        }>;
        createdAt: Date;
      }) => {
        const latestDownload = r.downloads[0];
        return {
          id: r.id,
          url: r.url,
          title: r.title || 'Untitled',
          thumbnail: r.thumbnailUrl || '',
          quality: latestDownload?.mediaQuality || 'unknown',
          format: latestDownload?.mediaFormat || 'unknown',
          fileSize: latestDownload?.fileSize ? Number(latestDownload.fileSize) : undefined,
          downloadedAt: latestDownload?.createdAt || r.createdAt,
        };
      }
    );

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async deleteEntry(userId: string, resolutionId: string): Promise<boolean> {
    const result = await requirePrisma().reelResolution.deleteMany({
      where: {
        id: resolutionId,
        userId,
      },
    });

    return result.count > 0;
  }

  async clearHistory(userId: string): Promise<number> {
    const result = await requirePrisma().reelResolution.deleteMany({
      where: { userId },
    });

    return result.count;
  }

  async getStats(userId: string): Promise<{
    totalResolutions: number;
    totalDownloads: number;
    totalSize: number;
  }> {
    const [resolutions, downloads] = await Promise.all([
      requirePrisma().reelResolution.count({ where: { userId } }),
      requirePrisma().download.aggregate({
        where: { userId },
        _count: { id: true },
        _sum: { fileSize: true },
      }),
    ]);

    return {
      totalResolutions: resolutions,
      totalDownloads: downloads._count.id || 0,
      totalSize: Number(downloads._sum.fileSize || 0),
    };
  }
}

export const historyService = new HistoryService();
