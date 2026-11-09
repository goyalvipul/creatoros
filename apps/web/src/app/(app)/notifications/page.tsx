'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import { ActionButton, Async, PageHeader } from '@/components/ui';
import { post, refresh, useApi } from '@/lib/api';
import { ago } from '@/lib/format';

type Note = {
  id: string;
  type: string;
  category?: string;
  title: string;
  body?: string | null;
  deepLink?: string | null;
  readAt?: string | null;
  createdAt: string;
};

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'action', label: 'Action needed' },
  { id: 'archived', label: 'Archived' },
] as const;

const CATEGORY: Record<string, string> = {
  publishing: 'Publishing',
  workflows: 'AI and workflows',
  tasks: 'Tasks',
  social: 'Social',
  analytics: 'Analytics',
  system: 'System',
};

function dayLabel(iso: string) {
  const d = new Date(iso);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const diff = Math.round((start.getTime() - that.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function NotificationsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const notes = useApi<Note[]>('/notifications', { query: { filter, limit: 100 } });
  const reload = () => refresh('/notifications');
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Alerts Kemokem raised from your own tasks, posts, and connections. Opening one follows its link."
        actions={
          <ActionButton
            onAction={async () => {
              await post('/notifications/read', { all: true });
              await reload();
            }}
          >
            Mark all read
          </ActionButton>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={clsx(
              'rounded-full border px-3 py-1 text-sm',
              filter === f.id ? 'border-accent bg-accent text-white' : 'border-border bg-panel',
            )}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <Async
        res={notes}
        empty={
          <p className="text-sm text-muted">
            {filter === 'all' ? 'No notifications yet. New ones appear here when Kemokem has something to show.' : 'Nothing in this filter.'}
          </p>
        }
      >
        {(rows) => {
          let last = '';
          return (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-panel">
              {rows.map((n) => {
                const day = dayLabel(n.createdAt);
                const showDay = day !== last;
                last = day;
                const group = CATEGORY[n.category ?? ''] ?? 'System';
                return (
                  <li key={n.id} className={clsx('px-3 py-3 text-sm', n.readAt && 'text-muted')}>
                    {showDay && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{day}</p>}
                    <p className="text-xs text-muted">{group}</p>
                    <div className="font-medium">
                      {n.deepLink ? (
                        <Link
                          href={n.deepLink}
                          className="hover:text-accent"
                          onClick={() => {
                            void post('/notifications/read', { ids: [n.id] });
                          }}
                        >
                          {n.title}
                        </Link>
                      ) : (
                        n.title
                      )}
                    </div>
                    {n.body && <p className="mt-1 text-xs text-muted">{n.body}</p>}
                    <p className="mt-1 text-xs text-muted">{ago(n.createdAt)}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      <button
                        className="text-accent"
                        onClick={async () => {
                          await post('/notifications/read', { ids: [n.id], read: !n.readAt });
                          await reload();
                        }}
                      >
                        {n.readAt ? 'Mark unread' : 'Mark read'}
                      </button>
                      <button
                        className="text-accent"
                        onClick={async () => {
                          await post('/notifications/archive', { ids: [n.id], archived: filter !== 'archived' });
                          await reload();
                        }}
                      >
                        {filter === 'archived' ? 'Restore' : 'Archive'}
                      </button>
                      {filter !== 'archived' && (
                        <button
                          className="text-accent"
                          onClick={async () => {
                            const until = new Date(Date.now() + 60 * 60_000).toISOString();
                            await post('/notifications/snooze', { ids: [n.id], until });
                            await reload();
                          }}
                        >
                          Snooze 1 hour
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </Async>
    </>
  );
}
