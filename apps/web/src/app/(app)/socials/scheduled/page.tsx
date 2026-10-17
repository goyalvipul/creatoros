'use client';

import Link from 'next/link';
import { Async, Badge, EmptyState, PageHeader } from '@/components/ui';
import { useApi } from '@/lib/api';
import { title as titleCase, when } from '@/lib/format';

export default function ScheduledPage() {
  const res = useApi<any[]>('/socials/scheduled');
  return (
    <div>
      <PageHeader
        title="Scheduled content"
        subtitle="Planned posts from the Publishing module. Socials cannot publish to Instagram, Facebook, TikTok or Threads yet: these are plans you publish manually or via Postiz."
        actions={
          <Link href="/publishing" className="text-sm text-accent">
            Open Publishing
          </Link>
        }
      />
      <Async res={res} empty={<EmptyState title="Nothing planned" />}>
        {(rows) => (
          <ul className="divide-y divide-border rounded-xl border border-border bg-panel text-sm">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <strong>{p.title ?? 'Untitled'}</strong>
                <Badge>
                  {titleCase(p.platform)} {p.accountHandle}
                </Badge>
                <Badge tone="neutral">{titleCase(p.state)}</Badge>
                <span className="text-muted">{when(p.plannedAt, p.timezone)}</span>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </div>
  );
}
