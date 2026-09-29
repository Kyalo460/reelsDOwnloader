// Prisma Seed Script

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: 'admin@reeldownloader.app' },
    update: {},
    create: {
      email: 'admin@reeldownloader.app',
      passwordHash: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RK.PZvO.S', // password: admin123
      name: 'Admin User',
      role: 'ADMIN',
      emailVerified: new Date(),
    },
  });

  console.log('✅ Created admin user:', admin.email);

  // Create demo user
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@reeldownloader.app' },
    update: {},
    create: {
      email: 'demo@reeldownloader.app',
      passwordHash: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RK.PZvO.S', // password: demo123
      name: 'Demo User',
      role: 'USER',
      emailVerified: new Date(),
    },
  });

  console.log('✅ Created demo user:', demoUser.email);

  // Create sample resolutions
  const sampleResolutions = [
    {
      id: 'ig_ABC123',
      url: 'https://www.instagram.com/reel/ABC123/',
      shortCode: 'ABC123',
      title: 'Amazing Nature Reel',
      thumbnailUrl:
        'https://instagram.fxxx-1.fna.fbcdn.net/v/t39.30807/123456789_123456789_123456789_n.jpg',
      duration: 30,
      status: 'RESOLVED' as const,
      media: [
        {
          quality: 'original',
          format: 'mp4',
          downloadUrl: '/api/reels/download/ig_ABC123/original',
          width: 1080,
          height: 1920,
        },
        {
          quality: 'hd',
          format: 'mp4',
          downloadUrl: '/api/reels/download/ig_ABC123/hd',
          width: 720,
          height: 1280,
        },
        {
          quality: 'sd',
          format: 'mp4',
          downloadUrl: '/api/reels/download/ig_ABC123/sd',
          width: 480,
          height: 854,
        },
      ],
      ipHash: 'abc123',
      userId: demoUser.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    {
      id: 'ig_DEF456',
      url: 'https://www.instagram.com/reel/DEF456/',
      shortCode: 'DEF456',
      title: 'Funny Cat Video',
      thumbnailUrl:
        'https://instagram.fxxx-1.fna.fbcdn.net/v/t39.30807/987654321_987654321_987654321_n.jpg',
      duration: 15,
      status: 'RESOLVED' as const,
      media: [
        {
          quality: 'original',
          format: 'mp4',
          downloadUrl: '/api/reels/download/ig_DEF456/original',
          width: 1080,
          height: 1920,
        },
        {
          quality: 'hd',
          format: 'mp4',
          downloadUrl: '/api/reels/download/ig_DEF456/hd',
          width: 720,
          height: 1280,
        },
      ],
      ipHash: 'def456',
      userId: demoUser.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    {
      url: 'https://www.instagram.com/reel/GHI789/',
      shortCode: 'GHI789',
      title: 'Private Account Reel',
      thumbnailUrl: null,
      duration: null,
      status: 'PRIVATE' as const,
      media: [],
      errorCode: 'PRIVATE_CONTENT',
      errorMessage: 'This content is from a private account',
      ipHash: 'ghi789',
      userId: null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  ];

  for (const resolution of sampleResolutions) {
    await prisma.reelResolution.upsert({
      where: { shortCode: resolution.shortCode },
      update: resolution,
      create: resolution,
    });
  }

  console.log('✅ Created sample resolutions');

  // Create sample downloads
  const resolution1 = await prisma.reelResolution.findUnique({ where: { shortCode: 'ABC123' } });
  const resolution2 = await prisma.reelResolution.findUnique({ where: { shortCode: 'DEF456' } });

  if (resolution1 && resolution2) {
    await prisma.download.createMany({
      data: [
        {
          resolutionId: resolution1.id,
          mediaQuality: 'hd',
          mediaFormat: 'mp4',
          fileSize: BigInt(5242880),
          ipHash: 'abc123',
          userId: demoUser.id,
        },
        {
          resolutionId: resolution1.id,
          mediaQuality: 'sd',
          mediaFormat: 'mp4',
          fileSize: BigInt(2097152),
          ipHash: 'abc123',
          userId: demoUser.id,
        },
        {
          resolutionId: resolution2.id,
          mediaQuality: 'original',
          mediaFormat: 'mp4',
          fileSize: BigInt(10485760),
          ipHash: 'def456',
          userId: demoUser.id,
        },
      ],
      skipDuplicates: true,
    });
  }

  console.log('✅ Created sample downloads');

  // Create admin metrics for the last 7 days
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    await prisma.adminMetric.upsert({
      where: { date },
      update: {},
      create: {
        date,
        totalRequests: Math.floor(Math.random() * 1000) + 100,
        successfulResolutions: Math.floor(Math.random() * 800) + 50,
        failedResolutions: Math.floor(Math.random() * 100) + 10,
        totalDownloads: Math.floor(Math.random() * 500) + 20,
        rateLimitEvents: Math.floor(Math.random() * 50),
        errors: Math.floor(Math.random() * 30),
        avgLatencyMs: Math.random() * 200 + 50,
        storageUsedBytes: BigInt(Math.floor(Math.random() * 1000000000) + 100000000),
      },
    });
  }

  console.log('✅ Created admin metrics');

  console.log('🎉 Seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
