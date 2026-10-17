'use client';

import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
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
import { post, refresh, useApi } from '@/lib/api';
import { ago, title as titleCase, when } from '@/lib/format';

function Inbox() {
  const initial = useSearchParams().get('account') ?? '';
  const [account, setAccount] = useState(initial);
  const [state, setState] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const accounts = useApi<any[]>('/socials/accounts');
  const threads = useApi<any[]>('/socials/threads', {
    query: {
      accounts: account || undefined,
      state: state || undefined,
      kind: kind || undefined,
      q: q || undefined,
    },
  });
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
              @{a.username ?? a.accountId}
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
                        <Badge>@{t.accountUsername ?? t.accountId}</Badge>
                        <Badge tone={t.state === 'NEED_REPLY' ? 'warn' : 'neutral'}>
                          {titleCase(t.state)}
                        </Badge>
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

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const res = useApi<any>(`/socials/threads/${id}`);
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
                {t.replyAs ? `@${t.replyAs.username ?? t.replyAs.accountId}` : 'account disconnected'}
              </strong>
            </div>
            <div>
              <span className="text-muted">Reply to</span>{' '}
              <strong>{t.replyTo.name ?? t.replyTo.participantId}</strong>{' '}
              <span className="text-xs text-muted">({titleCase(t.kind)})</span>
            </div>
            {t.optedOut && <Badge tone="bad">Asked not to be messaged automatically</Badge>}
          </div>
          <ul className="mb-3 max-h-96 space-y-2 overflow-y-auto">
            {t.messages.map((m: any) => (
              <li
                key={m.id}
                className={clsx(
                  'max-w-[85%] rounded-lg px-3 py-1.5 text-sm',
                  m.direction === 'OUTBOUND' ? 'ml-auto bg-accent/15' : 'bg-panel2',
                )}
              >
                <div className="whitespace-pre-wrap break-words">{m.text}</div>
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
              confirm={`Send this message as @${t.replyAs?.username ?? ''} to ${t.replyTo.name ?? t.replyTo.participantId}?`}
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
