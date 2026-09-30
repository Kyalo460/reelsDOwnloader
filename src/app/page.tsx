// Main Page

'use client';

import { useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Features } from '@/components/Features';
import { HowItWorks } from '@/components/HowItWorks';
import { UrlInput } from '@/components/UrlInput';
import { ReelPreview } from '@/components/ReelPreview';
import { AlertCircle, Info } from 'lucide-react';
import type { MediaResolutionResult, Platform } from '@/types';

export default function HomePage() {
  const [platform, setPlatform] = useState<Platform>('instagram');
  const [previewData, setPreviewData] = useState<MediaResolutionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingQuality, setDownloadingQuality] = useState<string | null>(null);

  const handleUrlDetected = useCallback(() => {
    // Clear preview and error when a new URL is detected
    setPreviewData(null);
    setError(null);
  }, []);

  const handleSubmit = useCallback(async (url: string) => {
    if (!url.trim()) return;

    setIsLoading(true);
    setError(null);
    setPreviewData(null);

    try {
      const response = await fetch('/api/reels/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || 'Failed to resolve media');
      }

      setPreviewData(data.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handlePlatformChange = useCallback((newPlatform: Platform) => {
    setPlatform(newPlatform);
    setPreviewData(null);
    setError(null);
  }, []);

  const handleDownload = useCallback(
    async (quality: string) => {
      if (!previewData) return;

      setDownloadingQuality(quality);

      try {
        const variant = previewData.media.find((m) => m.quality === quality);
        if (!variant) throw new Error('Quality not found');

        const response = await fetch(variant.downloadUrl);

        if (!response.ok) {
          if (response.status === 404 || response.status === 410) {
            throw new Error('Download link expired, please try resolving again');
          }
          throw new Error('Download failed');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${previewData.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${quality}.${variant.format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Download failed');
      } finally {
        setDownloadingQuality(null);
      }
    },
    [previewData]
  );

  const handleRetry = useCallback(() => {
    setError(null);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden py-16 lg:py-24" aria-labelledby="hero-heading">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-4xl text-center">
              <h1
                id="hero-heading"
                className="mb-6 text-4xl font-bold tracking-tight text-gray-900 dark:text-white lg:text-6xl"
              >
                {platform === 'instagram' ? (
                  <>
                    Download Instagram <span className="gradient-text">Reels</span> Instantly
                  </>
                ) : (
                  <>
                    Download YouTube <span className="gradient-text">Videos</span> Instantly
                  </>
                )}
              </h1>
              <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-gray-600 dark:text-gray-400 lg:text-xl">
                {platform === 'instagram'
                  ? 'Paste an Instagram Reel URL, preview the content, and download in your preferred quality. Fast, secure, and no login required.'
                  : 'Paste a YouTube URL, preview the video, and download in your preferred quality. Fast, secure, and no login required.'}
              </p>

              {/* URL Input */}
              <UrlInput
                onSubmit={handleSubmit}
                onUrlDetected={handleUrlDetected}
                isLoading={isLoading}
                error={error ?? undefined}
                platform={platform}
                onPlatformChange={handlePlatformChange}
              />

              {/* Trust Indicators */}
              <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1.5">
                  <Info className="h-4 w-4" />
                  No account needed
                </span>
                <span className="flex items-center gap-1.5">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                    />
                  </svg>
                  Privacy focused
                </span>
                <span className="flex items-center gap-1.5">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  Fast downloads
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Preview Section */}
        {previewData && (
          <section className="py-12 lg:py-16" aria-labelledby="preview-heading">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="mx-auto max-w-3xl">
                <h2 id="preview-heading" className="sr-only">
                  {platform === 'instagram' ? 'Reel Preview' : 'Video Preview'}
                </h2>
                <ReelPreview
                  title={previewData.title}
                  thumbnail={previewData.thumbnail}
                  duration={previewData.duration}
                  media={previewData.media}
                  shortCode={previewData.shortCode}
                  platform={previewData.platform ?? platform}
                  onDownload={handleDownload}
                  isDownloading={downloadingQuality}
                  error={error ?? undefined}
                />
              </div>
            </div>
          </section>
        )}

        {/* Error State */}
        {error && !previewData && (
          <section className="py-12" aria-labelledby="error-heading">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="mx-auto max-w-md text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                  <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
                </div>
                <h2
                  id="error-heading"
                  className="mb-2 text-xl font-semibold text-gray-900 dark:text-white"
                >
                  Something went wrong
                </h2>
                <p className="mb-6 text-gray-600 dark:text-gray-400">{error}</p>
                <button onClick={handleRetry} className="btn-secondary">
                  Try Again
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Features */}
        <Features />

        {/* How It Works */}
        <HowItWorks />

        {/* CTA Section */}
        <section className="py-20 lg:py-32" aria-labelledby="cta-heading">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="card p-8 text-center lg:p-12">
              <h2
                id="cta-heading"
                className="mb-4 text-3xl font-bold text-gray-900 dark:text-white lg:text-4xl"
              >
                Ready to download your first {platform === 'instagram' ? 'Reel' : 'video'}?
              </h2>
              <p className="mx-auto mb-8 max-w-2xl text-lg text-gray-600 dark:text-gray-400">
                Paste a URL above and start downloading in seconds. No registration, no limits, no
                hassle.
              </p>
              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <a href="#hero-heading" className="btn-primary px-8 py-4 text-lg">
                  Scroll Up to Start
                </a>
                <a href="/docs" className="btn-secondary px-8 py-4 text-lg">
                  Read Documentation
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
