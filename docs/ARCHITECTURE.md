# Architecture Documentation

## System Overview

The Instagram Reel Downloader is a modern web application built with a modular, provider-based architecture that separates concerns between the frontend, backend API, media resolution, and data persistence layers.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Browser                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Landing    │  │  Preview    │  │  Download               │  │
│  │  Page       │──▶│  Component  │──▶│  Handler              │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Next.js Application                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Frontend   │  │  API Routes │  │  Middleware             │  │
│  │  (React)    │  │  (REST)     │  │  (Auth, Rate Limit)     │  │
│  └─────────────┘  └──────┬──────┘  └─────────────────────────┘  │
└──────────────────────────┼──────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │ PostgreSQL  │ │   Redis     │ │  Provider   │
    │  (Prisma)   │ │  (Cache/    │ │  Services   │
    │             │ │   Queue)    │ │             │
    └─────────────┘ └─────────────┘ └──────┬──────┘
                                           │
                              ┌────────────┴────────────┐
                              ▼                         ▼
                       ┌─────────────┐           ┌─────────────┐
                       │Instagram    │           │  Future     │
                       │Provider     │           │  Providers  │
                       └─────────────┘           └─────────────┘
```

## Core Components

### 1. Media Provider Abstraction

The `MediaProvider` interface defines the contract for all media sources:

```typescript
interface MediaProvider {
  readonly name: string;
  readonly supportedDomains: string[];

  validateUrl(url: string): Promise<ValidationResult>;
  resolveMedia(url: string): Promise<MediaResolutionResult>;
  getDownloadStream(mediaId: string): Promise<ReadableStream>;
}
```

**InstagramProvider** implements this interface using only legitimate, publicly accessible methods.

### 2. Service Layer

```
services/
├── media/
│   ├── MediaProvider.ts          # Interface definition
│   ├── InstagramProvider.ts      # Instagram implementation
│   ├── MediaResolver.ts          # Orchestrates resolution
│   └── DownloadService.ts        # Handles streaming downloads
├── validation/
│   └── UrlValidator.ts           # URL validation & sanitization
├── rate-limit/
│   └── RateLimiter.ts            # Redis-based rate limiting
├── history/
│   └── HistoryService.ts         # Download history management
└── admin/
    └── AdminService.ts           # Admin dashboard metrics
```

### 3. Database Schema (Prisma)

```prisma
model ReelResolution {
  id            String    @id @default(cuid())
  url           String    @unique
  shortCode     String    @unique
  title         String?
  thumbnailUrl  String?
  duration      Int?
  status        ResolutionStatus @default(PENDING)
  media         Json      // Array of media variants
  errorCode     String?
  errorMessage  String?
  ipHash        String    // Hashed for privacy
  userId        String?   // Optional, for authenticated users
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  expiresAt     DateTime  // For cleanup
  downloads     Download[]
}

model Download {
  id              String   @id @default(cuid())
  resolutionId    String
  resolution      ReelResolution @relation(fields: [resolutionId], references: [id])
  mediaQuality    String
  mediaFormat     String
  fileSize        BigInt?
  ipHash          String
  userId          String?
  createdAt       DateTime @default(now())
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String
  emailVerified DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  resolutions   ReelResolution[]
  downloads     Download[]
  sessions      Session[]
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())
}

model AdminMetric {
  id          String   @id @default(cuid())
  date        DateTime @db.Date
  totalRequests     Int    @default(0)
  successfulResolutions Int @default(0)
  failedResolutions   Int    @default(0)
  totalDownloads      Int    @default(0)
  rateLimitEvents     Int    @default(0)
  errors              Int      @default(0)
  avgLatencyMs        Float    @default(0)
  storageUsedBytes    BigInt   @default(0)
  @@unique([date])
}

enum ResolutionStatus {
  PENDING
  RESOLVED
  FAILED
  EXPIRED
  PRIVATE
  NOT_PERMITTED
}
```

### 4. API Contract

#### POST /api/reels/resolve

```typescript
// Request
interface ResolveRequest {
  url: string;
}

// Success Response
interface ResolveResponse {
  success: true;
  data: {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
    media: MediaVariant[];
  };
}

// Error Response
interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

type ErrorCode =
  | 'INVALID_URL'
  | 'NOT_FOUND'
  | 'PRIVATE_CONTENT'
  | 'RATE_LIMITED'
  | 'NOT_PERMITTED'
  | 'INTERNAL_ERROR'
  | 'MEDIA_UNAVAILABLE'
  | 'UNSUPPORTED_URL';
```

#### GET /api/reels/download/:resolutionId/:quality

Streams the media file with proper headers.

### 5. Security Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    Security Layers                          │
├────────────────────────────────────────────────────────────┤
│  Network          │  TLS, Security Headers, CORS           │
│  Application      │  Input Validation, SSRF Protection     │
│  Rate Limiting    │  IP-based, User-based, Endpoint-specific│
│  Data             │  Encryption at rest, Field encryption  │
│  Audit            │  Structured logging, No secrets in logs│
└────────────────────────────────────────────────────────────┘
```

#### SSRF Protection

- Validate URLs against allowlist of domains
- Block private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8)
- Block localhost and metadata endpoints
- Enforce HTTPS for external requests

#### Rate Limiting Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                    Rate Limit Tiers                          │
├─────────────────┬──────────────┬──────────────┬──────────────┤
│ Tier            │ Window       │ Max Requests │ Scope        │
├─────────────────┼──────────────┼──────────────┼──────────────┤
│ Anonymous API   │ 60 seconds   │ 30           │ IP           │
│ Anonymous DL    │ 3600 seconds │ 10           │ IP           │
│ Authenticated   │ 60 seconds   │ 100          │ User ID      │
│ Authenticated DL│ 3600 seconds │ 50           │ User ID      │
└─────────────────┴──────────────┴──────────────┴──────────────┘
```

### 6. Error Handling Strategy

All errors flow through a centralized error handler:

```typescript
class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    public readonly message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

// Error codes map to HTTP status codes
const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  INVALID_URL: 400,
  NOT_FOUND: 404,
  PRIVATE_CONTENT: 403,
  RATE_LIMITED: 429,
  NOT_PERMITTED: 451,
  MEDIA_UNAVAILABLE: 404,
  UNSUPPORTED_URL: 400,
  INTERNAL_ERROR: 500,
};
```

### 7. Observability

#### Structured Logging

```json
{
  "requestId": "req_abc123",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "endpoint": "/api/reels/resolve",
  "method": "POST",
  "statusCode": 200,
  "latencyMs": 145,
  "ipHash": "sha256:...",
  "userId": "user_123",
  "errorCategory": null
}
```

#### Health Endpoints

- `GET /health` - Basic liveness check
- `GET /health/ready` - Readiness check (DB, Redis connectivity)
- `GET /health/live` - Liveness check for Kubernetes

### 8. Deployment Architecture

```
                    ┌─────────────────┐
                    │   Load Balancer  │
                    │   (nginx/ALB)    │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         ┌─────────┐   ┌─────────┐   ┌─────────┐
         │ App #1  │   │ App #2  │   │ App #3  │
         │ (Next.js)│  │(Next.js)│  │(Next.js)│
         └────┬────┘   └────┬────┘   └────┬────┘
              │             │             │
              └─────────────┼─────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
         ┌─────────┐   ┌─────────┐   ┌─────────┐
         │Primary  │   │ Replica │   │  Redis  │
         │Postgres │   │ Postgres│   │ Cluster │
         └─────────┘   └─────────┘   └─────────┘
```

### 9. Data Flow: URL Resolution

```
User Input URL
      │
      ▼
┌─────────────────┐
│ Validate URL    │── Invalid ──▶ 400 INVALID_URL
│ (format, domain)│
└────────┬────────┘
         │ Valid
         ▼
┌─────────────────┐
│ Check Rate Limit│── Exceeded ──▶ 429 RATE_LIMITED
└────────┬────────┘
         │ OK
         ▼
┌─────────────────┐
│ Check Cache     │── Hit ──▶ Return Cached
│ (Redis)         │
└────────┬────────┘
         │ Miss
         ▼
┌─────────────────┐
│ Select Provider │── No Provider ──▶ 400 UNSUPPORTED_URL
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Provider        │── Private ──▶ 403 PRIVATE_CONTENT
│ .validateUrl()  │   Not Found ──▶ 404 NOT_FOUND
│                 │   Not Permitted▶ 451 NOT_PERMITTED
└────────┬────────┘
         │ Valid
         ▼
┌─────────────────┐
│ Provider        │── Error ──▶ 500/404/451
│ .resolveMedia() │
└────────┬────────┘
         │ Success
         ▼
┌─────────────────┐
│ Cache Result    │
│ (Redis, TTL)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Persist to DB   │
└────────┬────────┘
         │
         ▼
    Return Response
```

### 10. Known Limitations

1. **Instagram Private Content** - Cannot access private accounts or age-restricted content without authentication
2. **Rate Limits** - Instagram's public endpoints have strict rate limits
3. **Content Changes** - Instagram may change public APIs without notice
4. **Regional Restrictions** - Some content may be geo-blocked
5. **DRM Protected** - Cannot download DRM-protected content

The provider abstraction allows graceful degradation when Instagram changes its public interfaces.
