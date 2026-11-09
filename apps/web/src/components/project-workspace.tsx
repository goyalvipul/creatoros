'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { PublishFields, publishHashtags, publishPrivacy } from '@/components/publish-fields';
import {
  ActionButton,
  Badge,
  Button,
  Card,
  CardTitle,
  Field,
  FormDialog,
  Input,
  Notice,
  Options,
  PageHeader,
  Select,
  StateBadge,
  Tabs,
  Textarea,
} from '@/components/ui';
import { ImageThumb, VideoThumb, cardWidth, isImageName } from '@/components/video-thumb';
import { ThumbnailPicker } from '@/components/publish-cover';
import { VideoTrim } from '@/components/video-trim';
import { ApiError, del, patch, post, refresh, useApi } from '@/lib/api';
import { dateInput, title as titleCase, when } from '@/lib/format';
import { PlatformLogo } from '@/components/platform-logo';
import { PROJECT_STAGES, projectStageLabel, useBrands, useRoots } from '@/lib/options';

const OLD_GENERAL = [
  'Approve creative direction / brief',
  'Captions & hashtags drafted per platform',
  'Final export approved',
  'Goal and audience written down',
  'Sponsor / AI-content disclosure checked',
  'Thumbnail / cover selected',
];

const RELEASE = [
  { label: 'Concept approved', required: false },
  { label: 'Reference assets linked', required: false },
  { label: 'Final video approved', required: true },
  { label: 'Platform metadata ready', required: true },
  { label: 'Owner confirmation', required: true },
];

const SCENE_STATUSES = ['PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SELECTED', 'REJECTED'];
const COVER = 'cos-cover:';

type Tab = 'overview' | 'scenes' | 'checklist' | 'assets' | 'publishing' | 'history';

function coverId(tags: unknown) {
  const hit = (Array.isArray(tags) ? tags : []).find((t) => typeof t === 'string' && t.startsWith('cover:'));
  return typeof hit === 'string' ? hit.slice('cover:'.length) : '';
}

function linkedFileCount(variants: { fileName?: string | null }[]) {
  const names = new Set<string>();
  for (const variant of variants) {
    for (const part of String(variant.fileName ?? '').split(',')) {
      const name = part.trim();
      if (name && name !== 'Video not in the library yet') names.add(name);
    }
  }
  return names.size;
}

function sourceOf(project: any, idea: any) {
  const origin = String(idea?.origin ?? '').toLowerCase();
  if (origin.includes('gmail') || origin.includes('mail') || origin.includes('email')) return 'Email';
  if (origin.includes('notif')) return 'Notification';
  if (origin.includes('comfy') || origin.includes('studio') || origin.includes('ltx')) return 'Create Studio';
  if (project.sourceIdeaId) return 'Content idea';
  return 'Manual entry';
}

function pill(tone: 'ok' | 'warn' | 'neutral') {
  if (tone === 'ok') return 'bg-[#e5f6ea] text-[#1d6b3a]';
  if (tone === 'warn') return 'bg-[#fff1d6] text-[#8a4b08]';
  return 'bg-[#eef1ee] text-[#5c6b63]';
}

export function ProjectWorkspace({ project, id, tz }: { project: any; id: string; tz?: string }) {
  const brands = useBrands();
  const idea = useApi<any>(project.sourceIdeaId ? `/ideas/${project.sourceIdeaId}` : null);
  const [tab, setTab] = useState<Tab>('overview');
  const [localCover, setLocalCover] = useState('');
  const [picking, setPicking] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [note, setNote] = useState(false);
  const [line, setLine] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [newItem, setNewItem] = useState({ label: '', required: true });
  const swapped = useRef(false);
  const [blocked, setBlocked] = useState<{ to: string; open: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => refresh(`/projects/${id}`, '/projects');
  useEffect(() => {
    if (swapped.current) return;
    const items = project.checklist ?? [];
    const labels = items.map((item: { label: string }) => item.label).sort();
    const untouched = items.every((item: { doneAt?: string | null }) => !item.doneAt);
    const same = labels.length === OLD_GENERAL.length && labels.every((label: string, index: number) => label === OLD_GENERAL[index]);
    if (!same || !untouched) return;
    swapped.current = true;
    void (async () => {
      for (const item of items) await del(`/checklist-items/${item.id}`);
      for (const item of RELEASE) await post(`/projects/${id}/checklist`, item);
      await reload();
    })();
  }, [project.checklist, id]);
  const variants = (project.variants ?? []) as { id: string; titleMaster: string; readiness: string; format: string; fileName: string | null; createdAt: string }[];
  const files = linkedFileCount(variants);
  const brand = brands.find((b) => b.id === project.brandId)?.name;
  const libraryCover = coverId(project.tags);

  useEffect(() => {
    setLocalCover(window.localStorage.getItem(`${COVER}${id}`) ?? '');
  }, [id]);

  const move = async (to: string, force = false) => {
    setError(null);
    try {
      await post(`/projects/${id}/stage`, {
        to,
        force: force || undefined,
        reason: force ? 'Owner override from project page' : undefined,
      });
      setBlocked(null);
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CHECKLIST_INCOMPLETE')
        setBlocked({ to, open: ((e.details as { open?: string[] })?.open ?? []) as string[] });
      else setError(e instanceof Error ? e.message : 'Could not change stage');
    }
  };

  const saveCoverFile = async (file: File) => {
    const data = await shrinkImage(file);
    window.localStorage.setItem(`${COVER}${id}`, data);
    setLocalCover(data);
  };

  const attachLibraryCover = async (fileId: string) => {
    const tags = (Array.isArray(project.tags) ? project.tags : []).filter((t: string) => !String(t).startsWith('cover:'));
    await patch(`/projects/${id}`, { tags: [...tags, `cover:${fileId}`] });
    await reload();
    setPicking(false);
  };

  const clearLibrary = async () => {
    const tags = (Array.isArray(project.tags) ? project.tags : []).filter((t: string) => !String(t).startsWith('cover:'));
    await patch(`/projects/${id}`, { tags });
    await reload();
  };

  const picture = libraryCover ? `/api/v1/files/${libraryCover}/preview` : localCover;
  const conceptReady = Boolean(project.brief || project.concept || project.conceptDetail || project.approvedDirection);
  const videoReady = variants.some((v) => v.readiness === 'READY' || v.readiness === 'APPROVED') || (project.progress?.total > 0 && project.progress?.pct === 100);
  const published = project.stage === 'PUBLISHED';
  const checks: { label: string; state: string; tone: 'ok' | 'warn' | 'neutral' }[] = [
    { label: 'Concept drafted', state: conceptReady ? 'Drafted' : 'Pending', tone: conceptReady ? 'ok' : 'warn' },
    { label: 'Reference assets linked and ready', state: files > 0 ? 'Ready' : 'Pending', tone: files > 0 ? 'ok' : 'warn' },
    { label: 'Final video approved', state: videoReady ? 'Approved' : variants.length ? 'In progress' : 'Pending', tone: videoReady ? 'ok' : variants.length ? 'warn' : 'neutral' },
    { label: 'Published', state: published ? 'Published' : 'Pending', tone: published ? 'ok' : 'neutral' },
    { label: 'Paid', state: 'Not recorded', tone: 'neutral' },
  ];

  const lines = [
    ...(idea.data && sourceOf(project, idea.data) === 'Email'
      ? [{ id: 'src', at: idea.data.createdAt, title: `From email: ${idea.data.title}`, detail: '' }]
      : []),
    ...(project.decisions ?? []).map((d: any) => ({ id: d.id, at: d.decidedAt ?? d.at ?? d.createdAt, title: d.title, detail: d.decision })),
    ...(project.history ?? []).map((h: any) => ({
      id: h.id,
      at: h.at,
      title: `${h.fromStage ? `${titleCase(h.fromStage)} → ` : ''}${titleCase(h.toStage)}`,
      detail: h.reason ?? '',
    })),
  ]
    .filter((row) => row.at)
    .sort((a, b) => +new Date(b.at) - +new Date(a.at));

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/production" className="text-accent">
          ← Production
        </Link>
      </p>
      <PageHeader
        title={project.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <StateBadge state={project.stage} />
            <Badge>{titleCase(project.type)}</Badge>
            {project.dueAt && <span>Due {when(project.dueAt, tz, false)}</span>}
          </span>
        }
        actions={
          <Select aria-label="Move to stage" value={project.stage} onChange={(e) => void move(e.target.value)}>
            {PROJECT_STAGES.map((s) => (
              <option key={s} value={s}>
                {projectStageLabel(s)}
              </option>
            ))}
          </Select>
        }
      />
      {error && (
        <div className="mb-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'scenes', label: 'Scenes' },
          { id: 'checklist', label: 'Checklist' },
          { id: 'assets', label: 'Assets' },
          { id: 'publishing', label: 'Publishing' },
          { id: 'history', label: 'History' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
          <div className="space-y-4">
            <Card>
              <div className="flex flex-wrap gap-4">
                <div className="w-full max-w-[200px]">
                  {picture ? (
                    <img
                      src={picture}
                      alt=""
                      className="h-28 w-full rounded-xl object-cover"
                      onError={(e) => {
                        if (libraryCover && e.currentTarget.src.indexOf('/stream') === -1) e.currentTarget.src = `/api/v1/files/${libraryCover}/stream`;
                      }}
                    />
                  ) : (
                    <label className="flex h-28 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border px-3 text-center text-xs text-muted">
                      Add a picture
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void saveCoverFile(file);
                        }}
                      />
                    </label>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
                    <label className="cursor-pointer text-accent">
                      Upload
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void saveCoverFile(file);
                        }}
                      />
                    </label>
                    <button type="button" className="cursor-pointer text-accent" onClick={() => setPicking(true)}>
                      Library
                    </button>
                    {libraryCover && (
                      <button type="button" className="cursor-pointer text-muted" onClick={() => void clearLibrary()}>
                        Remove
                      </button>
                    )}
                  </div>
                  {!libraryCover && localCover && <p className="mt-1 text-[10px] text-muted">This upload stays in this browser.</p>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-serif text-xl leading-snug">{project.title}</h2>
                    <StateBadge state={project.stage} />
                  </div>
                  <p className="mt-2 text-sm text-muted">
                    {project.brief || project.concept || 'Add a brief so this page says what the project is for.'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setTab('scenes')}>
                      Manage scenes
                    </Button>
                    <Button size="sm" onClick={() => setTab('assets')}>
                      Open assets
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => setTab('publishing')}>
                      Open publishing
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
            <Card>
              <CardTitle>Release readiness</CardTitle>
              <ul>
                {checks.map((check) => (
                  <li key={check.label} className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
                    <span className="text-sm">{check.label}</span>
                    <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-bold', pill(check.tone))}>{check.state}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <div className="space-y-4">
            <Card>
              <CardTitle>Related records</CardTitle>
              <dl className="space-y-2 text-sm">
                <Row label="Source" value={sourceOf(project, idea.data)} hint={idea.data?.title} />
                <Row label="Deliverables" value="Not tied to a deal" />
                <Row label="Linked media" value={files === 1 ? '1 file' : `${files} files`} />
                <div className="flex items-center justify-between gap-3 border-b border-border py-2">
                  <dt className="text-muted">Due date</dt>
                  <dd>
                    <Input
                      type="date"
                      aria-label="Due date"
                      className="!w-auto"
                      value={dateInput(project.dueAt)}
                      onChange={async (e) => {
                        await patch(`/projects/${id}`, { dueAt: e.target.value ? new Date(e.target.value).toISOString() : null });
                        await reload();
                      }}
                    />
                  </dd>
                </div>
                <div className="relative flex items-center justify-between gap-3 py-2">
                  <dt className="text-muted">Owner</dt>
                  <dd>
                    <button
                      type="button"
                      className="cursor-pointer rounded-full bg-[#dbe7ff] px-2 py-0.5 text-[11px] font-bold text-[#1e4d8c]"
                      onClick={() => setBrandOpen((v) => !v)}
                    >
                      {brand ?? 'Add brand'}
                    </button>
                    {brandOpen && (
                      <div role="menu" aria-label="Brand" className="absolute right-0 z-20 mt-1 flex w-52 flex-wrap gap-1.5 rounded-xl border border-border bg-panel p-2 shadow-lg">
                        {brands.map((b) => (
                          <button
                            key={b.id}
                            type="button"
                            role="menuitemradio"
                            aria-checked={project.brandId === b.id}
                            className={clsx(
                              'inline-flex items-center rounded-full bg-[#dbe7ff] px-2 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap text-[#1e4d8c]',
                              project.brandId === b.id && 'ring-2 ring-accent ring-offset-1 ring-offset-panel',
                            )}
                            onClick={async () => {
                              setBrandOpen(false);
                              await patch(`/projects/${id}`, { brandId: b.id });
                              await reload();
                            }}
                          >
                            {b.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </dd>
                </div>
              </dl>
            </Card>
            <Card>
              <CardTitle
                action={
                  <Button size="sm" onClick={() => setNote(true)}>
                    Add a note
                  </Button>
                }
              >
                Recent decisions
              </CardTitle>
              <p className="mb-2 text-xs text-muted">
                Stage changes and notes you add. An email line appears when this project was created from one.
              </p>
              {lines.length === 0 ? (
                <p className="text-sm text-muted">Nothing recorded yet.</p>
              ) : (
                <ul className="space-y-2">
                  {lines.slice(0, 5).map((row) => (
                    <li key={row.id} className="rounded-lg border border-border px-3 py-2">
                      <div className="text-sm font-medium">{row.title}</div>
                      <div className="text-[11px] text-muted">
                        {when(row.at, tz)}
                        {row.detail && row.detail !== row.title ? ` · ${row.detail}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === 'scenes' && (
        <Card>
          <CardTitle>Scenes</CardTitle>
          {project.scenes.length === 0 ? (
            <p className="text-sm text-muted">No scenes. Scenes break a video into shots with prompts and a status for each.</p>
          ) : (
            <ol className="space-y-2">
              {project.scenes.map((s: any) => (
                <li key={s.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-muted">#{s.ordinal}</span>
                    <span className="min-w-0 flex-1 font-medium">{s.title ?? `Scene ${s.ordinal}`}</span>
                    <Select
                      aria-label={`Status of scene ${s.ordinal}`}
                      value={s.status}
                      className="!w-auto"
                      onChange={async (e) => {
                        await patch(`/scenes/${s.id}`, { status: e.target.value });
                        await reload();
                      }}
                    >
                      <Options values={SCENE_STATUSES} />
                    </Select>
                  </div>
                  {s.shotPrompt && <p className="mt-1 text-xs text-muted">Prompt: {s.shotPrompt}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {tab === 'checklist' && (
        <Card>
          <CardTitle
            action={
              <Button size="sm" onClick={() => setAddingItem(true)}>
                Add item
              </Button>
            }
          >
            Release readiness
          </CardTitle>
          <p className="mb-2 text-sm text-muted">Mandatory items block Ready unless an explicit override is recorded.</p>
          {project.checklist.length === 0 ? (
            <p className="text-sm text-muted">No checklist items yet.</p>
          ) : (
            <ul>
              {project.checklist.map((c: any) => (
                <li key={c.id} className="flex min-h-12 items-center gap-3 border-b border-border py-2 last:border-0">
                  <input
                    type="checkbox"
                    aria-label={c.label}
                    className="size-4 accent-[#1d6b3a]"
                    checked={Boolean(c.doneAt)}
                    onChange={async (e) => {
                      await patch(`/checklist-items/${c.id}`, { done: e.target.checked });
                      await reload();
                    }}
                  />
                  {editId === c.id ? (
                    <input
                      autoFocus
                      className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onBlur={async () => {
                        const next = editLabel.trim();
                        setEditId(null);
                        if (next && next !== c.label) {
                          await patch(`/checklist-items/${c.id}`, { label: next });
                          await reload();
                        }
                      }}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setEditId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm"
                      onClick={() => {
                        setEditId(c.id);
                        setEditLabel(c.label);
                      }}
                    >
                      {c.label}
                    </button>
                  )}
                  <button
                    type="button"
                    className={clsx(
                      'cursor-pointer rounded-full px-2 py-0.5 text-[10px] font-bold',
                      c.required ? 'bg-[#fff1d6] text-[#8a4b08]' : 'bg-[#eef1ee] text-[#5c6b63]',
                    )}
                    onClick={async () => {
                      await patch(`/checklist-items/${c.id}`, { required: !c.required });
                      await reload();
                    }}
                  >
                    {c.required ? 'Required' : 'Optional'}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${c.label}`}
                    className="cursor-pointer px-1 text-sm text-muted"
                    onClick={async () => {
                      if (!window.confirm(`Remove “${c.label}”?`)) return;
                      await del(`/checklist-items/${c.id}`);
                      await reload();
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {(tab === 'assets' || tab === 'publishing') && (
        <ProjectPublish projectId={id} projectTitle={project.title} variants={variants} tz={tz} mode={tab} onLinked={reload} />
      )}

      {tab === 'history' && (
        <Card>
          <CardTitle>History</CardTitle>
          {lines.length === 0 ? (
            <p className="text-sm text-muted">No changes yet.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {lines.map((row) => (
                <li key={row.id}>
                  <div className="font-medium">{row.title}</div>
                  <div className="text-xs text-muted">
                    {when(row.at, tz)}
                    {row.detail && row.detail !== row.title ? ` · ${row.detail}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      <FormDialog
        open={addingItem}
        onClose={() => setAddingItem(false)}
        title="Add a checklist item"
        submitLabel="Add"
        onSubmit={async () => {
          await post(`/projects/${id}/checklist`, { label: newItem.label.trim(), required: newItem.required });
          setNewItem({ label: '', required: true });
          await reload();
        }}
      >
        <Field label="Item">
          <Input required autoFocus value={newItem.label} onChange={(e) => setNewItem({ ...newItem, label: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[#1d6b3a]"
            checked={newItem.required}
            onChange={(e) => setNewItem({ ...newItem, required: e.target.checked })}
          />
          Required before Ready
        </label>
      </FormDialog>
      <FormDialog
        open={note}
        onClose={() => setNote(false)}
        title="Add a note"
        submitLabel="Save"
        onSubmit={async () => {
          const text = line.trim();
          await post(`/projects/${id}/decisions`, { title: text, decision: text });
          setLine('');
          await reload();
        }}
      >
        <Field label="What changed">
          <Textarea required rows={2} value={line} onChange={(e) => setLine(e.target.value)} placeholder="One line is enough" />
        </Field>
      </FormDialog>
      <FormDialog
        open={Boolean(blocked)}
        onClose={() => setBlocked(null)}
        title="Checklist is incomplete"
        submitLabel="Move anyway (override)"
        danger
        onSubmit={async () => {
          await move(blocked!.to, true);
        }}
      >
        <p className="text-sm">These required items are not done yet:</p>
        <ul className="list-disc pl-5 text-sm">
          {blocked?.open.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      </FormDialog>
      {picking && <CoverPicker onClose={() => setPicking(false)} onPick={(fileId) => void attachLibraryCover(fileId)} />}
    </>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">
        <div className="font-medium">{value}</div>
        {hint && <div className="text-[11px] text-muted">{hint}</div>}
      </dd>
    </div>
  );
}

function CoverPicker({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const files = useApi<{ items: any[] }>('/library', { query: { kind: 'IMAGE', q, limit: 40 } });
  return (
    <FormDialog open onClose={onClose} title="Choose a library image" submitLabel="Close" onSubmit={async () => {}}>
      <Field label="Search">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="File name" />
      </Field>
      <ul className="max-h-64 space-y-1 overflow-auto">
        {(files.data?.items ?? []).map((f) => (
          <li key={f.id}>
            <button type="button" className="w-full cursor-pointer rounded-lg border border-border px-2 py-1.5 text-left text-sm hover:border-accent" onClick={() => onPick(f.id)}>
              <span className="block truncate font-medium">{f.fileName}</span>
              <span className="block truncate text-xs text-muted">{f.displayPath}</span>
            </button>
          </li>
        ))}
        {files.data && files.data.items.length === 0 && <li className="text-sm text-muted">No images match.</li>}
      </ul>
    </FormDialog>
  );
}

function ProjectPublish({
  projectId,
  projectTitle,
  variants,
  tz,
  mode,
  onLinked,
}: {
  projectId: string;
  projectTitle: string;
  variants: { id: string; titleMaster: string; fileName: string | null }[];
  tz?: string;
  mode: 'assets' | 'publishing';
  onLinked: () => Promise<unknown> | void;
}) {
  const assets = useApi<any[]>('/assets', { query: { projectId, limit: 50 } });
  const [creating, setCreating] = useState(false);
  const [assetId, setAssetId] = useState('');
  const allAssets = useApi<any[]>(variants.length === 0 ? '/assets' : null, { query: { limit: 100 } });
  const choices = (assets.data?.length ? assets.data : allAssets.data) ?? [];
  return (
    <div className="space-y-3">
      {variants.length === 0 && (
        <Card>
          <CardTitle>Link this project to a title</CardTitle>
          <p className="mb-3 text-sm text-muted">Pick an asset. The publishing title is created here, in the project’s name.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Asset">
              <Select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                <option value="">Choose an asset</option>
                {choices.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="primary"
              busy={creating}
              disabled={!assetId}
              onClick={async () => {
                setCreating(true);
                try {
                  await post('/variants', { assetId, titleMaster: projectTitle, projectId, type: 'MASTER' });
                  await refresh(`/projects/${projectId}`, '/projects', '/variants');
                  await onLinked();
                } finally {
                  setCreating(false);
                }
              }}
            >
              Create title
            </Button>
          </div>
        </Card>
      )}
      {variants.map((variant) => (
        <VariantPanel key={variant.id} variantId={variant.id} projectId={projectId} tz={tz} mode={mode} onChange={onLinked} />
      ))}
    </div>
  );
}

function VariantPanel({
  variantId,
  projectId,
  tz,
  mode,
  onChange,
}: {
  variantId: string;
  projectId: string;
  tz?: string;
  mode: 'assets' | 'publishing';
  onChange: () => Promise<unknown> | void;
}) {
  const page = useApi<any>(`/variants/${variantId}/publish`);
  const [linkOpen, setLinkOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<{ item: any; account: any; draft?: any; schedule?: boolean } | null>(null);
  const data = page.data;
  if (!data) return <Card><p className="text-sm text-muted">Loading linked files…</p></Card>;
  const refreshAll = async () => {
    await refresh(`/variants/${variantId}/publish`, '/publishing/matrix', `/projects/${projectId}`);
    await onChange();
  };
  return (
    <Card>
      <CardTitle
        action={
          mode === 'assets' ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                Upload
              </Button>
              <Button size="sm" variant="primary" onClick={() => setLinkOpen(true)}>
                Link a file
              </Button>
            </div>
          ) : undefined
        }
      >
        {mode === 'assets' ? 'Linked project assets' : data.title}
      </CardTitle>
      {data.items.length === 0 ? (
        <p className="text-sm text-muted">No file is linked yet. Link or upload one under Assets.</p>
      ) : mode === 'assets' ? (
        <ul className="flex flex-wrap items-start gap-3">
          {data.items.map((item: any) => (
            <AssetTile
              key={item.id}
              item={item}
              projectId={projectId}
              variantId={variantId}
              playing={playing === item.fileInstanceId}
              onPlay={() => setPlaying(item.fileInstanceId)}
            />
          ))}
        </ul>
      ) : (
        <PublishDesk
          items={data.items}
          accounts={data.accounts ?? []}
          drafts={data.drafts ?? []}
          selected={selected}
          playing={playing}
          projectId={projectId}
          variantId={variantId}
          tz={tz}
          onSelect={(id) => {
            setSelected(id);
            setPlaying(null);
          }}
          onPlay={setPlaying}
          onSend={(item, account, draft, schedule) => setForm({ item, account, draft, schedule })}
        />
      )}
      {linkOpen && (
        <LinkFiles
          variantId={variantId}
          assetId={data.assetId}
          assetTitle={data.assetTitle}
          onClose={() => setLinkOpen(false)}
          onDone={refreshAll}
        />
      )}
      {uploadOpen && <UploadFile variantId={variantId} onClose={() => setUploadOpen(false)} onDone={refreshAll} />}
      {form && (
        <SendDialog
          variantId={variantId}
          item={form.item}
          account={form.account}
          draft={form.draft}
          schedule={Boolean(form.schedule)}
          tz={tz}
          onClose={() => setForm(null)}
          onDone={refreshAll}
        />
      )}
    </Card>
  );
}

function PublishDesk({
  items,
  accounts,
  drafts,
  selected,
  playing,
  projectId,
  variantId,
  tz,
  onSelect,
  onPlay,
  onSend,
}: {
  items: any[];
  accounts: any[];
  drafts: any[];
  selected: string | null;
  playing: string | null;
  projectId: string;
  variantId: string;
  tz?: string;
  onSelect: (id: string) => void;
  onPlay: (fileId: string) => void;
  onSend: (item: any, account: any, draft: any, schedule?: boolean) => void;
}) {
  const current = items.find((item) => item.id === selected) ?? items[0];
  const [ratio, setRatio] = useState<number | null>(null);
  const [trim, setTrim] = useState(false);
  useEffect(() => setRatio(null), [current?.fileInstanceId]);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(240px,0.8fr)]">
      <div>
        {items.length > 1 && (
          <ul className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {items.map((item) => {
              const on = item.id === current.id;
              return (
                <li key={item.id} className="w-28 shrink-0">
                  <button
                    type="button"
                    aria-pressed={on}
                    className={clsx('w-full cursor-pointer overflow-hidden rounded-lg border', on ? 'border-[#1d5748] ring-2 ring-[#1d5748]' : 'border-border')}
                    onClick={() => onSelect(item.id)}
                  >
                    <FrameStill fileId={item.fileInstanceId} online={item.deviceState === 'ONLINE'} name={item.fileName} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="overflow-hidden rounded-xl" style={{ width: cardWidth(ratio), maxWidth: '100%' }}>
          <FilePreview item={current} playing={playing === current.fileInstanceId} onPlay={() => onPlay(current.fileInstanceId)} onRatio={setRatio} />
        </div>
        {isVideoFile(current.fileName) ? (
          <div className="mt-3">
            <ThumbnailPicker
              variantId={variantId}
              itemId={current.id}
              fileId={current.fileInstanceId}
              durationMs={Number(current.durationMs) || 0}
              online={current.deviceState === 'ONLINE'}
              hasCover={Boolean(current.hasCover)}
              onSaved={() => void refresh(`/variants/${variantId}/publish`)}
            />
          </div>
        ) : null}
        <p className="mt-2 truncate text-sm font-medium">{current.fileName}</p>
        <p className="text-xs text-muted">
          {current.deviceName}
          {current.deviceState !== 'ONLINE' ? ' · machine offline' : ''}
        </p>
        {isVideoFile(current.fileName) ? (
          <Button size="sm" className="mt-2" onClick={() => setTrim(true)}>
            Edit video
          </Button>
        ) : null}
        {trim && isVideoFile(current.fileName) ? (
          <VideoTrim fileId={current.fileInstanceId} projectId={projectId} variantId={variantId} onClose={() => setTrim(false)} />
        ) : null}
      </div>
      <ul className="space-y-2">
        {accounts.length === 0 && <li className="text-sm text-muted">No social accounts yet. Add them in Channels.</li>}
        {accounts.map((account) => {
          const draft = drafts.find((d) => d.itemId === current.id && d.accountId === account.id);
          const state = draft?.uploadState as string | undefined;
          const posted = state === 'PUBLISHED';
          return (
            <li key={account.id} className="rounded-xl border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
                    <PlatformLogo platform={account.platform} className="size-4" />
                    {account.handle}
                  </div>
                </div>
                <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', posted ? 'bg-[#e5f6ea] text-[#1d6b3a]' : state === 'SCHEDULED' ? 'bg-[#fff1d6] text-[#8a4b08]' : 'bg-[#eef1ee] text-[#5c6b63]')}>
                  {posted ? 'Published' : state === 'SCHEDULED' ? 'Scheduled' : state ? titleCase(state) : 'Not posted'}
                </span>
              </div>
              {draft?.scheduledAt && <p className="mt-1 text-[11px] text-muted">{when(draft.scheduledAt, tz)}</p>}
              {draft?.url && (
                <a href={draft.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-accent">
                  Open post
                </a>
              )}
              {!account.canPublish && <p className="mt-1 text-xs text-muted">{account.reason}</p>}
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" disabled={!account.canPublish || locked(state)} onClick={() => onSend(current, account, draft)}>
                  {posted ? 'Published' : 'Publish'}
                </Button>
                <Button size="sm" disabled={!account.canPublish || locked(state)} onClick={() => onSend(current, account, draft, true)}>
                  Schedule
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AssetTile({
  item,
  projectId,
  variantId,
  playing,
  onPlay,
}: {
  item: any;
  projectId: string;
  variantId: string;
  playing: boolean;
  onPlay: () => void;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  const [trim, setTrim] = useState(false);
  const online = item.deviceState === 'ONLINE';
  const image = isImageName(item.fileName);
  const video = isVideoFile(item.fileName);
  return (
    <li className="overflow-hidden rounded-xl border border-border bg-panel" style={{ width: cardWidth(ratio) }}>
      {image ? (
        <ImageThumb fileId={item.fileInstanceId} online={online} onRatio={setRatio} />
      ) : (
        <FilePreview item={item} playing={playing} onPlay={onPlay} onRatio={setRatio} />
      )}
      <div className="px-3 py-2">
        <div className="truncate text-sm font-medium">{item.fileName}</div>
        <div className="truncate text-xs text-muted">{item.deviceName}</div>
        {video ? (
          <Button size="sm" className="mt-2" onClick={() => setTrim(true)}>
            Edit video
          </Button>
        ) : null}
      </div>
      {trim && video ? (
        <VideoTrim fileId={item.fileInstanceId} projectId={projectId} variantId={variantId} onClose={() => setTrim(false)} />
      ) : null}
    </li>
  );
}

function isVideoFile(name?: string) {
  return /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(name ?? '');
}

function FrameStill({ fileId, online, name }: { fileId: string; online: boolean; name?: string }) {
  if (isImageName(name)) return <ImageThumb fileId={fileId} online={online} />;
  return <VideoThumb fileId={fileId} online={online} interactive={false} className="w-full" />;
}

function FilePreview({
  item,
  playing,
  onPlay,
  onRatio,
}: {
  item: any;
  playing: boolean;
  onPlay: () => void;
  onRatio?: (ratio: number) => void;
}) {
  if (isImageName(item.fileName)) {
    return <ImageThumb fileId={item.fileInstanceId} online={item.deviceState === 'ONLINE'} onRatio={onRatio} />;
  }
  return (
    <VideoThumb
      fileId={item.fileInstanceId}
      online={item.deviceState === 'ONLINE'}
      playing={playing}
      onPlay={onPlay}
      onRatio={onRatio}
      className="w-full"
    />
  );
}

function locked(state?: string) {
  return state === 'QUEUED' || state === 'UPLOADING' || state === 'PUBLISHED';
}

function LinkFiles({
  variantId,
  assetId,
  assetTitle,
  onClose,
  onDone,
}: {
  variantId: string;
  assetId: string;
  assetTitle?: string;
  onClose: () => void;
  onDone: () => Promise<unknown> | void;
}) {
  const [q, setQ] = useState('');
  const files = useApi<{ items: any[] }>('/library', { query: { kind: 'VIDEO', assetId, sameFolder: true, q, limit: 200 } });
  return (
    <FormDialog open onClose={onClose} title="Link a video" submitLabel="Close" onSubmit={async () => {}}>
      <p className="text-sm text-muted">Videos in the same folder as {assetTitle || 'this asset'}.</p>
      <Field label="Search">
        <Input value={q} onChange={(e) => setQ(e.target.value)} />
      </Field>
      <ul className="max-h-64 space-y-1 overflow-auto">
        {(files.data?.items ?? []).map((f) => (
          <li key={f.id}>
            <button
              type="button"
              className="w-full cursor-pointer rounded-lg border border-border px-2 py-1.5 text-left text-sm hover:border-accent"
              onClick={async () => {
                await post(`/variants/${variantId}/files`, { fileInstanceId: f.id });
                await onDone();
                onClose();
              }}
            >
              <span className="block truncate font-medium">{f.fileName}</span>
              <span className="block truncate text-xs text-muted">{f.deviceName} · {f.displayPath}</span>
            </button>
          </li>
        ))}
      </ul>
    </FormDialog>
  );
}

function UploadFile({ variantId, onClose, onDone }: { variantId: string; onClose: () => void; onDone: () => Promise<unknown> | void }) {
  const roots = useRoots();
  const [rootId, setRootId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const choices = (roots.data ?? []).filter((r) => r.state === 'ACTIVE' && r.deviceState === 'ONLINE');
  return (
    <FormDialog
      open
      onClose={onClose}
      title="Upload a video"
      submitLabel="Upload and link"
      onSubmit={async () => {
        if (!file || !rootId) throw new ApiError(400, 'BAD_REQUEST', 'Choose a video and a folder on a PC that is on.');
        const res = await fetch(`/api/v1/variants/${variantId}/upload?rootId=${encodeURIComponent(rootId)}&name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          headers: { 'x-requested-with': 'creatoros', 'content-type': 'application/x-creatoros-file' },
          body: file,
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'UPLOAD', json?.error?.message ?? 'The upload did not finish.');
        await onDone();
      }}
    >
      <p className="text-sm text-muted">The file is copied into a folder that PC already indexes. Nothing is posted until you press Publish.</p>
      <Field label="Folder">
        <Select value={rootId} onChange={(e) => setRootId(e.target.value)}>
          <option value="">Choose a folder</option>
          {choices.map((r) => (
            <option key={r.id} value={r.id}>
              {r.deviceName} · {r.displayPath}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Video">
        <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
    </FormDialog>
  );
}

function SendDialog({
  variantId,
  item,
  account,
  draft,
  schedule,
  tz,
  onClose,
  onDone,
}: {
  variantId: string;
  item: any;
  account: any;
  draft?: any;
  schedule: boolean;
  tz?: string;
  onClose: () => void;
  onDone: () => Promise<unknown> | void;
}) {
  const [title, setTitle] = useState(draft?.title ?? '');
  const [caption, setCaption] = useState(draft?.caption ?? '');
  const [tags, setTags] = useState((draft?.hashtags ?? []).join(', '));
  const [privacy, setPrivacy] = useState(draft?.privacy ?? '');
  const [contentForm, setContentForm] = useState(draft?.contentForm ?? '');
  const [playlistIds, setPlaylistIds] = useState<string[]>(draft?.playlistIds ?? []);
  const [aiUse, setAiUse] = useState(draft?.aiUse ?? '');
  const [whenLocal, setWhenLocal] = useState('');
  return (
    <FormDialog
      open
      onClose={onClose}
      title={schedule ? `Schedule on ${titleCase(account.platform)}` : `Publish to ${titleCase(account.platform)}`}
      submitLabel={schedule ? 'Schedule' : 'Publish'}
      onSubmit={async () => {
        if (schedule) {
          if (!whenLocal) throw new ApiError(400, 'BAD_REQUEST', 'Choose the date and time.');
          await post('/publishing/schedule', {
            itemId: item.id,
            socialAccountId: account.id,
            requestId: crypto.randomUUID(),
            title: title.trim() || null,
            caption: caption.trim() || null,
            hashtags: publishHashtags(account.platform, tags),
            privacy: publishPrivacy(account.platform, privacy),
            contentForm: contentForm || null,
            playlistIds,
            aiUse: aiUse || null,
            plannedLocal: whenLocal.slice(0, 16),
            timezone: tz,
          });
        } else {
          await post('/publishing/publish', {
            itemId: item.id,
            socialAccountId: account.id,
            requestId: crypto.randomUUID(),
            title: title.trim() || null,
            caption: caption.trim() || null,
            hashtags: publishHashtags(account.platform, tags),
            privacy: publishPrivacy(account.platform, privacy),
            contentForm: contentForm || null,
            playlistIds,
            aiUse: aiUse || null,
          });
        }
        await refresh(`/variants/${variantId}/publish`, '/publishing/matrix');
        await onDone();
      }}
    >
      <p className="text-sm text-muted">
        {item.fileName} → {account.handle}. {schedule ? 'Creator OS sends it at the time you set.' : 'This sends the file now.'} The original stays on the PC.
      </p>
      <PublishFields
        platform={account.platform}
        item={item}
        title={title}
        setTitle={setTitle}
        caption={caption}
        setCaption={setCaption}
        tags={tags}
        setTags={setTags}
        privacy={privacy}
        setPrivacy={setPrivacy}
        contentForm={contentForm}
        setContentForm={setContentForm}
        accountId={account.id}
        playlistIds={playlistIds}
        setPlaylistIds={setPlaylistIds}
        aiUse={aiUse}
        setAiUse={setAiUse}
      />
      {schedule && (
        <Field label="Publish at">
          <Input type="datetime-local" required value={whenLocal} onChange={(e) => setWhenLocal(e.target.value)} />
        </Field>
      )}
      {draft?.scheduledAt && <p className="text-xs text-muted">Currently scheduled for {when(draft.scheduledAt, tz)}.</p>}
    </FormDialog>
  );
}

function shrinkImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const edge = 1600;
      const scale = Math.min(1, edge / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not read that image'));
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    img.src = url;
  });
}
