// URL Input Component

'use client';

import type { FormEvent, ClipboardEvent } from 'react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { Clipboard, Loader2, AlertCircle, Instagram, Youtube } from 'lucide-react';
import { cn, isInstagramReelUrl, isYouTubeUrl } from '@/lib/utils';

export type Platform = 'instagram' | 'youtube';

interface UrlInputProps {
  onSubmit: (url: string) => void;
  onUrlDetected?: (url: string) => void;
  isLoading?: boolean;
  error?: string;
  disabled?: boolean;
  platform?: Platform;
  onPlatformChange?: (platform: Platform) => void;
}

const PLACEHOLDERS: Record<Platform, string> = {
  instagram: 'https://www.instagram.com/reel/ABC123/',
  youtube: 'https://www.youtube.com/watch?v=ABC123DEF',
};

const HINTS: Record<Platform, string> = {
  instagram: 'Paste an Instagram Reel URL (e.g., instagram.com/reel/ABC123/)',
  youtube: 'Paste a YouTube URL (e.g., youtube.com/watch?v=ABC123 or youtu.be/ABC123)',
};

const ICONS: Record<Platform, React.ReactNode> = {
  instagram: <Instagram className="h-5 w-5" />,
  youtube: <Youtube className="h-5 w-5" />,
};

export function UrlInput({
  onSubmit,
  onUrlDetected,
  isLoading,
  error,
  disabled,
  platform = 'instagram',
  onPlatformChange,
}: UrlInputProps) {
  const [url, setUrl] = useState('');
  const [showPaste, setShowPaste] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const trimmed = text.trim();
        setUrl(trimmed);
        setShowPaste(false);
        inputRef.current?.focus();
        const isValid =
          platform === 'instagram' ? isInstagramReelUrl(trimmed) : isYouTubeUrl(trimmed);
        if (isValid && onUrlDetected) {
          onUrlDetected(trimmed);
        }
      }
    } catch {
      // Clipboard access denied
    }
  }, [onUrlDetected, platform]);

  const handleInputPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      try {
        const text = e.clipboardData.getData('text');
        if (text) {
          const trimmed = text.trim();
          setUrl(trimmed);
          setShowPaste(false);
          const isValid =
            platform === 'instagram' ? isInstagramReelUrl(trimmed) : isYouTubeUrl(trimmed);
          if (isValid && onUrlDetected) {
            onUrlDetected(trimmed);
          }
        }
      } catch {
        // Clipboard access denied
      }
    },
    [onUrlDetected, platform]
  );

  useEffect(() => {
    const checkClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const trimmed = text.trim();
          const isValid =
            platform === 'instagram' ? isInstagramReelUrl(trimmed) : isYouTubeUrl(trimmed);
          if (isValid) {
            setUrl(trimmed);
            setShowPaste(false);
            if (onUrlDetected) {
              onUrlDetected(trimmed);
            }
          }
        }
      } catch {
        // Clipboard access denied or not available
      }
    };
    checkClipboard();
  }, [onUrlDetected, platform]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && !isLoading && !disabled) {
      onSubmit(url.trim());
    }
  };

  const handleClear = () => {
    setUrl('');
    setShowPaste(true);
    inputRef.current?.focus();
  };

  const isValidUrl = url.trim().length > 0;

  const handlePlatformChange = (newPlatform: Platform) => {
    onPlatformChange?.(newPlatform);
    // Clear the input when switching platforms
    setUrl('');
    setShowPaste(true);
    inputRef.current?.focus();
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-3xl" noValidate>
      {/* Platform Toggle */}
      <div className="mb-4 flex items-center gap-2" role="group" aria-label="Select platform">
        <button
          type="button"
          onClick={() => handlePlatformChange('instagram')}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
            platform === 'instagram'
              ? 'bg-primary-600 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
          )}
          aria-pressed={platform === 'instagram'}
        >
          {ICONS.instagram}
          Instagram
        </button>
        <button
          type="button"
          onClick={() => handlePlatformChange('youtube')}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
            platform === 'youtube'
              ? 'bg-red-600 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
          )}
          aria-pressed={platform === 'youtube'}
        >
          {ICONS.youtube}
          YouTube
        </button>
      </div>

      <div className="relative">
        <label htmlFor="media-url" className="sr-only">
          {platform === 'instagram' ? 'Instagram Reel URL' : 'YouTube Video URL'}
        </label>
        <div className="relative flex items-center">
          <input
            ref={inputRef}
            id="media-url"
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setShowPaste(false);
            }}
            onFocus={() => setShowPaste(false)}
            onPaste={handleInputPaste}
            placeholder={PLACEHOLDERS[platform]}
            className={cn(
              'input pl-14 pr-40',
              error && 'border-red-500 focus:border-red-500 focus:ring-red-500/20',
              isLoading && 'cursor-wait'
            )}
            disabled={disabled || isLoading}
            aria-invalid={!!error}
            aria-describedby={error ? 'url-error' : 'url-hint'}
            autoComplete="off"
            spellCheck={false}
          />

          {/* Paste Button */}
          {showPaste && !isLoading && (
            <button
              type="button"
              onClick={handlePaste}
              className="absolute left-3 flex h-10 items-center justify-center px-3 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Paste from clipboard"
            >
              <Clipboard className="h-5 w-5" />
            </button>
          )}

          {/* Clear Button */}
          {url && !isLoading && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 flex h-10 items-center justify-center px-3 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Clear URL"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}

          {/* Submit/Loading Button */}
          <button
            type="submit"
            className={cn(
              'absolute right-3 flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium transition-all',
              isLoading
                ? 'cursor-wait bg-primary-600 text-white'
                : isValidUrl && !error
                  ? 'btn-primary'
                  : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800'
            )}
            disabled={!isValidUrl || isLoading || !!error || disabled}
            aria-busy={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Resolving...
              </>
            ) : (
              'Resolve'
            )}
          </button>
        </div>

        {/* Error/Helper Text */}
        {error && (
          <p
            id="url-error"
            className="mt-2 flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </p>
        )}

        {!error && !isLoading && (
          <p id="url-hint" className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {HINTS[platform]}
          </p>
        )}
      </div>

      {/* Legal Notice */}
      <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
        <strong>Important:</strong> Only download content you own or have permission to download.{' '}
        Respect creators&apos; rights and{' '}
        {platform === 'instagram' ? 'Instagram&apos;s' : 'YouTube&apos;s'} Terms of Service.
      </p>
    </form>
  );
}
