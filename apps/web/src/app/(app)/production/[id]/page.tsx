'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Pin, PinOff, Plus } from 'lucide-react';
import { useState } from 'react';
import { useMe } from '@/components/shell';
import { ActionButton, Async, Badge, Button, Card, CardTitle, Field, FormDialog, Input, KV, Notice, Options, PageHeader, Select, StateBadge, Textarea } from '@/components/ui';
import { ApiError, patch, post, refresh, useApi } from '@/lib/api';
import { title as titleCase, when } from '@/lib/format';
import { PROJECT_STAGES } from '@/lib/options';

const SCENE_STATUSES = ['PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SELECTED', 'REJECTED'];

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const tz = me.data?.organization?.timezone;
  const res = useApi<any>(`/projects/${id}`);
  const reload = () => refresh(`/projects/${id}`, '/projects');
  const [blocked, setBlocked] = useState<{ to: string; open: string[] } | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [addItem, setAddItem] = useState(false);
  const [label, setLabel] = useState('');
  const [decide, setDecide] = useState(false);
  const [d, setD] = useState({ title: '', decision: '' });

  const move = async (to: string, force = false) => {
    setStageError(null);
    try {
      await post(`/projects/${id}/stage`, { to, force: force || undefined, reason: force ? 'Owner override from project page' : undefined });
      setBlocked(null);
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CHECKLIST_INCOMPLETE') setBlocked({ to, open: ((e.details as any)?.open as string[]) ?? [] });
      else setStageError(e instanceof Error ? e.message : 'Could not change stage');
    }
  };

  return (
    <Async res={res}>
      {(p) => {
        const doneCount = p.checklist.filter((c: any) => c.doneAt).length;
        return (
          <>
            <p className="mb-2 text-sm"><Link href="/production" className="text-accent">← Production</Link></p>
            <PageHeader
              title={p.title}
              subtitle={<span className="flex flex-wrap items-center gap-1.5"><StateBadge state={p.stage} /><Badge>{titleCase(p.type)}</Badge>{p.isDemo && <Badge tone="info">demo</Badge>}{p.dueAt && <span>Due {when(p.dueAt, tz, false)}</span>}</span>}
              actions={
                <>
                  <ActionButton onAction={async () => { await patch(`/projects/${id}`, { pinned: !p.pinned }); await reload(); }}>{p.pinned ? <><PinOff className="size-4" /> Unpin</> : <><Pin className="size-4" /> Pin</>}</ActionButton>
                  <Select aria-label="Move to stage" value={p.stage} onChange={(e) => void move(e.target.value)}>
                    {PROJECT_STAGES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                  </Select>
                </>
              }
            />
            {stageError && <div className="mb-3"><Notice tone="bad">{stageError}</Notice></div>}
            {p.nextStageHint && <div className="mb-3"><Notice tone="info" title="Suggestion">{typeof p.nextStageHint === 'string' ? p.nextStageHint : `Looks ready to move to ${titleCase(p.nextStageHint.stage ?? p.nextStageHint.to ?? '')}. ${p.nextStageHint.reason ?? ''}`}</Notice></div>}

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <Card>
                  <CardTitle action={<Button size="sm" onClick={() => setAddItem(true)}><Plus className="size-4" /> Add item</Button>}>Checklist ({doneCount}/{p.checklist.length})</CardTitle>
                  {p.checklist.length === 0 ? <p className="text-sm text-muted">No checklist items.</p> : (
                    <ul className="space-y-1">
                      {p.checklist.map((c: any) => (
                        <li key={c.id}>
                          <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-panel2">
                            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={Boolean(c.doneAt)} onChange={async (e) => { await patch(`/checklist-items/${c.id}`, { done: e.target.checked }); await reload(); }} />
                            <span className={clsx('flex-1 text-sm', c.doneAt && 'text-muted line-through')}>{c.label}</span>
                            {c.required && <Badge tone={c.doneAt ? 'ok' : 'warn'}>required</Badge>}
                            <span className="text-xs text-muted">{titleCase(c.stage)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card>
                  <CardTitle>Scenes {p.progress.total > 0 && <span className="text-sm font-normal text-muted">· {p.progress.pct}% selected</span>}</CardTitle>
                  {p.scenes.length === 0 ? <p className="text-sm text-muted">No scenes. Scenes break a video into shots with prompts and a status for each.</p> : (
                    <ol className="space-y-2">
                      {p.scenes.map((s: any) => (
                        <li key={s.id} className="rounded-lg border border-border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-muted">#{s.ordinal}</span>
                            <span className="min-w-0 flex-1 font-medium">{s.title ?? `Scene ${s.ordinal}`}</span>
                            <Select aria-label={`Status of scene ${s.ordinal}`} value={s.status} className="!w-auto" onChange={async (e) => { await patch(`/scenes/${s.id}`, { status: e.target.value }); await reload(); }}><Options values={SCENE_STATUSES} /></Select>
                          </div>
                          {s.narration && <p className="mt-1 text-sm">“{s.narration}”</p>}
                          {s.shotPrompt && <p className="mt-1 text-xs text-muted">Prompt: {s.shotPrompt}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>

                <Card>
                  <CardTitle action={<Button size="sm" onClick={() => setDecide(true)}><Plus className="size-4" /> Record</Button>}>Decisions</CardTitle>
                  {p.decisions.length === 0 ? <p className="text-sm text-muted">Nothing recorded yet. Note creative decisions so you remember why.</p> : (
                    <ul className="space-y-2">{p.decisions.map((x: any) => <li key={x.id} className="text-sm"><div className="font-medium">{x.title}</div><div className="text-muted">{x.decision}</div><div className="text-xs text-muted">{when(x.at ?? x.createdAt, tz)}</div></li>)}</ul>
                  )}
                </Card>
              </div>

              <div className="space-y-4">
                <Card>
                  <CardTitle>Details</CardTitle>
                  <KV items={[['Format', titleCase(p.contentFormat)], ['Priority', titleCase(p.priority)], ['Brief', p.brief ?? '—'], ['Concept', p.concept ?? '—'], ['Direction', p.approvedDirection ?? '—']]} />
                </Card>
                <Card>
                  <CardTitle>History</CardTitle>
                  <ol className="space-y-2 text-sm">
                    {[...p.history].reverse().map((h: any) => (
                      <li key={h.id}><span className="font-medium">{h.fromStage ? `${titleCase(h.fromStage)} → ` : ''}{titleCase(h.toStage)}</span><div className="text-xs text-muted">{when(h.at, tz)} · {h.source}{h.reason ? ` · ${h.reason}` : ''}</div></li>
                    ))}
                  </ol>
                </Card>
              </div>
            </div>

            <FormDialog open={Boolean(blocked)} onClose={() => setBlocked(null)} title="Checklist is incomplete" submitLabel="Move anyway (override)" danger onSubmit={async () => { await move(blocked!.to, true); }}>
              <p className="text-sm">These required items are not done yet:</p>
              <ul className="list-disc pl-5 text-sm">{blocked?.open.map((o) => <li key={o}>{o}</li>)}</ul>
              <p className="text-sm text-muted">You can finish them first, or override. The override is recorded in the project history and audit log.</p>
            </FormDialog>

            <FormDialog open={addItem} onClose={() => setAddItem(false)} title="Add checklist item" submitLabel="Add" onSubmit={async () => { await post(`/projects/${id}/checklist`, { label: label.trim(), required: false }); setLabel(''); await reload(); }}>
              <Field label="Item"><Input required autoFocus value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
            </FormDialog>

            <FormDialog open={decide} onClose={() => setDecide(false)} title="Record a decision" submitLabel="Record" onSubmit={async () => { await post(`/projects/${id}/decisions`, d); setD({ title: '', decision: '' }); await reload(); }}>
              <Field label="Topic"><Input required autoFocus value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></Field>
              <Field label="Decision"><Textarea required rows={3} value={d.decision} onChange={(e) => setD({ ...d, decision: e.target.value })} /></Field>
            </FormDialog>
          </>
        );
      }}
    </Async>
  );
}

