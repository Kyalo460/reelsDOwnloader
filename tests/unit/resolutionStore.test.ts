// Resolution Store Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { resolutionStore } from '@/services/media/resolutionStore';
import type { StoreResolutionInput } from '@/services/media/resolutionStore';

const SOURCE_URL = 'https://scontent.cdninstagram.com/v/t50/reel-1080.mp4';

function input(overrides: Partial<StoreResolutionInput> = {}): StoreResolutionInput {
  return {
    id: 'ig_ABC123',
    url: 'https://www.instagram.com/reel/ABC123',
    shortCode: 'ABC123',
    title: 'Golden hour',
    thumbnail: 'https://cdn/thumb.jpg',
    duration: 27,
    media: [
      {
        quality: 'original',
        format: 'mp4',
        downloadUrl: '/api/reels/download/ig_ABC123/original',
        sourceUrl: SOURCE_URL,
      },
    ],
    ipHash: 'abc123',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  };
}

describe('resolutionStore', () => {
  beforeEach(() => {
    resolutionStore.deleteByShortCode('ABC123');
    resolutionStore.deleteByShortCode('ZZZ999');
  });

  it('stores and returns a resolution with the located media URL', () => {
    resolutionStore.put(input());

    const record = resolutionStore.getById('ig_ABC123');
    expect(record?.shortCode).toBe('ABC123');
    expect(record?.status).toBe('RESOLVED');
    expect(record?.media[0]?.sourceUrl).toBe(SOURCE_URL);
  });

  it('looks up by id and by shortcode', () => {
    resolutionStore.put(input());

    expect(resolutionStore.getByShortCode('ABC123')?.id).toBe('ig_ABC123');
    expect(resolutionStore.getByShortCode('ZZZ999')).toBeNull();
  });

  it('returns null for an unknown resolution', () => {
    expect(resolutionStore.getById('ig_MISSING')).toBeNull();
    expect(resolutionStore.getById('cm1abc123def456')).toBeNull();
  });

  it('drops expired entries on read', () => {
    resolutionStore.put(input({ expiresAt: new Date(Date.now() - 1000) }));

    expect(resolutionStore.getById('ig_ABC123')).toBeNull();
    expect(resolutionStore.getByShortCode('ABC123')).toBeNull();
  });

  it('reuses the original createdAt when a record is re-stored', () => {
    const first = resolutionStore.put(input());
    const second = resolutionStore.put(input({ title: 'Updated title' }));

    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
    expect(second.title).toBe('Updated title');
  });

  it('deletes by shortcode', () => {
    resolutionStore.put(input());
    resolutionStore.deleteByShortCode('ABC123');

    expect(resolutionStore.getById('ig_ABC123')).toBeNull();
  });

  it('prunes expired entries', () => {
    resolutionStore.put(input({ shortCode: 'ABC123', expiresAt: new Date(Date.now() - 1000) }));
    resolutionStore.prune();

    expect(resolutionStore.getByShortCode('ABC123')).toBeNull();
  });
});
