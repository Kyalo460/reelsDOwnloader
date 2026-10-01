// YouTube extraction service client tests
//
// The app resolves YouTube metadata through a hosted yt-dlp wrapper
// (ytdlp-service/) because Vercel cannot spawn the binary. These cover the
// client half: sending the shared token, parsing the service's yt-dlp JSON, and
// translating the service's forwarded stderr into the same error codes the
// local binary path produces.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { YouTubeDirectProcessor } from '@/services/media/YouTubeDirectProcessor';

const VIDEO_ID = 'dQw4w9WgXcQ';
const VIDEO_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const SERVICE_URL = 'https://ytdlp-test.koyeb.app/';

/** Minimal yt-dlp --dump-json payload with one progressive MP4 rendition. */
const YTDLP_PAYLOAD = {
  id: VIDEO_ID,
  title: 'Never Gonna Give You Up',
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  duration: 213,
  is_live: false,
  availability: 'public',
  formats: [
    {
      format_id: '137',
      url: 'https://rr3---sn-x.googlevideo.com/videoplayback?id=abc',
      ext: 'mp4',
      vcodec: 'avc1.640028',
      acodec: 'none',
      width: 1920,
      height: 1080,
      tbr: 4500,
    },
  ],
};

describe('YouTubeDirectProcessor with the extraction service', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  /** Stands in for the oEmbed call, which uses the bare global fetch. */
  let oembedMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    // oEmbed 404s by default so a test that expects the fallback to fail does
    // not silently reach the real network.
    oembedMock = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', oembedMock);

    process.env.YTDLP_SERVICE_URL = SERVICE_URL;
    process.env.YTDLP_SERVICE_TOKEN = 'secret-token';
  });

  afterEach(() => {
    delete process.env.YTDLP_SERVICE_URL;
    delete process.env.YTDLP_SERVICE_TOKEN;
    vi.unstubAllGlobals();
  });

  const makeProcessor = () =>
    new YouTubeDirectProcessor({ fetchImpl: fetchMock as unknown as typeof fetch });

  it('sends the shared token and returns located renditions', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(YTDLP_PAYLOAD), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result = await makeProcessor().process(VIDEO_URL);

    // The hosted service is called, never a local binary.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://ytdlp-test.koyeb.app/extract');
    expect((init.headers as Record<string, string>)['X-Service-Token']).toBe('secret-token');
    expect(JSON.parse(init.body as string)).toEqual({ url: VIDEO_URL });

    // A real source URL is the entire point of the service: it is what makes
    // the download buttons work instead of returning metadata only.
    expect(result.platform).toBe('youtube');
    expect(result.media).toHaveLength(1);
    expect(result.media[0]?.sourceUrl).toBe(
      'https://rr3---sn-x.googlevideo.com/videoplayback?id=abc'
    );
    expect(result.media[0]?.quality).toBe('original');
    // A successful extraction must not fall back to oEmbed.
    expect(oembedMock).not.toHaveBeenCalled();
  });

  it('maps the service forwarded stderr onto the real cause without falling back', async () => {
    // The service relays yt-dlp's own stderr, which is the only thing that
    // distinguishes a private video from a removed one. oEmbed 404s for private
    // videos too, so falling back here would relabel this as "not found".
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "ERROR: Private video. Sign in if you've been granted access" }),
        { status: 502 }
      )
    );

    await expect(makeProcessor().process(VIDEO_URL)).rejects.toMatchObject({
      code: 'PRIVATE_CONTENT',
    });
    expect(oembedMock).not.toHaveBeenCalled();
  });

  it('maps a removed video to NOT_FOUND', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'ERROR: Video unavailable' }), { status: 502 })
    );

    await expect(makeProcessor().process(VIDEO_URL)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not surface a rejected token as a missing video', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
    );
    oembedMock.mockResolvedValue(
      new Response(JSON.stringify({ title: 'Still Fine', thumbnail_url: 'https://img/x.jpg' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    // A bad shared secret is an infrastructure problem. oEmbed still answers,
    // so the user gets the video's metadata instead of being told it is gone.
    const result = await makeProcessor().process(VIDEO_URL);

    expect(result.title).toBe('Still Fine');
    expect(result.media).toEqual([]);
  });

  it('still returns preview metadata when the service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    oembedMock.mockResolvedValue(
      new Response(JSON.stringify({ title: 'Some Video', thumbnail_url: 'https://img/x.jpg' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result = await makeProcessor().process(VIDEO_URL);

    // Metadata survives, but no renditions are invented, so the UI shows the
    // preview-only notice instead of dead download buttons.
    expect(result.title).toBe('Some Video');
    expect(result.media).toEqual([]);
  });

  it('never calls the service when the video id cannot be parsed', async () => {
    await expect(makeProcessor().process('not-a-url')).rejects.toMatchObject({
      code: 'INVALID_URL',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
