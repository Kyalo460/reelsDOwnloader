// In-Memory Resolution Store
//
// Postgres is the source of truth for a resolution, but it is not required to
// serve one: the only thing that must survive between the resolve and the
// download request is the direct media URL that was located on the public
// Instagram page. Keeping that in memory as well means a deployment without a
// `DATABASE_URL` still resolves and still streams, it just cannot cache across
// cold starts or share state between instances.
//
// On serverless this map lives for the lifetime of a single warm instance, so
// it is a fallback, not a replacement for the database.

/** A media variant as stored for the download path (may carry the direct URL). */
export interface StoredMediaVariant {
  quality: string;
  format: string;
  /** Internal download endpoint handed to clients. Never a media source. */
  downloadUrl?: string;
  /** Direct media URL located on the public Instagram page. */
  sourceUrl?: string;
}

/** The subset of a resolution row the read paths need. */
export interface StoredResolution {
  id: string;
  url: string;
  shortCode: string;
  title: string | null;
  thumbnailUrl: string | null;
  duration: number | null;
  status: string;
  media: StoredMediaVariant[];
  ipHash: string;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface StoreResolutionInput {
  id: string;
  url: string;
  shortCode: string;
  title: string;
  thumbnail: string;
  duration: number;
  media: StoredMediaVariant[];
  ipHash: string;
  userId?: string;
  expiresAt: Date;
}

/** Bound on the fallback map so a long-lived instance cannot grow without end. */
const MAX_ENTRIES = 500;

class ResolutionStore {
  private readonly byId = new Map<string, StoredResolution>();
  private readonly idByShortCode = new Map<string, string>();

  put(input: StoreResolutionInput): StoredResolution {
    const now = new Date();
    const existing = this.byId.get(input.id);

    const record: StoredResolution = {
      id: input.id,
      url: input.url,
      shortCode: input.shortCode,
      title: input.title || null,
      thumbnailUrl: input.thumbnail || null,
      duration: input.duration,
      status: 'RESOLVED',
      media: input.media,
      ipHash: input.ipHash,
      userId: input.userId ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt: input.expiresAt,
    };

    this.byId.set(record.id, record);
    this.idByShortCode.set(record.shortCode, record.id);
    this.prune();

    return record;
  }

  /** Looks up by record id, falling back to the provider id for a shortcode. */
  getById(id: string): StoredResolution | null {
    const direct = this.get(this.byId, id);
    if (direct) return direct;

    const shortCode = /^ig_([A-Za-z0-9_-]+)$/.exec(id)?.[1];
    if (!shortCode) return null;

    const mappedId = this.idByShortCode.get(shortCode);
    return mappedId ? this.get(this.byId, mappedId) : null;
  }

  getByShortCode(shortCode: string): StoredResolution | null {
    const id = this.idByShortCode.get(shortCode);
    return id ? this.get(this.byId, id) : null;
  }

  deleteByShortCode(shortCode: string): void {
    const id = this.idByShortCode.get(shortCode);
    if (id) this.byId.delete(id);
    this.idByShortCode.delete(shortCode);
  }

  /** Drops expired entries, then the oldest ones if the map is still too big. */
  prune(): void {
    const now = Date.now();

    for (const [id, record] of this.byId) {
      if (record.expiresAt.getTime() <= now) {
        this.byId.delete(id);
        if (this.idByShortCode.get(record.shortCode) === id) {
          this.idByShortCode.delete(record.shortCode);
        }
      }
    }

    while (this.byId.size > MAX_ENTRIES) {
      const oldest = this.byId.keys().next();
      if (oldest.done) break;
      this.deleteById(oldest.value);
    }
  }

  private deleteById(id: string): void {
    const record = this.byId.get(id);
    this.byId.delete(id);
    if (record && this.idByShortCode.get(record.shortCode) === id) {
      this.idByShortCode.delete(record.shortCode);
    }
  }

  private get(map: Map<string, StoredResolution>, id: string): StoredResolution | null {
    const record = map.get(id);
    if (!record) return null;

    if (record.expiresAt.getTime() <= Date.now()) {
      this.deleteById(id);
      return null;
    }

    return record;
  }
}

export const resolutionStore = new ResolutionStore();
