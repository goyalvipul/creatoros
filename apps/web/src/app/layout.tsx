import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  weight: ['500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: { default: 'Creator OS', template: '%s · Creator OS' },
  description: 'Private creative production, publishing and collaboration command centre.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Creator OS', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: '/brand/kemokem-favicon.ico' },
      { url: '/brand/kemokem-favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/brand/kemokem-favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/kemokem-favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/brand/kemokem-favicon-64.png', sizes: '64x64', type: 'image/png' },
    ],
    apple: [{ url: '/brand/kemokem-pwa-512.png', sizes: '512x512', type: 'image/png' }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0f17' },
  ],
};

// Applied before first paint so the theme never flashes.
const themeScript = `try{var t=localStorage.getItem('cos-theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t;${process.env.NEXT_PUBLIC_CREATOROS_UX_V5 === '1' ? "document.documentElement.dataset.ux='v5';" : ''}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
