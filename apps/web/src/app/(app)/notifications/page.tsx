'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { ActionButton, Async, PageHeader } from '@/components/ui';
import { post, refresh, useApi } from '@/lib/api';
import { ago } from '@/lib/format';

type Note = {
  id: string;
  title: string;
  body?: string | null;
  deepLink?: string | null;
  readAt?: string | null;
  createdAt: string;
};

export default function NotificationsPage() {
  const notes = useApi<Note[]>('/notifications', { query: { limit: 50 } });
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="The same alerts as the bell. Opening one follows its existing link. Nothing is sent from this page."
        actions={
          <ActionButton
            onAction={async () => {
              await post('/notifications/read', { all: true });
              await refresh('/notifications');
            }}
          >
            Mark all read
          </ActionButton>
        }
      />
      <Async res={notes} empty={<p className="text-sm text-muted">No notifications yet.</p>}>
        {(rows) => (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-panel">
            {rows.map((n) => (
              <li key={n.id} className={clsx('px-3 py-3 text-sm', n.readAt && 'text-muted')}>
                <div className="font-medium">
                  {n.deepLink ? (
                    <Link href={n.deepLink} className="hover:text-accent">
                      {n.title}
                    </Link>
                  ) : (
                    n.title
                  )}
                </div>
                {n.body && <p className="mt-1 text-xs text-muted">{n.body}</p>}
                <p className="mt-1 text-xs text-muted">{ago(n.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </>
  );
}
