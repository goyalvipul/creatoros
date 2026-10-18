'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
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
import { decodeEntities, title as titleCase, when } from '@/lib/format';

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const res = useApi<any>(`/threads/${id}`);
  const me = useMe();
  const tz = me.data?.organization?.timezone;
  const [state, setState] = useState('');
  const reload = () => refresh(`/threads/${id}`, '/threads', '/briefing', '/mail', '/actions');
  const sug = useApi<any[]>('/mail/invoice-suggestions', { query: { threadId: id } });
  // Reply panel: which message is being answered, and whether it is Reply all.
  const [reply, setReply] = useState<{ messageId: string; all: boolean } | null>(null);

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
            <MailToolbar
              t={t}
              reload={reload}
              onArchived={() => router.push('/collaborations')}
              onReply={() => {
                const latest = [...t.messages]
                  .sort((a: any, b: any) => +new Date(b.receivedAt) - +new Date(a.receivedAt))
                  .find((m: any) => m.direction === 'INBOUND');
                if (latest) setReply({ messageId: latest.id, all: false });
              }}
            />
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
                {[...t.messages]
                  .sort((a: any, b: any) => +new Date(b.receivedAt) - +new Date(a.receivedAt))
                  .map((m: any) => (
                    <MessageCard
                      key={m.id}
                      m={m}
                      t={t}
                      tz={tz}
                      reload={reload}
                      active={reply?.messageId === m.id}
                      onReply={(all) => setReply({ messageId: m.id, all })}
                    />
                  ))}
                {t.source !== 'GMAIL' && (
                  <Notice tone="info">
                    Creator OS never sends e-mail or messages for you here. Reply in your own mail or app,
                    then set this conversation to “Waiting for brand”.
                  </Notice>
                )}
              </div>
              <div className="space-y-4 lg:self-start">
                {reply && (
                  <ReplyPanel
                    key={`${reply.messageId}-${reply.all}`}
                    t={t}
                    messageId={reply.messageId}
                    all={reply.all}
                    reload={reload}
                    onClose={() => setReply(null)}
                  />
                )}
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
  onReply,
}: {
  t: any;
  reload: () => Promise<unknown>;
  onArchived: () => void;
  onReply: () => void;
}) {
  const id = t.id;
  const run = (fn: () => Promise<unknown>) => async () => {
    await fn();
    await reload();
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {t.source === 'GMAIL' && (
        <Button size="sm" variant="primary" onClick={onReply}>
          Reply
        </Button>
      )}
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

function MessageCard({
  m,
  t,
  tz,
  reload,
  active,
  onReply,
}: {
  m: any;
  t: any;
  tz?: string;
  reload: () => Promise<unknown>;
  active: boolean;
  onReply: (all: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const text = decodeEntities(m.body ?? m.bodyPreview ?? '');
  const LIMIT = 320;
  const long = text.length > LIMIT;
  // The sync keeps only a short snippet of each email; "Show full email" loads the complete text from Gmail once.
  const maybeSnippet = t.source === 'GMAIL' && text.length < 400;
  return (
    <Card className={active ? 'ring-2 ring-accent' : undefined}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{m.fromName ?? m.fromEmail}</span>
        <Badge tone={m.direction === 'INBOUND' ? 'info' : 'neutral'}>
          {m.direction === 'INBOUND' ? 'received' : 'sent'}
        </Badge>
        <span className="text-xs text-muted">{when(m.receivedAt, tz)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm">{open || !long ? text : `${text.slice(0, LIMIT)}…`}</p>
      {err && <p className="mt-1 text-xs text-bad">{err}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {(long || maybeSnippet) && (
          <Button
            size="sm"
            variant="ghost"
            busy={busy}
            onClick={async () => {
              if (open) return setOpen(false);
              setErr('');
              if (maybeSnippet) {
                setBusy(true);
                try {
                  await post(`/threads/${t.id}/messages/${m.id}/full`);
                  await reload();
                } catch (e) {
                  setErr((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }
              setOpen(true);
            }}
          >
            {open ? 'Show less' : 'Show full email'}
          </Button>
        )}
        {t.source === 'GMAIL' && (
          <>
            <Button size="sm" onClick={() => onReply(false)}>
              Reply
            </Button>
            <Button size="sm" onClick={() => onReply(true)}>
              Reply all
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

const splitAddrs = (v: string) =>
  v
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

function ReplyPanel({
  t,
  messageId,
  all,
  reload,
  onClose,
}: {
  t: any;
  messageId: string;
  all: boolean;
  reload: () => Promise<unknown>;
  onClose: () => void;
}) {
  const info = useApi<any>(`/threads/${t.id}/messages/${messageId}/reply-info`, {
    query: { all: all ? '1' : '0' },
  });
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const filled = useRef(false);
  useEffect(() => {
    if (info.data && !filled.current) {
      filled.current = true;
      setTo((info.data.to ?? []).join(', '));
      setCc((info.data.cc ?? []).join(', '));
      setSubject(info.data.subject ?? '');
    }
  }, [info.data]);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), []);
  // One id per composed reply: pressing Send twice can never send twice.
  const requestId = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState('');
  return (
    <div ref={panel} className="lg:sticky lg:top-4">
      <Card>
        <div className="flex items-center gap-2">
          <CardTitle>{all ? 'Reply all' : 'Reply'}</CardTitle>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
            Close
          </Button>
        </div>
        {info.error ? (
          <Notice tone="bad">{(info.error as Error).message}</Notice>
        ) : info.data && !info.data.canSend ? (
          <Notice tone="info" title="Reply from Creator OS is off">
            Sending needs one extra Gmail permission.{' '}
            <Link className="text-accent underline" href="/integrations">
              Open Integrations
            </Link>{' '}
            and choose “Enable sending” on {info.data.from}.
          </Notice>
        ) : (
          <div className="mt-2 space-y-3">
            {sent && <Notice tone="ok">{sent}</Notice>}
            {err && <Notice tone="bad">{err}</Notice>}
            <p className="text-xs text-muted">From {info.data?.from ?? '…'}</p>
            <Field label="To">
              <Input value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field label="Cc">
              <Input value={cc} onChange={(e) => setCc(e.target.value)} />
            </Field>
            <Field label="Subject">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label="Message">
              <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            </Field>
            <Button
              variant="primary"
              busy={busy}
              disabled={!text.trim() || !info.data || splitAddrs(to).length === 0}
              onClick={async () => {
                setBusy(true);
                setErr('');
                setSent('');
                try {
                  const r = await post(`/threads/${t.id}/reply`, {
                    text,
                    requestId: requestId.current,
                    messageId,
                    all,
                    to: splitAddrs(to),
                    cc: splitAddrs(cc),
                    subject: subject.trim() || undefined,
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
              Send
            </Button>
            <p className="text-xs text-muted">
              Sent from your Gmail account as a reply to this email, only when you press Send. It is never
              retried automatically.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
