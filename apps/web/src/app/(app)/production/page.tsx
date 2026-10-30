'use client';

import Link from 'next/link';
import { Pin, Plus, X } from 'lucide-react';
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
  FormDialog,
  Input,
  Notice,
  Options,
  PageHeader,
  Select,
} from '@/components/ui';
import { ApiError, del, post, refresh, useApi } from '@/lib/api';
import { title as titleCase, when } from '@/lib/format';
import { PROJECT_STAGES, PROJECT_TYPES, projectStageLabel, useBrands } from '@/lib/options';
import { useMe } from '@/components/shell';

type Project = {
  id: string;
  title: string;
  stage: string;
  type: string;
  brandId?: string;
  pinned?: boolean;
  sceneTotal?: number;
  sceneSelected?: number;
  openRequired?: number;
  dueAt?: string;
};

const LANES = PROJECT_STAGES.map((id) => ({ id, label: projectStageLabel(id) }));

export default function ProductionPage() {
  const router = useRouter();
  const me = useMe();
  const isOwner = me.data?.user?.role === 'OWNER';
  const tz = me.data?.organization?.timezone;
  const projects = useApi<Project[]>('/projects', { query: { limit: 200 } });
  const brands = useBrands();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: '', type: 'SHORT_FORM', brandId: '', dueAt: '' });
  const [dragId, setDragId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [blocked, setBlocked] = useState<{ id: string; to: string; open: string[] } | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);

  const all = projects.data ?? [];
  const brandName = (id?: string) => brands.find((b) => b.id === id)?.name;

  const moveProject = async (id: string, to: string, force = false) => {
    setBoardError(null);
    setMoving(true);
    try {
      await post(`/projects/${id}/stage`, {
        to,
        force: force || undefined,
        reason: force ? 'Owner override from production board' : undefined,
      });
      setBlocked(null);
      await refresh('/projects');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CHECKLIST_INCOMPLETE') {
        setBlocked({ id, to, open: ((e.details as { open?: string[] })?.open as string[]) ?? [] });
      } else {
        setBoardError(e instanceof Error ? e.message : 'Could not change stage');
      }
    } finally {
      setMoving(false);
      setDragId(null);
      setOverLane(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Production"
        subtitle="Drag projects between lanes to change status. Required checklist items gate Ready and Published."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> New project
          </Button>
        }
      />
      {boardError && (
        <div className="mb-3">
          <Notice tone="bad">{boardError}</Notice>
        </div>
      )}
      {blocked && (
        <div className="mb-3">
          <Notice tone="warn" title="Checklist still open">
            <p className="mb-2">
              {blocked.open.length
                ? `Still open: ${blocked.open.join(', ')}.`
                : 'Required checklist items are not done.'}{' '}
              Move anyway only if you mean to override.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setBlocked(null)}>
                Cancel
              </Button>
              {isOwner && (
                <Button size="sm" variant="danger" onClick={() => void moveProject(blocked.id, blocked.to, true)}>
                  Override and move to {projectStageLabel(blocked.to)}
                </Button>
              )}
            </div>
          </Notice>
        </div>
      )}
      <Async
        res={projects}
        empty={
          <EmptyState
            title="No projects yet"
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                Start a project
              </Button>
            }
          >
            Convert an idea or create a project directly.
          </EmptyState>
        }
      >
        {(rows) => (
          <div className="-mx-1 overflow-x-auto pb-2">
            <div className="flex min-w-max gap-3 px-1">
              {LANES.map((lane) => {
                const cards = rows.filter((p) => p.stage === lane.id);
                const dropTarget = overLane === lane.id && dragId != null;
                return (
                  <section
                    key={lane.id}
                    aria-label={`${lane.label} lane`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (overLane !== lane.id) setOverLane(lane.id);
                    }}
                    onDragLeave={() => {
                      if (overLane === lane.id) setOverLane(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData('text/project-id') || dragId;
                      setOverLane(null);
                      if (!id || moving) return;
                      const current = rows.find((p) => p.id === id);
                      if (!current || current.stage === lane.id) {
                        setDragId(null);
                        return;
                      }
                      void moveProject(id, lane.id);
                    }}
                    className={`flex w-72 shrink-0 flex-col rounded-xl border bg-panel2/40 ${
                      dropTarget ? 'border-accent bg-accent/5' : 'border-border'
                    }`}
                  >
                    <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                      <h2 className="text-sm font-medium">{lane.label}</h2>
                      <span className="text-xs text-muted">{cards.length}</span>
                    </header>
                    <ul className="flex min-h-40 flex-1 flex-col gap-2 p-2">
                      {cards.map((p) => (
                        <li key={p.id}>
                          <Card
                            draggable={!moving}
                            onDragStart={(e) => {
                              setDragId(p.id);
                              e.dataTransfer.setData('text/project-id', p.id);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnd={() => {
                              setDragId(null);
                              setOverLane(null);
                            }}
                            className={`cursor-grab active:cursor-grabbing transition-opacity hover:border-accent/60 ${
                              dragId === p.id ? 'opacity-60' : ''
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <Link
                                href={`/production/${p.id}`}
                                className="min-w-0 flex-1 font-medium hover:text-accent focus-visible:outline-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {p.title}
                              </Link>
                              {p.pinned && <Pin className="mt-0.5 size-4 shrink-0 text-accent" aria-label="Pinned" />}
                              {isOwner && (
                                <span
                                  className="shrink-0"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ActionButton
                                    size="sm"
                                    variant="ghost"
                                    aria-label={`Delete ${p.title}`}
                                    confirm={`Delete “${p.title}”? It leaves Production. Linked files and posts stay where they are.`}
                                    onAction={async () => {
                                      await del(`/projects/${p.id}`);
                                      await refresh('/projects');
                                    }}
                                    className="text-muted hover:text-bad"
                                  >
                                    <X className="size-4" />
                                  </ActionButton>
                                </span>
                              )}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <Badge>{titleCase(p.type)}</Badge>
                              {brandName(p.brandId) && <Badge tone="info">{brandName(p.brandId)}</Badge>}
                            </div>
                            <div className="mt-3 space-y-1 text-xs text-muted">
                              {p.sceneTotal != null && p.sceneTotal > 0 && (
                                <div>
                                  <div className="mb-1 flex justify-between">
                                    <span>Scenes selected</span>
                                    <span>
                                      {p.sceneSelected}/{p.sceneTotal}
                                    </span>
                                  </div>
                                  <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
                                    <div
                                      className="h-full bg-accent"
                                      style={{
                                        width: `${(100 * (p.sceneSelected ?? 0)) / p.sceneTotal}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              )}
                              <div>
                                {p.openRequired ?? 0} required checklist item
                                {(p.openRequired ?? 0) === 1 ? '' : 's'} open
                              </div>
                              {p.dueAt && <div>Due {when(p.dueAt, tz, false)}</div>}
                            </div>
                          </Card>
                        </li>
                      ))}
                      {cards.length === 0 && (
                        <li className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted">
                          Drop here
                        </li>
                      )}
                    </ul>
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </Async>

      <FormDialog
        open={adding}
        onClose={() => setAdding(false)}
        title="New project"
        submitLabel="Create"
        onSubmit={async () => {
          const p = await post('/projects', {
            title: f.title.trim(),
            type: f.type,
            brandId: f.brandId || undefined,
            dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : undefined,
          });
          setAdding(false);
          router.push(`/production/${p.id}`);
        }}
      >
        <Field label="Title">
          <Input required autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <Options values={PROJECT_TYPES} />
            </Select>
          </Field>
          <Field label="Due (optional)">
            <Input type="date" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} />
          </Field>
        </div>
        <Field label="Brand">
          <Select value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })}>
            <option value="">No brand</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      </FormDialog>
    </>
  );
}
