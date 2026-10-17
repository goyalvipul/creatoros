'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ActionButton,
  Async,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Notice,
  PageHeader,
} from '@/components/ui';
import { patch, post, refresh, useApi } from '@/lib/api';
import { ago, title as titleCase } from '@/lib/format';

const CAP_TONE: Record<string, 'ok' | 'warn' | 'neutral' | 'bad'> = {
  AVAILABLE: 'ok',
  MISSING_PERMISSION: 'warn',
  NEEDS_RECONNECT: 'bad',
  NOT_IMPLEMENTED: 'neutral',
  UNSUPPORTED: 'neutral',
  NOT_CONFIGURED: 'neutral',
};

export default function SocialAccountsPage() {
  const res = useApi<any[]>('/socials/accounts');
  const [error, setError] = useState('');
  return (
    <div>
      <PageHeader
        title="Accounts & settings"
        subtitle="Every connected social account, with the exact identity replies are sent from. Nothing is sent automatically unless you turn it on for an account and activate a tested workflow."
        actions={
          <>
            <Link href="/socials/inbox">
              <Button variant="primary">Unified inbox</Button>
            </Link>
            <Link href="/integrations">
              <Button>Add or reconnect account</Button>
            </Link>
          </>
        }
      />
      {error && <Notice tone="bad">{error}</Notice>}
      <Async
        res={res}
        empty={
          <EmptyState
            title="No social accounts connected"
            action={
              <Link href="/integrations">
                <Button variant="primary">Connect Instagram</Button>
              </Link>
            }
          >
            Connect an Instagram account in Integrations. Facebook, YouTube comments, Threads and TikTok
            messaging are not built yet.
          </EmptyState>
        }
      >
        {(rows) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {rows.map((a) => (
              <li key={a.id}>
                <Card>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">@{a.username ?? a.accountId}</p>
                      <p className="text-xs text-muted">
                        Instagram · account id {a.accountId} · {titleCase(a.state)}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {a.needReply > 0 && <Badge tone="warn">{a.needReply} need reply</Badge>}
                      {a.unread > 0 && <Badge tone="info">{a.unread} unread</Badge>}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(a.capabilities ?? {}).map(([k, v]: [string, any]) => (
                      <Badge key={k} tone={CAP_TONE[v.status ?? v] ?? 'neutral'} title={v.reason ?? ''}>
                        {titleCase(k)}: {titleCase(v.status ?? v)}
                      </Badge>
                    ))}
                  </div>
                  {a.lastError && <p className="mt-2 text-xs text-bad">{a.lastError}</p>}
                  <label className="mt-3 flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={a.settings.autoSendEnabled}
                      onChange={async (e) => {
                        try {
                          setError('');
                          await patch(`/socials/accounts/${a.id}/settings`, {
                            autoSendEnabled: e.target.checked,
                          });
                          await refresh('/socials');
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      }}
                    />
                    <span>
                      Allow tested workflows to send automatically from this account
                      <span className="block text-xs text-muted">
                        Off by default. Daily cap {a.settings.dailySendCap}, cooldown{' '}
                        {a.settings.perContactCooldownHours} h per person.
                      </span>
                    </span>
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/socials/inbox?account=${a.id}`}>
                      <Button size="sm">Inbox</Button>
                    </Link>
                    <ActionButton
                      size="sm"
                      success="Conversations imported (history only, no automation)"
                      onAction={async () => {
                        await post(`/socials/accounts/${a.id}/sync`);
                        await refresh('/socials');
                      }}
                    >
                      Sync now
                    </ActionButton>
                  </div>
                  <Prefs a={a} />
                  <p className="mt-2 text-xs text-muted">
                    Token expires {a.expiresAt ? ago(a.expiresAt) : 'unknown'}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </div>
  );
}

function Prefs({ a }: { a: any }) {
  const [v, setV] = useState({
    nickname: a.settings.nickname ?? '',
    tone: a.settings.tone ?? '',
    signature: a.settings.signature ?? '',
    defaultLanguage: a.settings.defaultLanguage ?? '',
  });
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-accent">Reply preferences</summary>
      <p className="mt-1 text-xs text-muted">
        Nickname and signature are for your own reference and appended text only. They never change which
        account sends.
      </p>
      {(['nickname', 'tone', 'signature', 'defaultLanguage'] as const).map((k) => (
        <Input
          key={k}
          className="mt-1"
          aria-label={k}
          placeholder={titleCase(k)}
          value={v[k]}
          onChange={(e) => setV({ ...v, [k]: e.target.value })}
        />
      ))}
      <ActionButton
        size="sm"
        className="mt-2"
        success="Saved"
        onAction={async () => {
          await patch(`/socials/accounts/${a.id}/settings`, {
            nickname: v.nickname || null,
            tone: v.tone || null,
            signature: v.signature || null,
            defaultLanguage: v.defaultLanguage || null,
          });
          await refresh('/socials');
        }}
      >
        Save preferences
      </ActionButton>
      <Link href="/integrations" className="ml-3 text-xs text-accent">
        Reconnect, test or disconnect
      </Link>
    </details>
  );
}
