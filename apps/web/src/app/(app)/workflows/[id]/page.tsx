'use client';

import { useParams } from 'next/navigation';
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
import { patch, post, refresh, useApi } from '@/lib/api';
import { title as titleCase, when } from '@/lib/format';

export default function WorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const res = useApi<any>(`/workflows/${id}`);
  const accounts = useApi<any[]>('/socials/accounts');
  const execs = useApi<any[]>('/workflows/executions', { query: { workflowId: id } });
  const [json, setJson] = useState('');
  const [conns, setConns] = useState<string[]>([]);
  const [mode, setMode] = useState('DRAFT_ONLY');
  const [testText, setTestText] = useState('Hi, I would love to collaborate!');
  const [sim, setSim] = useState<any>(null);
  const [error, setError] = useState('');
  const w = res.data;
  useEffect(() => {
    if (w) {
      setJson(JSON.stringify(w.definition, null, 2));
      setConns(w.connectionIds ?? []);
      setMode(w.mode);
    }
  }, [w?.latestVersion, w?.id]);
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
  return (
    <div>
      <Async res={res}>
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
                    onAction={() => guard(() => post(`/workflows/${id}/activate`))}
                  >
                    Activate
                  </ActionButton>
                  <ActionButton onAction={() => guard(() => post(`/workflows/${id}/pause`))}>
                    Pause
                  </ActionButton>
                  <ActionButton onAction={() => guard(() => post(`/workflows/${id}/duplicate`))}>
                    Duplicate
                  </ActionButton>
                </>
              }
            />
            {error && <Notice tone="bad">{error}</Notice>}
            <Notice tone="info" title="Editor">
              There is no drag-and-drop canvas yet: steps are edited as JSON (validated on save). Saving
              creates a new version; an Automatic workflow must pass a test again before it can be activated.
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
                <Textarea
                  aria-label="Workflow JSON"
                  className="font-mono text-xs"
                  rows={16}
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                />
                <div className="mt-2">
                  <ActionButton
                    variant="primary"
                    success="Saved as a new version"
                    onAction={() =>
                      guard(() =>
                        patch(`/workflows/${id}`, {
                          mode,
                          connectionIds: conns,
                          definition: JSON.parse(json),
                        }),
                      )
                    }
                  >
                    Save new version
                  </ActionButton>
                </div>
              </Card>
              <Card>
                <CardTitle>Test (dry run, never sends)</CardTitle>
                <Field label="Test message">
                  <Input value={testText} onChange={(e) => setTestText(e.target.value)} />
                </Field>
                <ActionButton
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
