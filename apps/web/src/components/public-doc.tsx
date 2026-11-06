import type { ReactNode } from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/brand-mark';
import { LEGAL } from '@/lib/legal';

const LINKS = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/legal/data-deletion', label: 'Data deletion' },
];

/** Public legal pages. No sign-in. Reviewers can open these addresses directly. */
export function PublicDoc({ children }: { children: ReactNode }) {
  return (
    <div className="legal-shell min-h-dvh">
      <header className="border-b border-border bg-panel">
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-5 py-4">
          <BrandLogo className="h-9" />
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold" aria-label="Policies">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="text-muted hover:text-text">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-5 py-8 text-base leading-relaxed">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 px-5 py-6 text-sm text-muted">
          <p>
            {LEGAL.product} is a free, invitation-only tool operated by {LEGAL.operator} in {LEGAL.region}.
          </p>
          <p>
            <a className="text-accent underline" href={`mailto:${LEGAL.email}`}>
              {LEGAL.email}
            </a>
          </p>
          <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Policies">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-text">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function OnThisPage({ items }: { items: { id: string; label: string }[] }) {
  return (
    <nav aria-label="On this page">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {items.map((item) => (
          <li key={item.id}>
            <a className="text-accent underline" href={`#${item.id}`}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
