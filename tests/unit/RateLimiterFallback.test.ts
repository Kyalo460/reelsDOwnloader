// Rate Limiter Degraded-Mode Tests
//
// A deployment with no reachable REDIS_URL must still serve requests: the
// limiter falls back to an in-process sliding window instead of throwing.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Every Redis call in this file rejects, simulating an unreachable server.
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    pipeline: () => ({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    }),
    zremrangebyscore: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    zcard: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    del: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    quit: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    disconnect: vi.fn(),
    on: vi.fn(),
  })),
}));

import { RateLimiter, DEFAULT_RATE_LIMITS } from '@/services/rate-limit/RateLimiter';

describe('RateLimiter without Redis', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter('redis://127.0.0.1:6399');
    for (const [name, config] of Object.entries(DEFAULT_RATE_LIMITS)) {
      rateLimiter.configure(name, config);
    }
    // The fallback logs once when Redis first fails.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('allows requests instead of throwing when Redis is down', async () => {
    const result = await rateLimiter.checkLimit('api:resolve', '198.51.100.1');

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(30);
    expect(result.remaining).toBe(29);
  });

  it('still enforces the limit in memory', async () => {
    const outcomes: boolean[] = [];
    for (let i = 0; i < 31; i++) {
      outcomes.push((await rateLimiter.checkLimit('api:resolve', '198.51.100.2')).allowed);
    }

    expect(outcomes.filter(Boolean)).toHaveLength(30);
    expect(outcomes[30]).toBe(false);
  });

  it('sets Retry-After once the in-memory limit is reached', async () => {
    for (let i = 0; i < 30; i++) {
      await rateLimiter.checkLimit('api:download', '198.51.100.3');
    }

    const limited = await rateLimiter.checkLimit('api:download', '198.51.100.3');
    expect(limited.allowed).toBe(false);
    expect(limited.retryAfter).toBeGreaterThan(0);
  });

  it('tracks identifiers independently', async () => {
    await rateLimiter.checkLimit('api:resolve', '198.51.100.4');
    await rateLimiter.checkLimit('api:resolve', '198.51.100.4');

    const other = await rateLimiter.checkLimit('api:resolve', '198.51.100.5');
    expect(other.remaining).toBe(29);
  });

  it('reports limit info without incrementing', async () => {
    await rateLimiter.checkLimit('api:resolve', '198.51.100.6');
    const info = await rateLimiter.getLimitInfo('api:resolve', '198.51.100.6');

    expect(info.remaining).toBe(29);
  });

  it('resets the in-memory counter', async () => {
    await rateLimiter.checkLimit('api:resolve', '198.51.100.7');
    await rateLimiter.resetLimit('api:resolve', '198.51.100.7');

    const info = await rateLimiter.getLimitInfo('api:resolve', '198.51.100.7');
    expect(info.remaining).toBe(30);
  });

  it('does not throw when disconnecting an unreachable Redis', async () => {
    await expect(rateLimiter.disconnect()).resolves.toBeUndefined();
  });

  it('still throws for an unknown limit config', async () => {
    await expect(rateLimiter.checkLimit('unknown:config', '198.51.100.8')).rejects.toThrow();
  });
});
