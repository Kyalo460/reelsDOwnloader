# Instagram Reel Downloader

A production-ready web application for downloading publicly accessible Instagram Reels.

## Features

- **URL Validation** - Validates Instagram Reel URLs before processing
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
