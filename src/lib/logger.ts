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

const logger = pino({
  level: logLevel,
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
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
  const { requestId, ...rest } = context;
  logger.info({ requestId, ...rest }, 'HTTP Request');
}

export function logError(error: Error, context: LogContext) {
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
}

export function logSecurityEvent(event: {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  ipHash?: string;
  userId?: string;
  details?: Record<string, unknown>;
}) {
  logger.warn(
    {
      securityEvent: true,
      ...event,
      timestamp: new Date().toISOString(),
    },
    `Security event: ${event.type}`
  );
}

export function logRateLimit(context: LogContext & { limit: number; remaining: number }) {
  logger.warn(
    {
      rateLimited: true,
      ...context,
    },
    'Rate limit exceeded'
  );
}

export default logger;
