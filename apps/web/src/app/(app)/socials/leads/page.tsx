'use client';

import { accountLabel } from '@/lib/social-label';
import Link from 'next/link';
import { Async, Badge, EmptyState, PageHeader } from '@/components/ui';
import { useApi } from '@/lib/api';
import { ago, title as titleCase } from '@/lib/format';

export default function LeadsPage() {
  const res = useApi<any[]>('/socials/threads', { query: { leads: 'true' } });
  return (
    <div>
      <PageHeader
        title="Collaboration leads"
        subtitle="Conversations confirmed as opportunities, or that look like business offers (rule-based, please review)."
      />
      <Async
        res={res}
        empty={
          <EmptyState title="No leads">
            Open a conversation and choose "Create collaboration" when it is a real offer.
          </EmptyState>
        }
      >
        {(rows) => (
          <ul className="divide-y divide-border rounded-xl border border-border bg-panel">
            {rows.map((t) => (
              <li key={t.id}>
                <Link href={`/socials/inbox?thread=${t.id}`} className="block px-3 py-2 hover:bg-panel2">
                  <span className="font-medium">{t.participantName ?? t.participantId}</span>{' '}
                  <Badge>{accountLabel(t)}</Badge>{' '}
                  {t.opportunityId ? (
                    <Badge tone="ok">Confirmed lead</Badge>
                  ) : (
                    <Badge tone="warn">Possible: {titleCase(t.category)}</Badge>
                  )}
                  <div className="truncate text-xs text-muted">
                    {t.preview} · {ago(t.lastMessageAt)}
                  </div>
                </Link>
                {t.opportunityId && (
                  <Link href="/collaborations" className="px-3 pb-2 text-xs text-accent">
                    Open in Collaborations
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Async>
    </div>
  );
}
