'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { Pin, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
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
import { ApiError, del, patch, post, refresh, useApi } from '@/lib/api';
import { title as titleCase, when } from '@/lib/format';
import { PROJECT_STAGES, PROJECT_TYPES, projectStageLabel, useBrands } from '@/lib/options';
import { useMe } from '@/components/shell';
import { uxV5 } from '@/components/ux-v5-flag';

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
  checklistTotal?: number;
  checklistDone?: number;
  dueAt?: string;
  tags?: string[];
};

const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function coverFileId(tags: unknown) {
  const hit = (Array.isArray(tags) ? tags : []).find((tag) => typeof tag === 'string' && tag.startsWith('cover:'));
  const id = typeof hit === 'string' ? hit.slice('cover:'.length) : '';
  return FILE_ID.test(id) ? id : '';
}

function CardCover({ project, upload, toolbar }: { project: Project; upload?: string; toolbar?: ReactNode }) {
  const fileId = coverFileId(project.tags);
  const src = fileId ? `/api/v1/files/${fileId}/preview` : upload;
  if (!src) return null;
  return (
    <div className="relative -mx-4 -mt-4 mb-2 overflow-hidden rounded-t-xl">
      <Link href={`/production/${project.id}`} className="block" onClick={(e) => e.stopPropagation()}>
        <img
          src={src}
          alt=""
          className="h-28 w-full object-cover"
          onError={(e) => {
            if (fileId && e.currentTarget.src.indexOf('/stream') === -1) {
              e.currentTarget.src = `/api/v1/files/${fileId}/stream`;
            }
          }}
        />
      </Link>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-2 pt-8">
        <Link
          href={`/production/${project.id}`}
          className="pointer-events-auto block truncate text-sm font-semibold text-white drop-shadow"
          onClick={(e) => e.stopPropagation()}
        >
          {project.title}
        </Link>
      </div>
      {toolbar && (
        <div className="absolute right-1 top-1 flex items-center" data-marks onMouseDown={(e) => e.stopPropagation()}>
          {toolbar}
        </div>
      )}
    </div>
  );
}

const LANES = PROJECT_STAGES.map((id) => ({ id, label: projectStageLabel(id) }));

function projectProgress(project: Project) {
  const checklist = project.checklistTotal ?? 0;
  const scenes = project.sceneTotal ?? 0;
  if (checklist > 0) return Math.round((100 * (project.checklistDone ?? 0)) / checklist);
  if (scenes > 0) return Math.round((100 * (project.sceneSelected ?? 0)) / scenes);
  return null;
}

function ProjectProgress({ project, tz }: { project: Project; tz?: string }) {
  const pct = projectProgress(project);
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>{project.dueAt ? `Due ${when(project.dueAt, tz, false)}` : 'No due date'}</span>
        {pct != null && <span className="font-semibold text-[#1d5748]">{pct}%</span>}
      </div>
      {pct != null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#e4ebe4]">
          <div className="h-full rounded-full bg-[#3e8b72]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {(project.openRequired ?? 0) > 0 && (
        <p className="mt-1 text-[11px] text-muted">
          {project.openRequired} required still open
        </p>
      )}
    </div>
  );
}

function ProjectMarks({
  project,
  brands,
  editable,
  picker,
  onPick,
  onSave,
}: {
  project: Project;
  brands: { id: string; name: string }[];
  editable: boolean;
  picker: { id: string; kind: 'type' | 'brand' } | null;
  onPick: (next: { id: string; kind: 'type' | 'brand' } | null) => void;
  onSave: (id: string, body: { type?: string; brandId?: string }) => void;
}) {
  const brand = brands.find((b) => b.id === project.brandId)?.name;
  if (!editable) {
    return (
      <div className="flex flex-wrap gap-1.5">
        <Badge>{titleCase(project.type)}</Badge>
        {brand && <Badge tone="info">{brand}</Badge>}
      </div>
    );
  }
  const open = picker?.id === project.id ? picker.kind : null;
  return (
    <div className="flex flex-wrap gap-1.5" data-marks onMouseDown={(e) => e.stopPropagation()}>
      <div className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open === 'type'}
          className="cursor-pointer rounded-full bg-[#e7ece8] px-2 py-0.5 text-[10px] font-bold text-[#3d4a44]"
          onClick={() => onPick(open === 'type' ? null : { id: project.id, kind: 'type' })}
        >
          {titleCase(project.type)}
        </button>
        {open === 'type' && (
          <div role="menu" aria-label="Project type" className="absolute left-0 top-full z-20 mt-1 flex w-52 flex-wrap gap-1.5 rounded-xl border border-border bg-panel p-2 shadow-lg">
            {PROJECT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                role="menuitemradio"
                aria-checked={project.type === type}
                className={clsx(
                  'inline-flex items-center rounded-full bg-[#e7ece8] px-2 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap text-[#3d4a44]',
                  project.type === type && 'ring-2 ring-accent ring-offset-1 ring-offset-panel',
                )}
                onClick={() => onSave(project.id, { type })}
              >
                {titleCase(type)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open === 'brand'}
          className={
            brand
              ? 'cursor-pointer rounded-full bg-[#dbe7ff] px-2 py-0.5 text-[10px] font-bold text-[#1e4d8c]'
              : 'cursor-pointer rounded-full border border-dashed border-[#8aa0b8] px-2 py-0.5 text-[10px] font-bold text-[#5c6b7a]'
          }
          onClick={() => onPick(open === 'brand' ? null : { id: project.id, kind: 'brand' })}
        >
          {brand ?? 'Add brand'}
        </button>
        {open === 'brand' && (
          <div role="menu" aria-label="Brand" className="absolute left-0 top-full z-20 mt-1 flex w-52 flex-wrap gap-1.5 rounded-xl border border-border bg-panel p-2 shadow-lg">
            {brands.length === 0 ? (
              <p className="px-1 text-[11px] text-[#5c6b7a]">No brand yet</p>
            ) : (
              brands.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={project.brandId === b.id}
                  className={clsx(
                    'inline-flex items-center rounded-full bg-[#dbe7ff] px-2 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap text-[#1e4d8c]',
                    project.brandId === b.id && 'ring-2 ring-accent ring-offset-1 ring-offset-panel',
                  )}
                  onClick={() => onSave(project.id, { brandId: b.id })}
                >
                  {b.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProductionPage() {
  const router = useRouter();
  const me = useMe();
  const isOwner = me.data?.user?.role === 'OWNER';
  const tz = me.data?.organization?.timezone;
  const projects = useApi<Project[]>('/projects', { query: { limit: 200 } });
  const brands = useBrands();
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [f, setF] = useState({ title: '', type: 'SHORT_FORM', brandId: '', dueAt: '' });
  const [dragId, setDragId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [blocked, setBlocked] = useState<{ id: string; to: string; open: string[] } | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ id: string; kind: 'type' | 'brand' } | null>(null);
  const [uploads, setUploads] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const project of projects.data ?? []) {
      const saved = window.localStorage.getItem(`cos-cover:${project.id}`);
      if (saved?.startsWith('data:image/')) next[project.id] = saved;
    }
    setUploads(next);
  }, [projects.data]);
  const canEdit = me.data?.user?.role === 'OWNER' || me.data?.user?.role === 'EDITOR';

  const openNew = () => {
    setF({
      title: '',
      type: 'SHORT_FORM',
      brandId: brands.length === 1 ? brands[0]!.id : '',
      dueAt: '',
    });
    setAdding(true);
  };

  const saveMark = async (id: string, body: { type?: string; brandId?: string }) => {
    setPicker(null);
    setBoardError(null);
    try {
      await patch(`/projects/${id}`, body);
      await refresh('/projects');
    } catch (e) {
      setBoardError(e instanceof Error ? e.message : 'Could not update the project');
    }
  };

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
        subtitle={
          uxV5() && view === 'list'
            ? 'Same projects as the board. Open a row for the checklist, scenes, and versions. Drag on the board still changes the stage.'
            : 'Drag projects between lanes to change status. Required checklist items gate Ready and Published.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {uxV5() && (
              <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Production layout">
                <Button size="sm" variant={view === 'board' ? 'primary' : 'ghost'} onClick={() => setView('board')}>
                  Board
                </Button>
                <Button size="sm" variant={view === 'list' ? 'primary' : 'ghost'} onClick={() => setView('list')}>
                  List
                </Button>
              </div>
            )}
            <Button variant="primary" onClick={openNew}>
              <Plus className="size-4" /> New project
            </Button>
          </div>
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
              <Button variant="primary" onClick={openNew}>
                Start a project
              </Button>
            }
          >
            Convert an idea or create a project directly.
          </EmptyState>
        }
      >
        {(rows) =>
          uxV5() && view === 'list' ? (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-panel">
              {rows.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-3 hover:bg-panel2">
                  <Link href={`/production/${p.id}`} className="min-w-0 flex-1 font-medium hover:text-accent">
                    {p.title}
                  </Link>
                  <Badge>{projectStageLabel(p.stage)}</Badge>
                  <ProjectMarks
                    project={p}
                    brands={brands}
                    editable={canEdit}
                    picker={picker}
                    onPick={setPicker}
                    onSave={(id, body) => void saveMark(id, body)}
                  />
                  {p.dueAt && <span className="text-xs text-muted">Due {when(p.dueAt, tz, false)}</span>}
                  <span className="text-xs text-muted">{p.openRequired ?? 0} required open</span>
                </li>
              ))}
            </ul>
          ) : (
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
                    className={`flex w-72 shrink-0 flex-col rounded-[14px] border ${
                      uxV5() ? 'bg-[#eef2ec]' : 'bg-panel2/40'
                    } ${dropTarget ? 'border-accent bg-accent/5' : 'border-[#e5eae4]'}`}
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
                              if ((e.target as HTMLElement).closest('[data-marks]')) {
                                e.preventDefault();
                                return;
                              }
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
                            <CardCover
                              project={p}
                              upload={uploads[p.id]}
                              toolbar={
                                <>
                                  {p.pinned && <Pin className="size-4 text-white" aria-label="Pinned" />}
                                  {isOwner && (
                                    <ActionButton
                                      size="sm"
                                      variant="ghost"
                                      aria-label={`Delete ${p.title}`}
                                      confirm={`Delete “${p.title}”? It leaves Production. Linked files and posts stay where they are.`}
                                      onAction={async () => {
                                        await del(`/projects/${p.id}`);
                                        await refresh('/projects');
                                      }}
                                      className="text-white hover:text-white"
                                    >
                                      <X className="size-4" />
                                    </ActionButton>
                                  )}
                                </>
                              }
                            />
                            {!coverFileId(p.tags) && !uploads[p.id] && (
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
                            )}
                            <div className="mt-2">
                              <ProjectMarks
                                project={p}
                                brands={brands}
                                editable={canEdit}
                                picker={picker}
                                onPick={setPicker}
                                onSave={(id, body) => void saveMark(id, body)}
                              />
                            </div>
                            <ProjectProgress project={p} tz={tz} />
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
          )
        }
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
