// Documentation Page

import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Documentation',
  description:
    'API reference for ReelDownloader: resolving Instagram Reel URLs, downloading media and the operational endpoints.',
};

const endpoints = [
  {
    method: 'POST',
    path: '/api/reels/resolve',
    description: 'Resolve a Reel URL and return its metadata and download options.',
  },
  {
    method: 'GET',
    path: '/api/reels/download/:resolutionId/:quality',
    description: 'Stream a resolved media variant. Supports Range requests.',
  },
  { method: 'GET', path: '/api/health', description: 'Liveness and version information.' },
  {
    method: 'GET',
    path: '/api/health/ready',
    description: 'Reports whether the optional database and Redis dependencies are in use.',
  },
];

const errorCodes = [
  { status: '400', code: 'INVALID_URL', description: 'The URL format is invalid.' },
  {
    status: '400',
    code: 'UNSUPPORTED_URL',
    description: 'Not a supported Instagram Reel or Post URL.',
  },
  {
    status: '403',
    code: 'PRIVATE_CONTENT',
    description: 'The content is from a private account.',
  },
  { status: '404', code: 'NOT_FOUND', description: 'The Reel was not found or has been deleted.' },
  {
    status: '404',
    code: 'MEDIA_UNAVAILABLE',
    description: 'The media could not be located or accessed.',
  },
  { status: '429', code: 'RATE_LIMITED', description: 'Too many requests.' },
  {
    status: '451',
    code: 'NOT_PERMITTED',
    description: 'The content cannot be legally or technically accessed.',
  },
  { status: '500', code: 'INTERNAL_ERROR', description: 'An unexpected server error occurred.' },
];

const variants = [
  { quality: 'original', format: 'mp4', useCase: 'Source quality' },
  { quality: 'hd', format: 'mp4', useCase: '720p-1080p' },
  { quality: 'sd', format: 'mp4', useCase: 'Lower bandwidth' },
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-lg bg-gray-900 p-4 text-sm text-gray-100">
      <code>{children}</code>
    </pre>
  );
}

const thClass = 'py-3 pr-4 font-semibold text-gray-900 dark:text-white';
const tdClass = 'py-3 pr-4 text-gray-600 dark:text-gray-400';
const rowClass = 'border-b border-gray-100 dark:border-gray-800/60';

export default function DocsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="py-16 lg:py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white">
              Documentation
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-gray-600 dark:text-gray-400">
              Everything you need to resolve Reel URLs and download the media programmatically. The
              API is public and requires no authentication.
            </p>

            <h2 className="mt-12 text-2xl font-semibold text-gray-900 dark:text-white">
              Endpoints
            </h2>
            <ul className="mt-6 space-y-4">
              {endpoints.map((endpoint) => (
                <li key={endpoint.path} className="card p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                      {endpoint.method}
                    </span>
                    <code className="text-sm font-semibold text-gray-900 dark:text-white">
                      {endpoint.path}
                    </code>
                  </div>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    {endpoint.description}
                  </p>
                </li>
              ))}
            </ul>

            <h2 className="mt-12 text-2xl font-semibold text-gray-900 dark:text-white">
              Resolve a Reel
            </h2>
            <p className="mt-4 text-gray-600 dark:text-gray-400">
              Send the URL as JSON. The resolver accepts the formats people actually paste: a
              trailing slash, a missing scheme, shared <code className="text-sm">?igsh=</code> query
              strings and <code className="text-sm">#media</code> fragments are all normalised.
            </p>
            <CodeBlock>{`curl -X POST /api/reels/resolve \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://www.instagram.com/reel/ABC123/"}'`}</CodeBlock>
            <p className="mt-6 text-gray-600 dark:text-gray-400">
              A successful response returns the reel metadata. The direct media URL located on the
              public Instagram page stays server-side, so{' '}
              <code className="text-sm">downloadUrl</code> always points back at this API.
            </p>
            <CodeBlock>{`{
  "success": true,
  "data": {
    "id": "ig_ABC123",
    "title": "Amazing Reel Title",
    "thumbnail": "https://...fbcdn.net/...",
    "duration": 30,
    "shortCode": "ABC123",
    "media": [
      {
        "quality": "hd",
        "format": "mp4",
        "downloadUrl": "/api/reels/download/ig_ABC123/hd",
        "width": 1080,
        "height": 1920
      }
    ]
  }
}`}</CodeBlock>

            <h2 className="mt-12 text-2xl font-semibold text-gray-900 dark:text-white">Download</h2>
            <p className="mt-4 text-gray-600 dark:text-gray-400">
              Request the <code className="text-sm">downloadUrl</code> from the resolve response.{' '}
              <code className="text-sm">Range</code> headers are forwarded upstream, so partial
              requests return <code className="text-sm">206</code> with a{' '}
              <code className="text-sm">Content-Range</code>. Instagram signs the underlying media
              URLs, so a link that has expired returns <code className="text-sm">410</code> and the
              Reel should be resolved again.
            </p>
            <CodeBlock>{`curl -L -o reel.mp4 "/api/reels/download/ig_ABC123/hd"`}</CodeBlock>

            <h2 className="mt-12 text-2xl font-semibold text-gray-900 dark:text-white">
              Media variants
            </h2>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className={thClass}>Quality</th>
                    <th className={thClass}>Format</th>
                    <th className="py-3 font-semibold text-gray-900 dark:text-white">
                      Typical size
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((variant) => (
                    <tr key={variant.quality} className={rowClass}>
                      <td className="py-3 pr-4 font-mono text-gray-900 dark:text-white">
                        {variant.quality}
                      </td>
                      <td className={tdClass}>{variant.format}</td>
                      <td className={tdClass}>{variant.useCase}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
              <code className="text-sm">media[]</code> only lists the renditions that were actually
              located on the public page, so the set can vary per Reel.
            </p>

            <h2 className="mt-12 text-2xl font-semibold text-gray-900 dark:text-white">
              Rate limits
            </h2>
            <p className="mt-4 text-gray-600 dark:text-gray-400">
              Resolutions are limited to 30 requests per minute per IP and downloads to 10 per hour.
              Every response carries <code className="text-sm">X-RateLimit-Limit</code>,{' '}
              <code className="text-sm">X-RateLimit-Remaining</code> and{' '}
              <code className="text-sm">X-RateLimit-Reset</code>; a limited response adds{' '}
              <code className="text-sm">Retry-After</code>.
            </p>

            <h2 className="mt-12 text-2xl font-semibold text-gray-900 dark:text-white">Errors</h2>
            <p className="mt-4 text-gray-600 dark:text-gray-400">
              Failures return a machine-readable <code className="text-sm">code</code> alongside a
              human-readable message.
            </p>
            <CodeBlock>{`{
  "success": false,
  "error": {
    "code": "PRIVATE_CONTENT",
    "message": "This content is from a private account"
  }
}`}</CodeBlock>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Code</th>
                    <th className="py-3 font-semibold text-gray-900 dark:text-white">Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {errorCodes.map((error) => (
                    <tr key={error.code} className={rowClass}>
                      <td className={tdClass}>{error.status}</td>
                      <td className="py-3 pr-4 font-mono text-gray-900 dark:text-white">
                        {error.code}
                      </td>
                      <td className={tdClass}>{error.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className="mt-12 text-2xl font-semibold text-gray-900 dark:text-white">
              Using it from JavaScript
            </h2>
            <CodeBlock>{`const response = await fetch('/api/reels/resolve', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url }),
});

const result = await response.json();
if (!result.success) throw new Error(result.error.message);

const downloadUrl = result.data.media.find((m) => m.quality === 'hd')?.downloadUrl;
if (downloadUrl) {
  const video = await fetch(downloadUrl);
  // Handle the streamed response.
}`}</CodeBlock>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
