# API Documentation

## Base URL

```
Development: http://localhost:3000/api
Production:  https://your-domain.com/api
```

## Authentication

Currently, the API is public and does not require authentication for basic usage. Optional user accounts can be added for history tracking.

## Endpoints

### Resolve Reel URL

Resolve an Instagram Reel URL and retrieve metadata and download options.

**Endpoint:** `POST /api/reels/resolve`

**Headers:**

```
Content-Type: application/json
```

**Request Body:**

```json
{
  "url": "https://www.instagram.com/reel/ABC123/"
}
```

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "id": "cm1abc123def456",
    "title": "Amazing Reel Title",
    "thumbnail": "https://instagram.fxxx-1.fna.fbcdn.net/...",
    "duration": 30,
    "media": [
      {
        "quality": "HD",
        "format": "mp4",
        "downloadUrl": "/api/reels/download/cm1abc123def456/hd",
        "fileSize": 5242880
      },
      {
        "quality": "SD",
        "format": "mp4",
        "downloadUrl": "/api/reels/download/cm1abc123def456/sd",
        "fileSize": 2097152
      }
    ]
  }
}
```

**Error Responses:**

| Status | Code                | Description                                    |
| ------ | ------------------- | ---------------------------------------------- |
| 400    | `INVALID_URL`       | URL format is invalid                          |
| 400    | `UNSUPPORTED_URL`   | URL is not a supported Instagram Reel          |
| 403    | `PRIVATE_CONTENT`   | Content is from a private account              |
| 404    | `NOT_FOUND`         | Reel not found or deleted                      |
| 404    | `MEDIA_UNAVAILABLE` | Media cannot be accessed                       |
| 429    | `RATE_LIMITED`      | Too many requests                              |
| 451    | `NOT_PERMITTED`     | Content cannot be legally/technically accessed |
| 500    | `INTERNAL_ERROR`    | Server error                                   |

**Error Response Format:**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_URL",
    "message": "The provided URL is not a valid Instagram Reel URL",
    "details": {
      "providedUrl": "https://example.com/invalid"
    }
  }
}
```

---

### Download Media

Stream download a resolved media file.

**Endpoint:** `GET /api/reels/download/:resolutionId/:quality`

**Path Parameters:**

- `resolutionId` - ID from resolve response
- `quality` - Quality variant (`hd`, `sd`, `original`)

**Headers (Response):**

```
Content-Type: video/mp4
Content-Disposition: attachment; filename="reel-title-hd.mp4"
Content-Length: 5242880
Accept-Ranges: bytes
Cache-Control: private, max-age=3600
```

**Response:** Binary video stream

**Error Responses:**

| Status | Code             | Description                     |
| ------ | ---------------- | ------------------------------- |
| 404    | `NOT_FOUND`      | Resolution or quality not found |
| 410    | `EXPIRED`        | Download link has expired       |
| 429    | `RATE_LIMITED`   | Download rate limit exceeded    |
| 500    | `INTERNAL_ERROR` | Server error                    |

---

### Health Check

Basic health check endpoint.

**Endpoint:** `GET /health`

**Response (200):**

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0",
  "uptime": 3600
}
```

---

### Readiness Check

Checks if all dependencies are available.

**Endpoint:** `GET /health/ready`

**Response (200):**

```json
{
  "status": "ready",
  "checks": {
    "database": "connected",
    "redis": "connected"
  }
}
```

**Response (503):**

```json
{
  "status": "not ready",
  "checks": {
    "database": "connected",
    "redis": "disconnected"
  }
}
```

---

### Liveness Check

Kubernetes liveness probe.

**Endpoint:** `GET /health/live`

**Response (200):**

```json
{
  "status": "alive"
}
```

---

## Rate Limit Headers

All API responses include rate limit headers:

```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 29
X-RateLimit-Reset: 1705315800
Retry-After: 45  (only on 429 responses)
```

---

## Supported URL Formats

The resolver accepts these Instagram Reel URL formats:

```
https://www.instagram.com/reel/ABC123/
https://www.instagram.com/reel/ABC123
https://instagram.com/reel/ABC123/
https://instagram.com/reel/ABC123
https://www.instagram.com/p/ABC123/        (also works for posts with video)
https://instagram.com/p/ABC123/
```

Short codes are alphanumeric with underscores and hyphens: `[A-Za-z0-9_-]+`

---

## Media Variants

| Quality    | Format | Typical Resolution | Use Case        |
| ---------- | ------ | ------------------ | --------------- |
| `original` | mp4    | Source quality     | Best quality    |
| `hd`       | mp4    | 720p-1080p         | High quality    |
| `sd`       | mp4    | 480p               | Lower bandwidth |

File sizes are estimated and may vary.

---

## Download Filename Format

Files are named using: `{sanitized-title}-{quality}.{format}`

Examples:

- `amazing-reel-title-hd.mp4`
- `my-video-original.mp4`

Special characters are removed, spaces replaced with hyphens.

---

## Webhooks (Future)

Webhook notifications for async processing (planned):

```
POST /webhooks/reel-resolved
Content-Type: application/json
Signature: sha256=...

{
  "event": "reel.resolved",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "data": {
    "resolutionId": "cm1abc123",
    "status": "completed",
    "media": [...]
  }
}
```

---

## SDK Usage Example

```typescript
// TypeScript/JavaScript
async function downloadReel(url: string) {
  const response = await fetch('/api/reels/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error.message);
  }

  // Download HD version
  const downloadUrl = result.data.media.find((m) => m.quality === 'HD')?.downloadUrl;
  if (downloadUrl) {
    const downloadResponse = await fetch(downloadUrl);
    const blob = await downloadResponse.blob();
    // Handle blob (save, play, etc.)
  }
}
```

```bash
# cURL Example
curl -X POST http://localhost:3000/api/reels/resolve \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.instagram.com/reel/ABC123/"}'

# Download
curl -L -o reel.mp4 "http://localhost:3000/api/reels/download/cm1abc123/hd"
```
