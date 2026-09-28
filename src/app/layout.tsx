// Root Layout

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/Providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: 'ReelDownloader - Download Instagram Reels',
    template: '%s | ReelDownloader',
  },
  description:
    'A fast, secure, and privacy-focused tool to download publicly available Instagram Reels. No login required.',
  keywords: ['instagram', 'reel', 'downloader', 'video', 'download', 'social media'],
  authors: [{ name: 'ReelDownloader' }],
  creator: 'ReelDownloader',
  publisher: 'ReelDownloader',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://reeldownloader.app',
    siteName: 'ReelDownloader',
    title: 'ReelDownloader - Download Instagram Reels',
    description:
      'A fast, secure, and privacy-focused tool to download publicly available Instagram Reels.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'ReelDownloader - Download Instagram Reels',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ReelDownloader - Download Instagram Reels',
    description:
      'A fast, secure, and privacy-focused tool to download publicly available Instagram Reels.',
    images: ['/og-image.png'],
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-16x16.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body
        className={`${inter.variable} bg-surface-light font-sans text-gray-900 antialiased transition-colors duration-200 dark:bg-surface-dark dark:text-gray-100`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
