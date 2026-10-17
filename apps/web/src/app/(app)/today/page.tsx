'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { Check, Clock, Pin, PinOff, Plus, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { useMe } from '@/components/shell';
import {
  ActionButton,
  Async,
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  FormDialog,
  Input,
  Options,
  PageHeader,
  Select,
  Tabs,
  Textarea,
} from '@/components/ui';
import { post, refresh, useApi } from '@/lib/api';
import { ago, parseDate, when } from '@/lib/format';

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
const priTone = { URGENT: 'bad', HIGH: 'warn', NORMAL: 'neutral', LOW: 'neutral' } as const;

function snoozeUntil(kind: 'later' | 'tomorrow' | 'week') {
  const d = new Date();
  if (kind === 'later') d.setHours(d.getHours() + 3);
  else if (kind === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  } else {
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    d.setHours(9, 0, 0, 0);
  }
  return d.toISOString();
}

export default function TodayPage() {
  const me = useMe();
  const tz = me.data?.organization?.timezone;
  const [tab, setTab] = useState<'OPEN' | 'SNOOZED' | 'DONE'>('OPEN');
  const open = useApi<any[]>('/actions', { query: { state: 'OPEN', limit: 200 } });
  const snoozed = useApi<any[]>('/actions', { query: { state: 'SNOOZED', limit: 100 } });
  const done = useApi<any[]>('/actions/recent');
  const notes = useApi<any[]>('/notifications', { query: { limit: 20 } });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: '', description: '', dueAt: '', priority: 'NORMAL' });
  const res = tab === 'OPEN' ? open : tab === 'SNOOZED' ? snoozed : done;
  const reload = () => refresh('/actions', '/briefing');

  return (
    <>
      <PageHeader
        title="Inbox & Today"
        subtitle="Everything that needs a decision, in priority order. Nothing is sent or posted from here without your confirmation."
        actions={
          <>
            <ActionButton
              onAction={async () => {
                await post('/actions/refresh');
                await reload();
              }}
              success="Refreshed from your latest data"
            >
              Refresh
            </ActionButton>
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add action
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tabs
            tabs={[
              { id: 'OPEN', label: 'To do', badge: open.data?.length },
              { id: 'SNOOZED', label: 'Snoozed', badge: snoozed.data?.length || undefined },
              { id: 'DONE', label: 'Recently done' },
            ]}
            value={tab}
            onChange={setTab}
          />
          <div className="mt-3">
            <Async
              res={res}
              empty={
                <EmptyState title={tab === 'OPEN' ? 'All clear' : 'Nothing here'}>
                  {tab === 'OPEN' ? 'No open actions. Enjoy it, or capture something new.' : 'No items.'}
                </EmptyState>
              }
            >
              {(rows) => (
                <ul className="space-y-2">
                  {rows.map((a) => {
                    const overdue = a.dueAt && parseDate(a.dueAt) < new Date() && a.state === 'OPEN';
                    return (
                      <li
                        key={a.id}
                        className={clsx(
                          'rounded-xl border bg-panel p-3',
                          overdue ? 'border-bad/50' : 'border-border',
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {a.pinned && <Pin className="size-3.5 text-accent" aria-label="Pinned" />}
                              <span className="font-medium">
                                {a.deepLink ? (
                                  <Link className="hover:underline" href={a.deepLink}>
                                    {a.title}
                                  </Link>
                                ) : (
                                  a.title
                                )}
                              </span>
                              <Badge tone={priTone[a.priority as keyof typeof priTone]}>
                                {a.priority.toLowerCase()}
                              </Badge>
                              {overdue && <Badge tone="bad">overdue</Badge>}
                            </div>
                            {a.description && <p className="mt-1 text-sm text-muted">{a.description}</p>}
                            <p className="mt-1 text-xs text-muted">
                              {a.reason}
                              {a.dueAt && <> · due {when(a.dueAt, tz)}</>}
                              {a.snoozedUntil && a.state === 'SNOOZED' && (
                                <> · back {when(a.snoozedUntil, tz)}</>
                              )}
                              {a.completedAt && <> · done {ago(a.completedAt)}</>}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1">
                            {a.state === 'OPEN' ? (
                              <>
                                <ActionButton
                                  size="sm"
                                  variant="primary"
                                  aria-label={`Complete ${a.title}`}
                                  onAction={async () => {
                                    await post(`/actions/${a.id}/complete`, {});
                                    await reload();
                                  }}
                                  success="Marked done"
                                >
                                  <Check className="size-4" />
                                </ActionButton>
                                <ActionButton
                                  size="sm"
                                  aria-label={`Pin ${a.title}`}
                                  onAction={async () => {
                                    await post(`/actions/${a.id}/pin`, { pinned: !a.pinned });
                                    await reload();
                                  }}
                                >
                                  {a.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                                </ActionButton>
                                <Snooze id={a.id} onDone={reload} />
                                <ActionButton
                                  size="sm"
                                  aria-label={`Dismiss ${a.title}`}
                                  confirm={`Dismiss “${a.title}”? It won't come back unless the underlying data changes.`}
                                  onAction={async () => {
                                    await post(`/actions/${a.id}/dismiss`, {});
                                    await reload();
                                  }}
                                >
                                  <X className="size-4" />
                                </ActionButton>
                              </>
                            ) : (
                              <ActionButton
                                size="sm"
                                onAction={async () => {
                                  await post(`/actions/${a.id}/reopen`, {});
                                  await reload();
                                }}
                              >
                                <RotateCcw className="size-4" /> Reopen
                              </ActionButton>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Async>
          </div>
        </div>

        <Card>
          <CardTitle
            action={
              (notes.data?.length ?? 0) > 0 && (
                <ActionButton
                  size="sm"
                  variant="ghost"
                  onAction={async () => {
                    await post('/notifications/read', { all: true });
                    await refresh('/notifications');
                  }}
                >
                  Mark all read
                </ActionButton>
              )
            }
          >
            Notifications
          </CardTitle>
          <Async res={notes} empty={<p className="text-sm text-muted">No notifications.</p>}>
            {(rows) => (
              <ul className="space-y-2">
                {rows.map((n) => (
                  <li
                    key={n.id}
                    className={clsx(
                      'rounded-lg border p-2 text-sm',
                      n.readAt ? 'border-border text-muted' : 'border-accent/40',
                    )}
                  >
                    <div className="font-medium">
                      {n.deepLink ? (
                        <Link href={n.deepLink} className="hover:underline">
                          {n.title}
                        </Link>
                      ) : (
                        n.title
                      )}
                    </div>
                    {n.body && <div className="text-xs text-muted">{n.body}</div>}
                    <div className="mt-0.5 text-xs text-muted">{ago(n.createdAt)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Async>
        </Card>
      </div>

      <FormDialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add action"
        submitLabel="Add"
        onSubmit={async () => {
          await post('/actions', {
            title: f.title.trim(),
            description: f.description.trim() || undefined,
            dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : undefined,
            priority: f.priority,
          });
          setF({ title: '', description: '', dueAt: '', priority: 'NORMAL' });
          await reload();
        }}
      >
        <Field label="What needs doing?">
          <Input required autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Details (optional)">
          <Textarea
            rows={3}
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due">
            <Input
              type="datetime-local"
              value={f.dueAt}
              onChange={(e) => setF({ ...f, dueAt: e.target.value })}
            />
          </Field>
          <Field label="Priority">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              <Options values={PRIORITIES} />
            </Select>
          </Field>
        </div>
      </FormDialog>
    </>
  );
}

function Snooze({ id, onDone }: { id: string; onDone: () => Promise<unknown> | void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <Button size="sm" aria-label="Snooze" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Clock className="size-4" />
      </Button>
      {open && (
        <span className="absolute right-0 z-20 mt-1 flex w-40 flex-col rounded-lg border border-border bg-panel p-1 shadow-lg">
          {(
            [
              ['later', 'In 3 hours'],
              ['tomorrow', 'Tomorrow 9:00'],
              ['week', 'Next week'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className="rounded px-2 py-1.5 text-left text-sm hover:bg-panel2"
              onClick={async () => {
                setOpen(false);
                await post(`/actions/${id}/snooze`, { until: snoozeUntil(k) });
                await onDone();
              }}
            >
              {label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
