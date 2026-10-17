import path from 'node:path';
import type { NextConfig } from 'next';

const apiInternal = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  transpilePackages: ['@creatoros/domain'],
  poweredByHeader: false,
  reactStrictMode: true,
  // In production Caddy sends /api straight to the API. In `pnpm dev` (and if someone browses the web container directly)
  // this rewrite keeps one origin so the session cookie and CSRF origin check behave identically.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternal}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default config;
