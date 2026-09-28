# Security Documentation

## Security Principles

1. **Defense in Depth** - Multiple layers of security controls
2. **Least Privilege** - Minimal permissions for each component
3. **Fail Secure** - Default deny, explicit allow
4. **No Secrets in Code** - All secrets via environment variables
5. **Audit Trail** - Structured logging without sensitive data

## Threat Model

### Assets to Protect

- User-provided URLs (may contain private content identifiers)
- Downloaded media (temporary storage)
- User accounts and credentials (if implemented)
- Application infrastructure
- Rate limit and abuse prevention data

### Threat Actors

- Malicious users attempting abuse
- Automated scrapers/bots
- Compromised dependencies
- Infrastructure attackers

### Attack Vectors Addressed

| Vector          | Mitigation                                               |
| --------------- | -------------------------------------------------------- |
| SSRF            | Domain allowlist, private IP blocking, request timeouts  |
| Injection       | Parameterized queries, input validation, output encoding |
| XSS             | CSP headers, React auto-escaping, sanitization           |
| CSRF            | SameSite cookies, CSRF tokens (when auth added)          |
| Rate Abuse      | Multi-tier rate limiting, IP + user tracking             |
| Large File DoS  | Size limits, streaming, timeouts                         |
| Path Traversal  | No user-controlled paths, safe filename generation       |
| Info Disclosure | Structured logging filters, generic error messages       |

## SSRF Protection

### URL Validation Pipeline

```typescript
// 1. Parse and normalize URL
const parsed = new URL(userInput);

// 2. Validate protocol
if (!['https:'].includes(parsed.protocol)) {
  throw new AppError('INVALID_URL', 400, 'Only HTTPS URLs are allowed');
}

// 3. Validate domain against allowlist
const ALLOWED_DOMAINS = ['instagram.com', 'www.instagram.com'];
if (!ALLOWED_DOMAINS.includes(parsed.hostname.toLowerCase())) {
  throw new AppError('UNSUPPORTED_URL', 400, 'Domain not supported');
}

// 4. Block private IP ranges (after DNS resolution)
const ip = await dns.lookup(parsed.hostname);
if (isPrivateIP(ip)) {
  throw new AppError('NOT_PERMITTED', 451, 'Access to private networks not permitted');
}

// 5. Block localhost and metadata endpoints
const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '169.254.169.254'];
if (BLOCKED_HOSTS.includes(parsed.hostname)) {
  throw new AppError('NOT_PERMITTED', 451, 'Access to local resources not permitted');
}
```

### Private IP Detection

```typescript
function isPrivateIP(ip: string): boolean {
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^127\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/,
    /^fe80:/,
  ];
  return privateRanges.some((range) => range.test(ip));
}
```

## Input Validation

### URL Sanitization

```typescript
function sanitizeUrl(url: string): string {
  // Remove whitespace
  url = url.trim();

  // Remove fragment
  const parsed = new URL(url);
  parsed.hash = '';

  // Normalize path
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');

  return parsed.toString();
}
```

### Request Body Validation

All API endpoints use Zod schemas:

```typescript
const resolveSchema = z.object({
  url: z
    .string()
    .url('Invalid URL format')
    .max(2048, 'URL too long')
    .refine(isValidInstagramReelUrl, 'Not a valid Instagram Reel URL'),
});

function isValidInstagramReelUrl(url: string): boolean {
  const reelPatterns = [
    /^https?:\/\/(www\.)?instagram\.com\/reel\/[A-Za-z0-9_-]+\/?$/,
    /^https?:\/\/instagram\.com\/reel\/[A-Za-z0-9_-]+\/?$/,
    /^https?:\/\/(www\.)?instagram\.com\/p\/[A-Za-z0-9_-]+\/?$/,
    /^https?:\/\/instagram\.com\/p\/[A-Za-z0-9_-]+\/?$/,
  ];
  return reelPatterns.some((pattern) => pattern.test(url));
}
```

## Rate Limiting

### Implementation

```typescript
// Redis-based sliding window
interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'api:resolve': {
    windowMs: 60_000, // 1 minute
    maxRequests: 30, // 30 requests/minute
    keyPrefix: 'rl:resolve',
  },
  'api:download': {
    windowMs: 3_600_000, // 1 hour
    maxRequests: 10, // 10 downloads/hour
    keyPrefix: 'rl:download',
  },
};
```

### Key Generation

```typescript
function getRateLimitKey(identifier: string, endpoint: string): string {
  // Hash IP for privacy
  const hashed = crypto.createHash('sha256').update(identifier).digest('hex').slice(0, 16);
  return `${RATE_LIMITS[endpoint].keyPrefix}:${hashed}`;
}
```

## Secure Headers

### Next.js Middleware Headers

```typescript
const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'Referrer-Policy',
    value: 'origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://instagram.com https://*.instagram.com",
      "media-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];
```

## File Download Security

### Streaming with Size Limits

```typescript
async function streamDownload(
  sourceUrl: string,
  res: Response,
  maxSize: number = 100 * 1024 * 1024 // 100MB
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout

  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ReelDownloader/1.0' },
    });

    // Validate content type
    const contentType = response.headers.get('content-type');
    if (!contentType?.startsWith('video/')) {
      throw new AppError('MEDIA_UNAVAILABLE', 404, 'Invalid media type');
    }

    // Check content length
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > maxSize) {
      throw new AppError('NOT_PERMITTED', 451, 'File size exceeds limit');
    }

    // Stream with size enforcement
    let totalBytes = 0;
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) return;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          totalBytes += value.length;
          if (totalBytes > maxSize) {
            controller.error(new Error('File size exceeded'));
            break;
          }
          controller.enqueue(value);
        }
        controller.close();
      },
    });

    // Set headers
    res.headers.set('Content-Type', contentType || 'video/mp4');
    res.headers.set('Content-Disposition', `attachment; filename="${safeFilename}"`);
    if (contentLength) {
      res.headers.set('Content-Length', contentLength);
    }

    return stream;
  } finally {
    clearTimeout(timeout);
  }
}
```

### Safe Filename Generation

```typescript
function generateSafeFilename(title: string, quality: string, format: string): string {
  // Remove/replace dangerous characters
  const sanitized = title
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // Remove invalid chars
    .replace(/\s+/g, '-') // Spaces to hyphens
    .replace(/-+/g, '-') // Collapse hyphens
    .replace(/^-|-$/g, '') // Trim hyphens
    .slice(0, 100); // Limit length

  return `${sanitized || 'reel'}-${quality}.${format}`;
}
```

## Database Security

### Parameterized Queries (Prisma)

Prisma ORM automatically uses parameterized queries:

```typescript
// Safe - Prisma handles parameterization
const resolutions = await prisma.reelResolution.findMany({
  where: {
    userId: userId, // Parameterized
    createdAt: { gte: startDate },
  },
});

// Never do this:
const unsafe = await prisma.$queryRaw`SELECT * FROM "ReelResolution" WHERE "userId" = ${userId}`;
```

### Field-Level Encryption

For sensitive fields (if any):

```typescript
// Encryption utility for sensitive data
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!; // 32 bytes

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(encrypted: string): string {
  const [ivHex, authTagHex, encryptedHex] = encrypted.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    ENCRYPTION_KEY,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString();
}
```

## Logging Security

### Structured Logger with Redaction

```typescript
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'session',
  'creditCard',
  'ssn',
];

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.some((f) => lowerKey.includes(f))) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redact(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// Usage
logger.info(
  'Request processed',
  redact({
    requestId,
    url: request.url,
    headers: request.headers,
    body: request.body,
    user: request.user,
  })
);
```

## Dependency Security

### Audit and Update Policy

```bash
# Regular audit
npm audit

# Update dependencies
npm update

# Check for outdated
npm outdated

# Use lockfile
npm ci  # In CI/CD
```

### Allowed Registries

Only npmjs.org and approved private registries in `.npmrc`:

```
registry=https://registry.npmjs.org/
```

## Environment Variable Security

### Required Variables

```env
# .env.example
DATABASE_URL=postgresql://user:pass@localhost:5432/reeldownloader
REDIS_URL=redis://localhost:6379
APP_URL=http://localhost:3000
NODE_ENV=development

# Security
ENCRYPTION_KEY=your-32-byte-base64-encoded-key
SESSION_SECRET=your-session-secret-min-32-chars

# Rate Limiting
RATE_LIMIT_WINDOW=60
RATE_LIMIT_MAX_REQUESTS=30

# Limits
MAX_DOWNLOAD_SIZE=104857600
REQUEST_TIMEOUT=30000
```

### Production Checklist

- [ ] All secrets generated with cryptographically secure random
- [ ] `NODE_ENV=production`
- [ ] `APP_URL` uses HTTPS
- [ ] Database uses SSL/TLS
- [ ] Redis uses ACL/authentication
- [ ] Rate limits tuned for production traffic
- [ ] Error monitoring configured (Sentry, etc.)
- [ ] Log aggregation configured
- [ ] Backup and recovery tested

## Incident Response

### Security Event Logging

```typescript
function logSecurityEvent(event: SecurityEvent) {
  logger.warn('Security event', {
    eventType: event.type,
    severity: event.severity,
    ipHash: hashIp(event.ip),
    userId: event.userId,
    details: event.details,
    timestamp: new Date().toISOString(),
  });
}

// Event types
type SecurityEventType =
  | 'RATE_LIMIT_EXCEEDED'
  | 'INVALID_URL_ATTEMPT'
  | 'SSRF_ATTEMPT'
  | 'LARGE_FILE_ATTEMPT'
  | 'AUTH_FAILURE'
  | 'SUSPICIOUS_PATTERN';
```

### Automated Responses

- Rate limit exceeded → Temporary IP block (Redis TTL)
- SSRF attempt → Immediate block + alert
- Repeated failures → Progressive delays

## Compliance Considerations

- **GDPR**: IP hashing, data minimization, right to deletion
- **DMCA**: Clear policy, takedown process
- **Instagram ToS**: Only public content, no authentication bypass

## Security Testing

```bash
# Run security tests
npm run test:security

# SAST
npm run sast

# Dependency check
npm audit --audit-level=high
```

## Contact

Report security issues to: security@yourdomain.com
