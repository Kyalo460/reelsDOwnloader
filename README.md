# Instagram Reel Downloader

A production-ready web application for downloading publicly accessible Instagram Reels.

## Features

- **URL Validation** - Validates Instagram Reel URLs before processing
- **Direct URL Processing** - Resolves reels by reading the publicly accessible Instagram page and locating the media URL in the response (no Meta Graph API, no access token)
- **Media Preview** - Displays reel metadata and thumbnail before download
- **Secure Downloads** - Streams media directly without storing large files
- **Rate Limiting** - Protects against abuse with configurable limits
- **Dark/Light Mode** - Modern responsive UI with theme support
- **Download History** - Track processed URLs (optional, for authenticated users)
- **Admin Dashboard** - Monitor service health and usage statistics

## Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes, Node.js
- **Database**: PostgreSQL with Prisma ORM
- **Cache/Queue**: Redis
- **Containerization**: Docker, Docker Compose
- **Testing**: Vitest (unit), Playwright (e2e)

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- Docker & Docker Compose (optional)

### Local Development

```bash
# Clone and navigate
cd instagram-reel-downloader

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
# DATABASE_URL, REDIS_URL, etc.

# Run database migrations
npx prisma migrate dev

# Start development server
npm run dev
```

### Docker Development

```bash
# Start all services
docker-compose up -d

# Run migrations
docker-compose exec app npx prisma migrate deploy

# View logs
docker-compose logs -f app
```

## Environment Variables

See `.env.example` for all available configuration options.

| Variable                  | Description                          | Required            |
| ------------------------- | ------------------------------------ | ------------------- |
| `DATABASE_URL`            | PostgreSQL connection string         | Yes                 |
| `REDIS_URL`               | Redis connection string              | Yes                 |
| `APP_URL`                 | Public application URL               | Yes                 |
| `NODE_ENV`                | Environment (development/production) | Yes                 |
| `MAX_DOWNLOAD_SIZE`       | Maximum download size in bytes       | No (default: 100MB) |
| `RATE_LIMIT_WINDOW`       | Rate limit window in seconds         | No (default: 60)    |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window              | No (default: 30)    |

### Instagram Session Setup

Instagram withholds the video file from anonymous visitors for some reels. When
that happens the resolver falls back to an authenticated read, which needs a
signed-in session. A session is optional: with none configured, everything else
keeps working anonymously.

There are two ways to provide one, and cookies are preferred.

**Option 1 (recommended): supplied cookies.** Set `INSTAGRAM_SESSION_COOKIES`
to cookies copied from a real browser. This needs no browser on the server at
all, so it is the only option that works on a serverless host, where the
filesystem is ephemeral and no Chromium can be installed. It also avoids
automated login, which is the behavior Instagram is most likely to challenge.

To obtain the cookies:

1. Sign in to instagram.com in a normal browser using a throwaway account.
2. Open devtools and go to **Application > Cookies > https://www.instagram.com**
   (a cookies-export extension works as well and saves a step).
3. Copy the `name` and `value` of each cookie for the `instagram.com` domain and
   join them into one string: `name=value; name=value`.
4. Put that string in `INSTAGRAM_SESSION_COOKIES`. The raw JSON array that an
   export extension produces is also accepted directly.

A `sessionid` cookie must be included or the session is rejected. `sessionid` and
`csrftoken` are the pair that matters:

```bash
INSTAGRAM_SESSION_COOKIES=sessionid=...; csrftoken=...
```

**Option 2: automated login.** Set `INSTAGRAM_USERNAME` and
`INSTAGRAM_PASSWORD`, plus `INSTAGRAM_2FA_SECRET` if the account uses
authenticator 2FA. The app signs in with Playwright on first use. This requires
a Chromium: a locally installed Chrome or Edge (auto-detected), or Playwright's
bundled build via `npx playwright install chromium`.

Supplied cookies always win over automated login when both are configured.

#### Refreshing an expiring session

`sessionid` cookies expire — realistically every few weeks, not months. Refreshing
one is a single request, and does **not** require a rebuild or a redeploy:

```bash
curl -X POST https://<your-domain>/api/auth/instagram/session \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"cookies":"sessionid=...; csrftoken=..."}'
```

With a database configured the session is written to a single-row table and read
at request time. That matters on Vercel specifically: a deployment is an
immutable artifact, so changing `INSTAGRAM_SESSION_COOKIES` only takes effect on
a new deployment, and anything held in memory is lost on the next cold start.
Check what is currently in effect with `GET /api/auth/instagram/session`, and
verify local configuration with `npm run auth:check`.

> **Warning:** These cookies grant full access to the Instagram account they
> came from — anyone holding them can post, message, and change account
> settings. Use a throwaway account, never a personal one, and never commit the
> cookies or `.env` to version control. `.env` is gitignored; the cookies belong
> in it and nowhere else.

> **Warning:** Automating an Instagram login violates Instagram's Terms of Use
> and is the single most likely reason the account gets banned. Option 1 avoids
> that entirely, which is one more reason to prefer it.

## API Endpoints

### POST /api/reels/resolve

Resolve an Instagram Reel URL and return metadata.

**Request:**

```json
{
  "url": "https://www.instagram.com/reel/ABC123/"
}
```

**Response:**

```json
{
  "success": true,
  "title": "Reel Title",
  "thumbnail": "https://...",
  "duration": 30,
  "media": [
    {
      "quality": "HD",
      "format": "mp4",
      "downloadUrl": "/api/reels/download/..."
    }
  ]
}
```

### GET /api/reels/download/:id

Stream download the resolved media.

### GET /health

Health check endpoint.

## Legal Notice

**Important:** This tool only accesses publicly available content. Users must only download content they own or have explicit permission to download. Downloading copyrighted content without authorization may violate Instagram's Terms of Service and applicable copyright laws.

## Project Structure

```
├── src/
│   ├── app/                    # Next.js App Router pages
│   ├── components/             # React components
│   ├── lib/                    # Utilities and configurations
│   ├── services/               # Business logic services
│   ├── types/                  # TypeScript type definitions
│   └── hooks/                  # Custom React hooks
├── prisma/                     # Database schema and migrations
├── tests/                      # Test files
├── docker/                     # Docker configurations
└── docs/                       # Documentation
```

## Development

```bash
# Run tests
npm run test

# Run linting
npm run lint

# Type checking
npm run typecheck

# Build for production
npm run build
```

## Deployment

See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for production deployment instructions.

## Contributing

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for contribution guidelines.

## License

MIT License - See LICENSE file for details.
