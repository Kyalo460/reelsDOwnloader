// GET /api/reels/download/[resolutionId]/[quality]

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { downloadService } from '@/services/media/DownloadService';
import { getRateLimiter } from '@/services/rate-limit/RateLimiter';
import logger, { logRequest, logError } from '@/lib/logger';
import { hashString, generateId } from '@/lib/utils';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resolutionId: string; quality: string }> }
) {
  const { resolutionId, quality } = await params;
  const requestId = generateId('dl_');
  const startTime = Date.now();

  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const ipHash = hashString(ipAddress);

  const requestLogger = logger.child({ requestId, ipHash, resolutionId, quality });

  try {
    // Check download rate limit
    const rateLimiter = getRateLimiter();
    const rateLimitResult = await rateLimiter.checkLimit('api:download', ipAddress);

    if (!rateLimitResult.allowed) {
      return new NextResponse('Too many download requests', {
        status: 429,
        headers: {
          'X-RateLimit-Limit': rateLimitResult.limit.toString(),
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': rateLimitResult.reset.toString(),
          'Retry-After': rateLimitResult.retryAfter?.toString() || '3600',
        },
      });
    }

    // Prepare download
    const result = await downloadService.prepareDownload({
      resolutionId,
      quality,
      ipAddress,
    });

    const latencyMs = Date.now() - startTime;

    logRequest({
      requestId,
      ipHash,
      endpoint: `/api/reels/download/${resolutionId}/${quality}`,
      method: 'GET',
      statusCode: 200,
      latencyMs,
    });

    // Return streamed response
    return new NextResponse(result.stream, {
      status: 200,
      headers: {
        ...result.headers,
        'X-RateLimit-Limit': rateLimitResult.limit.toString(),
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': rateLimitResult.reset.toString(),
        'X-Request-ID': requestId,
      },
    });
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    logError(error as Error, {
      requestId,
      ipHash,
      endpoint: `/api/reels/download/${resolutionId}/${quality}`,
      method: 'GET',
      statusCode: 500,
      latencyMs,
      errorCategory: 'download',
    });

    // Handle known errors
    if (error instanceof Error) {
      const message = error.message;

      if (message === 'NOT_FOUND') {
        return new NextResponse('Not found', { status: 404 });
      }
      if (message === 'EXPIRED') {
        return new NextResponse('Download link expired', { status: 410 });
      }
      if (message === 'FILE_TOO_LARGE') {
        return new NextResponse('File too large', { status: 413 });
      }
      if (message === 'MEDIA_UNAVAILABLE') {
        return new NextResponse('Media unavailable', { status: 404 });
      }
    }

    return new NextResponse('Internal server error', { status: 500 });
  }
}
