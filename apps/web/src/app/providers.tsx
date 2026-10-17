'use client';

import { useEffect, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { ToastProvider } from '@/components/ui';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* installability is a bonus, never a requirement */
      });
    }
  }, []);
  return (
    <SWRConfig value={{ dedupingInterval: 2000 }}>
      <ToastProvider>{children}</ToastProvider>
    </SWRConfig>
  );
}
