'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ApiError, post, useApi } from '@/lib/api';
import { Async, Badge, Button, Card, Notice, PageHeader } from '@/components/ui';
import { ago, title as titleCase, when } from '@/lib/format';

type Message = {
  messageId: string;
  threadId: string;
  text: string;
  kind: string;
  platform: string;
  state: string;
  fromName: string | null;
  account: string | null;
  receivedAt: string;
};

type Detail = {
  days: number;
  people: number;
  trend: {
    id: string;
    title: string;
    detail: string[];
    count: number;
    needReply: number;
    firstAt: string | null;
    lastAt: string | null;
    workflow: { name: string; description: string; mode: 'APPROVAL'; definition: unknown } | null;
  };
  messages: Message[];
};

export default function TrendDetailPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const days = search.get('days') || '30';
  const id = params.id;
  const res = useApi<Detail>(id ? `/socials/trends/${id}` : null, { query: { days } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState<string | null>(null);

  async function createWorkflow(detail: Detail) {
    const workflow = detail.trend.workflow;
    if (!workflow) return;
    setBusy(true);
    setError('');
    try {
      const wf = await post<{ id: string }>('/workflows', {
        name: workflow.name,
        description: workflow.description,
        mode: workflow.mode,
        connectionIds: [],
        definition: workflow.definition,
      });
      setMade(wf.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the workflow.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Trend"
        subtitle="Read the messages in this group. Open one to reply in the inbox. Creating a workflow does not send anything."
        actions={
          <Link href="/socials/trends">
            <Button>Back to trends</Button>
          </Link>
        }
      />
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Async res={res}>
        {(detail) => (
          <div className="space-y-4">
            <Card>
              <h2 className="text-lg font-semibold">{detail.trend.title}</h2>
              <div className="mt-2 space-y-1 text-sm">
                {detail.trend.detail.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">
                {detail.people} {detail.people === 1 ? 'person' : 'people'}
                {detail.trend.firstAt ? ` · ${when(detail.trend.firstAt)} to ${when(detail.trend.lastAt)}` : ''}
                {` · last ${detail.days} days`}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {detail.trend.workflow && !made ? (
                  <Button variant="primary" busy={busy} onClick={() => createWorkflow(detail)}>
                    Create workflow
                  </Button>
                ) : null}
                {!detail.trend.workflow ? (
                  <p className="text-sm text-muted">No workflow is offered for this group.</p>
                ) : null}
                {made ? (
                  <Link href={`/workflows/${made}`} className="text-sm font-medium hover:underline">
                    Open the draft workflow
                  </Link>
                ) : null}
              </div>
            </Card>
            <ul className="space-y-2">
              {detail.messages.map((message) => (
                <li key={message.messageId}>
                  <Link
                    href={`/socials/inbox?thread=${message.threadId}`}
                    className="block rounded-xl border border-border bg-panel p-3 hover:bg-panel2"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{message.fromName || 'Unknown sender'}</span>
                      <Badge>{titleCase(message.kind)}</Badge>
                      <Badge>{titleCase(message.platform)}</Badge>
                      {message.account ? <Badge>{message.account}</Badge> : null}
                      <Badge tone={message.state === 'NEED_REPLY' ? 'warn' : 'neutral'}>
                        {titleCase(message.state)}
                      </Badge>
                      <span className="text-xs text-muted">{ago(message.receivedAt)}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{message.text}</p>
                    <p className="mt-2 text-xs font-medium">Open this conversation</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Async>
    </div>
  );
}
