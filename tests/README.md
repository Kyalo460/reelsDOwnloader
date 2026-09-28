# Tests

## Structure

```
tests/
├── unit/           # Unit tests (Vitest)
├── integration/    # Integration tests (Vitest)
├── e2e/            # End-to-end tests (Playwright)
├── setup.ts        # Test setup and mocks
└── fixtures/       # Test fixtures and helpers
```

## Running Tests

```bash
# Unit tests
npm run test

# Unit tests with UI
npm run test:ui

# Integration tests (requires DB and Redis)
npm run test:integration

# E2E tests (requires running app)
npm run test:e2e

# E2E tests with UI
npm run test:e2e:ui
```

## Writing Tests

### Unit Tests

Place in `tests/unit/` with `.test.ts` or `.test.tsx` extension.

```typescript
// tests/unit/myFunction.test.ts
import { describe, it, expect } from 'vitest';
import { myFunction } from '@/lib/myFunction';

describe('myFunction', () => {
  it('should do something', () => {
    expect(myFunction()).toBe('expected');
  });
});
```

### Integration Tests

Place in `tests/integration/` - test API endpoints and database interactions.

### E2E Tests

Place in `tests/e2e/` - test user flows with Playwright.

## Fixtures

Shared test fixtures in `tests/fixtures/`:

```typescript
// tests/fixtures/reel.ts
export const mockReel = {
  id: 'test123',
  title: 'Test Reel',
  // ...
};
```
