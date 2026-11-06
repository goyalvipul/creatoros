'use client';

import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
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

const EMOJI_GROUPS: { name: string; emojis: string }[] = [
  { name: 'Smile', emojis: '😀 😁 😂 🤣 😊 😍 🥰 😘 😎 🤩 🤔 😅 😭 😢 🙏 😴 😇 🤗 🥹 😉' },
  { name: 'Hearts', emojis: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💕 💖 💗 💘 💝 💞 💓 ♥️ 🫶 💋' },
  { name: 'Hands', emojis: '👍 👎 👏 🙌 🤝 ✌️ 🤞 💪 👋 👌 🤘 👊 🤲' },
  { name: 'Reply', emojis: '🔥 ✨ ⭐ 🌟 🎉 🎵 🎤 🎶 📸 🎬 💯 ✅ 👑 🌹 👀 💅 💀 🤍 🥹' },
];
const RECENT_KEY = 'cos-reply-emojis';

function chip(on: boolean) {
  return clsx(
    'shrink-0 cursor-pointer rounded-full border px-2.5 py-1 text-xs',
    on ? 'border-transparent bg-accent text-accentfg' : 'border-border bg-panel hover:bg-panel2',
  );
}

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
        subtitle="Every account in one list. A reply is sent only when you press Send."
      />
      <div className="mb-2 grid gap-2 sm:grid-cols-4">
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
      <div className="mb-1 flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Saved views">
        {(
          [
            ['', 'All'],
            ['unread', 'Unread'],
            ['starred', 'Starred'],
            ['followup', 'Follow up'],
            ['leads', 'Collaboration leads'],
            ['archived', 'Archived (local)'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={chip(view === k)}>
            {l}
            {viewCount[k] !== undefined && (
              <span className="ml-1.5 tabular-nums opacity-80">{viewCount[k]!.toLocaleString()}</span>
            )}
          </button>
        ))}
      </div>
      <div
        className="mb-3 flex gap-1.5 overflow-x-auto pb-1"
        role="group"
        aria-label="What to reply to"
        title="Conversations still waiting for your reply, sorted by what is worth your time. Suggestions from keywords, not a decision."
      >
        <button
          type="button"
          onClick={() => {
            setCategory('');
            setState('');
          }}
          className={chip(!category)}
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
              type="button"
              title={info.hint}
              onClick={() => {
                setCategory(category === k ? '' : k);
                setState(category === k ? '' : 'NEED_REPLY');
                setView('');
              }}
              className={clsx(
                chip(category === k),
                category !== k && info.group === 'first' && 'border-warn/50',
                n === 0 && category !== k && 'opacity-50',
              )}
            >
              {info.label}
              <span className="ml-1.5 tabular-nums opacity-80">{n.toLocaleString()}</span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,22rem)_1fr] lg:items-start">
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
              <ul className="max-h-[min(40rem,calc(100dvh-13rem))] divide-y divide-border overflow-y-auto rounded-xl border border-border bg-panel">
                {rows.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={clsx(
                        'w-full cursor-pointer px-3 py-2 text-left hover:bg-panel2',
                        sel === t.id && 'bg-panel2',
                      )}
                      onClick={() => setSel(t.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{t.participantName ?? t.participantId}</span>
                        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
                          {t.unread > 0 && <Badge tone="info">{t.unread}</Badge>}
                          <span>{ago(t.lastMessageAt)}</span>
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted">{t.preview}</div>
                      <div className="mt-0.5 truncate text-[11px] text-muted">
                        {accountLabel(t)}
                        <span className="px-1">·</span>
                        <span className={t.state === 'NEED_REPLY' ? 'text-warn' : undefined}>
                          {titleCase(t.state)}
                        </span>
                        {t.replyCategory && REPLY_CATEGORY_INFO[t.replyCategory as ReplyCategory] && (
                          <>
                            <span className="px-1">·</span>
                            <span
                              className={
                                REPLY_CATEGORY_INFO[t.replyCategory as ReplyCategory].group === 'first'
                                  ? 'text-warn'
                                  : undefined
                              }
                            >
                              {REPLY_CATEGORY_INFO[t.replyCategory as ReplyCategory].label}
                            </span>
                          </>
                        )}
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
  const [open, setOpen] = useState(Boolean(t.internalNotes));
  const done = async (fn: () => Promise<unknown>) => {
    await fn();
    await refresh('/socials');
  };
  return (
    <div className="mb-2 space-y-1.5 text-sm">
      <div
        className="flex gap-1.5 overflow-x-auto pb-0.5"
        title="Star, archive, notes and read state only exist in CreatorOS. They do not change anything on Instagram."
      >
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
          {t.archivedLocal ? 'Unarchive' : 'Archive'}
        </ActionButton>
        <ActionButton
          size="sm"
          success="Follow-up set for tomorrow"
          onAction={() => done(() => post(`/socials/threads/${id}/follow-up`, { preset: 'tomorrow' }))}
        >
          Tomorrow
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
          Task
        </ActionButton>
        <ActionButton
          size="sm"
          success={t.opportunityId ? 'Already a collaboration' : 'Collaboration created'}
          onAction={() => done(() => post(`/socials/threads/${id}/create-collaboration`, {}))}
        >
          {t.opportunityId ? 'Linked' : 'Collab'}
        </ActionButton>
        <Button size="sm" type="button" onClick={() => setOpen((v) => !v)}>
          Notes{t.internalNotes ? ' ·' : ''}
        </Button>
      </div>
      {t.followUpAt && <p className="text-xs text-warn">Follow-up due {when(t.followUpAt)}</p>}
      {open && (
        <div className="space-y-1.5">
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
      )}
    </div>
  );
}

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((e) => typeof e === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

function ReplyBox({
  text,
  setText,
  id,
  t,
  error,
  setError,
}: {
  text: string;
  setText: (v: string) => void;
  id: string;
  t: any;
  error: string;
  setError: (v: string) => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(readRecent()), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  function insert(emoji: string) {
    const el = box.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = (text.slice(0, start) + emoji + text.slice(end)).slice(0, 1000);
    setText(next);
    const picked = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, 12);
    setRecent(picked);
    localStorage.setItem(RECENT_KEY, JSON.stringify(picked));
    const pos = Math.min(start + emoji.length, next.length);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }
  const groups = recent.length ? [{ name: 'Recent', emojis: recent.join(' ') }, ...EMOJI_GROUPS] : EMOJI_GROUPS;
  return (
    <div>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="relative" ref={pop}>
        {open && (
          <div className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-72 overflow-y-auto rounded-xl border border-border bg-panel p-2 shadow-lg">
            {groups.map((g) => (
              <div key={g.name} className="mb-1.5">
                <div className="px-1 text-[11px] text-muted">{g.name}</div>
                <div className="flex flex-wrap">
                  {g.emojis.split(' ').map((emoji) => (
                    <button
                      key={`${g.name}-${emoji}`}
                      type="button"
                      className="cursor-pointer rounded px-1.5 py-1 text-lg leading-none hover:bg-panel2"
                      onClick={() => insert(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <Textarea
          ref={box}
          aria-label="Reply"
          rows={3}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a reply"
        />
        <div className="mt-2 flex gap-2">
        <button
          type="button"
          aria-label="Insert emoji"
          aria-expanded={open}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-border bg-panel px-2.5 text-lg leading-none hover:bg-panel2"
          onClick={() => setOpen((v) => !v)}
        >
          😊
        </button>
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
      </div>
    </div>
  );
}

function Messages({ messages }: { messages: any[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);
  return (
    <ul className="mb-2 min-h-0 flex-1 space-y-2 overflow-y-auto">
      {messages.map((m: any) => (
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
                No text (photo, video, reel, story reply, reaction or removed message). Open it on the platform to
                see it.
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted">{when(m.receivedAt)}</div>
        </li>
      ))}
      <div ref={end} />
    </ul>
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
        <Card className="flex h-[min(40rem,calc(100dvh-13rem))] flex-col">
          <button type="button" className="mb-2 cursor-pointer text-sm text-accent lg:hidden" onClick={onBack}>
            ← Back to list
          </button>
          <div className="mb-2 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <strong>{t.replyTo.name ?? t.replyTo.participantId}</strong>
              <span className="text-xs text-muted">{titleCase(t.kind)}</span>
              {t.optedOut && <Badge tone="bad">Asked not to be messaged automatically</Badge>}
            </div>
            <div className="text-xs text-muted">
              Reply as{' '}
              <span className="text-text">
                {t.replyAs
                  ? (t.replyAs.displayName ?? `@${t.replyAs.username ?? t.replyAs.accountId}`)
                  : 'account disconnected'}
              </span>
            </div>
          </div>
          {t.media && (
            <div className="mb-2 flex gap-2 rounded-lg border border-border bg-panel2 p-2 text-sm">
              {t.media.thumbnailUrl && (
                <img src={t.media.thumbnailUrl} alt="" className="size-12 rounded object-cover" />
              )}
              <div className="min-w-0">
                <div className="text-xs text-muted">
                  Comment on your {String(t.media.type ?? 'post').toLowerCase()}
                </div>
                <div className="line-clamp-2">{t.media.caption ?? '(no caption)'}</div>
                {t.media.permalink && (
                  <a href={t.media.permalink} target="_blank" rel="noreferrer" className="text-xs text-accent">
                    Open on Instagram
                  </a>
                )}
              </div>
            </div>
          )}
          <Tools t={t} id={id} />
          <Messages messages={t.messages} />
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
          <ReplyBox text={text} setText={setText} id={id} t={t} error={error} setError={setError} />
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
