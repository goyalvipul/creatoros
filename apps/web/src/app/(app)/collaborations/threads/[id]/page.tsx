'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMe } from '@/components/shell';
import {
  ActionButton,
  Async,
  Badge,
  Card,
  CardTitle,
  KV,
  Notice,
  Options,
  PageHeader,
  Select,
  StateBadge,
} from '@/components/ui';
import { post, refresh, useApi } from '@/lib/api';
import { title as titleCase, when } from '@/lib/format';

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const res = useApi<any>(`/threads/${id}`);
  const me = useMe();
  const tz = me.data?.organization?.timezone;
  const [state, setState] = useState('');
  const reload = () => refresh(`/threads/${id}`, '/threads', '/briefing');

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
                <Notice tone="info">
                  Creator OS never sends e-mail or messages for you. Reply in your own mail or app, then set
                  this conversation to “Waiting for brand”.
                </Notice>
              </div>
              <div className="space-y-4">
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
