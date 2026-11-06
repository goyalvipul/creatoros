'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Async, Notice } from '@/components/ui';
import { type WfDef } from '@/components/workflow-canvas';
import { WorkflowStudio } from '@/components/workflow-studio';
import { patch, post, refresh, useApi } from '@/lib/api';
import { isLocalId, localWorkflow, useOutbox } from '@/lib/outbox';

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
  const [name, setName] = useState('');
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
      setName(w.name ?? '');
    }
  }, [w?.latestVersion, w?.id, w?.updatedAt, w?.status]);
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
  const activeVersion =
    w?.versions?.find((v: { id?: string; version: number }) => v.id && v.id === w.activeVersionId)?.version ?? null;
  return (
    <div>
      {phone && !local ? (
        <p className="text-sm text-muted">This workflow was saved to Creator OS. Open Workflows if this page stays here.</p>
      ) : null}
      <Async res={shown}>
        {(wf) =>
          def ? (
            <>
              {wf.pendingSync ? (
                <Notice tone="warn" dismissible={false} title="On this phone">
                  This workflow is not in Creator OS yet. Keep editing. It will sync when you are back online. Turning it on waits until then.
                </Notice>
              ) : null}
              <WorkflowStudio
                name={name}
                status={wf.status}
                mode={mode}
                latestVersion={wf.latestVersion}
                testedVersion={wf.testedVersion ?? null}
                activeVersion={activeVersion}
                versions={wf.versions ?? []}
                accounts={accounts.data ?? []}
                connectionIds={conns}
                def={def}
                executions={execs.data ?? []}
                error={error}
                sim={sim}
                testText={testText}
                pending={!!wf.pendingSync}
                onName={setName}
                onMode={setMode}
                onConnections={setConns}
                onDef={setDef}
                onTestText={setTestText}
                onSave={() =>
                  guard(() =>
                    patch(`/workflows/${id}`, {
                      name,
                      mode,
                      connectionIds: conns,
                      definition: def,
                    }),
                  )
                }
                onActivate={() => guard(() => post(`/workflows/${id}/activate`))}
                onPause={() => guard(() => post(`/workflows/${id}/pause`))}
                onTest={() =>
                  guard(async () =>
                    setSim(
                      await post(`/workflows/${id}/simulate`, {
                        text: testText,
                        connectionId: conns[0],
                        kind: def.trigger.event === 'COMMENT_RECEIVED' ? 'COMMENT' : 'DM',
                        isNewConversation: true,
                      }),
                    ),
                  )
                }
                onRestore={(version) => guard(() => post(`/workflows/${id}/rollback`, { version }))}
              />
            </>
          ) : (
            <p className="text-sm text-muted">This workflow has no saved definition.</p>
          )
        }
      </Async>
    </div>
  );
}
