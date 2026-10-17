'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const TABS = [
  ['/socials', 'Overview'],
  ['/socials/inbox', 'Unified inbox'],
  ['/socials/platform/instagram', 'Instagram'],
  ['/socials/platform/facebook', 'Facebook'],
  ['/socials/platform/youtube', 'YouTube'],
  ['/socials/platform/tiktok', 'TikTok'],
  ['/socials/platform/threads', 'Threads'],
  ['/socials/comments', 'Comments'],
  ['/socials/leads', 'Collaboration leads'],
  ['/socials/scheduled', 'Scheduled content'],
  ['/socials/accounts', 'Accounts & settings'],
] as const;

export default function SocialsLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div>
      <nav aria-label="Socials sections" className="-mx-1 mb-4 flex gap-1 overflow-x-auto pb-1">
        {TABS.map(([href, label]) => {
          const active = href === '/socials' ? path === href : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm',
                active ? 'bg-accent text-accentfg' : 'text-muted hover:bg-panel2',
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
