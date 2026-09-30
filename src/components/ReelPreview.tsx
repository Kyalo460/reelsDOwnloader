// Reel Preview Component

'use client';

import { useState, useRef } from 'react';
import { Download, Play, ExternalLink, X, Loader2, AlertCircle } from 'lucide-react';
import { cn, formatDuration, formatBytes } from '@/lib/utils';
import type { MediaVariant, Platform } from '@/types';

interface ReelPreviewProps {
  title: string;
  thumbnail: string;
  duration: number;
  media: MediaVariant[];
  shortCode: string;
  platform: Platform;
  onDownload: (quality: string) => void;
  isDownloading?: string | null;
  error?: string;
}

export function ReelPreview({
  title,
  thumbnail,
  duration,
  media,
  shortCode,
  platform,
  onDownload,
  isDownloading,
  error,
}: ReelPreviewProps) {
  const [showVideo, setShowVideo] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Fetch video URL for preview when user clicks play
  const handlePlay = async (quality: string = 'sd') => {
    const variant = media.find((m) => m.quality === quality) || media[0];
    if (!variant) return;

    try {
      // In a real app, this would fetch the actual video URL
      // For preview, we can try to load a lower quality version
      setVideoUrl(variant.downloadUrl);
      setShowVideo(true);
    } catch {
      // Handle error
    }
  };

  const handleVideoEnd = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.pause();
    }
  };

  const sortedMedia = [...media].sort((a, b) => {
    const order = { original: 0, hd: 1, sd: 2 };
    return (order[a.quality] ?? 3) - (order[b.quality] ?? 3);
  });

  return (
    <div className="animate-slide-up">
      {/* Thumbnail/Video Preview */}
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-800">
        {showVideo && videoUrl && (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            autoPlay
            playsInline
            onEnded={handleVideoEnd}
            className="absolute inset-0 h-full w-full object-cover"
            poster={thumbnail}
          />
        )}

        {!showVideo && (
          <img
            src={thumbnail}
            alt={`${title} thumbnail`}
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
            loading="lazy"
          />
        )}

        {/* Play Button Overlay */}
        {!showVideo && (
          <button
            onClick={() => handlePlay('sd')}
            className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors hover:bg-black/40"
            aria-label="Play preview"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 shadow-xl backdrop-blur-sm dark:bg-gray-900/90">
              <Play className="ml-1 h-7 w-7 text-gray-900 dark:text-white" />
            </div>
          </button>
        )}

        {/* Close Video Button */}
        {showVideo && (
          <button
            onClick={() => setShowVideo(false)}
            className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
            aria-label="Close video"
          >
            <X className="h-5 w-5" />
          </button>
        )}

        {/* Duration Badge */}
        <div className="absolute bottom-3 right-3 rounded bg-black/75 px-2 py-1 text-xs font-medium text-white">
          {formatDuration(duration)}
        </div>
      </div>

      {/* Title */}
      <h2 className="mt-4 line-clamp-2 text-lg font-semibold text-gray-900 dark:text-white">
        {title}
      </h2>

      {/* Error Message */}
      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      {/* Download Options */}
      <div className="mt-6 space-y-3">
        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <span className="font-medium text-gray-700 dark:text-gray-300">Available Downloads</span>
          <a
            href={`https://www.instagram.com/reel/${shortCode}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
            aria-label="View on Instagram"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View on Instagram
          </a>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {sortedMedia.map((variant) => (
            <DownloadOption
              key={variant.quality}
              variant={variant}
              onDownload={onDownload}
              isDownloading={isDownloading === variant.quality}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DownloadOption({
  variant,
  onDownload,
  isDownloading,
}: {
  variant: MediaVariant;
  onDownload: (quality: string) => void;
  isDownloading: boolean;
}) {
  const qualityLabels: Record<string, string> = {
    original: 'Original',
    hd: 'HD (720p+)',
    sd: 'SD (480p)',
  };

  const qualityColors: Record<string, string> = {
    original: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    hd: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    sd: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  };

  return (
    <button
      onClick={() => onDownload(variant.quality)}
      disabled={isDownloading}
      className={cn(
        'relative flex items-center justify-between rounded-xl border p-4 transition-all duration-200',
        'hover:border-primary-300 dark:hover:border-primary-700',
        'hover:shadow-md',
        isDownloading ? 'cursor-wait opacity-70' : 'cursor-pointer'
      )}
      aria-busy={isDownloading}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
          <svg
            className="h-6 w-6 text-gray-500 dark:text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 dark:text-white">
              {qualityLabels[variant.quality] || variant.quality.toUpperCase()}
            </span>
            <span className={cn('badge', qualityColors[variant.quality] || 'badge-info')}>
              {variant.format.toUpperCase()}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
            {variant.fileSize && (
              <span className="flex items-center gap-1">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
                {formatBytes(variant.fileSize)}
              </span>
            )}
            {variant.width && variant.height && (
              <span className="flex items-center gap-1">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
                {variant.width}×{variant.height}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isDownloading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
            <span className="text-sm font-medium text-primary-600 dark:text-primary-400">
              Preparing...
            </span>
          </>
        ) : (
          <Download className="h-5 w-5 text-gray-400" />
        )}
      </div>
    </button>
  );
}
