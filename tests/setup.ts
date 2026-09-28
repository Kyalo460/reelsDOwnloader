// Test Setup

import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: vi.fn(),
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
    };
  },
  usePathname() {
    return '/';
  },
  useSearchParams() {
    return new URLSearchParams();
  },
}));

// Mock environment variables
vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv(
  'DATABASE_URL',
  'postgresql://postgres:postgres@localhost:5432/reel_downloader_test?schema=public'
);
vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
vi.stubEnv('APP_URL', 'http://localhost:3000');
vi.stubEnv('NEXT_TELEMETRY_DISABLED', '1');

// Global test utilities
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Suppress console.error in tests (optional)
// const originalError = console.error;
// console.error = (...args) => {
//   if (args[0]?.includes?.('Warning:')) return;
//   originalError.call(console, ...args);
// };
