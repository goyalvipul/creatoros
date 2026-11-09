'use client';

import { useEffect, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { ToastProvider } from '@/components/ui';
import { refresh } from '@/lib/api';
import { flushOutbox, onOutboxSynced } from '@/lib/outbox';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      // v=7 is a new address so an installed app replaces the worker that had no push handler.
      // The worker still does not answer page requests.
      navigator.serviceWorker
        .register('/sw.js?v=7', { scope: '/', updateViaCache: 'none' })
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
      if (document.visibilityState === 'visible') kick();
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
