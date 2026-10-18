'use client';

import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import {
  ActionButton,
  Async,
  Badge,
  Button,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Select,
  Textarea,
  Input,
} from '@/components/ui';
import { patch, post, refresh, useApi } from '@/lib/api';
import { ago, title as titleCase, when } from '@/lib/format';
import { accountLabel } from '@/lib/social-label';
import { REPLY_CATEGORY_INFO, type ReplyCategory } from '@creatoros/domain';

function Inbox() {
  const params = useSearchParams();
  const initial = params.get('account') ?? '';
  const [view, setView] = useState('');
  const [account, setAccount] = useState(initial);
  const [state, setState] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [sel, setSel] = useState<string | null>(params.get('thread'));
  const accounts = useApi<any[]>('/socials/accounts');
  const threads = useApi<any[]>('/socials/threads', {
    query: {
      accounts: account || undefined,
      state: state || undefined,
      kind: kind || undefined,
      q: q || undefined,
      category: category || undefined,
      unread: view === 'unread' ? 'true' : undefined,
      starred: view === 'starred' ? 'true' : undefined,
      followUp: view === 'followup' ? 'true' : undefined,
      leads: view === 'leads' ? 'true' : undefined,
      archived: view === 'archived' ? 'true' : undefined,
    },
  });
  const counts = useApi<any>('/socials/threads/counts', {
    query: { accounts: account || undefined, kind: kind || undefined },
  });
  const c = counts.data;
  const viewCount: Record<string, number | undefined> = {
    '': c?.all,
    unread: c?.unread,
    starred: c?.starred,
    followup: c?.followup,
    leads: c?.leads,
    archived: c?.archived,
  };
  return (
    <div>
      <PageHeader
        title="Unified inbox"
        subtitle="All connected accounts in one list. Each conversation is locked to the account that received it."
      />
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <Select aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">All accounts</option>
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {accountLabel(a)}
              {a.linked?.channel ? ` (${a.linked.channel})` : ''}
            </option>
          ))}
        </Select>
        <Select aria-label="State" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">Any state</option>
          <option value="NEED_REPLY">Needs reply</option>
          <option value="WAITING_FOR_BRAND">Waiting for them</option>
          <option value="DONE">Done</option>
        </Select>
        <Select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">DMs and comments</option>
          <option value="DM">DMs</option>
          <option value="COMMENT">Comments</option>
        </Select>
        <Input aria-label="Search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Saved views">
        {[
          ['', 'All'],
          ['unread', 'Unread'],
          ['starred', 'Starred'],
          ['followup', 'Follow up'],
          ['leads', 'Collaboration leads'],
          ['archived', 'Archived (local)'],
        ].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setView(k!)}
            className={clsx(
              'rounded-full border border-border px-3 py-1 text-xs',
              view === k ? 'bg-accent text-accentfg' : 'bg-panel hover:bg-panel2',
            )}
          >
            {l}
            {viewCount[k!] !== undefined && (
              <span className="ml-1.5 tabular-nums opacity-80">{viewCount[k!]!.toLocaleString()}</span>
            )}
          </button>
        ))}
      </div>
      <div className="mb-3" role="group" aria-label="What to reply to">
        <div className="mb-1 flex flex-wrap items-baseline gap-2 text-xs text-muted">
          <span className="font-medium text-text">What to reply to</span>
          <span>
            Conversations still waiting for your reply, sorted by what is worth your time. Suggestions from
            keywords, not a decision.
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => {
              setCategory('');
              setState('');
            }}
            className={clsx(
              'rounded-full border border-border px-3 py-1 text-xs',
              !category ? 'bg-accent text-accentfg' : 'bg-panel hover:bg-panel2',
            )}
          >
            Any
            {c && <span className="ml-1.5 tabular-nums opacity-80">{c.needReply.toLocaleString()}</span>}
          </button>
          {(Object.keys(REPLY_CATEGORY_INFO) as ReplyCategory[]).map((k) => {
            const info = REPLY_CATEGORY_INFO[k];
            const n = c?.reply?.[k] ?? 0;
            return (
              <button
                key={k}
                title={info.hint}
                onClick={() => {
                  setCategory(category === k ? '' : k);
                  setState(category === k ? '' : 'NEED_REPLY');
                  setView('');
                }}
                className={clsx(
                  'rounded-full border px-3 py-1 text-xs',
                  category === k
                    ? 'border-transparent bg-accent text-accentfg'
                    : clsx(
                        'bg-panel hover:bg-panel2',
                        info.group === 'first' ? 'border-warn/50' : 'border-border',
                        n === 0 && 'opacity-50',
                      ),
                )}
              >
                {info.label}
                <span className="ml-1.5 tabular-nums opacity-80">{n.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className={clsx(sel && 'hidden lg:block')}>
          <Async
            res={threads}
            empty={
              <EmptyState title="No conversations">
                Messages appear here once Instagram webhooks are delivered or after Sync now.
              </EmptyState>
            }
          >
            {(rows) => (
              <ul className="divide-y divide-border rounded-xl border border-border bg-panel">
                {rows.map((t) => (
                  <li key={t.id}>
                    <button
                      className={clsx(
                        'w-full px-3 py-2 text-left hover:bg-panel2',
                        sel === t.id && 'bg-panel2',
                      )}
                      onClick={() => setSel(t.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{t.participantName ?? t.participantId}</span>
                        {t.unread > 0 && <Badge tone="info">{t.unread}</Badge>}
                      </div>
                      <div className="truncate text-xs text-muted">{t.preview}</div>
                      <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted">
                        <Badge>{accountLabel(t)}</Badge>
                        <Badge tone={t.state === 'NEED_REPLY' ? 'warn' : 'neutral'}>
                          {titleCase(t.state)}
                        </Badge>
                        {t.replyCategory && REPLY_CATEGORY_INFO[t.replyCategory as ReplyCategory] && (
                          <Badge
                            tone={
                              REPLY_CATEGORY_INFO[t.replyCategory as ReplyCategory].group === 'first'
                                ? 'warn'
                                : 'neutral'
                            }
                          >
                            {REPLY_CATEGORY_INFO[t.replyCategory as ReplyCategory].label}
                          </Badge>
                        )}
                        <span>{ago(t.lastMessageAt)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Async>
        </div>
        <div className={clsx(!sel && 'hidden lg:block')}>
          {sel ? (
            <Thread id={sel} onBack={() => setSel(null)} />
          ) : (
            <EmptyState title="Select a conversation" />
          )}
        </div>
      </div>
    </div>
  );
}

function Tools({ t, id }: { t: any; id: string }) {
  const [notes, setNotes] = useState(t.internalNotes ?? '');
  const done = async (fn: () => Promise<unknown>) => {
    await fn();
    await refresh('/socials');
  };
  return (
    <div className="mb-3 space-y-2 text-sm">
      <div className="flex flex-wrap gap-1.5">
        <ActionButton
          size="sm"
          onAction={() => done(() => patch(`/socials/threads/${id}/local`, { starred: !t.starred }))}
        >
          {t.starred ? 'Unstar' : 'Star'}
        </ActionButton>
        <ActionButton
          size="sm"
          onAction={() =>
            done(() => patch(`/socials/threads/${id}/local`, { archivedLocal: !t.archivedLocal }))
          }
        >
          {t.archivedLocal ? 'Unarchive (CreatorOS only)' : 'Archive (CreatorOS only)'}
        </ActionButton>
        <ActionButton
          size="sm"
          success="Follow-up set for tomorrow"
          onAction={() => done(() => post(`/socials/threads/${id}/follow-up`, { preset: 'tomorrow' }))}
        >
          Follow up tomorrow
        </ActionButton>
        <ActionButton
          size="sm"
          success="Follow-up set for next week"
          onAction={() => done(() => post(`/socials/threads/${id}/follow-up`, { preset: 'next_week' }))}
        >
          Next week
        </ActionButton>
        <ActionButton
          size="sm"
          success="Task ready in Actions"
          onAction={() => done(() => post(`/socials/threads/${id}/create-task`, {}))}
        >
          Create task
        </ActionButton>
        <ActionButton
          size="sm"
          success={t.opportunityId ? 'Already a collaboration' : 'Collaboration created'}
          onAction={() => done(() => post(`/socials/threads/${id}/create-collaboration`, {}))}
        >
          {t.opportunityId ? 'Collaboration linked' : 'Create collaboration'}
        </ActionButton>
      </div>
      {t.followUpAt && <p className="text-xs text-muted">Follow-up due {when(t.followUpAt)}</p>}
      <p className="text-xs text-muted">
        Star, archive, notes and read state only exist in CreatorOS. They do not change anything on Instagram.
      </p>
      <Textarea
        aria-label="Internal notes"
        rows={2}
        placeholder="Internal notes (private to CreatorOS)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <ActionButton
        size="sm"
        success="Notes saved"
        onAction={() => done(() => patch(`/socials/threads/${id}/local`, { internalNotes: notes }))}
      >
        Save notes
      </ActionButton>
    </div>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const res = useApi<any>(`/socials/threads/${id}`);
  useEffect(() => {
    void post(`/socials/threads/${id}/read`).then(
      () => refresh('/socials/threads', '/socials/overview'),
      () => {},
    );
  }, [id]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return (
    <Async res={res}>
      {(t) => (
        <Card>
          <button className="mb-2 text-sm text-accent lg:hidden" onClick={onBack}>
            ← Back to list
          </button>
          <div className="mb-3 rounded-lg border border-border bg-panel2 p-2 text-sm">
            <div>
              <span className="text-muted">Reply as</span>{' '}
              <strong>
                {t.replyAs
                  ? (t.replyAs.displayName ?? `@${t.replyAs.username ?? t.replyAs.accountId}`)
                  : 'account disconnected'}
              </strong>
            </div>
            <div>
              <span className="text-muted">Reply to</span>{' '}
              <strong>{t.replyTo.name ?? t.replyTo.participantId}</strong>{' '}
              <span className="text-xs text-muted">({titleCase(t.kind)})</span>
            </div>
            {t.optedOut && <Badge tone="bad">Asked not to be messaged automatically</Badge>}
          </div>
          {t.media && (
            <div className="mb-3 flex gap-2 rounded-lg border border-border bg-panel2 p-2 text-sm">
              {t.media.thumbnailUrl && (
                <img src={t.media.thumbnailUrl} alt="" className="size-14 rounded object-cover" />
              )}
              <div className="min-w-0">
                <div className="text-xs text-muted">
                  Comment on your {String(t.media.type ?? 'post').toLowerCase()}
                </div>
                <div className="line-clamp-2">{t.media.caption ?? '(no caption)'}</div>
                {t.media.permalink && (
                  <a
                    href={t.media.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-accent"
                  >
                    Open on Instagram
                  </a>
                )}
              </div>
            </div>
          )}
          <Tools t={t} id={id} />
          <ul className="mb-3 max-h-96 space-y-2 overflow-y-auto">
            {t.messages.map((m: any) => (
              <li
                key={m.id}
                className={clsx(
                  'max-w-[85%] rounded-lg px-3 py-1.5 text-sm',
                  m.direction === 'OUTBOUND' ? 'ml-auto bg-accent/15' : 'bg-panel2',
                )}
              >
                <div className="whitespace-pre-wrap break-words">
                  {m.text || (
                    <span className="italic text-muted">
                      No text (photo, video, reel, story reply, reaction or removed message). Open it on the
                      platform to see it.
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted">{when(m.receivedAt)}</div>
              </li>
            ))}
          </ul>
          {t.outbound
            .filter((o: any) => ['DRAFT', 'UNCERTAIN', 'FAILED', 'SENDING'].includes(o.state))
            .map((o: any) => (
              <Notice
                key={o.id}
                tone={o.state === 'DRAFT' ? 'info' : 'warn'}
                title={`${titleCase(o.state)} (${titleCase(o.source)})`}
              >
                {o.body}
                {o.error && <span className="block">{o.error}</span>}
                {o.state === 'DRAFT' && (
                  <Button size="sm" className="mt-1" onClick={() => setText(o.body)}>
                    Use as my reply
                  </Button>
                )}
              </Notice>
            ))}
          {!t.eligibility.canSend && <Notice tone="warn">{t.eligibility.reasons.join(' ')}</Notice>}
          {error && <Notice tone="bad">{error}</Notice>}
          <Textarea
            aria-label="Reply"
            rows={3}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <ActionButton
              disabled={!text.trim()}
              onAction={async () => {
                await post(`/socials/threads/${id}/reply`, {
                  connectionId: t.replyAs.connectionId,
                  text,
                  requestId: `ui-${crypto.randomUUID()}`,
                  send: false,
                });
                setText('');
                await refresh('/socials');
              }}
              success="Draft saved"
            >
              Save draft
            </ActionButton>
            <ActionButton
              variant="primary"
              disabled={!text.trim() || !t.eligibility.canSend || !t.replyAs}
              onAction={async () => {
                try {
                  setError('');
                  await post(`/socials/threads/${id}/reply`, {
                    connectionId: t.replyAs.connectionId,
                    text,
                    requestId: `ui-${crypto.randomUUID()}`,
                    send: true,
                  });
                  setText('');
                  await refresh('/socials');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
              success="Sent"
            >
              Send
            </ActionButton>
          </div>
        </Card>
      )}
    </Async>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Inbox />
    </Suspense>
  );
}
