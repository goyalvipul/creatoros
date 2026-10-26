'use client';

import { useEffect, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { ToastProvider } from '@/components/ui';
import { refresh } from '@/lib/api';
import { flushOutbox, onOutboxSynced } from '@/lib/outbox';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* installability is a bonus, never a requirement */
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
