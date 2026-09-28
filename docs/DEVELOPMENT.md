# Development Guide

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/instagram-reel-downloader.git
cd instagram-reel-downloader

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# Required: DATABASE_URL, REDIS_URL, ENCRYPTION_KEY, SESSION_SECRET

# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate

# (Optional) Seed database with demo data
npm run db:seed

# Start development server
npm run dev
```

### Using Docker

```bash
# Start all services
docker-compose up -d

# Run migrations
docker-compose exec app npx prisma migrate deploy

# Seed database
docker-compose exec app npm run db:seed

# View logs
docker-compose logs -f app
```

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   │   ├── reels/         # Reel endpoints
│   │   └── health/        # Health checks
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Home page
│   └── globals.css        # Global styles
├── components/            # React components
├── lib/                   # Utilities and configurations
├── services/              # Business logic services
│   ├── media/             # Media provider abstraction
│   ├── validation/        # Input validation
│   ├── rate-limit/        # Rate limiting
│   ├── history/           # Download history
│   └── admin/             # Admin dashboard
├── types/                 # TypeScript type definitions
└── hooks/                 # Custom React hooks
```

## Development Workflow

### Code Quality

```bash
# Run linter
npm run lint

# Fix linting issues
npm run lint -- --fix

# Type checking
npm run typecheck

# Format code
npm run format

# Check formatting
npm run format:check
```

### Testing

```bash
# Run unit tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with UI
npm run test:ui

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e

# Run E2E tests with UI
npm run test:e2e:ui
```

### Database

```bash
# Generate Prisma client
npm run db:generate

# Push schema changes (development)
npm run db:push

# Create migration
npm run db:migrate

# Deploy migrations (production)
npm run db:migrate:deploy

# Open Prisma Studio
npm run db:studio

# Seed database
npm run db:seed
```

### Git Hooks

Husky is configured to run on commit:

```bash
# Install hooks
npm run prepare
```

Pre-commit hooks:

- Lint staged files
- Format staged files
- Type check

## Environment Variables

| Variable                  | Description                   | Default                 |
| ------------------------- | ----------------------------- | ----------------------- |
| `DATABASE_URL`            | PostgreSQL connection string  | Required                |
| `REDIS_URL`               | Redis connection string       | Required                |
| `APP_URL`                 | Public application URL        | `http://localhost:3000` |
| `NODE_ENV`                | Environment                   | `development`           |
| `ENCRYPTION_KEY`          | 32-byte encryption key        | Required                |
| `SESSION_SECRET`          | Session secret (min 32 chars) | Required                |
| `MAX_DOWNLOAD_SIZE`       | Max download size in bytes    | `104857600` (100MB)     |
| `RATE_LIMIT_WINDOW`       | Rate limit window (seconds)   | `60`                    |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window       | `30`                    |
| `LOG_LEVEL`               | Log level                     | `info`                  |
| `LOG_PRETTY`              | Pretty print logs             | `true`                  |

Generate secure keys:

```bash
# Encryption key (32 bytes)
openssl rand -base64 32

# Session secret
openssl rand -base64 48
```

## Adding New Providers

1. Create a new provider class extending `BaseMediaProvider`:

```typescript
// src/services/media/MyProvider.ts
import { BaseMediaProvider } from './MediaProvider';

export class MyProvider extends BaseMediaProvider {
  readonly name = 'MyProvider';
  readonly supportedDomains = ['example.com'];

  protected extractIdentifier(url: string): string | null {
    // Extract media ID from URL
  }

  protected async fetchMediaInfo(url: string): Promise<MediaResolutionResult> {
    // Fetch media metadata
  }

  protected createDownloadUrl(resolutionId: string, quality: string): string {
    // Return download URL
  }
}
```

2. Register the provider:

```typescript
// In the provider file or a central registration file
import { providerRegistry } from './MediaProvider';
providerRegistry.register(new MyProvider());
```

## Adding New API Endpoints

1. Create route file in `src/app/api/`:

```typescript
// src/app/api/my-endpoint/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  return NextResponse.json({ message: 'Hello' });
}
```

2. Add validation, rate limiting, and error handling following existing patterns.

## Debugging

### VS Code Debug Configuration

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Next.js: Debug",
      "type": "node-terminal",
      "request": "launch",
      "command": "npm run dev"
    },
    {
      "name": "Next.js: Debug Tests",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run"],
      "console": "integratedTerminal"
    }
  ]
}
```

### Database Debugging

```bash
# Open Prisma Studio
npm run db:studio

# View database logs
docker-compose logs -f db
```

### Redis Debugging

```bash
# Connect to Redis CLI
docker-compose exec redis redis-cli

# Monitor commands
redis-cli MONITOR
```

## Common Issues

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Database Connection Failed

```bash
# Check if PostgreSQL is running
docker-compose ps db

# Restart database
docker-compose restart db
```

### Prisma Client Out of Sync

```bash
# Regenerate client
npm run db:generate

# If schema changed, create migration
npm run db:migrate
```

### TypeScript Errors

```bash
# Restart TypeScript server in VS Code
Cmd+Shift+P -> "TypeScript: Restart TS Server"
```

## Performance Profiling

```bash
# Build with profiling
NODE_ENV=production npm run build

# Analyze bundle
npx @next/bundle-analyzer
```

## Useful Commands

```bash
# Clean build artifacts
rm -rf .next node_modules/.cache

# Reset database (development)
docker-compose down -v && docker-compose up -d && npm run db:migrate && npm run db:seed

# Update dependencies
npm update

# Check outdated packages
npm outdated

# Audit dependencies
npm run security:audit
```
