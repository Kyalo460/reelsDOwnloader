// Structured Logger

import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || 'info';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.token',
  'req.body.secret',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.secret',
  '*.authorization',
  '*.cookie',
];

// Note: We don't use pino-pretty transport because it uses thread-stream
// which can crash in serverless environments (Vercel)
const logger = pino({
  level: logLevel,
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  base: {
    service: 'reel-downloader',
    version: process.env.npm_package_version || '1.0.0',
  },
});

export interface LogContext {
  requestId?: string;
  userId?: string;
  ipHash?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  latencyMs?: number;
  errorCategory?: string;
  [key: string]: unknown;
}

export function createRequestLogger(context: LogContext) {
  return logger.child(context);
}

export function logRequest(context: LogContext) {
  try {
    const { requestId, ...rest } = context;
    logger.info({ requestId, ...rest }, 'HTTP Request');
  } catch {
    // Swallow logging errors to prevent crash on serverless
  }
}

export function logError(error: Error, context: LogContext) {
  try {
    const { requestId, ...rest } = context;
    logger.error(
      {
        requestId,
        err: error,
        errorMessage: error.message,
        errorStack: error.stack,
        ...rest,
      },
      'Error occurred'
    );
  } catch {
    // Swallow logging errors to prevent crash on serverless
  }
}

export function logSecurityEvent(event: {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  ipHash?: string;
  userId?: string;
  details?: Record<string, unknown>;
}) {
  try {
    logger.warn(
      {
        securityEvent: true,
        ...event,
        timestamp: new Date().toISOString(),
      },
      `Security event: ${event.type}`
    );
  } catch {
    // Swallow logging errors to prevent crash on serverless
  }
}

export function logRateLimit(context: LogContext & { limit: number; remaining: number }) {
  try {
    logger.warn(
      {
        rateLimited: true,
        ...context,
      },
      'Rate limit exceeded'
    );
  } catch {
    // Swallow logging errors to prevent crash on serverless
  }
}

export default logger;
