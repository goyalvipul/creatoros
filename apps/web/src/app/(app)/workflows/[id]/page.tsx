'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ActionButton,
  Async,
  Badge,
  Card,
  CardTitle,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
  StateBadge,
  Textarea,
} from '@/components/ui';
import { WorkflowCanvas, type WfDef } from '@/components/workflow-canvas';
import { patch, post, refresh, useApi } from '@/lib/api';
import { isLocalId, localWorkflow, useOutbox } from '@/lib/outbox';
import { title as titleCase, when } from '@/lib/format';

export default function WorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const phone = isLocalId(id);
  useOutbox();
  const local = phone ? localWorkflow(id) : null;
  const res = useApi<any>(phone ? null : `/workflows/${id}`);
  const accounts = useApi<any[]>(phone ? null : '/socials/accounts');
  const execs = useApi<any[]>(phone ? null : '/workflows/executions', { query: { workflowId: id } });
  const [def, setDef] = useState<WfDef | null>(null);
  const [conns, setConns] = useState<string[]>([]);
  const [mode, setMode] = useState('DRAFT_ONLY');
  const [testText, setTestText] = useState('Hi, I would love to collaborate!');
  const [sim, setSim] = useState<any>(null);
  const [error, setError] = useState('');
  const w = phone ? local : res.data;
  useEffect(() => {
    const onSynced = (event: Event) => {
      const detail = (event as CustomEvent<{ localId?: string; serverId?: string }>).detail;
      if (detail?.localId === id && detail.serverId) router.replace(`/workflows/${detail.serverId}`);
    };
    window.addEventListener('cos-outbox-synced', onSynced);
    return () => window.removeEventListener('cos-outbox-synced', onSynced);
  }, [id, router]);
  useEffect(() => {
    if (w) {
      setDef(w.definition);
      setConns(w.connectionIds ?? []);
      setMode(w.mode);
    }
  }, [w?.latestVersion, w?.id, w?.updatedAt]);
  const guard = async (fn: () => Promise<unknown>) => {
    try {
      setError('');
      await fn();
      await refresh('/workflows');
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  };
  const shown = phone
    ? { data: local ?? undefined, error: undefined, isLoading: false, mutate: () => undefined }
    : res;
  return (
    <div>
      {phone && !local ? (
        <p className="text-sm text-muted">This workflow was saved to Creator OS. Open Workflows if this page stays here.</p>
      ) : null}
      <Async res={shown}>
        {(wf) => (
          <>
            <PageHeader
              title={wf.name}
              subtitle={`${titleCase(wf.mode)} · latest v${wf.latestVersion} · tested v${wf.testedVersion ?? 'none'}`}
              actions={
                <>
                  <StateBadge state={wf.status} />
                  <ActionButton
                    variant="primary"
                    success="Activated"
                    disabled={!!wf.pendingSync}
                    onAction={() => guard(() => post(`/workflows/${id}/activate`))}
                  >
                    Activate
                  </ActionButton>
                  <ActionButton disabled={!!wf.pendingSync} onAction={() => guard(() => post(`/workflows/${id}/pause`))}>
                    Pause
                  </ActionButton>
                  <ActionButton disabled={!!wf.pendingSync} onAction={() => guard(() => post(`/workflows/${id}/duplicate`))}>
                    Duplicate
                  </ActionButton>
                </>
              }
            />
            {error && <Notice tone="bad">{error}</Notice>}
            {wf.pendingSync ? (
              <Notice tone="warn" dismissible={false} title="On this phone">
                This workflow is not in Creator OS yet. Keep editing. It will sync when you are back online. Turning it on waits until then.
              </Notice>
            ) : null}
            <Notice tone="info" title="How a workflow runs">
              Drag the cards into order, or use Move up and Move down. Saving creates a new version. An
              automatic workflow must pass a test again before it can be activated. A reply is not sent unless
              the mode is Fully automatic and you have turned that on.
            </Notice>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Card>
                <CardTitle>Definition</CardTitle>
                <Field label="Mode">
                  <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value="DRAFT_ONLY">Draft only</option>
                    <option value="APPROVAL">Approval required</option>
                    <option value="AUTOMATIC">Fully automatic</option>
                  </Select>
                </Field>
                <Field label="Applies to accounts">
                  <div className="space-y-1">
                    {(accounts.data ?? []).map((a) => (
                      <label key={a.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={conns.includes(a.id)}
                          onChange={(e) =>
                            setConns(e.target.checked ? [...conns, a.id] : conns.filter((c) => c !== a.id))
                          }
                        />
                        @{a.username ?? a.accountId}
                      </label>
                    ))}
                  </div>
                </Field>
                {def && <WorkflowCanvas def={def} onChange={setDef} />}
                <div className="mt-2">
                  <ActionButton
                    variant="primary"
                    success="Saved as a new version"
                    disabled={!def}
                    onAction={() =>
                      guard(() =>
                        patch(`/workflows/${id}`, {
                          mode,
                          connectionIds: conns,
                          definition: def,
                        }),
                      )
                    }
                  >
                    Save new version
                  </ActionButton>
                </div>
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-muted">Saved definition</summary>
                  <Textarea aria-label="Workflow JSON" className="mt-2 font-mono" rows={8} readOnly value={JSON.stringify(def, null, 2)} />
                </details>
              </Card>
              <Card>
                <CardTitle>Test (dry run, never sends)</CardTitle>
                <Field label="Test message">
                  <Input value={testText} onChange={(e) => setTestText(e.target.value)} />
                </Field>
                <ActionButton
                  disabled={!!wf.pendingSync}
                  onAction={() =>
                    guard(async () =>
                      setSim(
                        await post(`/workflows/${id}/simulate`, {
                          text: testText,
                          connectionId: conns[0],
                          isNewConversation: true,
                        }),
                      ),
                    )
                  }
                >
                  Run test
                </ActionButton>
                {sim && (
                  <div className="mt-3 text-sm">
                    <Badge tone={sim.status === 'FAILED' ? 'bad' : 'ok'}>{titleCase(sim.status)}</Badge>{' '}
                    {sim.outcome}
                    <ol className="mt-2 space-y-1 text-xs">
                      {(sim.trace ?? []).map((t: any, i: number) => (
                        <li key={i}>
                          <Badge>{t.result}</Badge> {t.step}: {t.detail}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <CardTitle>Versions</CardTitle>
                <ul className="text-sm">
                  {wf.versions.map((v: any) => (
                    <li key={v.version} className="flex items-center justify-between py-0.5">
                      <span>
                        v{v.version} · {when(v.createdAt)}
                      </span>
                      <ActionButton
                        size="sm"
                        onAction={() =>
                          guard(() => post(`/workflows/${id}/rollback`, { version: v.version }))
                        }
                      >
                        Restore as new version
                      </ActionButton>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
            <h2 className="mb-2 mt-6 font-semibold">Executions</h2>
            <Async res={execs} empty={<p className="text-sm text-muted">No executions yet.</p>}>
              {(rows) => (
                <ul className="divide-y divide-border rounded-xl border border-border bg-panel text-sm">
                  {rows.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <StateBadge state={e.status} />
                      {e.isSimulation && <Badge>Simulation</Badge>}
                      <span className="text-muted">{when(e.startedAt)}</span>
                      <span>{e.outcome}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Async>
          </>
        )}
      </Async>
    </div>
  );
}
