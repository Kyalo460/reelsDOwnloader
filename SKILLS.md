# Agent Skills & Best Practices

This document defines the skills, conventions, and best practices for AI agents working on this project. Follow these guidelines to ensure fast, correct, and production-ready code.

---

## 🎯 Core Principles

| Principle | Description |
|-----------|-------------|
| **Correctness > Speed** | Never ship code that hasn't passed typecheck, lint, and tests |
| **Explicit over Implicit** | Type everything, avoid `any`, use strict TypeScript |
| **Test First** | Write tests before or alongside implementation |
| **Small, Atomic Changes** | One logical change per commit/PR |
| **Defensive Coding** | Validate inputs, handle errors, log context |

---

## 📦 Project-Specific Conventions

### Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript 5.4+ (strict mode)
- **Database**: Prisma ORM + PostgreSQL
- **Styling**: Tailwind CSS + clsx + tailwind-merge
- **Testing**: Vitest (unit), Playwright (e2e)
- **Linting**: ESLint (Next.js config) + Prettier
- **Logging**: Pino structured logging
- **Validation**: Zod schemas

### Directory Structure
```
src/
├── app/                    # Next.js App Router pages & API routes
│   ├── api/               # API routes (REST endpoints)
│   └── (pages)/           # Page components
├── components/            # React components (PascalCase.tsx)
├── lib/                   # Shared utilities, configs, clients
├── services/              # Business logic (domain-driven)
│   ├── media/             # Media resolution providers
│   ├── validation/        # Input validation
│   ├── rate-limit/        # Rate limiting
│   ├── history/           # Download history
│   └── admin/             # Admin operations
├── types/                 # Global TypeScript types
└── middleware.ts          # Next.js middleware
```

### Naming Conventions
| Type | Convention | Example |
|------|------------|---------|
| Files (components) | PascalCase | `ReelPreview.tsx` |
| Files (utils/services) | PascalCase | `UrlValidator.ts` |
| Functions/Variables | camelCase | `resolveMediaUrl()` |
| Types/Interfaces | PascalCase | `MediaResolutionResult` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRY_ATTEMPTS` |
| Enums | PascalCase | `ProviderType` |
| Test files | `*.test.ts` / `*.test.tsx` | `UrlValidator.test.ts` |

---

## 🔧 Development Workflow

### Before Starting Work
1. **Read existing code** - Understand patterns, imports, and conventions
2. **Check for existing tests** - Extend rather than duplicate
3. **Verify dependencies** - Check `package.json` before adding new packages

### During Implementation
1. **Type first** - Define interfaces/types before implementation
2. **Validate inputs** - Use Zod schemas at API boundaries
3. **Handle errors** - Use `Result<T, E>` pattern or throw typed errors
4. **Log structured** - Use `logger.info/warn/error({ ctx, ... })`
5. **Write tests** - Unit test pure logic, integration test API routes

### Before Committing
```bash
# Run all checks (must pass)
npm run typecheck    # TypeScript strict check
npm run lint         # ESLint
npm run format:check # Prettier
npm run test         # Vitest unit tests
npm run test:e2e     # Playwright e2e tests (if applicable)
```

### Git Workflow
- **Branch naming**: `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`
- **Commit messages**: Conventional Commits (`feat: add Instagram cookie auth`)
- **PR size**: < 400 lines changed (split if larger)

---

## 🧪 Testing Standards

### Unit Tests (Vitest)
```typescript
// tests/unit/ServiceName.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ServiceName } from '@/services/ServiceName'

describe('ServiceName', () => {
  let service: ServiceName

  beforeEach(() => {
    service = new ServiceName(/* dependencies */)
  })

  describe('methodName', () => {
    it('should return expected result for valid input', () => {
      const result = service.methodName(validInput)
      expect(result).toEqual(expectedOutput)
    })

    it('should throw ValidationError for invalid input', () => {
      expect(() => service.methodName(invalidInput))
        .toThrowError(ValidationError)
    })
  })
})
```

### E2E Tests (Playwright)
```typescript
// tests/e2e/feature.test.ts
import { test, expect } from '@playwright/test'

test.describe('Feature Name', () => {
  test('user can download reel', async ({ page }) => {
    await page.goto('/')
    await page.fill('[data-testid="url-input"]', validReelUrl)
    await page.click('[data-testid="download-btn"]')
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible()
  })
})
```

### Test Coverage Targets
- **Unit**: ≥ 80% lines, ≥ 70% branches
- **Critical paths**: 100% (auth, payment, data mutation)
- **E2E**: Cover all user-facing flows

---

## 🛡️ Security & Quality Gates

### Input Validation
```typescript
// Always validate at API boundaries
import { z } from 'zod'

const resolveReelSchema = z.object({
  url: z.string().url().refine(isInstagramReelUrl, 'Must be Instagram Reel URL'),
})

export async function POST(req: Request) {
  const body = await req.json()
  const result = resolveReelSchema.safeParse(body)
  if (!result.success) {
    return Response.json({ error: result.error.flatten() }, { status: 400 })
  }
  // ... handle valid input
}
```

### Error Handling
```typescript
// Use typed errors, never throw raw strings
export class ValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
```

### Rate Limiting
- Apply rate limiting to all public API endpoints
- Use Redis-backed limiter with fallback to in-memory
- Return `429` with `Retry-After` header

### Secrets Management
- **Never** commit secrets (API keys, tokens, passwords)
- Use environment variables (`.env.local` for dev, platform secrets for prod)
- Validate required env vars at startup

---

## ⚡ Performance Guidelines

### Database (Prisma)
- Use `select`/`include` to fetch only needed fields
- Batch queries with `Promise.all` or Prisma transactions
- Add indexes for frequently queried columns
- Use connection pooling in production

### Caching
- Cache provider responses (Instagram/YouTube) with TTL
- Use `resolutionStore` for deduplication
- Set appropriate `Cache-Control` headers

### Bundle Size
- Dynamic import heavy components (`next/dynamic`)
- Tree-shake imports (`import { fn } from 'lib'`)
- Monitor with `next build` output

---

## 🐛 Debugging & Troubleshooting

### Logging
```typescript
import { logger } from '@/lib/logger'

// Good: structured, contextual
logger.info({ userId, reelUrl, provider: 'instagram' }, 'Resolving reel URL')

// Bad: string concatenation
logger.info('Resolving reel URL for ' + userId)
```

### Common Issues
| Issue | Check |
|-------|-------|
| Type errors | Run `npm run typecheck` |
| Lint failures | Run `npm run lint` |
| Test flakiness | Check for async/await issues, shared state |
| Build failures | Check Prisma generate, missing env vars |
| Runtime errors | Check logs, verify input validation |

---

## 📋 Agent Checklist (Pre-Commit)

- [ ] TypeScript compiles (`npm run typecheck`)
- [ ] ESLint passes (`npm run lint`)
- [ ] Prettier formatted (`npm run format:check`)
- [ ] Unit tests pass (`npm run test`)
- [ ] E2E tests pass (`npm run test:e2e`) if UI changes
- [ ] No `any` types (except explicit `unknown` narrowing)
- [ ] No console.log (use logger)
- [ ] No hardcoded secrets
- [ ] Input validation on all public APIs
- [ ] Error handling with typed errors
- [ ] Tests cover new logic (happy + error paths)
- [ ] Documentation updated if API changed

---

## 🔄 Continuous Improvement

### When to Update This File
- New patterns emerge in the codebase
- Tooling changes (ESLint rules, TS config, test frameworks)
- Security incidents or near-misses
- Performance regressions

### Review Cadence
- **Monthly**: Review with team for relevance
- **Per PR**: Reference in code reviews
- **Onboarding**: New agents must read and acknowledge

---

## 📚 References

- [TypeScript Strict Mode](https://www.typescriptlang.org/tsconfig#strict)
- [Next.js Best Practices](https://nextjs.org/docs/app/building-your-application/optimizing)
- [Prisma Performance](https://www.prisma.io/docs/orm/prisma-client/performance-and-optimization)
- [Vitest Guide](https://vitest.dev/guide/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Zod Validation](https://zod.dev/)
- [Conventional Commits](https://www.conventionalcommits.org/)

---

*This document is a living guide. Update it as the project evolves.*