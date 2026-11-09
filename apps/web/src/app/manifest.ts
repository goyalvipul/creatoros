import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kemokem',
    short_name: 'Kemokem',
    description: 'Private creative production, publishing and collaboration command centre.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f7f7f3',
    theme_color: '#f7f7f3',
    icons: [
      { src: '/brand/kemokem-pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/kemokem-pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
    shortcuts: [
      { name: 'Today', url: '/today' },
      { name: 'Library', url: '/library' },
    ],
  };
}
