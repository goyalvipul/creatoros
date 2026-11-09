'use client';

import { useEffect, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { ToastProvider } from '@/components/ui';
import { api, refresh } from '@/lib/api';
import { flushOutbox, onOutboxSynced } from '@/lib/outbox';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      // v=8 replaces the worker that could not badge or open a closed Home Screen app.
      // The worker still does not answer page requests.
      navigator.serviceWorker
        .register('/sw.js?v=8', { scope: '/', updateViaCache: 'none' })
        .catch(() => {
          /* the installed app is a bonus, never a requirement */
        });
    }
    onOutboxSynced((path) => {
      const top = `/${path.split('/').filter(Boolean)[0] ?? ''}`;
      if (top !== '/') void refresh(top);
    });
    const kick = () => {
      void flushOutbox();
    };
    window.addEventListener('online', kick);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      kick();
      const badge = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
      if (!badge.setAppBadge) return;
      void api<{ count: number }>('/notifications/badge')
        .then((row) => (row.count > 0 ? badge.setAppBadge?.(row.count) : badge.clearAppBadge?.()))
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    kick();
    return () => {
      window.removeEventListener('online', kick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return (
    <SWRConfig value={{ dedupingInterval: 2000 }}>
      <ToastProvider>{children}</ToastProvider>
    </SWRConfig>
  );
}
