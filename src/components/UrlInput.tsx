// URL Input Component

'use client';

import type { FormEvent } from 'react';
import { useState, useRef, useCallback } from 'react';
import { Clipboard, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UrlInputProps {
  onSubmit: (url: string) => void;
  isLoading?: boolean;
  error?: string;
  disabled?: boolean;
}

export function UrlInput({ onSubmit, isLoading, error, disabled }: UrlInputProps) {
  const [url, setUrl] = useState('');
  const [showPaste, setShowPaste] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
        setShowPaste(false);
        inputRef.current?.focus();
      }
    } catch {
      // Clipboard access denied
    }
  }, []);

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

  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-3xl" noValidate>
      <div className="relative">
        <label htmlFor="reel-url" className="sr-only">
          Instagram Reel URL
        </label>
        <div className="relative flex items-center">
          <input
            ref={inputRef}
            id="reel-url"
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setShowPaste(false);
            }}
            onFocus={() => setShowPaste(false)}
            placeholder="https://www.instagram.com/reel/ABC123/"
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
            Paste an Instagram Reel URL (e.g., instagram.com/reel/ABC123/)
          </p>
        )}
      </div>

      {/* Legal Notice */}
      <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
        <strong>Important:</strong> Only download content you own or have permission to download.{' '}
        Respect creators&apos; rights and Instagram&apos;s Terms of Service.
      </p>
    </form>
  );
}
