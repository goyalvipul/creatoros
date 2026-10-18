'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { useMe } from '@/components/shell';
import {
  ActionButton,
  Async,
  Badge,
  Card,
  Button,
  CardTitle,
  Field,
  Input,
  KV,
  Notice,
  Options,
  PageHeader,
  Select,
  StateBadge,
  Textarea,
} from '@/components/ui';
import { patch, post, refresh, useApi } from '@/lib/api';
import { SuggestionCard } from '../../invoice-suggestions';
import { title as titleCase, when } from '@/lib/format';

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const res = useApi<any>(`/threads/${id}`);
  const me = useMe();
  const tz = me.data?.organization?.timezone;
  const [state, setState] = useState('');
  const reload = () => refresh(`/threads/${id}`, '/threads', '/briefing', '/mail', '/actions');
  const sug = useApi<any[]>('/mail/invoice-suggestions', { query: { threadId: id } });

  return (
    <Async res={res}>
      {(t) => {
        const cls = [...t.messages]
          .reverse()
          .map((m: any) => m.classification)
          .find(Boolean);
        return (
          <>
            <p className="mb-2 text-sm">
              <Link href="/collaborations" className="text-accent">
                ← Collaborations
              </Link>
            </p>
            <PageHeader
              title={t.subject}
              subtitle={
                <span className="flex flex-wrap items-center gap-1.5">
                  <StateBadge state={t.state} />
                  <Badge>{titleCase(t.source)}</Badge>
                  <Badge tone={t.triageState === 'POSSIBLE' ? 'warn' : 'neutral'}>
                    {titleCase(t.triageState)}
                  </Badge>
                  {t.isDemo && <Badge tone="info">demo</Badge>}
                </span>
              }
              actions={
                <>
                  <Select
                    aria-label="Reply state"
                    value={state || t.state}
                    onChange={async (e) => {
                      setState(e.target.value);
                      await post(`/threads/${id}/state`, { state: e.target.value });
                      await reload();
                    }}
                  >
                    <Options values={['NEED_REPLY', 'WAITING_FOR_BRAND', 'WAITING_FOR_USER', 'DONE']} />
                  </Select>
                  {t.externalLink && (
                    <a className="text-sm text-accent" href={t.externalLink} target="_blank" rel="noreferrer">
                      Open original ↗
                    </a>
                  )}
                </>
              }
            />
            <MailToolbar t={t} reload={reload} onArchived={() => router.push('/collaborations')} />
            {t.triageState === 'POSSIBLE' && (
              <div className="mb-4">
                <Notice tone="warn" title="Is this a real collaboration?">
                  <p className="mb-2 text-sm">
                    This was flagged by simple rules, not by AI. Nothing is created until you confirm.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      size="sm"
                      variant="primary"
                      onAction={async () => {
                        await post(`/threads/${id}/triage`, { outcome: 'CONFIRMED' });
                        await reload();
                      }}
                      success="Confirmed. A deal opportunity was created."
                    >
                      Yes, create an opportunity
                    </ActionButton>
                    <ActionButton
                      size="sm"
                      onAction={async () => {
                        await post(`/threads/${id}/triage`, { outcome: 'DISMISSED' });
                        await reload();
                        router.push('/collaborations');
                      }}
                    >
                      Not a collaboration
                    </ActionButton>
                  </div>
                </Notice>
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-3 lg:col-span-2">
                {t.messages.map((m: any) => (
                  <Card key={m.id}>
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{m.fromName ?? m.fromEmail}</span>
                      <Badge tone={m.direction === 'INBOUND' ? 'info' : 'neutral'}>
                        {m.direction === 'INBOUND' ? 'received' : 'sent'}
                      </Badge>
                      <span className="text-xs text-muted">{when(m.receivedAt, tz)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{m.body ?? m.bodyPreview}</p>
                  </Card>
                ))}
                {t.source === 'GMAIL' ? (
                  <ReplyBox t={t} reload={reload} />
                ) : (
                  <Notice tone="info">
                    Creator OS never sends e-mail or messages for you here. Reply in your own mail or app,
                    then set this conversation to “Waiting for brand”.
                  </Notice>
                )}
              </div>
              <div className="space-y-4">
                {(sug.data?.length ?? 0) > 0 && (
                  <Card>
                    <CardTitle>Invoice found in this email</CardTitle>
                    <ul className="-mx-3 divide-y divide-border">
                      {sug.data!.map((x) => (
                        <SuggestionCard key={x.id} s={x} />
                      ))}
                    </ul>
                  </Card>
                )}
                {cls && (
                  <Card>
                    <CardTitle>Suggested reading</CardTitle>
                    <KV
                      items={[
                        ['Looks like', titleCase(cls.category)],
                        ['Confidence', `${Math.round(cls.confidence * 100)}% (${cls.algorithm})`],
                        ['Signals', (cls.signals ?? []).join(', ') || '—'],
                        ['Brand guess', cls.extracted?.brandGuess ?? '—'],
                        ['Missing terms', (cls.extracted?.missingTerms ?? []).join(', ') || '—'],
                      ]}
                    />
                  </Card>
                )}
                {t.dealId && (
                  <Card>
                    <CardTitle>Deal</CardTitle>
                    <Link className="text-sm text-accent" href={`/collaborations/deals/${t.dealId}`}>
                      Open the deal →
                    </Link>
                  </Card>
                )}
              </div>
            </div>
          </>
        );
      }}
    </Async>
  );
}

function MailToolbar({
  t,
  reload,
  onArchived,
}: {
  t: any;
  reload: () => Promise<unknown>;
  onArchived: () => void;
}) {
  const id = t.id;
  const run = (fn: () => Promise<unknown>) => async () => {
    await fn();
    await reload();
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <ActionButton
        size="sm"
        onAction={run(() => patch(`/threads/${id}/local`, { starred: !t.starred }))}
        aria-pressed={t.starred}
      >
        <Star className={t.starred ? 'size-4 fill-current text-warn' : 'size-4'} />
        {t.starred ? 'Starred' : 'Star'}
      </ActionButton>
      {t.triageState !== 'CONFIRMED' && (
        <ActionButton
          size="sm"
          onAction={run(() => post(`/threads/${id}/move`, { to: 'PIPELINE' }))}
          success="Moved to pipeline. An opportunity was created."
        >
          Move to pipeline
        </ActionButton>
      )}
      {t.archivedLocal || t.triageState === 'DISMISSED' ? (
        <ActionButton size="sm" onAction={run(() => post(`/threads/${id}/move`, { to: 'INBOX' }))}>
          Move to inbox
        </ActionButton>
      ) : (
        <ActionButton
          size="sm"
          onAction={async () => {
            await post(`/threads/${id}/move`, { to: 'ARCHIVE' });
            await reload();
            onArchived();
          }}
        >
          Archive
        </ActionButton>
      )}
      <ActionButton
        size="sm"
        onAction={run(() => post(`/threads/${id}/create-task`, {}))}
        success="Task created (or already open). See Actions."
      >
        Create task
      </ActionButton>
      <ActionButton
        size="sm"
        onAction={run(() => post(`/threads/${id}/follow-up`, { preset: 'tomorrow' }))}
        success="Follow-up set for tomorrow"
      >
        Follow up tomorrow
      </ActionButton>
      <ActionButton
        size="sm"
        onAction={run(() => post(`/threads/${id}/follow-up`, { preset: 'next_week' }))}
        success="Follow-up set for next week"
      >
        Next week
      </ActionButton>
      {t.followUpAt && (
        <ActionButton size="sm" onAction={run(() => post(`/threads/${id}/follow-up`, { preset: 'clear' }))}>
          Clear follow-up
        </ActionButton>
      )}
    </div>
  );
}

function ReplyBox({ t, reload }: { t: any; reload: () => Promise<unknown> }) {
  const accounts = useApi<any>('/mail/accounts');
  const acct = accounts.data?.accounts?.find((a: any) => a.id === t.providerConnectionId);
  const [text, setText] = useState('');
  const [to, setTo] = useState('');
  // One id per composed reply: pressing Send twice can never send twice.
  const requestId = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState('');
  if (accounts.data && !acct)
    return (
      <Notice tone="info">
        This email is not linked to a connected Gmail account, so it cannot be replied to here.
      </Notice>
    );
  if (acct && !acct.canSend)
    return (
      <Notice tone="info" title="Reply from Creator OS is off">
        Sending needs one extra Gmail permission.{' '}
        <Link className="text-accent underline" href="/integrations">
          Open Integrations
        </Link>{' '}
        and choose “Enable sending” on {acct.label}. Until then, reply in Gmail and set this conversation to
        “Waiting for brand”.
      </Notice>
    );
  return (
    <Card>
      <CardTitle>Reply{acct ? ` as ${acct.label}` : ''}</CardTitle>
      {sent && <Notice tone="ok">{sent}</Notice>}
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="mt-2 space-y-3">
        <Field label="To (leave empty to reply to the sender)">
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="sender@example.com" />
        </Field>
        <Field label="Message">
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Button
          variant="primary"
          busy={busy}
          disabled={!text.trim()}
          onClick={async () => {
            setBusy(true);
            setErr('');
            setSent('');
            try {
              const r = await post(`/threads/${t.id}/reply`, {
                text,
                requestId: requestId.current,
                to: to.trim() || undefined,
              });
              setSent(`Sent to ${r.to}.`);
              setText('');
              requestId.current = crypto.randomUUID();
              await reload();
            } catch (e) {
              // a refused or uncertain send used its id; a fresh id is needed for any deliberate second attempt
              requestId.current = crypto.randomUUID();
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Send reply
        </Button>
        <p className="text-xs text-muted">
          Sent from your Gmail account in this conversation, only when you press Send. It is never retried
          automatically.
        </p>
      </div>
    </Card>
  );
}
