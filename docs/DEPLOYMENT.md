# Deployment Guide

## Overview

This guide covers deploying the Instagram Reel Downloader to production environments using Docker, Kubernetes, or traditional VM deployment.

## Prerequisites

- Docker 24+ and Docker Compose 2+
- PostgreSQL 15+ (managed or self-hosted)
- Redis 7+ (managed or self-hosted)
- Domain name with DNS configured
- SSL certificates (Let's Encrypt recommended)
- Container registry (GHCR, Docker Hub, etc.)

## Environment Variables

Create a `.env.production` file with all required variables:

```env
# Application
APP_URL=https://your-domain.com
NODE_ENV=production

# Database (use managed PostgreSQL in production)
DATABASE_URL=postgresql://user:password@host:5432/reel_downloader?sslmode=require

# Redis (use managed Redis in production)
REDIS_URL=redis://user:password@host:6379

# Security (generate with: openssl rand -base64 32)
ENCRYPTION_KEY=your-32-byte-base64-encoded-key
SESSION_SECRET=your-session-secret-min-32-chars

# Rate Limiting
RATE_LIMIT_WINDOW=60
RATE_LIMIT_MAX_REQUESTS=30
DOWNLOAD_RATE_LIMIT_WINDOW=3600
DOWNLOAD_RATE_LIMIT_MAX_REQUESTS=10

# Limits
MAX_DOWNLOAD_SIZE=104857600
REQUEST_TIMEOUT=30000

# Logging
LOG_LEVEL=info
LOG_PRETTY=false

# Optional: External services
# SENTRY_DSN=https://xxx@sentry.io/xxx
# ANALYTICS_ID=G-XXXXXXXXXX
```

## Docker Deployment

### Build Image

```bash
# Build production image
docker build -t reeldownloader:latest .

# Build with specific tag
docker build -t reeldownloader:v1.0.0 .

# Push to registry
docker tag reeldownloader:latest ghcr.io/your-org/reeldownloader:latest
docker push ghcr.io/your-org/reeldownloader:latest
```

### Run with Docker Compose

```bash
# Production deployment
docker-compose -f docker-compose.prod.yml up -d

# With custom env file
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f app

# Scale app replicas
docker-compose -f docker-compose.prod.yml up -d --scale app=3
```

### Health Checks

```bash
# Check container health
docker-compose -f docker-compose.prod.yml ps

# Manual health check
curl https://your-domain.com/health
curl https://your-domain.com/health/ready
curl https://your-domain.com/health/live
```

## Kubernetes Deployment

### Namespace and ConfigMap

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: reeldownloader
---
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: reeldownloader-config
  namespace: reeldownloader
data:
  NODE_ENV: 'production'
  APP_URL: 'https://your-domain.com'
  LOG_LEVEL: 'info'
  LOG_PRETTY: 'false'
  RATE_LIMIT_WINDOW: '60'
  RATE_LIMIT_MAX_REQUESTS: '30'
```

### Secrets

```yaml
# k8s/secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: reeldownloader-secrets
  namespace: reeldownloader
type: Opaque
stringData:
  DATABASE_URL: 'postgresql://user:password@host:5432/reel_downloader?sslmode=require'
  REDIS_URL: 'redis://user:password@host:6379'
  ENCRYPTION_KEY: 'your-base64-encoded-32-byte-key'
  SESSION_SECRET: 'your-session-secret'
```

### Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: reeldownloader
  namespace: reeldownloader
  labels:
    app: reeldownloader
spec:
  replicas: 3
  selector:
    matchLabels:
      app: reeldownloader
  template:
    metadata:
      labels:
        app: reeldownloader
    spec:
      containers:
        - name: app
          image: ghcr.io/your-org/reeldownloader:latest
          ports:
            - containerPort: 3000
          envFrom:
            - configMapRef:
                name: reeldownloader-config
            - secretRef:
                name: reeldownloader-secrets
          resources:
            requests:
              memory: '512Mi'
              cpu: '500m'
            limits:
              memory: '1Gi'
              cpu: '1000m'
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
---
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: reeldownloader
  namespace: reeldownloader
spec:
  selector:
    app: reeldownloader
  ports:
    - port: 80
      targetPort: 3000
  type: ClusterIP
```

### Ingress

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: reeldownloader
  namespace: reeldownloader
  annotations:
    cert-manager.io/cluster-issuer: 'letsencrypt-prod'
    nginx.ingress.kubernetes.io/rate-limit: '30'
    nginx.ingress.kubernetes.io/rate-limit-window: '1m'
    nginx.ingress.kubernetes.io/proxy-body-size: '10m'
    nginx.ingress.kubernetes.io/proxy-read-timeout: '300'
    nginx.ingress.kubernetes.io/proxy-send-timeout: '300'
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - your-domain.com
      secretName: reeldownloader-tls
  rules:
    - host: your-domain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: reeldownloader
                port:
                  number: 80
```

### Apply Kubernetes Resources

```bash
# Apply all resources
kubectl apply -f k8s/

# Check deployment status
kubectl get pods -n reeldownloader
kubectl get svc -n reeldownloader
kubectl get ingress -n reeldownloader

# View logs
kubectl logs -n reeldownloader -l app=reeldownloader -f

# Rollout restart
kubectl rollout restart deployment/reeldownloader -n reeldownloader
```

## Traditional VM Deployment

### System Requirements

- Ubuntu 22.04+ / Debian 12+ / RHEL 9+
- 2+ CPU cores
- 4+ GB RAM
- 20+ GB disk space

### Setup

```bash
# Install dependencies
sudo apt update && sudo apt install -y \
  nodejs npm postgresql-client redis-tools nginx certbot python3-certbot-nginx

# Create app user
sudo useradd -r -s /bin/bash -d /opt/reeldownloader reeldownloader

# Create directories
sudo mkdir -p /opt/reeldownloader /var/log/reeldownloader
sudo chown reeldownloader:reeldownloader /opt/reeldownloader /var/log/reeldownloader

# Clone repository
sudo -u reeldownloader git clone https://github.com/your-org/instagram-reel-downloader.git /opt/reeldownloader/app
cd /opt/reeldownloader/app

# Install dependencies
sudo -u reeldownloader npm ci --production

# Build application
sudo -u reeldownloader npm run build

# Run migrations
sudo -u reeldownloader npx prisma migrate deploy
```

### Systemd Service

```ini
# /etc/systemd/system/reeldownloader.service
[Unit]
Description=Instagram Reel Downloader
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=reeldownloader
WorkingDirectory=/opt/reeldownloader/app
EnvironmentFile=/opt/reeldownloader/.env.production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
StandardOutput=append:/var/log/reeldownloader/app.log
StandardError=append:/var/log/reeldownloader/error.log

# Security
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/reeldownloader /var/log/reeldownloader

[Install]
WantedBy=multi-user.target
```

### Nginx Configuration

```nginx
# /etc/nginx/sites-available/reeldownloader
upstream reeldownloader {
    least_conn;
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name your-domain.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 10M;

    location /health {
        proxy_pass http://reeldownloader;
        access_log off;
    }

    location /api/reels/resolve {
        limit_req zone=api burst=5 nodelay;
        proxy_pass http://reeldownloader;
    }

    location /api/reels/download/ {
        limit_req zone=download burst=2 nodelay;
        proxy_pass http://reeldownloader;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location /_next/static/ {
        proxy_pass http://reeldownloader;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        proxy_pass http://reeldownloader;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Rate Limit Zones (nginx.conf)

```nginx
http {
    limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
    limit_req_zone $binary_remote_addr zone=download:10m rate=10r/h;
    # ... rest of config
}
```

### Enable and Start

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/reeldownloader /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com

# Start service
sudo systemctl daemon-reload
sudo systemctl enable reeldownloader
sudo systemctl start reeldownloader

# Check status
sudo systemctl status reeldownloader
```

## Database Setup

### PostgreSQL (Managed)

Use managed PostgreSQL (AWS RDS, Google Cloud SQL, Azure Database, etc.):

```bash
# Create database
createdb -h your-db-host -U postgres reel_downloader

# Run migrations
npx prisma migrate deploy
```

### Redis (Managed)

Use managed Redis (AWS ElastiCache, Google Memorystore, Azure Cache, etc.):

```bash
# Test connection
redis-cli -h your-redis-host -p 6379 ping
```

## Monitoring and Observability

### Health Endpoints

| Endpoint            | Purpose               |
| ------------------- | --------------------- |
| `GET /health`       | Basic liveness        |
| `GET /health/ready` | Readiness (DB, Redis) |
| `GET /health/live`  | Kubernetes liveness   |

### Logs

Structured JSON logs include:

- Request ID
- Timestamp
- Endpoint
- Status code
- Latency
- IP hash (privacy)
- Error category (no sensitive data)

### Metrics

Key metrics to monitor:

- Request rate (total, success, error)
- Resolution success rate
- Download rate
- Rate limit events
- Average latency
- Error rate by type
- Database/Redis connection health

### Alerting Rules

```yaml
# Example Prometheus alerts
groups:
  - name: reeldownloader
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: 'High error rate detected'

      - alert: DatabaseDown
        expr: up{job="postgresql"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: 'PostgreSQL is down'

      - alert: RedisDown
        expr: up{job="redis"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: 'Redis is down'

      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'High API latency'
```

## Backup and Recovery

### Database Backup

```bash
# Automated daily backup
pg_dump -h $DB_HOST -U $DB_USER -d reel_downloader | gzip > backup_$(date +%Y%m%d).sql.gz

# Restore
gunzip -c backup_20240115.sql.gz | psql -h $DB_HOST -U $DB_USER -d reel_downloader
```

### Redis Backup

```bash
# Redis persistence (AOF/RDB) should be enabled in managed Redis
# Manual backup
redis-cli -h $REDIS_HOST BGSAVE
```

## Rollback Procedure

```bash
# Docker
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d --force-recreate

# Kubernetes
kubectl rollout undo deployment/reeldownloader -n reeldownloader

# VM
cd /opt/reeldownloader/app
git checkout previous-tag
npm ci --production
npm run build
npx prisma migrate deploy
sudo systemctl restart reeldownloader
```

## Security Checklist

- [ ] All secrets in environment variables (not in code)
- [ ] HTTPS enforced with valid TLS certificates
- [ ] Security headers configured (CSP, HSTS, etc.)
- [ ] Rate limiting enabled on all endpoints
- [ ] Database connections use SSL/TLS
- [ ] Redis connections use authentication
- [ ] Regular security updates applied
- [ ] Dependency scanning in CI/CD
- [ ] Log aggregation without sensitive data
- [ ] Backup encryption enabled
- [ ] Access logs monitored for anomalies

## Troubleshooting

### Application Won't Start

```bash
# Check logs
docker-compose logs app
# or
sudo journalctl -u reeldownloader -f

# Common issues:
# - DATABASE_URL incorrect
# - REDIS_URL incorrect
# - Missing ENCRYPTION_KEY
# - Port 3000 already in use
```

### High Memory Usage

```bash
# Check Node.js heap
node --inspect=0.0.0.0:9229 server.js

# Or add to Dockerfile:
ENV NODE_OPTIONS="--max-old-space-size=1024"
```

### Database Connection Issues

```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1"

# Check pool settings in Prisma schema
# Adjust connection_limit if needed
```

## Support

For deployment issues:

- Check logs first
- Verify environment variables
- Ensure dependencies are healthy
- Review this guide's troubleshooting section
