'use client';

import { accountLabel } from '@/lib/social-label';
import Link from 'next/link';
import { Async, Badge, EmptyState, PageHeader } from '@/components/ui';
import { useApi } from '@/lib/api';
import { ago, title as titleCase } from '@/lib/format';

export default function CommentsPage() {
  const res = useApi<any[]>('/socials/threads', { query: { kind: 'COMMENT' } });
  return (
    <div>
      <PageHeader
        title="Comments"
        subtitle="Comment threads received on connected accounts. Replies go out from the account that received the comment."
      />
      <Async
        res={res}
        empty={
          <EmptyState title="No comments synchronised">
            Instagram and Facebook comments arrive through webhooks and Sync now. YouTube comments are polled
            once you press Enable comments in Integrations. Threads comments are not built.
          </EmptyState>
        }
      >
        {(rows) => (
          <ul className="divide-y divide-border rounded-xl border border-border bg-panel">
            {rows.map((t) => (
              <li key={t.id}>
                <Link href={`/socials/inbox?thread=${t.id}`} className="block px-3 py-2 hover:bg-panel2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.participantName ?? t.participantId}</span>
                    <Badge>{accountLabel(t)}</Badge>
                    <Badge tone={t.state === 'NEED_REPLY' ? 'warn' : 'neutral'}>{titleCase(t.state)}</Badge>
                  </div>
                  {t.mediaCaption && <div className="truncate text-xs text-muted">On: {t.mediaCaption}</div>}
                  <div className="truncate text-xs text-muted">
                    {t.preview} · {ago(t.lastMessageAt)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </div>
  );
}
