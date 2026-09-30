-- CreateEnum
CREATE TYPE "ResolutionStatus" AS ENUM ('PENDING', 'RESOLVED', 'FAILED', 'EXPIRED', 'PRIVATE', 'NOT_PERMITTED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateTable
CREATE TABLE "ReelResolution" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "title" TEXT,
    "thumbnailUrl" TEXT,
    "duration" INTEGER,
    "status" "ResolutionStatus" NOT NULL DEFAULT 'PENDING',
    "media" JSONB NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "ipHash" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReelResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Download" (
    "id" TEXT NOT NULL,
    "resolutionId" TEXT NOT NULL,
    "mediaQuality" TEXT NOT NULL,
    "mediaFormat" TEXT NOT NULL,
    "fileSize" BIGINT,
    "ipHash" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Download_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminMetric" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "successfulResolutions" INTEGER NOT NULL DEFAULT 0,
    "failedResolutions" INTEGER NOT NULL DEFAULT 0,
    "totalDownloads" INTEGER NOT NULL DEFAULT 0,
    "rateLimitEvents" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "avgLatencyMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "storageUsedBytes" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "AdminMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitEntry" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReelResolution_url_key" ON "ReelResolution"("url");

-- CreateIndex
CREATE UNIQUE INDEX "ReelResolution_shortCode_key" ON "ReelResolution"("shortCode");

-- CreateIndex
CREATE INDEX "ReelResolution_shortCode_idx" ON "ReelResolution"("shortCode");

-- CreateIndex
CREATE INDEX "ReelResolution_createdAt_idx" ON "ReelResolution"("createdAt");

-- CreateIndex
CREATE INDEX "ReelResolution_status_idx" ON "ReelResolution"("status");

-- CreateIndex
CREATE INDEX "ReelResolution_ipHash_idx" ON "ReelResolution"("ipHash");

-- CreateIndex
CREATE INDEX "ReelResolution_userId_idx" ON "ReelResolution"("userId");

-- CreateIndex
CREATE INDEX "ReelResolution_expiresAt_idx" ON "ReelResolution"("expiresAt");

-- CreateIndex
CREATE INDEX "Download_resolutionId_idx" ON "Download"("resolutionId");

-- CreateIndex
CREATE INDEX "Download_createdAt_idx" ON "Download"("createdAt");

-- CreateIndex
CREATE INDEX "Download_ipHash_idx" ON "Download"("ipHash");

-- CreateIndex
CREATE INDEX "Download_userId_idx" ON "Download"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminMetric_date_key" ON "AdminMetric"("date");

-- CreateIndex
CREATE INDEX "AdminMetric_date_idx" ON "AdminMetric"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitEntry_key_key" ON "RateLimitEntry"("key");

-- CreateIndex
CREATE INDEX "RateLimitEntry_windowStart_idx" ON "RateLimitEntry"("windowStart");

-- CreateIndex
CREATE INDEX "RateLimitEntry_expiresAt_idx" ON "RateLimitEntry"("expiresAt");

-- AddForeignKey
ALTER TABLE "ReelResolution" ADD CONSTRAINT "ReelResolution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "ReelResolution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
