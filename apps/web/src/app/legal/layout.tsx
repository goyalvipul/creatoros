import type { ReactNode } from 'react';

/** Public pages (no sign-in) required by Meta app settings. Kept outside the (app) group on purpose. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6 text-sm leading-relaxed">
      <p className="text-xs text-muted">
        Creator OS · private creator operations tool · last updated 17 October 2026
      </p>
      {children}
    </main>
  );
}
