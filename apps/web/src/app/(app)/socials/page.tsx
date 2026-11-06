'use client';

import { accountLabel } from '@/lib/social-label';
import Link from 'next/link';
import { useState } from 'react';
import { Async, Badge, Button, Card, CardTitle, EmptyState, PageHeader, Select, Stat } from '@/components/ui';
import { ApiError, post, refresh, useApi } from '@/lib/api';
import { ago, title as titleCase, when } from '@/lib/format';
import { PlatformLogo } from '@/components/platform-logo';

const REASON: Record<string, string> = {
  partnership: 'Partnerships',
  collab: 'Says collaboration',
  rates: 'Asks for rates',
};

export default function SocialsOverview() {
  const [account, setAccount] = useState('');
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const accounts = useApi<any[]>('/socials/accounts');
  const res = useApi<any>('/socials/overview', { query: { account: account || undefined, days } });
  async function decide(id: string, kind: 'dismiss' | 'accept') {
    setBusy(id);
    setDecideError(null);
    setNote(null);
    try {
      const path = kind === 'dismiss' ? 'dismiss-opportunity' : 'accept-opportunity';
      const out = await post<{ projectId?: string }>(`/socials/threads/${id}/${path}`, {});
      if (out.projectId) setNote('Project created. A follow-up is on Today. Nothing was sent.');
      refresh('/socials/overview');
    } catch (e) {
      setDecideError(e instanceof ApiError ? e.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }
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
              {accountLabel(a)}
              {a.linked?.channel ? ` (${a.linked.channel})` : ''}
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
              Connect Instagram, a Facebook Page or YouTube (comments) in Integrations. Threads and TikTok are
              not built.
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
                          <Badge>{t.accountName ?? `@${t.accountUsername}`}</Badge>{' '}
                          <Badge>{titleCase(t.kind)}</Badge>
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
                  <p className="mb-2 text-xs text-muted">
                    Partnerships, messages that say collaboration, and requests for reel rates. Nothing is created
                    until you choose. Not keeps the message and does not ask again.
                  </p>
                  {note && <p className="mb-2 text-sm text-ok">{note}</p>}
                  {decideError && <p className="mb-2 text-sm text-bad">{decideError}</p>}
                  {(o.suggestions ?? []).length === 0 && o.leadList.length === 0 ? (
                    <p className="text-sm text-muted">No messages waiting for a decision.</p>
                  ) : (
                    <ul className="divide-y divide-border text-sm">
                      {(o.suggestions ?? []).map((s: any) => (
                        <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{s.participantName || 'Unknown'}</span>
                              <Badge>{REASON[s.reason] ?? s.reason}</Badge>
                              {s.accountName && <span className="text-xs text-muted">{s.accountName}</span>}
                            </div>
                            {s.preview && <p className="mt-1 line-clamp-2 text-xs text-muted">{s.preview}</p>}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button size="sm" disabled={busy === s.id} onClick={() => decide(s.id, 'dismiss')}>
                              Not
                            </Button>
                            <Button size="sm" variant="primary" disabled={busy === s.id} onClick={() => decide(s.id, 'accept')}>
                              Create project
                            </Button>
                          </div>
                        </li>
                      ))}
                      {o.leadList.map((t: any) => (
                        <li key={t.id} className="py-2">
                          <Link href={`/socials/inbox?thread=${t.id}`} className="font-medium hover:underline">
                            {t.participantName}
                          </Link>{' '}
                          <Badge>{t.accountName ?? `@${t.accountUsername}`}</Badge>
                          <span className="ml-2 text-xs text-muted">Confirmed</span>
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
                          {p.title ?? 'Untitled'} · <PlatformLogo platform={p.platform} className="inline size-4 align-text-bottom" /> {p.accountHandle} ·{' '}
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
