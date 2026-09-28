// Rate Limiter Service - Redis-based sliding window

import Redis from 'ioredis';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
}

export class RateLimiter {
  private redis: Redis;
  private configs: Map<string, RateLimitConfig> = new Map();

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      lazyConnect: true,
    });

    this.redis.on('error', (err) => {
      console.error('Redis connection error:', err);
    });
  }

  configure(name: string, config: RateLimitConfig): void {
    this.configs.set(name, config);
  }

  async checkLimit(name: string, identifier: string): Promise<RateLimitResult> {
    const config = this.configs.get(name);
    if (!config) {
      throw new Error(`Rate limit config "${name}" not found`);
    }

    const key = `${config.keyPrefix}:${this.hashIdentifier(identifier)}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    const pipeline = this.redis.pipeline();

    // Remove expired entries
    pipeline.zremrangebyscore(key, 0, windowStart);

    // Count current requests
    pipeline.zcard(key);

    // Add current request
    pipeline.zadd(key, now, `${now}-${Math.random()}`);

    // Set expiry
    pipeline.expire(key, Math.ceil(config.windowMs / 1000) + 1);

    const results = await pipeline.exec();

    if (!results) {
      throw new Error('Redis pipeline failed');
    }

    const currentCount = (results[1]?.[1] as number) ?? 0;
    const allowed = currentCount < config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - currentCount);
    const reset = Math.ceil((now + config.windowMs) / 1000);

    return {
      allowed,
      limit: config.maxRequests,
      remaining,
      reset,
      retryAfter: allowed ? undefined : Math.ceil(config.windowMs / 1000),
    };
  }

  async getLimitInfo(name: string, identifier: string): Promise<RateLimitResult> {
    const config = this.configs.get(name);
    if (!config) {
      throw new Error(`Rate limit config "${name}" not found`);
    }

    const key = `${config.keyPrefix}:${this.hashIdentifier(identifier)}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    await this.redis.zremrangebyscore(key, 0, windowStart);
    const currentCount = await this.redis.zcard(key);

    return {
      allowed: currentCount < config.maxRequests,
      limit: config.maxRequests,
      remaining: Math.max(0, config.maxRequests - currentCount),
      reset: Math.ceil((now + config.windowMs) / 1000),
    };
  }

  async resetLimit(name: string, identifier: string): Promise<void> {
    const config = this.configs.get(name);
    if (!config) return;

    const key = `${config.keyPrefix}:${this.hashIdentifier(identifier)}`;
    await this.redis.del(key);
  }

  private hashIdentifier(identifier: string): string {
    // Hash IP for privacy
    let hash = 0;
    for (let i = 0; i < identifier.length; i++) {
      const char = identifier.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

// Default configurations
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  'api:resolve': {
    windowMs: 60_000, // 1 minute
    maxRequests: 30,
    keyPrefix: 'rl:resolve',
  },
  'api:download': {
    windowMs: 3_600_000, // 1 hour
    maxRequests: 10,
    keyPrefix: 'rl:download',
  },
  'auth:login': {
    windowMs: 900_000, // 15 minutes
    maxRequests: 5,
    keyPrefix: 'rl:login',
  },
  'auth:register': {
    windowMs: 3_600_000, // 1 hour
    maxRequests: 3,
    keyPrefix: 'rl:register',
  },
};

// Singleton instance
let rateLimiterInstance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!rateLimiterInstance) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    rateLimiterInstance = new RateLimiter(redisUrl);

    for (const [name, config] of Object.entries(DEFAULT_RATE_LIMITS)) {
      rateLimiterInstance.configure(name, config);
    }
  }
  return rateLimiterInstance;
}

export function createRateLimiter(redisUrl: string): RateLimiter {
  const limiter = new RateLimiter(redisUrl);
  for (const [name, config] of Object.entries(DEFAULT_RATE_LIMITS)) {
    limiter.configure(name, config);
  }
  return limiter;
}
