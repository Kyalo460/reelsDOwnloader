// POST /api/reels/resolve

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mediaResolver } from '@/services/media/MediaResolver';
import { urlValidator } from '@/services/validation/UrlValidator';
import { getRateLimiter } from '@/services/rate-limit/RateLimiter';
import logger, { logRequest, logError, logRateLimit } from '@/lib/logger';
import { hashString, generateId } from '@/lib/utils';
import type { ErrorCode } from '@/types';
import { ERROR_STATUS_MAP } from '@/types';

const resolveSchema = z.object({
  url: z.string().url('Invalid URL format').max(2048, 'URL too long'),
});

export async function POST(request: NextRequest) {
  const requestId = generateId('req_');
  const startTime = Date.now();

  // Get client IP
  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const ipHash = hashString(ipAddress);

  const requestLogger = logger.child({ requestId, ipHash });

  try {
    // Parse and validate request body
    const body = await request.json();
    const parseResult = resolveSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse(
        'INVALID_URL',
        'Invalid request body',
        { details: parseResult.error.flatten() },
        400,
        requestId
      );
    }

    const { url } = parseResult.data;

    // Validate URL
    const validation = urlValidator.validate(url);
    if (!validation.valid) {
      return errorResponse(
        (validation.error?.code as ErrorCode) || 'INVALID_URL',
        validation.error?.message || 'URL validation failed',
        { providedUrl: url },
        ERROR_STATUS_MAP[validation.error?.code as ErrorCode] || 400,
        requestId
      );
    }

    // Check rate limit
    const rateLimiter = getRateLimiter();
    const rateLimitResult = await rateLimiter.checkLimit('api:resolve', ipAddress);

    if (!rateLimitResult.allowed) {
      logRateLimit({ requestId, ipHash, endpoint: '/api/reels/resolve', ...rateLimitResult });

      return errorResponse(
        'RATE_LIMITED',
        'Too many requests. Please try again later.',
        {},
        429,
        requestId,
        rateLimitResult
      );
    }

    // Resolve media
    const result = await mediaResolver.resolve(url, {
      ipAddress,
      userId: undefined, // No auth yet
    });

    const latencyMs = Date.now() - startTime;

    logRequest({
      requestId,
      ipHash,
      endpoint: '/api/reels/resolve',
      method: 'POST',
      statusCode: 200,
      latencyMs,
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      {
        headers: {
          'X-RateLimit-Limit': rateLimitResult.limit.toString(),
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': rateLimitResult.reset.toString(),
        },
      }
    );
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    logError(error as Error, {
      requestId,
      ipHash,
      endpoint: '/api/reels/resolve',
      method: 'POST',
      statusCode: 500,
      latencyMs,
      errorCategory: 'resolution',
    });

    // Handle known errors
    if (error instanceof Error) {
      const code = (error as Error & { code?: ErrorCode }).code;
      if (code && code in ERROR_STATUS_MAP) {
        return errorResponse(code, error.message, {}, ERROR_STATUS_MAP[code], requestId);
      }
    }

    return errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', {}, 500, requestId);
  }
}

function errorResponse(
  code: ErrorCode,
  message: string,
  details: Record<string, unknown>,
  status: number,
  requestId: string,
  rateLimit?: { limit: number; remaining: number; reset: number; retryAfter?: number }
) {
  const headers: Record<string, string> = {
    'X-Request-ID': requestId,
  };

  if (rateLimit) {
    headers['X-RateLimit-Limit'] = rateLimit.limit.toString();
    headers['X-RateLimit-Remaining'] = rateLimit.remaining.toString();
    headers['X-RateLimit-Reset'] = rateLimit.reset.toString();
    if (rateLimit.retryAfter) {
      headers['Retry-After'] = rateLimit.retryAfter.toString();
    }
  }

  return NextResponse.json(
    {
      success: false,
      error: { code, message, details },
    },
    { status, headers }
  );
}
