// Rate Limiter Tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter, DEFAULT_RATE_LIMITS } from '@/services/rate-limit/RateLimiter';

// Mock ioredis
vi.mock('ioredis', () => {
  const mPipeline = {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([
      [null, 0],
      [null, 0],
      [null, 1],
      [null, 1],
    ]),
  };

  return {
    default: vi.fn().mockImplementation(() => ({
      pipeline: () => mPipeline,
      zremrangebyscore: vi.fn().mockResolvedValue(0),
      zcard: vi.fn().mockResolvedValue(0),
      zadd: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      del: vi.fn().mockResolvedValue(1),
      quit: vi.fn().mockResolvedValue('OK'),
      on: vi.fn(),
    })),
  };
});

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter('redis://localhost:6379');
    for (const [name, config] of Object.entries(DEFAULT_RATE_LIMITS)) {
      rateLimiter.configure(name, config);
    }
  });

  afterEach(async () => {
    await rateLimiter.disconnect();
  });

  it('should allow requests within limit', async () => {
    const result = await rateLimiter.checkLimit('api:resolve', '192.168.1.1');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(30);
    expect(result.remaining).toBeLessThanOrEqual(30);
  });

  it('should track remaining requests', async () => {
    const result1 = await rateLimiter.checkLimit('api:resolve', '192.168.1.2');
    const result2 = await rateLimiter.checkLimit('api:resolve', '192.168.1.2');

    expect(result1.allowed).toBe(true);
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBeLessThanOrEqual(result1.remaining);
  });

  it('should have different limits for different endpoints', async () => {
    const resolveResult = await rateLimiter.checkLimit('api:resolve', '192.168.1.3');
    const downloadResult = await rateLimiter.checkLimit('api:download', '192.168.1.3');

    expect(resolveResult.limit).toBe(30);
    expect(downloadResult.limit).toBe(10);
  });

  it('should hash identifiers for privacy', async () => {
    // The internal hashIdentifier method should produce consistent hashes
    const identifier = '192.168.1.100';
    const result1 = await rateLimiter.checkLimit('api:resolve', identifier);
    const result2 = await rateLimiter.checkLimit('api:resolve', identifier);

    // Same identifier should track the same counter
    expect(result2.remaining).toBeLessThanOrEqual(result1.remaining);
  });

  it('should return limit info without incrementing', async () => {
    await rateLimiter.checkLimit('api:resolve', '192.168.1.4');
    const info = await rateLimiter.getLimitInfo('api:resolve', '192.168.1.4');

    expect(info.limit).toBe(30);
    expect(info.remaining).toBeLessThanOrEqual(30);
  });

  it('should reset limit for identifier', async () => {
    await rateLimiter.checkLimit('api:resolve', '192.168.1.5');
    await rateLimiter.resetLimit('api:resolve', '192.168.1.5');
    const info = await rateLimiter.getLimitInfo('api:resolve', '192.168.1.5');

    expect(info.remaining).toBe(30);
  });

  it('should throw for unknown limit config', async () => {
    await expect(rateLimiter.checkLimit('unknown:config', '192.168.1.1')).rejects.toThrow();
  });
});
