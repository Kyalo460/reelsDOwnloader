// Rate Limiter Service - Redis-based sliding window
//
// Redis is the primary store for rate limit counters, but a deployment without
// a reachable `REDIS_URL` must not take the API down with it: an unavailable
// limiter degrades to an in-process sliding window rather than failing the
// request. On serverless that fallback is per warm instance, so it is a safety
// net, not a distributed limit.

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
  /** Sliding window used when Redis is unavailable. */
  private fallback: MemorySlidingWindow = new MemorySlidingWindow();
  /** Latched once Redis has failed, so we stop paying the connection timeout. */
  private redisUnavailable = false;

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

    // An unreachable limiter must not fail the request it is protecting, so
    // Redis errors fall through to the in-process window.
    if (!this.redisUnavailable) {
      try {
        return await this.checkLimitWithRedis(key, config, now, windowStart);
      } catch (error) {
        this.redisUnavailable = true;
        console.error('Redis unavailable, falling back to in-memory rate limiting:', error);
      }
    }

    return this.fallback.checkLimit(key, config, now);
  }

  private async checkLimitWithRedis(
    key: string,
    config: RateLimitConfig,
    now: number,
    windowStart: number
  ): Promise<RateLimitResult> {
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

    return this.buildResult(config, currentCount, now);
  }

  async getLimitInfo(name: string, identifier: string): Promise<RateLimitResult> {
    const config = this.configs.get(name);
    if (!config) {
      throw new Error(`Rate limit config "${name}" not found`);
    }

    const key = `${config.keyPrefix}:${this.hashIdentifier(identifier)}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    if (!this.redisUnavailable) {
      try {
        await this.redis.zremrangebyscore(key, 0, windowStart);
        const currentCount = await this.redis.zcard(key);
        return this.buildResult(config, currentCount, now);
      } catch (error) {
        this.redisUnavailable = true;
        console.error('Redis unavailable, falling back to in-memory rate limiting:', error);
      }
    }

    return this.fallback.getLimitInfo(key, config, now);
  }

  async resetLimit(name: string, identifier: string): Promise<void> {
    const config = this.configs.get(name);
    if (!config) return;

    const key = `${config.keyPrefix}:${this.hashIdentifier(identifier)}`;

    if (!this.redisUnavailable) {
      try {
        await this.redis.del(key);
      } catch (error) {
        this.redisUnavailable = true;
        console.error('Redis unavailable, falling back to in-memory rate limiting:', error);
      }
    }

    this.fallback.reset(key);
  }

  private buildResult(config: RateLimitConfig, currentCount: number, now: number): RateLimitResult {
    const allowed = currentCount < config.maxRequests;

    return {
      allowed,
      limit: config.maxRequests,
      remaining: Math.max(0, config.maxRequests - currentCount),
      reset: Math.ceil((now + config.windowMs) / 1000),
      retryAfter: allowed ? undefined : Math.ceil(config.windowMs / 1000),
    };
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
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

/**
 * In-process sliding window with the same semantics as the Redis one: entries
 * older than the window are dropped, and a request is only counted when the
 * window still has room.
 */
class MemorySlidingWindow {
  private readonly hits: Map<string, number[]> = new Map();

  checkLimit(key: string, config: RateLimitConfig, now: number): RateLimitResult {
    const timestamps = this.prune(key, config.windowMs, now);

    if (timestamps.length >= config.maxRequests) {
      return {
        allowed: false,
        limit: config.maxRequests,
        remaining: 0,
        reset: Math.ceil(((timestamps[0] ?? now) + config.windowMs) / 1000),
        retryAfter: Math.ceil(config.windowMs / 1000),
      };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);

    return {
      allowed: true,
      limit: config.maxRequests,
      remaining: config.maxRequests - timestamps.length,
      reset: Math.ceil((now + config.windowMs) / 1000),
    };
  }

  getLimitInfo(key: string, config: RateLimitConfig, now: number): RateLimitResult {
    const timestamps = this.prune(key, config.windowMs, now);
    const count = timestamps.length;

    return {
      allowed: count < config.maxRequests,
      limit: config.maxRequests,
      remaining: Math.max(0, config.maxRequests - count),
      reset: Math.ceil((now + config.windowMs) / 1000),
    };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(key: string, windowMs: number, now: number): number[] {
    const cutoff = now - windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((time) => time > cutoff);

    if (timestamps.length) {
      this.hits.set(key, timestamps);
    } else {
      this.hits.delete(key);
    }

    return timestamps;
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
