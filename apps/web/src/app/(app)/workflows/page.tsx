'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ActionButton,
  Async,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  Stat,
  StateBadge,
} from '@/components/ui';
import { blankWorkflow } from '@/components/workflow-canvas';
import { ApiError, post, put, refresh, useApi } from '@/lib/api';
import { pendingWorkflows, useOutbox } from '@/lib/outbox';
import { ago, title as titleCase } from '@/lib/format';

export default function WorkflowsPage() {
  const list = useApi<any[]>('/workflows');
  const ov = useApi<any>('/workflows/overview');
  const tpl = useApi<any[]>('/workflows/templates');
  const router = useRouter();
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const paused = ov.data?.pauseAllSending;
  useOutbox();
  const pending = pendingWorkflows();
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
      {pending.length > 0 && (
        <ul className="mb-3 grid gap-3 md:grid-cols-2">
          {pending.map((w) => (
            <li key={w.id}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/workflows/${w.id}`} className="font-medium hover:underline">
                    {w.name}
                  </Link>
                  <Badge tone="warn">On this phone</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {titleCase(w.mode)} · not in Creator OS yet. It will sync when you are back online.
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Async
        res={list}
        empty={
          pending.length > 0 ? (
            <></>
          ) : (
            <EmptyState title="No workflows yet">
              Create one above, or start from a template. New workflows stay off until you activate them.
            </EmptyState>
          )
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
      <h2 className="mb-2 mt-6 font-semibold">Your own workflow</h2>
      <Card>
        <p className="mb-2 text-sm text-muted">
          Starts as a draft that saves a reply and does not send it. You can change every step on the next page.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Name" className="min-w-60 flex-1">
            <Input aria-label="Workflow name" value={name} placeholder="Fan asks for the song link" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                setError('');
                const created = await post<{ id: string }>('/workflows', {
                  name: name.trim() || 'My workflow',
                  description: '',
                  mode: 'DRAFT_ONLY',
                  connectionIds: [],
                  definition: blankWorkflow(),
                });
                await refresh('/workflows');
                router.push(`/workflows/${created.id}`);
              } catch (e) {
                const localId = e instanceof ApiError ? (e.details as { localId?: string } | undefined)?.localId : undefined;
                if (e instanceof ApiError && e.code === 'OFFLINE_QUEUED' && localId) {
                  router.push(`/workflows/${localId}`);
                  return;
                }
                setError((e as Error).message);
              }
            }}
          >
            Create workflow
          </Button>
        </div>
      </Card>
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
