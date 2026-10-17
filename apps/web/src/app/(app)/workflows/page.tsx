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
  Notice,
  PageHeader,
  Stat,
  StateBadge,
} from '@/components/ui';
import { post, put, refresh, useApi } from '@/lib/api';
import { ago, title as titleCase } from '@/lib/format';

export default function WorkflowsPage() {
  const list = useApi<any[]>('/workflows');
  const ov = useApi<any>('/workflows/overview');
  const tpl = useApi<any[]>('/workflows/templates');
  const [error, setError] = useState('');
  const paused = ov.data?.pauseAllSending;
  return (
    <div>
      <PageHeader
        title="Workflows"
        subtitle="Rules that draft, queue or send replies. New workflows are inactive drafts. Draft Only is the default; sending automatically needs a passing test, an account opt-in and your activation."
        actions={
          <Link href="/workflows/approvals">
            <Button>Approval queue{ov.data?.pendingApprovals ? ` (${ov.data.pendingApprovals})` : ''}</Button>
          </Link>
        }
      />
      {error && <Notice tone="bad">{error}</Notice>}
      <Notice
        tone={paused ? 'bad' : 'info'}
        title={paused ? 'All automatic sending is paused' : 'Emergency stop'}
      >
        <ActionButton
          size="sm"
          variant={paused ? 'primary' : 'danger'}
          confirm={paused ? undefined : 'Stop every workflow from sending automatically?'}
          onAction={async () => {
            await put('/workflows/settings/pause-all', { paused: !paused });
            await refresh('/workflows');
          }}
        >
          {paused ? 'Resume automatic sending' : 'Pause all automatic sending'}
        </ActionButton>
      </Notice>
      <Async res={ov}>
        {(o) => (
          <div className="my-4 grid grid-cols-2 gap-3 md:grid-cols-6">
            <Stat label="Active" value={o.active} />
            <Stat label="Paused" value={o.paused} />
            <Stat label="Runs (24 h)" value={o.executions24h} />
            <Stat label="Auto-replies (24 h)" value={o.autoReplies24h} />
            <Stat label="Awaiting approval" value={o.pendingApprovals} />
            <Stat label="Failed (24 h)" value={o.failed24h} />
          </div>
        )}
      </Async>
      <Async
        res={list}
        empty={
          <EmptyState title="No workflows yet">
            Start from a template below. Templates are imported inactive with no accounts selected.
          </EmptyState>
        }
      >
        {(rows) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {rows.map((w) => (
              <li key={w.id}>
                <Card>
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/workflows/${w.id}`} className="font-medium hover:underline">
                      {w.name}
                    </Link>
                    <StateBadge state={w.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {titleCase(w.mode)} · v{w.latestVersion} · {w.connectionIds.length} account(s) ·{' '}
                    {w.runs24h} runs/24 h · updated {ago(w.updatedAt)}
                  </p>
                  {w.pendingApprovals > 0 && (
                    <Badge tone="warn">{w.pendingApprovals} awaiting approval</Badge>
                  )}
                  {w.pauseReason && <p className="mt-1 text-xs text-bad">{w.pauseReason}</p>}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Async>
      <h2 className="mb-2 mt-6 font-semibold">Templates</h2>
      <Async res={tpl}>
        {(rows) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {rows.map((t) => (
              <li key={t.key}>
                <Card>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted">{t.description}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge tone={t.mode === 'AUTOMATIC' ? 'warn' : 'neutral'}>{titleCase(t.mode)}</Badge>
                    <ActionButton
                      size="sm"
                      success="Imported as an inactive draft"
                      onAction={async () => {
                        try {
                          setError('');
                          await post('/workflows/import', {
                            name: t.name,
                            description: t.description,
                            mode: t.mode,
                            definition: t.definition,
                          });
                          await refresh('/workflows');
                        } catch (e) {
                          setError((e as Error).message);
                          throw e;
                        }
                      }}
                    >
                      Import
                    </ActionButton>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </div>
  );
}
