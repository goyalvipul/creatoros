'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Async, Badge, Button, Card, CardTitle, EmptyState, PageHeader, Select, Stat } from '@/components/ui';
import { useApi } from '@/lib/api';
import { ago, title as titleCase, when } from '@/lib/format';

export default function SocialsOverview() {
  const [account, setAccount] = useState('');
  const [days, setDays] = useState('30');
  const accounts = useApi<any[]>('/socials/accounts');
  const res = useApi<any>('/socials/overview', { query: { account: account || undefined, days } });
  return (
    <div>
      <PageHeader
        title="Socials"
        subtitle="Numbers below come from conversations CreatorOS has synchronised. Unread is CreatorOS read state, not the platform's."
        actions={
          <Link href="/socials/inbox">
            <Button variant="primary">Open inbox</Button>
          </Link>
        }
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Select aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">All accounts</option>
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              Instagram @{a.username ?? a.accountId}
            </option>
          ))}
        </Select>
        <Select aria-label="Date range" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </Select>
      </div>
      <Async res={res}>
        {(o) =>
          o.accountsTotal === 0 ? (
            <EmptyState
              title="No social accounts connected"
              action={
                <Link href="/integrations">
                  <Button variant="primary">Connect Instagram</Button>
                </Link>
              }
            >
              Only Instagram can be connected today. Facebook, YouTube comments, Threads and TikTok are not
              built.
            </EmptyState>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Connected accounts" value={o.accountsTotal} />
                <Stat label="Unread messages" value={o.unreadMessages} />
                <Stat label="Needs reply" value={o.needReply} />
                <Stat label={`Received (${o.days} d)`} value={o.received} />
                <Stat label="Comments awaiting reply" value={o.commentsAwaiting} />
                <Stat label="Collaboration leads" value={o.leads} />
                <Stat label="Follow-ups overdue" value={o.followUpsOverdue} />
                <Stat label="Mentions" value={o.mentions ?? 'Not collected'} />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardTitle>Needs reply</CardTitle>
                  {o.needsReplyList.length === 0 ? (
                    <p className="text-sm text-muted">Nothing is waiting for a reply.</p>
                  ) : (
                    <ul className="divide-y divide-border text-sm">
                      {o.needsReplyList.map((t: any) => (
                        <li key={t.id} className="py-2">
                          <Link
                            href={`/socials/inbox?thread=${t.id}`}
                            className="font-medium hover:underline"
                          >
                            {t.participantName}
                          </Link>{' '}
                          <Badge>@{t.accountUsername}</Badge> <Badge>{titleCase(t.kind)}</Badge>
                          <div className="truncate text-xs text-muted">
                            {t.preview} · {ago(t.lastInboundAt)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card>
                  <CardTitle>Collaboration opportunities</CardTitle>
                  {o.leadList.length === 0 ? (
                    <p className="text-sm text-muted">No conversation has been confirmed as a lead.</p>
                  ) : (
                    <ul className="divide-y divide-border text-sm">
                      {o.leadList.map((t: any) => (
                        <li key={t.id} className="py-2">
                          <Link
                            href={`/socials/inbox?thread=${t.id}`}
                            className="font-medium hover:underline"
                          >
                            {t.participantName}
                          </Link>{' '}
                          <Badge>@{t.accountUsername}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card>
                  <CardTitle>Connection problems</CardTitle>
                  {o.connectionProblems.length === 0 ? (
                    <p className="text-sm text-muted">All connected accounts report healthy.</p>
                  ) : (
                    <ul className="text-sm">
                      {o.connectionProblems.map((c: any) => (
                        <li key={c.id} className="py-1">
                          @{c.username ?? c.label} <Badge tone="bad">{titleCase(c.state)}</Badge>
                          {c.lastError && <span className="block text-xs text-muted">{c.lastError}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link href="/socials/accounts" className="mt-2 inline-block text-sm text-accent">
                    Manage accounts
                  </Link>
                </Card>
                <Card>
                  <CardTitle>Scheduled publishing</CardTitle>
                  {o.scheduled.length === 0 ? (
                    <p className="text-sm text-muted">No planned posts.</p>
                  ) : (
                    <ul className="text-sm">
                      {o.scheduled.map((p: any) => (
                        <li key={p.id} className="py-1">
                          {p.title ?? 'Untitled'} · {titleCase(p.platform)} {p.accountHandle} ·{' '}
                          {when(p.plannedAt, p.timezone)}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </>
          )
        }
      </Async>
    </div>
  );
}
