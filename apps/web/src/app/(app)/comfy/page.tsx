'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { ApiError, api, del, post, put, refresh, useApi } from '@/lib/api';
import { FileDownload } from '@/components/file-download';
import { VideoTrim } from '@/components/video-trim';
import { VideoThumb, SizedFrame } from '@/components/video-thumb';
import { ActionButton, Async, Badge, Button, Card, CardTitle, Dialog, EmptyState, Field, Input, Notice, PageHeader, Select, Spinner, Tabs, Textarea } from '@/components/ui';
import { H3_ASPECTS, LTX_UPSCALE_QUALITIES, h3AspectRatio, type LtxResizeType, type LtxUpscaleQuality } from '@creatoros/domain';
import { clipBounds, clipPlayback } from '@/lib/audio-clip';
import { ago } from '@/lib/format';
import { uxV5 } from '@/components/ux-v5-flag';
import { useWorkspace } from '@/lib/workspace';
import { LongVideos } from './long-videos';
import { AiPromptTools, AiSwitch } from '@/components/ai-tools';

type Issue = { field: string; message: string };
type Worker = {
  id: string;
  label: string;
  baseUrl: string;
  role: string;
  expectedVramGb: number | null;
  lastOk: boolean | null;
  lastError: string | null;
  reportedVramGb: number | null;
  comfyVersion: string | null;
  deviceName: string | null;
  enabled: boolean;
  /** Live ComfyUI queue. busy = red, free = green. Absent until this page has checked. */
  queue?: 'busy' | 'free' | 'offline';
};

const WORKER_KEY = 'cos-ltx-worker';

function savedWorkerId() {
  try {
    return localStorage.getItem(WORKER_KEY);
  } catch {
    return null;
  }
}

function rememberWorker(id: string | null) {
  try {
    if (id) localStorage.setItem(WORKER_KEY, id);
    else localStorage.removeItem(WORKER_KEY);
  } catch {
    /* private mode */
  }
}

const STUDIO_KEY = 'cos-ltx-studio';

function readStudioMemory(): {
  form: Partial<Form>;
  imageName: string | null;
  audioName: string | null;
  audioSeconds: number | null;
} | null {
  try {
    const raw = localStorage.getItem(STUDIO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      form?: Partial<Form>;
      imageName?: string | null;
      audioName?: string | null;
      audioSeconds?: number | null;
    };
    if (!parsed?.form || typeof parsed.form !== 'object') return null;
    return {
      form: parsed.form,
      imageName: parsed.imageName ?? null,
      audioName: parsed.audioName ?? null,
      audioSeconds: typeof parsed.audioSeconds === 'number' ? parsed.audioSeconds : null,
    };
  } catch {
    return null;
  }
}

function writeStudioMemory(memory: {
  form: Form;
  imageName: string | null;
  audioName: string | null;
  audioSeconds: number | null;
}) {
  try {
    localStorage.setItem(STUDIO_KEY, JSON.stringify(memory));
  } catch {
    /* private mode */
  }
}

/** e.g. RTX 3090 + 24 → "24GB (3090)" */
function gpuTitle(w: Pick<Worker, 'label' | 'expectedVramGb'>) {
  const short = w.label.replace(/^RTX\s+/i, '').trim() || w.label;
  return w.expectedVramGb != null ? `${w.expectedVramGb}GB (${short})` : short;
}

function usePcQueue(workerIds: string[]) {
  const key = workerIds.slice().sort().join(',');
  const [queues, setQueues] = useState<Record<string, NonNullable<Worker['queue']>>>({});
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (!ids.length) return;
    let gone = false;
    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      for (const id of ids) {
        api<{ queue: 'busy' | 'free' | 'offline' }>(`/comfy/workers/${id}/queue`)
          .then((r) => {
            if (!gone) setQueues((q) => ({ ...q, [id]: r.queue }));
          })
          .catch(() => {
            if (!gone) setQueues((q) => ({ ...q, [id]: 'offline' }));
          });
      }
    };
    tick();
    const timer = setInterval(tick, 8000);
    const onShow = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      gone = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [key]);
  return [queues, setQueues] as const;
}

function comfyLabel(queue: Worker['queue'] | undefined) {
  if (queue === 'busy') return 'Rendering';
  if (queue === 'free') return 'Available';
  return 'Offline';
}

function WorkerRail({
  workers,
  selectedId,
  queues,
}: {
  workers: Worker[];
  selectedId: string | null;
  queues: Record<string, 'busy' | 'free' | 'offline' | undefined>;
}) {
  const paired = useApi<{ devices: PairedPc[] }>('/comfy/windows-tasks', { refreshInterval: 15_000 });
  if (!uxV5()) return null;
  return (
    <aside>
      <div className="mb-3 text-[12px] font-bold">Execution & outputs</div>
      {workers.length === 0 && <p className="text-xs text-[#aebdb9]">No PC is saved yet. Add one under Settings.</p>}
      {workers.map((w) => {
        const queue = queues[w.id] ?? w.queue;
        const agent = agentFor(w, paired.data?.devices ?? []);
        const selected = w.id === selectedId;
        return (
          <div key={w.id} className="mb-2 rounded-[10px] border border-[#334647] bg-[#202b2d] p-3">
            <b className="block text-[12px]">{gpuTitle(w)}</b>
            <small className="text-[#a4b9b1]">
              {comfyLabel(queue)}
              {w.expectedVramGb ? ` · ${w.expectedVramGb} GB` : ''}
              {` · ${agent.label}`}
              {selected ? ' · selected' : ''}
            </small>
          </div>
        );
      })}
      <p className="mt-4 text-[11px] text-[#aebdb9]">Generate is the only control that starts a job. Playback needs that PC online.</p>
    </aside>
  );
}

const SPLIT_KEY = 'cos-studio-split';

function readSplit() {
  try {
    const saved = Number(localStorage.getItem(SPLIT_KEY));
    if (saved >= 280 && saved <= 2400) return saved;
  } catch {
    /* private mode */
  }
  return 460;
}

let splitWidth = 460;
const splitListeners = new Set<(width: number) => void>();

function publishSplit(width: number) {
  splitWidth = width;
  try {
    localStorage.setItem(SPLIT_KEY, String(width));
  } catch {
    /* private mode */
  }
  splitListeners.forEach((listen) => listen(width));
}

function StudioSplit({ left, right }: { left: ReactNode; right: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const widthRef = useRef(splitWidth);
  const [width, setWidth] = useState(splitWidth);
  useLayoutEffect(() => {
    const saved = readSplit();
    splitWidth = saved;
    widthRef.current = saved;
    setWidth(saved);
    splitListeners.add(setWidth);
    return () => {
      splitListeners.delete(setWidth);
    };
  }, []);
  function resize(next: number) {
    const parent = box.current;
    const max = parent ? Math.max(320, parent.clientWidth - 240) : 2400;
    const clamped = Math.min(max, Math.max(280, next));
    widthRef.current = clamped;
    publishSplit(clamped);
  }
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const start = widthRef.current;
    const move = (ev: PointerEvent) => resize(start + ev.clientX - startX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  return (
    <div ref={box} className="studio-split">
      <div className="studio-left" style={{ width }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the form and the preview"
        tabIndex={0}
        className="studio-grip"
        onPointerDown={down}
        onKeyDown={(event) => {
          const step = event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0;
          if (!step) return;
          event.preventDefault();
          resize(widthRef.current + step);
        }}
      />
      <div className="studio-right">{right}</div>
    </div>
  );
}

function phoneShape(ratio: string): 'tall' | 'wide' | 'square' {
  const text = ratio.toLowerCase();
  if (text.includes('1:1') || text.includes('square')) return 'square';
  if (text.includes('9:16') || text.includes('3:4') || text.includes('4:5') || text.includes('portrait')) return 'tall';
  return 'wide';
}

function frameLabel(width: number, height: number) {
  if (!(width > 0) || !(height > 0)) return 'Frame';
  const ratio = width / height;
  const known: [number, string][] = [
    [9 / 16, '9:16 Portrait'],
    [16 / 9, '16:9'],
    [1, '1:1'],
    [4 / 5, '4:5'],
    [3 / 4, '3:4'],
  ];
  return known.find(([value]) => Math.abs(ratio - value) < 0.05)?.[1] ?? `${width}×${height}`;
}

function prettyName(name: string) {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || name;
}

function GpuDot({ status }: { status?: 'busy' | 'free' | 'offline' }) {
  const tone = status === 'busy' ? 'bg-bad' : status === 'free' ? 'bg-ok' : 'bg-muted';
  const label = status === 'busy' ? 'Rendering' : status === 'free' ? 'Free' : 'Offline';
  return (
    <span
      className={`inline-block size-2.5 shrink-0 rounded-full ${tone}`}
      title={label}
      aria-label={label}
    />
  );
}
type Studio = {
  preset: {
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    audioStartSec: number;
    loraStrength: number;
    loraName: string;
    prompt: string;
    negativePrompt: string;
    upscale: { width: number; height: number; quality: string };
    nodeCount: number;
    executable: boolean;
    notes: string[];
  } | null;
  generation: 'READY' | 'BLOCKED';
  blockReason: string | null;
  apiExportPresent: boolean;
  workers: Worker[];
  draft: (Form & { imageName?: string | null; audioName?: string | null; audioDurationMs?: number | null }) | null;
  jobs: {
    id: string;
    projectId?: string | null;
    brandId?: string | null;
    projectTitle?: string | null;
    status: string;
    outcome: string;
    error: string | null;
    createdAt: string;
    settings: SavedClip['settings'] & {
      progress?: { phase: string; value: number | null; max: number | null; detail: string };
      outputs?: { filename: string; node?: string }[];
      upscaleFailed?: boolean;
      projectTitle?: string | null;
    };
    files: {
      fileId: string | null;
      fileName: string | null;
      displayPath: string | null;
      deviceName: string | null;
      assetId: string | null;
      assetTitle: string | null;
      expectedPath: string | null;
    }[];
  }[];
};
type Form = {
  projectId: string | null;
  workerId: string | null;
  imageFileId: string | null;
  audioFileId: string | null;
  audioStartSec: number;
  durationSec: number;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  fps: number;
  loraName: string;
  loraStrength: number;
  upscaleWidth: number;
  upscaleHeight: number;
  upscaleResizeType: LtxResizeType;
  upscaleQuality: LtxUpscaleQuality;
  upscaleScale: number;
  wantUpscale: boolean;
  imageUploadName: string | null;
  imageUploadWorkerId: string | null;
  audioUploadName: string | null;
  audioUploadWorkerId: string | null;
};
type CheckResult = { ok?: boolean; errors?: Issue[]; warnings?: Issue[]; blockReason?: string | null; prompted?: boolean; loaded?: boolean };
type SavedClip = {
  id: string;
  projectId: string | null;
  createdAt: string;
  status: string;
  settings: Partial<Form> & {
    workerId?: string | null;
    workerLabel?: string;
    imageName?: string | null;
    audioName?: string | null;
    prompt?: string;
    negativePrompt?: string;
    aspectRatio?: string;
    megapixels?: number;
  };
};

function num(value: unknown, fallback: number) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Keeps the box empty while the number is deleted. A controlled number input would put 0 back immediately. */
function LooseNumber({ value, onValue }: { value: number; onValue: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
        setDraft(raw);
        if (raw === '' || raw === '.') return;
        const n = Number(raw);
        if (Number.isFinite(n)) onValue(n);
      }}
      onBlur={() => {
        focused.current = false;
        if (draft === '' || draft === '.' || !Number.isFinite(Number(draft))) setDraft(String(value));
      }}
    />
  );
}

const FRAME_SIZES: [string, number, number][] = [
  ['YouTube Shorts', 576, 1024],
  ['Instagram Reels / TikTok', 576, 1024],
  ['Facebook Reels', 576, 1024],
  ['YouTube Standard (16:9)', 960, 540],
  ['Instagram Square (1:1)', 576, 576],
];
const UPSCALE_SIZES: [string, number, number][] = [
  ['Shorts', 1152, 2048],
  ['Normal videos', 1920, 1080],
];

const PRESET_FALLBACK = {
  width: 576,
  height: 1024,
  fps: 30,
  durationSec: 30,
  audioStartSec: 48,
  loraStrength: 0.88,
  loraName: 'mehaklora-ltx.safetensors',
  prompt: '',
  negativePrompt: '',
  upscale: { width: 1152, height: 2048, quality: 'ULTRA' },
};

export default function ComfyPage() {
  const [tab, setTab] = useState<'ltx' | 'audio' | 'h3' | 'long' | 'history' | 'settings'>('ltx');
  const [recall, setRecall] = useState<SavedClip | null>(null);
  useEffect(() => {
    if (window.location.hash === '#history') setTab('history');
    if (window.location.hash.startsWith('#long')) setTab('long');
  }, []);
  const v5 = uxV5();
  const studioTabs = [
    { id: 'ltx' as const, label: v5 ? 'LTX Video' : 'LTX' },
    { id: 'h3' as const, label: 'MiniMax H3' },
    { id: 'long' as const, label: 'Long Videos' },
    { id: 'audio' as const, label: 'Audio' },
    { id: 'history' as const, label: 'History' },
    { id: 'settings' as const, label: 'Settings' },
  ];
  return (
    <div>
      <PageHeader
        title={v5 ? 'Creative Studio' : 'ComfyUI'}
        subtitle={v5 ? undefined : 'Fill the clip and generate only when you press the button. PCs are added under Settings.'}
      />
      {v5 ? (
        <div className="studio-wrap studio-page">
          <div className="studio-top">
            <div className="studio-tabs" role="tablist">
              {studioTabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  className={tab === item.id ? 'studio-tab active' : 'studio-tab'}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <AiSwitch />
          </div>
          <div className={tab === 'history' || tab === 'settings' ? 'p-5' : undefined}>
            <StudioBody tab={tab} recall={recall} onHistory={() => setTab('history')} onUse={(clip) => { setRecall(clip); setTab('ltx'); }} />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs tabs={studioTabs} value={tab} onChange={setTab} />
          <AiSwitch />
        </div>
      )}
      {!v5 && <StudioBody tab={tab} recall={recall} onHistory={() => setTab('history')} onUse={(clip) => { setRecall(clip); setTab('ltx'); }} />}
    </div>
  );
}

function StudioBody({
  tab,
  recall,
  onUse,
  onHistory,
}: {
  tab: 'ltx' | 'audio' | 'h3' | 'long' | 'history' | 'settings';
  recall: SavedClip | null;
  onUse: (clip: SavedClip) => void;
  onHistory: () => void;
}) {
  return (
    <>
      <div hidden={tab !== 'ltx'}>
        <LtxStudio recall={recall} onHistory={onHistory} />
      </div>
      <div hidden={tab !== 'audio'}>
        <AudioTab onHistory={onHistory} />
      </div>
      <div hidden={tab !== 'h3'}>
        <H3Tab onHistory={onHistory} />
      </div>
      <div hidden={tab !== 'long'}>
        <LongVideos active={tab === 'long'} />
      </div>
      <div hidden={tab !== 'history'}>
        <HistoryTab onUse={onUse} />
      </div>
      <div hidden={tab !== 'settings'} className="space-y-4">
        {tab === 'settings' ? (
          <>
            <MachineSetup />
            <WindowsTasks />
          </>
        ) : null}
      </div>
    </>
  );
}

function voiceSrc(job: { id: string; status: string; settings?: { localAudio?: string | null; outputs?: { type?: string; filename?: string }[] } } | null) {
  if (!job || job.status !== 'SUCCEEDED') return null;
  if (typeof job.settings?.localAudio === 'string' && job.settings.localAudio) return `/api/v1/comfy/jobs/${job.id}/audio`;
  const outputs = (job.settings?.outputs ?? []).filter((item) => !item.filename || /\.(wav|mp3|flac|ogg|m4a)$/i.test(item.filename));
  if (outputs.length > 0 && outputs.every((item) => item.type === 'temp')) return null;
  return `/api/v1/comfy/jobs/${job.id}/audio`;
}

function jobLabel(status: string, progress?: { phase?: string } | null) {
  if (status === 'SUCCEEDED') return 'Ready';
  if (status === 'FAILED') return 'Failed';
  if (status === 'QUEUED' || progress?.phase === 'waiting') return 'Waiting in the queue';
  if (status === 'RUNNING') return 'Rendering';
  return status;
}

function useWorkspaceProjectIds() {
  const { id } = useWorkspace();
  const projects = useApi<{ id: string }[]>(id ? '/projects' : null, { query: { brandId: id ?? undefined, limit: 200 } });
  const ids = new Set((projects.data ?? []).map((project) => project.id));
  return { ready: Boolean(id && projects.data), ids, workspaceId: id };
}

function inWorkspace(job: { projectId?: string | null; brandId?: string | null }, scope: { ready: boolean; ids: Set<string> }) {
  if (!scope.ready || !job.projectId) return true;
  if ('brandId' in job && job.brandId == null) return true;
  return scope.ids.has(job.projectId);
}

function HistoryTab({ onUse }: { onUse: (clip: SavedClip) => void }) {
  const scope = useWorkspaceProjectIds();
  const ltx = useApi<Studio>('/comfy/ltx');
  const h3 = useApi<{ jobs: Studio['jobs'] }>('/comfy/h3');
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [trimFile, setTrimFile] = useState<{ id: string; projectId: string | null } | null>(null);
  const clips = [...(ltx.data?.jobs ?? []).map((job) => ({ ...job, kind: 'LTX' as const })), ...(h3.data?.jobs ?? []).map((job) => ({ ...job, kind: 'MiniMax' as const }))]
    .filter((job) => inWorkspace(job, scope))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);
  const rendering = clips.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING');
  useEffect(() => {
    if (!rendering) return;
    const timer = setInterval(() => void refresh('/comfy/ltx', '/comfy/h3'), 4000);
    return () => clearInterval(timer);
  }, [rendering]);
  if (!ltx.data && !h3.data && (ltx.isLoading || h3.isLoading)) return <Spinner />;
  if (clips.length === 0) {
    return <EmptyState title="No generations yet">Generate a clip on LTX or MiniMax. The latest ones stay here.</EmptyState>;
  }
  return (
    <>
      <ul className="space-y-2">
        {clips.map((job) => {
          const s = job.settings ?? {};
          const prompt = (s.prompt ?? '').trim();
          const project = job.projectTitle || s.projectTitle || 'No project';
          const machine = s.workerLabel ?? 'No PC';
          return (
            <li key={job.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={job.status === 'SUCCEEDED' ? 'ok' : job.status === 'FAILED' ? 'bad' : job.status === 'RUNNING' && s.progress?.phase !== 'waiting' ? 'info' : 'warn'}>
                        {jobLabel(job.status, s.progress)}
                      </Badge>
                      <Badge tone="neutral">{job.kind}</Badge>
                      <span className="font-medium">{machine}</span>
                      <span className="text-sm">{project}</span>
                    </div>
                    <div className="mt-1 font-medium">{prompt ? prompt.slice(0, 120) : 'No prompt'}</div>
                    <p className="mt-1 text-xs text-muted">
                      {job.kind === 'LTX'
                        ? `${s.imageName ?? 'No image'} · ${s.audioName ?? 'No song'} · from ${s.audioStartSec ?? 0}s for ${s.durationSec ?? 0}s · ${s.width ?? '—'}×${s.height ?? '—'}`
                        : `${s.aspectRatio ?? 'MiniMax'} · ${s.megapixels ?? 1} MP`}
                      {' · '}
                      {ago(job.createdAt)}
                    </p>
                  </div>
                  {job.kind === 'LTX' ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        onUse({
                          id: job.id,
                          projectId: job.projectId ?? null,
                          createdAt: job.createdAt,
                          status: job.status,
                          settings: s,
                        })
                      }
                    >
                      Use in the form
                    </Button>
                  ) : null}
                </div>
                {job.status === 'QUEUED' ? <p className="mt-2 text-sm text-muted">Waiting to send this clip to the PC.</p> : null}
                {job.status === 'RUNNING' ? (
                  <div className="mt-2">
                    <p className="text-sm text-muted">{s.progress?.detail ?? 'Working on that PC. This updates about every 15 seconds.'}</p>
                    {s.progress?.max ? (
                      <div className="mt-1 h-1.5 overflow-hidden rounded bg-panel2" aria-hidden>
                        <div
                          className="h-full bg-accent"
                          style={{ width: `${Math.min(100, Math.round(((s.progress.value ?? 0) / s.progress.max) * 100))}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {job.kind === 'LTX' && (s.upscaleFailed || job.error === 'Upscaling Failed') ? (
                  <p className="mt-2 text-sm font-medium">Upscaling Failed</p>
                ) : job.error ? (
                  <p className="mt-2 text-sm text-muted">{job.error}</p>
                ) : null}
                {job.status === 'SUCCEEDED' && s.outputs?.length ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <VideoThumb src={`/api/v1/comfy/jobs/${job.id}/video`} className="w-full max-w-sm" />
                    <FileDownload href={`/api/v1/comfy/jobs/${job.id}/video?download=1`} name={`${job.kind}-${job.id}.mp4`} />
                  </div>
                ) : null}
                {job.files?.some((f) => f.fileId) ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {job.files.filter((f) => f.fileId).map((f) => (
                      <span key={f.fileId ?? f.expectedPath} className="inline-flex items-center gap-2">
                        <Button size="sm" onClick={() => f.fileId && setOpenFile(f.fileId)}>
                          Open {f.assetTitle ? `${f.assetTitle} / ` : ''}{f.fileName ?? 'library file'}
                        </Button>
                        {f.fileId ? <FileDownload href={`/api/v1/files/${f.fileId}/stream?download=1`} name={f.fileName ?? 'video.mp4'} /> : null}
                        {f.fileId ? (
                          <Button size="sm" onClick={() => setTrimFile({ id: f.fileId!, projectId: job.projectId ?? null })}>
                            Edit video
                          </Button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                ) : job.status === 'SUCCEEDED' ? (
                  <p className="mt-2 text-xs text-muted">
                    The video is on {machine}. Play it here. It appears in the library after that output folder is scanned.
                  </p>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
      {openFile ? <LibraryFileOnPage id={openFile} onClose={() => setOpenFile(null)} /> : null}
      {trimFile ? <VideoTrim fileId={trimFile.id} projectId={trimFile.projectId} onClose={() => setTrimFile(null)} /> : null}
    </>
  );
}

function taskStatusLabel(status: string) {
  if (status === 'RUNNING') return 'Running';
  if (status === 'READY') return 'Ready';
  if (status === 'DISABLED') return 'Disabled';
  if (status === 'NOT_FOUND') return 'Not found';
  return 'Not checked yet';
}

function WindowsTasks() {
  const board = useApi<{
    devices: { id: string; displayName: string; state: string; os: string | null }[];
    tasks: {
      id: string;
      deviceId: string;
      deviceName: string;
      deviceState: string;
      label: string;
      taskName: string;
      status: string;
      detail: string | null;
      checkedAt: string | null;
      restartStatus: string | null;
      restartError: string | null;
    }[];
  }>('/comfy/windows-tasks');
  const [form, setForm] = useState({ deviceId: '', label: 'ComfyUI', taskName: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const waiting = (board.data?.tasks ?? []).some((task) => task.restartStatus === 'PENDING' || task.restartStatus === 'RUNNING');
  useEffect(() => {
    const timer = setInterval(() => void refresh('/comfy/windows-tasks'), waiting ? 4000 : 15000);
    return () => clearInterval(timer);
  }, [waiting]);
  return (
    <Async res={board}>
      {(data) => {
        const devices = data.devices ?? [];
        const tasks = data.tasks ?? [];
        return (
          <Card>
            <CardTitle>Windows tasks</CardTitle>
            <p className="mb-3 text-sm text-muted">
              Add the Task Scheduler name from a paired Windows PC, such as ComfyUI or the Telegram task. Status comes from that PC’s agent. Restart stops the task and starts it again. It does not run any other command.
            </p>
            {devices.length === 0 ? (
              <EmptyState title="No paired PC">Pair the scanner agent on the Windows machine first. Docker does not update that program.</EmptyState>
            ) : (
              <>
                {tasks.length === 0 ? <p className="mb-3 text-sm text-muted">No scheduled tasks are being watched yet.</p> : null}
                <ul className="mb-4 space-y-2">
                  {tasks.map((task) => {
                    const restarting = task.restartStatus === 'PENDING' || task.restartStatus === 'RUNNING';
                    return (
                      <li key={task.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 font-medium">
                            <span>{task.label}</span>
                            <Badge tone={task.status === 'RUNNING' ? 'ok' : task.status === 'NOT_FOUND' || task.status === 'DISABLED' ? 'bad' : 'neutral'}>
                              {restarting ? 'Restarting' : taskStatusLabel(task.status)}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted">
                            {task.deviceName} · {task.taskName}
                            {task.deviceState !== 'ONLINE' ? ' · PC offline' : ''}
                          </div>
                          {task.detail ? <div className="text-xs text-muted">{task.detail}</div> : null}
                          {task.restartError ? <div className="text-xs text-bad">{task.restartError}</div> : null}
                        </div>
                        <div className="flex gap-2">
                          <ActionButton
                            confirm={`Stop and start ${task.label} on ${task.deviceName}?`}
                            onAction={async () => {
                              await post(`/comfy/windows-tasks/${task.id}/restart`);
                              await refresh('/comfy/windows-tasks');
                            }}
                          >
                            Restart
                          </ActionButton>
                          <ActionButton
                            variant="danger"
                            confirm="Stop watching this task? The scheduled task itself stays on the PC."
                            onAction={async () => {
                              await del(`/comfy/windows-tasks/${task.id}`);
                              await refresh('/comfy/windows-tasks');
                            }}
                          >
                            Remove
                          </ActionButton>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="PC">
                    <Select value={form.deviceId} onChange={(e) => setForm({ ...form, deviceId: e.target.value })}>
                      <option value="">Choose a PC</option>
                      {devices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.displayName}
                          {device.state === 'ONLINE' ? '' : ' — offline'}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="What it is">
                    <Input value={form.label} placeholder="ComfyUI" onChange={(e) => setForm({ ...form, label: e.target.value })} />
                  </Field>
                  <Field label="Task Scheduler name" hint="The name in Task Scheduler, for example \\ComfyUI">
                    <Input value={form.taskName} placeholder="\\ComfyUI" onChange={(e) => setForm({ ...form, taskName: e.target.value })} />
                  </Field>
                </div>
                {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
                <Button
                  className="mt-3"
                  busy={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await post('/comfy/windows-tasks', form);
                      setForm({ ...form, taskName: '' });
                      await refresh('/comfy/windows-tasks');
                    } catch (e) {
                      setError(e instanceof ApiError ? e.message : 'That task was not saved.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Add task
                </Button>
              </>
            )}
          </Card>
        );
      }}
    </Async>
  );
}

type PairedPc = { id: string; displayName: string; hostname: string | null; state: string; lastSeenAt: string | null };

function agentFor(worker: Worker, devices: PairedPc[]) {
  const gb = worker.expectedVramGb != null ? String(worker.expectedVramGb) : '';
  const hit = devices.find((device) => {
    const name = `${device.displayName} ${device.hostname ?? ''}`;
    return gb !== '' && name.includes(gb);
  });
  if (!hit) return { label: 'No scanner paired', online: false, seen: null as string | null, name: null as string | null };
  const seen = hit.lastSeenAt ? new Date(hit.lastSeenAt).getTime() : 0;
  const online = hit.state === 'ONLINE' && seen > Date.now() - 180_000;
  return { label: online ? 'Agent online' : 'Agent offline', online, seen: hit.lastSeenAt, name: hit.displayName };
}

function MachineSetup() {
  const studio = useApi<Studio>('/comfy/ltx');
  const paired = useApi<{ devices: PairedPc[] }>('/comfy/windows-tasks', { refreshInterval: 15_000 });
  const [machine, setMachine] = useState({ label: '', baseUrl: '', role: 'primary', expectedVramGb: '24' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <Async res={studio}>
      {(data) => {
        const workers = Array.isArray(data.workers) ? data.workers : [];
        const devices = paired.data?.devices ?? [];
        return (
          <Card>
            <CardTitle>Machines</CardTitle>
            <p className="mb-3 text-sm text-muted">
              Add the 3090, the 3060, or any other PC that runs ComfyUI. Use its Tailscale or LAN address. The LTX graph was built for a 24GB card. A 12GB card stays selectable and is warned when the models may not fit. Agent online is the Windows scanner, separate from the ComfyUI connection.
            </p>
            {workers.length === 0 ? (
              <EmptyState title="No PC yet">Add the address of a ComfyUI you can reach from this server.</EmptyState>
            ) : (
              <ul className="mb-4 space-y-2">
                {workers.map((w) => {
                  const agent = agentFor(w, devices);
                  return (
                  <li key={w.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <GpuDot status={w.queue} />
                        <span>{gpuTitle(w)}</span>
                        <Badge tone={w.role === 'primary' ? 'info' : 'neutral'}>{w.role === 'primary' ? 'Preferred' : 'Other'}</Badge>
                        <span className="text-xs font-normal text-muted">
                          {w.queue === 'busy' ? 'Rendering' : w.queue === 'free' ? 'Free' : 'Offline'}
                        </span>
                        <span className={`text-xs font-normal ${agent.online ? 'text-ok' : 'text-muted'}`}>· {agent.label}</span>
                      </div>
                      <div className="truncate text-xs text-muted">{w.baseUrl}</div>
                      <div className="text-xs text-muted">
                        {agent.name ? `Scanner ${agent.name}, seen ${ago(agent.seen)}. ` : 'No scanner agent is paired for this PC. '}
                        {w.lastOk == null
                          ? 'Not checked yet.'
                          : w.lastOk
                            ? `${w.deviceName ?? 'Connected'}${w.reportedVramGb ? `, ${w.reportedVramGb} GB` : ''}${w.comfyVersion ? `, ComfyUI ${w.comfyVersion}` : ''}`
                            : 'Last check failed.'}
                        {w.lastError ? ` ${w.lastError}` : ''}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <ActionButton
                        onAction={async () => {
                          await post(`/comfy/workers/${w.id}/check`);
                          await refresh('/comfy/ltx');
                        }}
                      >
                        Check
                      </ActionButton>
                      <ActionButton
                        variant="danger"
                        confirm="Remove this PC from the list? Renders already recorded stay."
                        onAction={async () => {
                          await del(`/comfy/workers/${w.id}`);
                          await refresh('/comfy/ltx');
                        }}
                      >
                        Remove
                      </ActionButton>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name">
                <Input value={machine.label} placeholder="RTX 3090" onChange={(e) => setMachine({ ...machine, label: e.target.value })} />
              </Field>
              <Field label="Address" hint="Private address only, for example http://100.x.x.x:8188">
                <Input value={machine.baseUrl} placeholder="http://100.x.x.x:8188" onChange={(e) => setMachine({ ...machine, baseUrl: e.target.value })} />
              </Field>
              <Field label="Expected memory">
                <Select value={machine.expectedVramGb} onChange={(e) => setMachine({ ...machine, expectedVramGb: e.target.value })}>
                  <option value="24">24 GB (3090)</option>
                  <option value="12">12 GB (3060)</option>
                  <option value="8">8 GB</option>
                  <option value="16">16 GB</option>
                  <option value="48">48 GB</option>
                </Select>
              </Field>
              <Field label="Preference">
                <Select value={machine.role} onChange={(e) => setMachine({ ...machine, role: e.target.value })}>
                  <option value="primary">Preferred</option>
                  <option value="secondary">Other</option>
                </Select>
              </Field>
            </div>
            {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
            <Button
              className="mt-3"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await post('/comfy/workers', {
                    label: machine.label,
                    baseUrl: machine.baseUrl,
                    role: machine.role,
                    expectedVramGb: Number(machine.expectedVramGb),
                  });
                  setMachine({ label: '', baseUrl: '', role: 'secondary', expectedVramGb: machine.expectedVramGb });
                  await refresh('/comfy/ltx');
                } catch (e) {
                  setError(e instanceof ApiError ? e.message : 'Could not add that PC.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add PC
            </Button>
          </Card>
        );
      }}
    </Async>
  );
}

function LtxStudio({ recall, onHistory }: { recall: SavedClip | null; onHistory: () => void }) {
  const scope = useWorkspaceProjectIds();
  const studio = useApi<Studio>('/comfy/ltx');
  const [form, setForm] = useState<Form | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [audioSeconds, setAudioSeconds] = useState<number | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loras, setLoras] = useState<string[]>([]);
  const [queues, setQueues] = usePcQueue((studio.data?.workers ?? []).map((worker) => worker.id));
  const [clipNote, setClipNote] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [picking, setPicking] = useState<'image' | 'audio' | null>(null);
  const [manageLora, setManageLora] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const clipOn = useRef(false);
  const holding = useRef(false);
  const clipTimer = useRef<number | null>(null);
  const boundsRef = useRef({ start: 0, end: 0 });
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!studio.data || form) return;
    const d = studio.data.draft;
    const p = studio.data.preset ?? PRESET_FALLBACK;
    const workers = Array.isArray(studio.data.workers) ? studio.data.workers : [];
    const remembered = savedWorkerId();
    const workerId =
      (remembered && workers.some((w) => w.id === remembered) ? remembered : null) ??
      d?.workerId ??
      workers.find((w) => w.role === 'primary')?.id ??
      null;
    const saved = readStudioMemory();
    const base: Form = {
      projectId: d?.projectId ?? null,
      workerId,
      imageFileId: d?.imageFileId ?? null,
      audioFileId: d?.audioFileId ?? null,
      audioStartSec: d?.audioStartSec ?? p.audioStartSec,
      durationSec: d?.durationSec ?? p.durationSec,
      prompt: d?.prompt ?? p.prompt,
      negativePrompt: d?.negativePrompt ?? p.negativePrompt,
      width: d?.width ?? p.width,
      height: d?.height ?? p.height,
      fps: d?.fps ?? p.fps,
      loraName: d?.loraName || p.loraName,
      loraStrength: d?.loraStrength ?? p.loraStrength,
      upscaleWidth: d?.upscaleWidth ?? p.upscale.width,
      upscaleHeight: d?.upscaleHeight ?? p.upscale.height,
      upscaleResizeType: 'target dimensions',
      upscaleQuality: 'ULTRA',
      upscaleScale: 2,
      wantUpscale: d?.wantUpscale ?? true,
      imageUploadName: d?.imageUploadName ?? null,
      imageUploadWorkerId: d?.imageUploadWorkerId ?? null,
      audioUploadName: d?.audioUploadName ?? null,
      audioUploadWorkerId: d?.audioUploadWorkerId ?? null,
    };
    setForm(saved?.form ? { ...base, ...saved.form } : base);
    setImageName(saved?.imageName ?? d?.imageName ?? null);
    setAudioName(saved?.audioName ?? d?.audioName ?? null);
    setAudioSeconds(saved?.audioSeconds ?? (d?.audioDurationMs != null ? d.audioDurationMs / 1000 : null));
  }, [studio.data, form]);

  useEffect(() => {
    if (!form) return;
    writeStudioMemory({ form, imageName, audioName, audioSeconds });
  }, [form, imageName, audioName, audioSeconds]);

  useEffect(() => {
    if (!recall) return;
    const s = recall.settings;
    setForm((current) => {
      const base = current ?? {
        projectId: null,
        workerId: null,
        imageFileId: null,
        audioFileId: null,
        audioStartSec: PRESET_FALLBACK.audioStartSec,
        durationSec: PRESET_FALLBACK.durationSec,
        prompt: '',
        negativePrompt: '',
        width: PRESET_FALLBACK.width,
        height: PRESET_FALLBACK.height,
        fps: PRESET_FALLBACK.fps,
        loraName: PRESET_FALLBACK.loraName,
        loraStrength: PRESET_FALLBACK.loraStrength,
        upscaleWidth: PRESET_FALLBACK.upscale.width,
        upscaleHeight: PRESET_FALLBACK.upscale.height,
        upscaleResizeType: 'target dimensions',
        upscaleQuality: 'ULTRA',
        upscaleScale: 2,
        wantUpscale: true,
        imageUploadName: null,
        imageUploadWorkerId: null,
        audioUploadName: null,
        audioUploadWorkerId: null,
      };
      const imageFileId = s.imageFileId ?? null;
      const audioFileId = s.audioFileId ?? null;
      return {
        ...base,
        projectId: recall.projectId,
        workerId: s.workerId ?? base.workerId,
        imageFileId,
        audioFileId,
        audioStartSec: num(s.audioStartSec, base.audioStartSec),
        durationSec: num(s.durationSec, base.durationSec),
        prompt: s.prompt ?? '',
        negativePrompt: s.negativePrompt ?? '',
        width: num(s.width, base.width),
        height: num(s.height, base.height),
        fps: num(s.fps, base.fps),
        loraName: s.loraName || base.loraName,
        loraStrength: num(s.loraStrength, base.loraStrength),
        upscaleWidth: num(s.upscaleWidth, base.upscaleWidth),
        upscaleHeight: num(s.upscaleHeight, base.upscaleHeight),
        upscaleResizeType: s.upscaleResizeType === 'scale by multiplier' ? 'scale by multiplier' : 'target dimensions',
        upscaleQuality: s.upscaleQuality === 'LOW' || s.upscaleQuality === 'MEDIUM' || s.upscaleQuality === 'HIGH' || s.upscaleQuality === 'ULTRA' ? s.upscaleQuality : 'ULTRA',
        upscaleScale: num(s.upscaleScale, base.upscaleScale),
        wantUpscale: s.wantUpscale !== false,
        imageUploadName: imageFileId ? null : (s.imageUploadName ?? null),
        imageUploadWorkerId: imageFileId ? null : (s.workerId ?? null),
        audioUploadName: audioFileId ? null : (s.audioUploadName ?? null),
        audioUploadWorkerId: audioFileId ? null : (s.workerId ?? null),
      };
    });
    setImageName(s.imageName ?? null);
    setAudioName(s.audioName ?? null);
    if (s.workerId) rememberWorker(s.workerId);
    setResult({ ok: true, loaded: true, warnings: [], errors: [] });
  }, [recall]);

  useEffect(() => {
    if (!form?.workerId || !studio.data) return;
    const workers = Array.isArray(studio.data.workers) ? studio.data.workers : [];
    if (workers.length > 0 && !workers.some((w) => w.id === form.workerId)) {
      rememberWorker(null);
      setForm((f) => (f ? { ...f, workerId: null } : f));
    }
  }, [studio.data, form?.workerId]);

  const audioSrc = form?.audioFileId
    ? `/api/v1/files/${form.audioFileId}/stream`
    : form?.audioUploadName && (form.audioUploadWorkerId || form.workerId)
      ? `/api/v1/comfy/workers/${form.audioUploadWorkerId || form.workerId}/input?name=${encodeURIComponent(form.audioUploadName)}`
      : null;

  boundsRef.current = form ? clipBounds(form.audioStartSec, form.durationSec) : boundsRef.current;

  function seekableEnd(el: HTMLAudioElement) {
    if (!el.seekable.length) return null;
    return el.seekable.end(el.seekable.length - 1);
  }

  function stopClip() {
    clipOn.current = false;
    holding.current = false;
    if (clipTimer.current != null) {
      window.clearInterval(clipTimer.current);
      clipTimer.current = null;
    }
    audioRef.current?.pause();
    setPlaying(false);
  }

  /** Keep the playhead inside the trim. The file itself is unchanged. */
  function enforceClip() {
    const el = audioRef.current;
    if (!el || !clipOn.current) return;
    const { start, end } = boundsRef.current;
    const action = clipPlayback(el.currentTime, start, end, seekableEnd(el));
    if (action === 'restart') {
      holding.current = false;
      el.pause();
      try {
        el.currentTime = start;
      } catch {
        /* the file cannot move yet */
      }
      clipOn.current = false;
      if (clipTimer.current != null) {
        window.clearInterval(clipTimer.current);
        clipTimer.current = null;
      }
      setPlaying(false);
      setClipNote('');
      return;
    }
    if (action === 'seek' || action === 'wait') {
      holding.current = true;
      if (!el.paused) el.pause();
      if (action === 'seek') {
        try {
          el.currentTime = start;
        } catch {
          /* try again on the next tick */
        }
      } else setClipNote('Loading the selected part…');
      return;
    }
    if (el.paused && holding.current) {
      holding.current = false;
      setClipNote('');
      void el.play().catch(() => {
        stopClip();
        setClipNote('The browser could not play this audio. The PC that holds it may be off.');
      });
    }
  }

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !form || el.readyState < 1 || !el.paused || clipOn.current) return;
    const { start } = clipBounds(form.audioStartSec, form.durationSec);
    if (Number.isFinite(el.duration) && start >= el.duration) {
      setClipNote(`This file is ${el.duration.toFixed(1)}s, so it cannot start at ${start}s.`);
      return;
    }
    try {
      el.currentTime = start;
    } catch {
      /* metadata is not ready to seek */
    }
  }, [audioSrc, form?.audioStartSec, form?.durationSec]);

  useEffect(() => () => stopClip(), []);

  useEffect(() => {
    if (!form?.workerId) {
      setLoras([]);
      return;
    }
    let gone = false;
    api<{ loras: string[] }>(`/comfy/workers/${form.workerId}/loras`)
      .then((r) => {
        if (!gone) setLoras(r.loras ?? []);
      })
      .catch(() => {
        if (!gone) setLoras([]);
      });
    return () => {
      gone = true;
    };
  }, [form?.workerId]);

  const rendering = (studio.data?.jobs ?? []).some((j) => j.status === 'QUEUED' || j.status === 'RUNNING');
  useEffect(() => {
    if (!rendering) return;
    const timer = setInterval(() => void refresh('/comfy/ltx'), 4000);
    return () => clearInterval(timer);
  }, [rendering]);

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  function setTrim(start: number, length: number) {
    const total = audioSeconds;
    const minLen = total != null && total > 0 && total < 1 ? Math.max(0.2, total) : 1;
    let nextStart = Math.max(0, Math.min(3600, start));
    let nextLen = Math.max(minLen, Math.min(120, length));
    if (total != null && total > 0) {
      nextStart = Math.min(nextStart, Math.max(0, total - minLen));
      nextLen = Math.min(nextLen, Math.max(minLen, total - nextStart));
    }
    set({
      audioStartSec: Math.round(nextStart * 10) / 10,
      durationSec: Math.round(nextLen * 10) / 10,
    });
  }
  function toggleClip() {
    const el = audioRef.current;
    if (!form || !el || !audioSrc) {
      setClipNote('Choose an audio file first.');
      return;
    }
    if (clipOn.current) {
      const { start } = boundsRef.current;
      stopClip();
      try {
        el.currentTime = start;
      } catch {
        /* leave the playhead where it is */
      }
      return;
    }
    const { start } = clipBounds(form.audioStartSec, form.durationSec);
    if (el.readyState >= 1 && Number.isFinite(el.duration) && start >= el.duration - 0.05) {
      setClipNote(`This file is ${el.duration.toFixed(1)}s, so it cannot start at ${start}s.`);
      return;
    }
    clipOn.current = true;
    holding.current = true;
    setPlaying(true);
    setClipNote('');
    if (clipTimer.current != null) window.clearInterval(clipTimer.current);
    clipTimer.current = window.setInterval(enforceClip, 100);
    enforceClip();
  }

  async function uploadToPc(kind: 'image' | 'audio', file: File) {
    if (!form?.workerId) {
      setResult({ ok: false, errors: [{ field: 'workerId', message: 'Choose the PC first. The file is saved on that PC.' }], warnings: [] });
      return;
    }
    setBusy(`upload-${kind}`);
    setResult(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/v1/comfy/workers/${form.workerId}/upload?kind=${kind}`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'creatoros', accept: 'application/json' },
      });
      const json = (await res.json().catch(() => null)) as { data?: { name?: string }; error?: { message?: string } } | null;
      if (!res.ok || !json?.data?.name) throw new ApiError(res.status, 'ERROR', json?.error?.message ?? 'That file was not saved on the PC.');
      if (kind === 'image') {
        set({ imageFileId: null, imageUploadName: json.data.name, imageUploadWorkerId: form.workerId });
        setImageName(file.name);
      } else {
        set({ audioFileId: null, audioUploadName: json.data.name, audioUploadWorkerId: form.workerId });
        setAudioName(file.name);
        setAudioSeconds(null);
      }
      setResult({ ok: true, warnings: [], errors: [] });
    } catch (e) {
      setResult({ ok: false, errors: [{ field: kind, message: e instanceof ApiError ? e.message : 'That file was not saved on the PC.' }], warnings: [] });
    } finally {
      setBusy(null);
    }
  }

  async function run(kind: 'validate' | 'generate' | 'draft') {
    if (!form) return;
    setBusy(kind);
    setResult(null);
    try {
      if (kind === 'draft') {
        await put('/comfy/ltx/draft', form);
        setResult({ ok: true, warnings: [], errors: [] });
      } else {
        const data = await api<CheckResult>(`/comfy/ltx/${kind}`, {
          method: 'POST',
          body: form,
          idempotencyKey: kind === 'generate' ? crypto.randomUUID() : undefined,
        });
        setResult(data);
        if (kind === 'generate' && form.workerId) setQueues((q) => ({ ...q, [form.workerId!]: 'busy' }));
      }
      await refresh('/comfy/ltx');
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      const details = Array.isArray(err?.details) ? (err.details as Issue[]) : null;
      setResult({ ok: false, errors: details ?? [{ field: 'form', message: err?.message ?? 'That did not save.' }], warnings: [] });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Async res={studio}>
      {(data) => {
        const workers = Array.isArray(data.workers) ? data.workers : [];
        const preset = data.preset ?? PRESET_FALLBACK;
        if (!form) return <Spinner />;
        if (uxV5()) {
          const recent = [...data.jobs].filter((job) => inWorkspace(job, scope)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 2);
          const shown = recent.find((job) => job.id === previewId) ?? recent[0] ?? null;
          const other = recent.find((job) => job.id !== shown?.id) ?? null;
          const imageSrc = form.imageFileId
            ? `/api/v1/files/${form.imageFileId}/preview`
            : form.imageUploadName && (form.imageUploadWorkerId || form.workerId)
              ? `/api/v1/comfy/workers/${form.imageUploadWorkerId || form.workerId}/input?name=${encodeURIComponent(form.imageUploadName)}`
              : null;
          const machine = workers.find((worker) => worker.id === form.workerId);
          const queue = form.workerId ? queues[form.workerId] ?? machine?.queue : undefined;
          const queueLabel = queue === 'busy' ? 'Rendering' : queue === 'offline' ? 'Offline' : machine ? 'Ready' : 'No PC';
          const applyJob = (job: Studio['jobs'][number]) => {
            const s = job.settings;
            set({
              projectId: job.projectId ?? form.projectId,
              workerId: s.workerId ?? form.workerId,
              imageFileId: s.imageFileId ?? null,
              audioFileId: s.audioFileId ?? null,
              audioStartSec: num(s.audioStartSec, form.audioStartSec),
              durationSec: num(s.durationSec, form.durationSec),
              prompt: s.prompt ?? '',
              negativePrompt: s.negativePrompt ?? '',
              width: num(s.width, form.width),
              height: num(s.height, form.height),
              fps: num(s.fps, form.fps),
              loraName: s.loraName || form.loraName,
              loraStrength: num(s.loraStrength, form.loraStrength),
              upscaleWidth: num(s.upscaleWidth, form.upscaleWidth),
              upscaleHeight: num(s.upscaleHeight, form.upscaleHeight),
              upscaleResizeType: s.upscaleResizeType === 'scale by multiplier' ? 'scale by multiplier' : 'target dimensions',
              upscaleQuality: s.upscaleQuality === 'LOW' || s.upscaleQuality === 'MEDIUM' || s.upscaleQuality === 'HIGH' || s.upscaleQuality === 'ULTRA' ? s.upscaleQuality : 'ULTRA',
              upscaleScale: num(s.upscaleScale, form.upscaleScale),
              wantUpscale: s.wantUpscale !== false,
              imageUploadName: s.imageFileId ? null : (s.imageUploadName ?? null),
              imageUploadWorkerId: s.imageFileId ? null : (s.workerId ?? null),
              audioUploadName: s.audioFileId ? null : (s.audioUploadName ?? null),
              audioUploadWorkerId: s.audioFileId ? null : (s.workerId ?? null),
            });
            setImageName(s.imageName ?? null);
            setAudioName(s.audioName ?? null);
            if (s.workerId) rememberWorker(s.workerId);
          };
          return (
            <StudioSplit
              left={
                <div className="space-y-4">
                  {data.generation !== 'READY' && data.blockReason ? <Notice tone="warn">{data.blockReason}</Notice> : null}
                  <div className="studio-pair">
                  <ProjectPick value={form.projectId} onChange={(projectId) => set({ projectId })} quiet />
                  <Field label="Run on">
                    <div className="flex items-center gap-2">
                      <GpuDot status={queue} />
                      <Select
                        className="min-w-0 flex-1"
                        aria-label="PC"
                        value={form.workerId ?? ''}
                        onChange={(e) => {
                          const id = e.target.value || null;
                          rememberWorker(id);
                          set({ workerId: id });
                        }}
                      >
                        <option value="">Choose a PC</option>
                        {workers.map((worker) => {
                          const state = queues[worker.id] ?? worker.queue;
                          return (
                            <option key={worker.id} value={worker.id}>
                              {gpuTitle(worker)}
                              {state === 'busy' ? ' — busy' : state === 'offline' ? ' — offline' : ''}
                            </option>
                          );
                        })}
                      </Select>
                    </div>
                  </Field>
                  </div>
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h2 className="text-sm font-semibold">01 Source assets</h2>
                      <button type="button" className="text-xs font-semibold text-accent" onClick={() => setPicking('image')}>
                        Browse library
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <SourceCard
                        title={imageName || 'No image'}
                        detail="Starting frame · Image"
                        action="Change image"
                        fileId={form.imageFileId}
                        image={form.imageFileId ? null : imageSrc}
                        onAction={() => setPicking(picking === 'image' ? null : 'image')}
                      />
                      <SourceCard
                        title={audioName || 'No audio'}
                        detail={
                          form.audioFileId || form.audioUploadName
                            ? `${clockShort(form.audioStartSec)}–${clockShort(form.audioStartSec + form.durationSec)}`
                            : 'Audio'
                        }
                        action="Change audio"
                        playing={playing}
                        onPlay={form.audioFileId || form.audioUploadName ? toggleClip : undefined}
                        onAction={() => setPicking(picking === 'audio' ? null : 'audio')}
                      />
                    </div>
                    {form.audioFileId || form.audioUploadName ? (
                      <div className="mt-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Start (seconds)">
                            <LooseNumber value={form.audioStartSec} onValue={(audioStartSec) => setTrim(audioStartSec, form.durationSec)} />
                          </Field>
                          <Field label="Use (seconds)">
                            <LooseNumber value={form.durationSec} onValue={(durationSec) => setTrim(form.audioStartSec, durationSec)} />
                          </Field>
                        </div>
                        {audioSeconds != null && audioSeconds > 0 ? (
                          <TrimBar total={audioSeconds} start={form.audioStartSec} length={form.durationSec} onChange={setTrim} />
                        ) : (
                          <p className="mt-1 text-xs text-muted">The length appears once the audio has loaded.</p>
                        )}
                        {clipNote ? <p className="mt-1 text-xs text-muted">{clipNote}</p> : null}
                      </div>
                    ) : null}
                    {picking ? (
                      <div className="mt-2">
                        <FilePick
                          kind={picking === 'image' ? 'IMAGE' : 'AUDIO'}
                          label={picking === 'image' ? 'Image' : 'Audio'}
                          quiet
                          selected={picking === 'image' ? imageName : audioName}
                          uploaded={picking === 'image' ? !!form.imageUploadName : !!form.audioUploadName}
                          busy={busy === `upload-${picking}`}
                          onSelect={(file) => {
                            if (picking === 'image') {
                              set({ imageFileId: file.id, imageUploadName: null, imageUploadWorkerId: null });
                              setImageName(file.fileName);
                            } else {
                              set({ audioFileId: file.id, audioUploadName: null, audioUploadWorkerId: null });
                              setAudioName(file.fileName);
                              const ms = file.tech?.durationMs;
                              setAudioSeconds(typeof ms === 'number' ? ms / 1000 : null);
                            }
                            setPicking(null);
                          }}
                          onUpload={(file) => void uploadToPc(picking, file)}
                        />
                      </div>
                    ) : null}
                  </section>
                  <section>
                    <h2 className="mb-2 text-sm font-semibold">02 Motion & performance</h2>
                    <Textarea rows={5} value={form.prompt} aria-label="Prompt" onChange={(e) => set({ prompt: e.target.value })} />
                    <p className="mt-1 text-xs text-muted">Describe motion and camera action.</p>
                  </section>
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h2 className="text-sm font-semibold">03 Output</h2>
                      <button type="button" className="text-xs font-semibold text-accent" onClick={() => setAdvanced(true)}>
                        Edit settings
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold" onClick={() => setAdvanced(true)}>
                        {frameLabel(form.width, form.height)}
                      </button>
                      <button type="button" className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold" onClick={() => setAdvanced(true)}>
                        {form.durationSec} sec
                      </button>
                      <button type="button" className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold" onClick={() => setAdvanced(true)}>
                        {form.fps} FPS
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold"
                        onClick={() => set({ wantUpscale: !form.wantUpscale })}
                      >
                        {form.wantUpscale ? 'Upscale On' : 'Upscale Off'}
                      </button>
                    </div>
                  </section>
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h2 className="text-sm font-semibold">Identity & model</h2>
                      <button type="button" className="text-xs font-semibold text-accent" onClick={() => setManageLora((open) => !open)}>
                        Manage
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-panel2 px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{prettyName(form.loraName) || 'LoRA'} · LoRA</div>
                        <div className="truncate text-xs text-muted">
                          {form.loraName || 'No file'} · Strength {form.loraStrength}
                          {machine ? ` · ${gpuTitle(machine)}` : ''}
                        </div>
                      </div>
                      <Badge tone="ok">Active</Badge>
                    </div>
                    {manageLora ? (
                      <div className="mt-2">
                        <Input list="ltx-loras" aria-label="LoRA file" value={form.loraName} onChange={(e) => set({ loraName: e.target.value })} />
                        <datalist id="ltx-loras">
                          {loras.map((name) => (
                            <option key={name} value={name} />
                          ))}
                        </datalist>
                      </div>
                    ) : null}
                  </section>
                  <section className="rounded-xl border border-border">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold"
                      aria-expanded={advanced}
                      onClick={() => setAdvanced((open) => !open)}
                    >
                      Advanced settings
                      <span className="text-muted">{advanced ? '▴' : '▾'}</span>
                    </button>
                    {advanced ? (
                      <div className="space-y-3 border-t border-border px-3 py-3">
                        <SizePick
                          label="Frame size"
                          rows={FRAME_SIZES}
                          width={form.width}
                          height={form.height}
                          onPick={(width, height) => set({ width, height })}
                        />
                        {form.wantUpscale ? <UpscaleChoices form={form} set={set} /> : null}
                        {form.wantUpscale && form.upscaleResizeType === 'target dimensions' ? (
                          <SizePick
                            label="Upscale size"
                            rows={UPSCALE_SIZES}
                            width={form.upscaleWidth}
                            height={form.upscaleHeight}
                            onPick={(upscaleWidth, upscaleHeight) => set({ upscaleWidth, upscaleHeight })}
                          />
                        ) : null}
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Frame rate">
                            <LooseNumber value={form.fps} onValue={(fps) => set({ fps })} />
                          </Field>
                          <Field label="LoRA strength">
                            <LooseNumber value={form.loraStrength} onValue={(loraStrength) => set({ loraStrength })} />
                          </Field>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={form.wantUpscale} onChange={(e) => set({ wantUpscale: e.target.checked })} />
                          Enable upscale after rendering
                        </label>
                        <Field label="Negative prompt">
                          <Textarea rows={3} value={form.negativePrompt} onChange={(e) => set({ negativePrompt: e.target.value })} />
                        </Field>
                        <Field label="Audio start (seconds)">
                          <LooseNumber value={form.audioStartSec} onValue={(audioStartSec) => setTrim(audioStartSec, form.durationSec)} />
                        </Field>
                      </div>
                    ) : null}
                  </section>
                  {audioSrc ? (
                    <audio
                      ref={audioRef}
                      className="sr-only"
                      src={audioSrc}
                      preload="auto"
                      onLoadedMetadata={(e) => {
                        const el = e.currentTarget;
                        if (Number.isFinite(el.duration)) setAudioSeconds(el.duration);
                        const { start } = boundsRef.current;
                        if (el.paused && start < el.duration) {
                          try {
                            el.currentTime = start;
                          } catch {
                            /* seek when the browser allows it */
                          }
                        }
                      }}
                      onPlay={() => {
                        if (!clipOn.current) {
                          clipOn.current = true;
                          holding.current = true;
                          if (clipTimer.current == null) clipTimer.current = window.setInterval(enforceClip, 100);
                        }
                        setPlaying(true);
                      }}
                      onPause={() => {
                        if (holding.current) return;
                        clipOn.current = false;
                        if (clipTimer.current != null) {
                          window.clearInterval(clipTimer.current);
                          clipTimer.current = null;
                        }
                        setPlaying(false);
                      }}
                      onEnded={() => stopClip()}
                      onTimeUpdate={() => enforceClip()}
                    />
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                    <span className="inline-flex items-center gap-2 text-xs text-muted">
                      <GpuDot status={queue} />
                      {machine ? gpuTitle(machine) : 'No PC'} · {queueLabel}
                    </span>
                    <div className="flex gap-2">
                      <Button busy={busy === 'draft'} onClick={() => run('draft')}>
                        Save
                      </Button>
                      <Button variant="primary" busy={busy === 'generate'} onClick={() => run('generate')}>
                        Generate
                      </Button>
                    </div>
                  </div>
                  {result ? <ResultLines result={result} /> : null}
                </div>
              }
              right={
                <StudioResult
                  stageRef={stageRef}
                  kind="video"
                  tag="LTX"
                  ratio={frameLabel(form.width, form.height)}
                  job={shown}
                  other={other}
                  fallback={imageSrc}
                  onHistory={onHistory}
                  onPick={(id) => setPreviewId(id)}
                  onReuse={() => shown && applyJob(shown)}
                />
              }
            />
          );
        }
        return (
          <div className="space-y-4">
          <div className={uxV5() ? 'studio-col space-y-4' : 'space-y-4'}>
            {data.generation === 'READY' ? (
              <Notice tone="info" dismissible={false} title="Generate runs on the PC you pick">
                The video is written into that PC’s ComfyUI output folder. Validate only checks this form. Check only asks what that PC has installed.
              </Notice>
            ) : (
              <Notice tone="warn" dismissible={false} title="Generation is not started">
                {data.blockReason}
              </Notice>
            )}

            <Card>
              <CardTitle>LTX clip</CardTitle>
              <p className="mb-3 text-sm text-muted">
                Workflow: {preset.width}×{preset.height}, {preset.fps} fps, {preset.durationSec}s from {preset.audioStartSec}s, LoRA {preset.loraName} at {preset.loraStrength}. Upscale {preset.upscale.width}×{preset.upscale.height} {preset.upscale.quality}.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <ProjectPick value={form.projectId} onChange={(projectId) => set({ projectId })} />
                <Field
                  label="Run on"
                  hint="Green is free. Red is rendering. Choosing a PC checks it again."
                >
                  <div className="flex items-center gap-2">
                    <GpuDot status={form.workerId ? (queues[form.workerId] ?? workers.find((w) => w.id === form.workerId)?.queue) : undefined} />
                    <Select
                      className="min-w-0 flex-1"
                      value={form.workerId ?? ''}
                      onChange={(e) => {
                        const id = e.target.value || null;
                        rememberWorker(id);
                        set({ workerId: id });
                      }}
                    >
                      <option value="">Choose a PC</option>
                      {workers.map((w) => {
                        const queue = queues[w.id] ?? w.queue;
                        return (
                          <option key={w.id} value={w.id}>
                            {gpuTitle(w)}
                            {queue === 'busy' ? ' — busy' : queue === 'offline' ? ' — offline' : ''}
                          </option>
                        );
                      })}
                    </Select>
                  </div>
                </Field>
                <FilePick
                  kind="IMAGE"
                  label="Starting image"
                  selected={imageName}
                  uploaded={!!form.imageUploadName}
                  busy={busy === 'upload-image'}
                  onSelect={(file) => {
                    set({ imageFileId: file.id, imageUploadName: null, imageUploadWorkerId: null });
                    setImageName(file.fileName);
                  }}
                  onUpload={(file) => uploadToPc('image', file)}
                />
                <FilePick
                  kind="AUDIO"
                  label="Song"
                  selected={audioName}
                  uploaded={!!form.audioUploadName}
                  busy={busy === 'upload-audio'}
                  onSelect={(file) => {
                    set({ audioFileId: file.id, audioUploadName: null, audioUploadWorkerId: null });
                    setAudioName(file.fileName);
                    const ms = file.tech?.durationMs;
                    setAudioSeconds(typeof ms === 'number' ? ms / 1000 : null);
                  }}
                  onUpload={(file) => uploadToPc('audio', file)}
                />
                <Field label="Start (seconds)" hint={audioSeconds != null ? `Song length ${audioSeconds.toFixed(1)}s` : 'Length appears after the file has been probed.'}>
                  <LooseNumber value={form.audioStartSec} onValue={(audioStartSec) => set({ audioStartSec })} />
                </Field>
                <Field label="Duration (seconds)" hint={`The workflow file uses ${preset.durationSec} seconds.`}>
                  <LooseNumber value={form.durationSec} onValue={(durationSec) => set({ durationSec })} />
                </Field>
                <div className="md:col-span-2">
                  <SizeChart
                    title="Resolution chart"
                    note="Both values must divide by 32."
                    rows={FRAME_SIZES}
                    onPick={(width, height) => set({ width, height })}
                  />
                </div>
                <Field label="Width">
                  <LooseNumber value={form.width} onValue={(width) => set({ width })} />
                </Field>
                <Field label="Height">
                  <LooseNumber value={form.height} onValue={(height) => set({ height })} />
                </Field>
                <Field label="Frame rate">
                  <LooseNumber value={form.fps} onValue={(fps) => set({ fps })} />
                </Field>
                <Field label="LoRA file" hint={loras.length ? 'These are the LoRA files on the PC you picked.' : 'Type the file name, or pick a PC to load its list.'}>
                  <Input list="ltx-loras" value={form.loraName} onChange={(e) => set({ loraName: e.target.value })} />
                  <datalist id="ltx-loras">
                    {loras.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </Field>
                <Field label="LoRA strength" hint={`The workflow file uses ${preset.loraStrength}.`}>
                  <LooseNumber value={form.loraStrength} onValue={(loraStrength) => set({ loraStrength })} />
                </Field>
              </div>
              {form.imageFileId ? (
                // The preview is a cached thumbnail. A missing one just hides.
                <img
                  alt=""
                  src={`/api/v1/files/${form.imageFileId}/preview`}
                  className="mt-3 max-h-48 rounded-lg"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : null}
              {audioSrc && form ? (
                <div className="mt-3">
                  <audio
                    ref={audioRef}
                    className="w-full"
                    controls
                    src={audioSrc}
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      const el = e.currentTarget;
                      if (Number.isFinite(el.duration)) setAudioSeconds(el.duration);
                      const { start, end } = boundsRef.current;
                      if (Number.isFinite(el.duration) && start >= el.duration) {
                        setClipNote(`This file is ${el.duration.toFixed(1)}s, so it cannot start at ${start}s.`);
                        return;
                      }
                      try {
                        el.currentTime = start;
                      } catch {
                        /* seek when the browser allows it */
                      }
                      setClipNote(`Playing from ${start}s for ${Math.round((end - start) * 10) / 10}s.`);
                    }}
                    onTimeUpdate={() => enforceClip()}
                    onPlay={() => {
                      if (!clipOn.current) {
                        clipOn.current = true;
                        holding.current = true;
                        if (clipTimer.current == null) clipTimer.current = window.setInterval(enforceClip, 100);
                      }
                      setPlaying(true);
                    }}
                    onPause={() => {
                      if (holding.current) return;
                      clipOn.current = false;
                      if (clipTimer.current != null) {
                        window.clearInterval(clipTimer.current);
                        clipTimer.current = null;
                      }
                      setPlaying(false);
                    }}
                    onEnded={() => stopClip()}
                  />
                  {clipNote ? <p className="mt-1 text-xs text-muted">{clipNote}</p> : null}
                </div>
              ) : null}
              <Field label="Prompt" className="mt-3">
                <div className="relative">
                  <button
                    type="button"
                    className="absolute right-2 top-2 z-10 rounded px-1 text-sm text-muted hover:text-text"
                    aria-label="Clear prompt"
                    title="Clear prompt"
                    onClick={() => set({ prompt: '' })}
                  >
                    ×
                  </button>
                  <Textarea className="pr-8" rows={6} value={form.prompt} onChange={(e) => set({ prompt: e.target.value })} />
                </div>
              </Field>
              <Field label="Negative prompt" className="mt-3">
                <Textarea rows={4} value={form.negativePrompt} onChange={(e) => set({ negativePrompt: e.target.value })} />
              </Field>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.wantUpscale} onChange={(e) => set({ wantUpscale: e.target.checked })} />
                Keep the upscale
              </label>
              {form.wantUpscale ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <UpscaleChoices form={form} set={set} />
                  </div>
                  {form.upscaleResizeType === 'target dimensions' ? (
                    <>
                      <div className="md:col-span-2">
                        <SizeChart title="Upscale resolution" rows={UPSCALE_SIZES} onPick={(upscaleWidth, upscaleHeight) => set({ upscaleWidth, upscaleHeight })} />
                      </div>
                      <Field label="Upscale width">
                        <LooseNumber value={form.upscaleWidth} onValue={(upscaleWidth) => set({ upscaleWidth })} />
                      </Field>
                      <Field label="Upscale height">
                        <LooseNumber value={form.upscaleHeight} onValue={(upscaleHeight) => set({ upscaleHeight })} />
                      </Field>
                    </>
                  ) : null}
                </div>
              ) : null}
              {!uxV5() && <LastOnMachine jobs={data.jobs.filter((job) => inWorkspace(job, scope))} workerId={form.workerId} kind="video" />}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button busy={busy === 'draft'} onClick={() => run('draft')}>
                  Save draft
                </Button>
                <Button busy={busy === 'validate'} onClick={() => run('validate')}>
                  Validate
                </Button>
                <Button variant="primary" busy={busy === 'generate'} onClick={() => run('generate')}>
                  Generate
                </Button>
              </div>
              {result ? (
                <div className="mt-3 space-y-1 text-sm">
                  {result.prompted ? <p>Sent to the PC. This page updates when the video is ready.</p> : null}
                  {result.loaded ? <p>Loaded from history. Change anything, then press Generate. Nothing was sent.</p> : null}
                  {result.ok && !result.prompted && !result.blockReason && !result.loaded ? <p>Saved. Nothing was sent to a GPU.</p> : null}
                  {result.ok && result.blockReason ? <p>The form checks passed. {result.blockReason}</p> : null}
                  {!result.ok && result.blockReason ? <p>{result.blockReason}</p> : null}
                  {result.errors?.map((e) => (
                    <p key={e.field + e.message} className="text-bad">
                      {e.message}
                    </p>
                  ))}
                  {result.warnings?.map((e) => (
                    <p key={e.field + e.message} className="text-muted">
                      {e.message}
                    </p>
                  ))}
                </div>
              ) : null}
            </Card>
            <p className="text-sm text-muted">Progress and finished videos are on the History tab.</p>
          </div>
          {uxV5() && (
            <div className="studio-preview">
              <div className="flex items-center justify-between text-[13px] font-bold">
                <span>Generation preview</span>
                <span className="text-[11px] font-semibold text-[#9fb1a7]">Project output</span>
              </div>
              <div className="studio-screen">
                {form.imageFileId ? (
                  <img alt="" src={`/api/v1/files/${form.imageFileId}/preview`} />
                ) : (
                  <span className="px-6 text-center text-xs text-[#9fb1a7]">The starting image and the last finished video show here.</span>
                )}
              </div>
              <LastOnMachine jobs={data.jobs.filter((job) => inWorkspace(job, scope))} workerId={form.workerId} kind="video" />
              <div className="flex flex-wrap gap-2">
                <Link href="/library" className="rounded-lg border border-[#40565a] px-2 py-1 text-[11px] font-bold">Open in Library</Link>
                <Link href="/publishing" className="rounded-lg border border-[#40565a] px-2 py-1 text-[11px] font-bold">Prepare publishing</Link>
              </div>
            </div>
          )}
          <div className={uxV5() ? 'studio-col' : undefined}>
            <WorkerRail workers={workers} selectedId={form.workerId} queues={queues} />
          </div>
          </div>
        );
      }}
    </Async>
  );
}

function Still({
  fileId,
  src,
  className,
}: {
  fileId?: string | null;
  src?: string | null;
  className?: string;
}) {
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [fileId, src]);
  const url =
    step === 0
      ? src || (fileId ? `/api/v1/files/${fileId}/preview` : null)
      : step === 1 && fileId
        ? `/api/v1/files/${fileId}/stream`
        : null;
  if (!url) return null;
  return <img alt="" src={url} className={className} onError={() => setStep((n) => n + 1)} />;
}

function clockShort(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function TrimBar({
  total,
  start,
  length,
  onChange,
}: {
  total: number;
  start: number;
  length: number;
  onChange: (start: number, length: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const end = Math.min(total, start + length);
  function at(clientX: number) {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.min(total, Math.max(0, ((clientX - rect.left) / rect.width) * total));
  }
  function drag(edge: 'start' | 'end', event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const move = (ev: PointerEvent) => {
      const point = at(ev.clientX);
      if (edge === 'start') {
        const next = Math.min(point, end - 0.2);
        onChange(Math.round(next * 10) / 10, Math.round((end - next) * 10) / 10);
      } else {
        const next = Math.max(point, start + 0.2);
        onChange(start, Math.round((next - start) * 10) / 10);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  const left = (start / total) * 100;
  const width = (Math.max(0.2, end - start) / total) * 100;
  return (
    <div ref={bar} className="relative mt-2 h-8 rounded-lg bg-panel2">
      <div className="absolute inset-y-1 rounded bg-accent/35" style={{ left: `${left}%`, width: `${width}%` }} />
      <button
        type="button"
        aria-label="Trim start"
        className="absolute top-1 h-6 w-3 -translate-x-1/2 cursor-ew-resize rounded bg-accent"
        style={{ left: `${left}%` }}
        onPointerDown={(event) => drag('start', event)}
      />
      <button
        type="button"
        aria-label="Trim end"
        className="absolute top-1 h-6 w-3 -translate-x-1/2 cursor-ew-resize rounded bg-accent"
        style={{ left: `${left + width}%` }}
        onPointerDown={(event) => drag('end', event)}
      />
    </div>
  );
}

function SourceCard({
  title,
  detail,
  action,
  fileId,
  image,
  onAction,
  onPlay,
  playing,
}: {
  title: string;
  detail: string;
  action: string;
  fileId?: string | null;
  image?: string | null;
  onAction: () => void;
  onPlay?: () => void;
  playing?: boolean;
}) {
  return (
    <div className="flex min-w-0 gap-2 rounded-xl border border-border p-2">
      <div className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-panel2 text-lg">
        {fileId || image ? (
          <Still fileId={fileId} src={image} className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden>{onPlay ? '♪' : '▣'}</span>
        )}
        {onPlay ? (
          <button
            type="button"
            aria-label={playing ? 'Pause audio' : 'Play the selected part'}
            className="absolute inset-0 grid place-items-center"
            onClick={onPlay}
          >
            <span className="grid size-7 place-items-center rounded-full bg-black/60 text-[11px] text-white">{playing ? '❚❚' : '▶'}</span>
          </button>
        ) : null}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold" title={title}>
          {title}
        </div>
        <div className="truncate text-[11px] text-muted">{detail}</div>
        <button type="button" className="mt-1 text-xs font-semibold text-accent" onClick={onAction}>
          {action}
        </button>
      </div>
    </div>
  );
}

function ResultLines({ result }: { result: CheckResult }) {
  return (
    <div className="space-y-1 text-sm">
      {result.prompted ? <p>Sent to the PC. This page updates when the video is ready.</p> : null}
      {result.loaded ? <p>Loaded from history. Change anything, then press Generate.</p> : null}
      {result.ok && !result.prompted && !result.blockReason && !result.loaded ? <p>Saved.</p> : null}
      {result.blockReason ? <p>{result.blockReason}</p> : null}
      {result.errors?.map((item) => (
        <p key={item.field + item.message} className="text-bad">
          {item.message}
        </p>
      ))}
      {result.warnings?.map((item) => (
        <p key={item.field + item.message} className="text-muted">
          {item.message}
        </p>
      ))}
    </div>
  );
}

function StudioResult({
  stageRef,
  kind,
  tag,
  ratio,
  job,
  other,
  fallback,
  onHistory,
  onPick,
  onReuse,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  kind: 'video' | 'audio';
  tag: string;
  ratio: string;
  job: Studio['jobs'][number] | null;
  other: Studio['jobs'][number] | null;
  fallback?: string | null;
  onHistory: () => void;
  onPick: (id: string) => void;
  onReuse?: () => void;
}) {
  const fileId = job?.files?.find((file) => file.fileId)?.fileId ?? null;
  const [trim, setTrim] = useState(false);
  const ready = job?.status === 'SUCCEEDED';
  const shape = kind === 'video' ? phoneShape(ratio) : null;
  const picture = (
    <>
      {ready && kind === 'video' ? (
        <video className="studio-picture" controls playsInline preload="metadata" src={`/api/v1/comfy/jobs/${job.id}/video`} />
      ) : ready && kind === 'audio' && voiceSrc(job) ? (
        <audio className="w-full" controls preload="none" src={voiceSrc(job) ?? undefined} />
      ) : ready && kind === 'audio' ? (
        <p className="grid min-h-24 place-items-center text-center text-xs text-muted">This voice was only a preview on the PC and is no longer there. Generate it again.</p>
      ) : fallback || job?.settings.imageFileId ? (
        <Still fileId={job?.settings.imageFileId ?? null} src={fallback} className="studio-picture" />
      ) : (
        <p className="grid min-h-40 place-items-center text-center text-xs text-muted">The last result for this tab shows here.</p>
      )}
    </>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Preview & iterations</h2>
        <div className="flex gap-2">
          <button type="button" className="rounded-lg border border-border px-2 py-1 text-[11px] font-semibold" onClick={() => stageRef.current?.requestFullscreen?.()}>
            Fullscreen
          </button>
          <button type="button" className="rounded-lg border border-border px-2 py-1 text-[11px] font-semibold" onClick={onHistory}>
            Jobs
          </button>
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-panel2 p-3">
        <div className="mb-2 flex items-center justify-between text-[10px] font-semibold tracking-wide text-muted">
          <span>LATEST RESULT · {tag}</span>
          <span>Fit to canvas · {ratio}</span>
        </div>
        <div ref={stageRef} className="studio-stage relative w-full">
          <button
            type="button"
            className="studio-stage-close"
            aria-label="Close fullscreen"
            onClick={() => {
              const doc = document as Document & { webkitExitFullscreen?: () => void };
              if (document.fullscreenElement) void document.exitFullscreen();
              else doc.webkitExitFullscreen?.();
            }}
          >
            <span aria-hidden>×</span>
          </button>
          {shape && (ready || fallback || job?.settings.imageFileId) ? (
            <div className={shape === 'tall' ? 'studio-phone' : `studio-phone is-${shape}`}>
              <span className="studio-island" aria-hidden />
              {picture}
            </div>
          ) : (
            picture
          )}
          {job && job.status !== 'SUCCEEDED' ? (
            <p className="mt-2 text-xs text-muted">
              {jobLabel(job.status, job.settings.progress)}
              {job.settings.progress?.phase ? '' : job.settings.progress?.detail ? ` · ${job.settings.progress.detail}` : ''}
              {job.error ? ` · ${job.error}` : ''}
            </p>
          ) : null}
        </div>
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold">Recent in this tab</div>
        {job ? (
          <div className="grid grid-cols-2 gap-2">
            {[job, other].filter(Boolean).map((item) => (
              <button
                key={item!.id}
                type="button"
                className={clsxCard(item!.id === job.id)}
                onClick={() => onPick(item!.id)}
              >
                <div className="truncate text-xs font-semibold">{item!.projectTitle || item!.settings.projectTitle || tag}</div>
                <div className="text-[11px] text-muted">
                  {ago(item!.createdAt)} · {jobLabel(item!.status, item!.settings.progress)}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">Nothing generated on this tab yet.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={fileId ? `/library?file=${fileId}` : '/library'} className="cursor-pointer rounded-lg border border-border px-2 py-1 text-[11px] font-semibold">
          Open in Library
        </Link>
        <Link href="/publishing" className="cursor-pointer rounded-lg border border-border px-2 py-1 text-[11px] font-semibold">
          Prepare publishing
        </Link>
        {fileId && kind === 'video' ? (
          <button type="button" className="cursor-pointer rounded-lg border border-border px-2 py-1 text-[11px] font-semibold" onClick={() => setTrim(true)}>
            Edit video
          </button>
        ) : null}
        {onReuse ? (
          <button type="button" className="cursor-pointer rounded-lg border border-border px-2 py-1 text-[11px] font-semibold" disabled={!job} onClick={onReuse}>
            Reuse settings
          </button>
        ) : null}
        <button type="button" className="cursor-pointer rounded-lg border border-border px-2 py-1 text-[11px] font-semibold disabled:cursor-not-allowed" disabled={!other} onClick={() => other && onPick(other.id)}>
          Compare
        </button>
      </div>
      {trim && fileId ? <VideoTrim fileId={fileId} projectId={job?.projectId ?? null} onClose={() => setTrim(false)} /> : null}
    </div>
  );
}

function clsxCard(on: boolean) {
  return `cursor-pointer rounded-xl border px-2 py-2 text-left ${on ? 'border-accent' : 'border-border'}`;
}

function UpscaleChoices({ form, set }: { form: Form; set: (patch: Partial<Form>) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Resize">
        <Select
          aria-label="Resize"
          value={form.upscaleResizeType}
          onChange={(e) => set({ upscaleResizeType: e.target.value as LtxResizeType })}
        >
          <option value="target dimensions">Target dimensions</option>
          <option value="scale by multiplier">Scale by multiplier</option>
        </Select>
      </Field>
      <Field label="Quality">
        <Select aria-label="Quality" value={form.upscaleQuality} onChange={(e) => set({ upscaleQuality: e.target.value as LtxUpscaleQuality })}>
          {LTX_UPSCALE_QUALITIES.map((quality) => (
            <option key={quality} value={quality}>
              {quality}
            </option>
          ))}
        </Select>
      </Field>
      {form.upscaleResizeType === 'scale by multiplier' ? (
        <Field label="Scale" hint="2 doubles the width and the height. 4 is the maximum.">
          <LooseNumber value={form.upscaleScale} onValue={(upscaleScale) => set({ upscaleScale })} />
        </Field>
      ) : null}
    </div>
  );
}

function SizePick({
  label,
  rows,
  width,
  height,
  onPick,
}: {
  label: string;
  rows: [string, number, number][];
  width: number;
  height: number;
  onPick: (width: number, height: number) => void;
}) {
  const match = rows.find(([, w, h]) => w === width && h === height);
  const [choice, setChoice] = useState<string | null>(null);
  const value = choice ?? (match ? match[0] : 'custom');
  return (
    <div className="space-y-2">
      <Field label={label}>
        <Select
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            setChoice(next);
            const row = rows.find((item) => item[0] === next);
            if (row) onPick(row[1], row[2]);
          }}
        >
          {rows.map(([name, w, h]) => (
            <option key={name} value={name}>
              {name} · {w}×{h}
            </option>
          ))}
          <option value="custom">Custom</option>
        </Select>
      </Field>
      {value === 'custom' ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Width">
            <LooseNumber
              value={width}
              onValue={(next) => {
                setChoice('custom');
                onPick(next, height);
              }}
            />
          </Field>
          <Field label="Height">
            <LooseNumber
              value={height}
              onValue={(next) => {
                setChoice('custom');
                onPick(width, next);
              }}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

function SizeChart({
  title,
  note,
  rows,
  onPick,
}: {
  title: string;
  note?: string;
  rows: [string, number, number][];
  onPick: (width: number, height: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" className="text-sm text-accent underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {title}
      </button>
      {open ? (
        <div className="mt-2 rounded-lg border border-border bg-panel2 p-3 text-sm">
          <table className="w-full text-left">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 font-medium">Format</th>
                <th className="py-1 font-medium">Width</th>
                <th className="py-1 font-medium">Height</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, width, height]) => (
                <tr key={label}>
                  <td className="py-1">
                    <button type="button" className="text-left hover:underline" onClick={() => onPick(width, height)}>
                      {label}
                    </button>
                  </td>
                  <td className="py-1">{width}</td>
                  <td className="py-1">{height}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {note ? <p className="mt-2 text-xs text-muted">{note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function LibraryFileOnPage({ id, onClose }: { id: string; onClose: () => void }) {
  const res = useApi<{
    fileName: string;
    fileType: string;
    displayPath?: string;
    effectiveAvailability?: string;
    copyPaths?: { local?: string | null };
  }>(`/files/${id}`);
  const file = res.data;
  return (
    <Dialog open onClose={onClose} title={file?.fileName ?? 'Library file'} wide>
      <Async res={res}>
        {(row) => (
          <div className="space-y-3 text-sm">
            {row.fileType === 'VIDEO' ? (
              <VideoThumb fileId={id} className="max-h-80 w-full" />
            ) : null}
            {row.fileType === 'AUDIO' ? <audio className="w-full" controls src={`/api/v1/files/${id}/stream`} /> : null}
            {row.fileType === 'IMAGE' ? (
              <SizedFrame fileId={id} kind="IMAGE" online={row.effectiveAvailability === 'AVAILABLE'} />
            ) : null}
            <p className="break-all text-xs text-muted">{row.copyPaths?.local || row.displayPath || 'Path is on the PC that holds this file.'}</p>
            {row.effectiveAvailability === 'AVAILABLE' ? (
              <FileDownload href={`/api/v1/files/${id}/stream?download=1`} name={row.fileName} />
            ) : null}
          </div>
        )}
      </Async>
    </Dialog>
  );
}

function FilePick({
  kind,
  label,
  selected,
  uploaded,
  busy,
  quiet = false,
  onSelect,
  onUpload,
}: {
  kind: 'IMAGE' | 'AUDIO';
  label: string;
  selected: string | null;
  uploaded?: boolean;
  busy?: boolean;
  quiet?: boolean;
  onSelect: (file: { id: string; fileName: string; tech?: { durationMs?: number } }) => void;
  onUpload: (file: File) => void;
}) {
  const [q, setQ] = useState('');
  const list = useApi<{ items: { id: string; fileName: string; tech?: { durationMs?: number } }[] }>(q.trim() ? '/library' : null, {
    query: { kind, q, limit: 20 },
  });
  return (
    <Field
      label={label}
      hint={
        quiet
          ? undefined
          : selected
            ? `${uploaded ? 'Uploaded to the PC' : 'From the library'}: ${selected}`
            : 'Search the library, or upload a file onto the PC you picked.'
      }
    >
      <Input value={q} placeholder={kind === 'IMAGE' ? 'Search images' : 'Search audio'} onChange={(e) => setQ(e.target.value)} />
      <label className="mt-2 inline-flex cursor-pointer text-sm text-accent underline">
        {busy ? 'Uploading…' : 'Upload to the PC'}
        <input
          className="sr-only"
          type="file"
          accept={kind === 'IMAGE' ? 'image/png,image/jpeg,image/webp' : 'audio/mpeg,audio/wav,audio/flac,audio/mp4,audio/aac,audio/ogg'}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onUpload(file);
          }}
        />
      </label>
      {list.data && list.data.items.length > 0 ? (
        <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-border">
          {list.data.items.map((file) => (
            <li key={file.id}>
              <button type="button" className="w-full px-2 py-1.5 text-left text-sm hover:bg-panel2" onClick={() => onSelect(file)}>
                {file.fileName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </Field>
  );
}

function ProjectPick({
  value,
  onChange,
  compact = false,
  quiet = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  compact?: boolean;
  quiet?: boolean;
}) {
  const { id: workspaceId } = useWorkspace();
  const projects = useApi<{ id: string; title: string }[]>(workspaceId ? '/projects' : null, { query: { limit: 200, brandId: workspaceId } });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [made, setMade] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listed = Array.isArray(projects.data) ? projects.data : [];
  const rows = [...made.filter((item) => !listed.some((p) => p.id === item.id)), ...listed];
  const known = !value || rows.some((project) => project.id === value);
  useEffect(() => {
    if (!value || !projects.data || known) return;
    onChange(null);
  }, [value, projects.data, known, onChange]);
  const control = (
    <>
      <Select
        aria-label="Project"
        className={compact ? 'max-w-52' : undefined}
        value={creating ? '__new__' : (value ?? '')}
        onChange={(e) => {
          if (e.target.value === '__new__') {
            setCreating(true);
            setError('');
            return;
          }
          setCreating(false);
          onChange(e.target.value || null);
        }}
      >
        <option value="">No project</option>
        <option value="__new__">New project…</option>
        {rows.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </Select>
      {creating ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            className="min-w-0 flex-1"
            value={title}
            placeholder="Project name"
            aria-label="New project name"
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button
            busy={busy}
            onClick={async () => {
              const name = title.trim();
              if (!name) {
                setError('Name the project.');
                return;
              }
              setBusy(true);
              setError('');
              try {
                const created = await post<{ id: string; title: string }>('/projects', { title: name, type: 'OTHER', brandId: workspaceId ?? undefined });
                setMade((items) => [{ id: created.id, title: created.title || name }, ...items]);
                onChange(created.id);
                setCreating(false);
                setTitle('');
                await refresh('/projects');
              } catch (e) {
                setError(e instanceof ApiError ? e.message : 'That project was not created.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Create
          </Button>
        </div>
      ) : null}
      {error ? <p className="mt-1 text-xs text-bad">{error}</p> : null}
    </>
  );
  if (compact) {
    return (
      <label className="flex min-w-0 items-center gap-2 text-sm">
        <span className="text-muted">Project</span>
        {control}
      </label>
    );
  }
  return (
    <Field label="Project" hint={quiet ? undefined : 'Empty leaves Production and Publishing alone. A later clip on the same project joins the publishing row that is already there.'}>
      {control}
    </Field>
  );
}

function LastOnMachine({
  jobs,
  workerId,
  kind,
}: {
  jobs: Studio['jobs'];
  workerId: string | null;
  kind: 'video' | 'audio';
}) {
  const job = jobs.find((j) => (j.settings as { workerId?: string }).workerId === workerId);
  if (!workerId) return null;
  const file = job?.files?.find((f) => f.fileId);
  return (
    <div className="mt-4 rounded-lg border border-border p-3">
      <div className="text-sm font-medium">Last run on this PC</div>
      {!job ? <p className="mt-1 text-sm text-muted">Nothing has been generated on this PC yet.</p> : null}
      {job ? (
        <div className="mt-2 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={job.status === 'SUCCEEDED' ? 'ok' : job.status === 'FAILED' ? 'bad' : job.status === 'RUNNING' && job.settings.progress?.phase !== 'waiting' ? 'info' : 'warn'}>{jobLabel(job.status, job.settings.progress)}</Badge>
            <span className="text-muted">{ago(job.createdAt)}</span>
          </div>
          {job.status === 'QUEUED' || job.status === 'RUNNING' ? (
            <p className="text-muted">{job.settings.progress?.detail ?? 'Working on that PC.'}</p>
          ) : null}
          {job.error ? <p className="text-bad">{job.error}</p> : null}
          {job.status === 'SUCCEEDED' ? (
            kind === 'video' ? (
              <VideoThumb src={`/api/v1/comfy/jobs/${job.id}/video`} className="w-full max-w-sm" />
            ) : voiceSrc(job) ? (
              <audio className="w-full" controls preload="none" src={voiceSrc(job) ?? undefined} />
            ) : (
              <p className="text-xs text-muted">This voice was only a preview on the PC and is no longer there. Generate it again.</p>
            )
          ) : null}
          {file?.fileId ? (
            <a className="text-accent" href={`/library?file=${file.fileId}`}>
              Open {file.fileName ?? 'file'} in the library
            </a>
          ) : job.status === 'SUCCEEDED' ? (
            <p className="text-xs text-muted">Play it here. It shows in the library after that PC’s output folder is scanned.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AudioTab({ onHistory = () => {} }: { onHistory?: () => void }) {
  const scope = useWorkspaceProjectIds();
  const studio = useApi<{
    ready: boolean;
    blockReason: string | null;
    defaults: { referenceText: string; targetText: string; builtinName: string; clips?: { file: string; label: string; referenceText: string }[] };
    workers: Worker[];
    draft: {
      projectId?: string | null;
      workerId: string | null;
      audioFileId: string | null;
      audioUploadName: string | null;
      audioUploadWorkerId: string | null;
      useBuiltin: boolean;
      builtinClip?: string;
      referenceText: string;
      targetText: string;
      audioName?: string | null;
    } | null;
    jobs: Studio['jobs'];
  }>('/comfy/audio');
  const [form, setForm] = useState<{
    projectId: string | null;
    workerId: string | null;
    audioFileId: string | null;
    audioUploadName: string | null;
    audioUploadWorkerId: string | null;
    useBuiltin: boolean;
    builtinClip: string;
    referenceText: string;
    targetText: string;
    audioName: string | null;
  } | null>(null);
  const [queues, setQueues] = usePcQueue((studio.data?.workers ?? []).map((worker) => worker.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!studio.data || form) return;
    const d = studio.data.draft;
    const workers = studio.data.workers ?? [];
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem('cos-qwen-worker');
    } catch {
      remembered = null;
    }
    setForm({
      projectId: d?.projectId ?? null,
      workerId:
        (remembered && workers.some((w) => w.id === remembered) ? remembered : null) ??
        d?.workerId ??
        workers.find((w) => w.role === 'primary')?.id ??
        null,
      audioFileId: d?.audioFileId ?? null,
      audioUploadName: d?.audioUploadName ?? null,
      audioUploadWorkerId: d?.audioUploadWorkerId ?? null,
      useBuiltin: d?.useBuiltin ?? true,
      builtinClip: d?.builtinClip || 'mehakdeepvoice.wav',
      referenceText: d?.referenceText || studio.data.defaults.referenceText,
      targetText: d?.targetText || studio.data.defaults.targetText,
      audioName: d?.audioName ?? d?.audioUploadName ?? null,
    });
  }, [studio.data, form]);

  const running = (studio.data?.jobs ?? []).some((j) => j.status === 'QUEUED' || j.status === 'RUNNING');
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh('/comfy/audio'), 4000);
    return () => clearInterval(timer);
  }, [running]);

  const set = (patch: Partial<NonNullable<typeof form>>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const audioStage = useRef<HTMLDivElement>(null);
  const [audioPreview, setAudioPreview] = useState<string | null>(null);

  async function upload(file: File) {
    if (!form?.workerId) {
      setError('Choose the PC first. The file is saved on that PC.');
      return;
    }
    setBusy('upload');
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/v1/comfy/workers/${form.workerId}/upload?kind=audio`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'creatoros', accept: 'application/json' },
      });
      const json = (await res.json().catch(() => null)) as { data?: { name?: string }; error?: { message?: string } } | null;
      if (!res.ok || !json?.data?.name) throw new Error(json?.error?.message ?? 'That file was not saved on the PC.');
      set({
        useBuiltin: false,
        audioFileId: null,
        audioUploadName: json.data.name,
        audioUploadWorkerId: form.workerId,
        audioName: file.name,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file was not saved on the PC.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Async res={studio}>
      {(data) => {
        if (!form) return <Spinner />;
        const workers = data.workers ?? [];
        const payload = {
          projectId: form.projectId,
          workerId: form.workerId,
          audioFileId: form.useBuiltin ? null : form.audioFileId,
          audioUploadName: form.useBuiltin ? null : form.audioUploadName,
          audioUploadWorkerId: form.useBuiltin ? null : form.audioUploadWorkerId,
          useBuiltin: form.useBuiltin,
          builtinClip: form.builtinClip,
          referenceText: form.referenceText,
          targetText: form.targetText,
        };
        if (uxV5()) {
          const recent = [...data.jobs].filter((job) => inWorkspace(job, scope)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 2);
          const shown = recent.find((job) => job.id === audioPreview) ?? recent[0] ?? null;
          const other = recent.find((job) => job.id !== shown?.id) ?? null;
          return (
            <StudioSplit
              left={
                <div className="space-y-3">
                  {data.blockReason ? <Notice tone="warn">{data.blockReason}</Notice> : null}
                  <ProjectPick value={form.projectId} onChange={(projectId) => set({ projectId })} quiet />
                  <Field label="Run on">
                    <div className="flex items-center gap-2">
                      <GpuDot status={form.workerId ? (queues[form.workerId] ?? workers.find((w) => w.id === form.workerId)?.queue) : undefined} />
                      <Select
                        className="min-w-0 flex-1"
                        aria-label="PC"
                        value={form.workerId ?? ''}
                        onChange={(e) => {
                          const id = e.target.value || null;
                          try {
                            if (id) localStorage.setItem('cos-qwen-worker', id);
                          } catch {
                            /* private mode */
                          }
                          set({ workerId: id });
                        }}
                      >
                        <option value="">Choose a PC</option>
                        {workers.map((worker) => {
                          const state = queues[worker.id] ?? worker.queue;
                          return (
                            <option key={worker.id} value={worker.id}>
                              {gpuTitle(worker)}
                              {state === 'busy' ? ' — busy' : state === 'offline' ? ' — offline' : ''}
                            </option>
                          );
                        })}
                      </Select>
                    </div>
                  </Field>
                  <Field label="Reference audio">
                    <Select
                      value={form.useBuiltin ? form.builtinClip : 'own'}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === 'own') {
                          set({ useBuiltin: false });
                          return;
                        }
                        const clip = (data.defaults.clips ?? []).find((item) => item.file === value);
                        set({ useBuiltin: true, builtinClip: value, referenceText: clip?.referenceText ?? form.referenceText });
                      }}
                    >
                      {(data.defaults.clips ?? [{ file: data.defaults.builtinName, label: data.defaults.builtinName, referenceText: '' }]).map((clip) => (
                        <option key={clip.file} value={clip.file}>
                          {clip.label}
                        </option>
                      ))}
                      <option value="own">A file I choose</option>
                    </Select>
                  </Field>
                  {!form.useBuiltin ? (
                    <FilePick
                      kind="AUDIO"
                      label="Reference clip"
                      quiet
                      selected={form.audioName}
                      uploaded={!!form.audioUploadName}
                      busy={busy === 'upload'}
                      onSelect={(file) =>
                        set({
                          useBuiltin: false,
                          audioFileId: file.id,
                          audioUploadName: null,
                          audioUploadWorkerId: null,
                          audioName: file.fileName,
                        })
                      }
                      onUpload={(file) => void upload(file)}
                    />
                  ) : null}
                  <Field label="Text in that audio">
                    <Textarea rows={4} value={form.referenceText} onChange={(e) => set({ referenceText: e.target.value })} />
                  </Field>
                  <Field label="What to say">
                    <Textarea rows={4} value={form.targetText} onChange={(e) => set({ targetText: e.target.value })} />
                  </Field>
                  <div className="flex justify-end gap-2 border-t border-border pt-3">
                    <Button
                      busy={busy === 'draft'}
                      onClick={async () => {
                        setBusy('draft');
                        setError('');
                        try {
                          await put('/comfy/audio/draft', payload);
                        } catch (e) {
                          setError(e instanceof ApiError ? e.message : 'That did not save.');
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      Save
                    </Button>
                    <Button
                      variant="primary"
                      busy={busy === 'generate'}
                      onClick={async () => {
                        setBusy('generate');
                        setError('');
                        try {
                          await post('/comfy/audio/generate', payload);
                          if (form.workerId) setQueues((q) => ({ ...q, [form.workerId!]: 'busy' }));
                          await refresh('/comfy/audio');
                        } catch (e) {
                          setError(e instanceof ApiError ? e.message : 'The voice was not started.');
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      Generate
                    </Button>
                  </div>
                  {error ? <p className="text-sm text-bad">{error}</p> : null}
                </div>
              }
              right={
                <StudioResult
                  stageRef={audioStage}
                  kind="audio"
                  tag="Audio"
                  ratio="Voice"
                  job={shown}
                  other={other}
                  onHistory={onHistory}
                  onPick={setAudioPreview}
                />
              }
            />
          );
        }
        return (
          <div>
          <Card>
            <CardTitle>Voice</CardTitle>
            <p className="mb-3 text-sm text-muted">
              Qwen3 clones the reference voice, then speaks the line you write. Nothing is sent until Generate.
            </p>
            {data.blockReason ? (
              <div className="mb-3">
                <Notice tone="warn">{data.blockReason}</Notice>
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <ProjectPick value={form.projectId} onChange={(projectId) => set({ projectId })} />
              <Field label="Run on" hint="Green is free. Red is rendering. Choosing a PC checks it again.">
                <div className="flex items-center gap-2">
                  <GpuDot status={form.workerId ? (queues[form.workerId] ?? workers.find((w) => w.id === form.workerId)?.queue) : undefined} />
                  <Select
                    className="min-w-0 flex-1"
                    value={form.workerId ?? ''}
                    onChange={(e) => {
                      const id = e.target.value || null;
                      try {
                        if (id) localStorage.setItem('cos-qwen-worker', id);
                      } catch {
                        /* private mode */
                      }
                      set({ workerId: id });
                    }}
                  >
                    <option value="">Choose a PC</option>
                    {workers.map((w) => (
                      <option key={w.id} value={w.id}>
                        {gpuTitle(w)}
                        {(queues[w.id] ?? w.queue) === 'busy' ? ' — busy' : (queues[w.id] ?? w.queue) === 'offline' ? ' — offline' : ''}
                      </option>
                    ))}
                  </Select>
                </div>
              </Field>
              <Field label="Reference audio">
                <Select
                  value={form.useBuiltin ? form.builtinClip : 'own'}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === 'own') {
                      set({ useBuiltin: false });
                      return;
                    }
                    const clip = (data.defaults.clips ?? []).find((item) => item.file === value);
                    set({ useBuiltin: true, builtinClip: value, referenceText: clip?.referenceText ?? form.referenceText });
                  }}
                >
                  {(data.defaults.clips ?? [{ file: data.defaults.builtinName, label: data.defaults.builtinName, referenceText: '' }]).map((clip) => (
                    <option key={clip.file} value={clip.file}>
                      {clip.label}
                    </option>
                  ))}
                  <option value="own">A file I choose</option>
                </Select>
              </Field>
            </div>
            {!form.useBuiltin ? (
              <div className="mt-3">
                <FilePick
                  kind="AUDIO"
                  label="Your reference clip"
                  selected={form.audioName}
                  uploaded={!!form.audioUploadName}
                  busy={busy === 'upload'}
                  onSelect={(file) =>
                    set({
                      useBuiltin: false,
                      audioFileId: file.id,
                      audioUploadName: null,
                      audioUploadWorkerId: null,
                      audioName: file.fileName,
                    })
                  }
                  onUpload={(file) => void upload(file)}
                />
              </div>
            ) : null}
            <Field label="Text in that audio" className="mt-3">
              <Textarea rows={6} value={form.referenceText} onChange={(e) => set({ referenceText: e.target.value })} />
            </Field>
            <Field label="What to say" className="mt-3">
              <Textarea rows={5} value={form.targetText} onChange={(e) => set({ targetText: e.target.value })} />
            </Field>
            {!uxV5() && <LastOnMachine jobs={data.jobs.filter((job) => inWorkspace(job, scope))} workerId={form.workerId} kind="audio" />}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                busy={busy === 'draft'}
                onClick={async () => {
                  setBusy('draft');
                  setError('');
                  try {
                    await put('/comfy/audio/draft', payload);
                  } catch (e) {
                    setError(e instanceof ApiError ? e.message : 'That did not save.');
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Save draft
              </Button>
              <Button
                variant="primary"
                busy={busy === 'generate'}
                onClick={async () => {
                  setBusy('generate');
                  setError('');
                  try {
                    await post('/comfy/audio/generate', payload);
                    if (form.workerId) setQueues((q) => ({ ...q, [form.workerId!]: 'busy' }));
                    await refresh('/comfy/audio');
                  } catch (e) {
                    setError(e instanceof ApiError ? e.message : 'The voice was not started.');
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Generate
              </Button>
            </div>
            {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
          </Card>
          </div>
        );
      }}
    </Async>
  );
}

type H3Image = {
  key: string;
  fileId: string | null;
  uploadName: string | null;
  uploadWorkerId: string | null;
  name: string | null;
  shared: boolean;
  /** Shown in the tile. Not sent to the PC. */
  preview?: string;
};
type H3Join = 'shot' | 'context' | 'context_swap';
type H3Mode = 'i2v' | 'ref' | 'v2v' | 'l2v';
type H3RefSize = 'max' | 'match';
type H3Clip = {
  key: string;
  continuity: H3Join;
  taskMode: H3Mode;
  refImageSize: H3RefSize;
  prompt: string;
  audioFileId: string | null;
  audioUploadName: string | null;
  audioUploadWorkerId: string | null;
  audioName: string | null;
  audioTrim: boolean;
  audioStartSec: number;
  audioUseSec: number;
  audioSeconds: number | null;
  durationSec: string;
  images: H3Image[];
};

const H3_MODES: { id: H3Mode; label: string }[] = [
  { id: 'i2v', label: 'I2V' },
  { id: 'ref', label: 'R2V' },
  { id: 'v2v', label: 'V2V' },
  { id: 'l2v', label: 'L2V' },
];
const H3_JOINS: { id: H3Join; label: string }[] = [
  { id: 'shot', label: 'Shot' },
  { id: 'context', label: 'Context' },
  { id: 'context_swap', label: 'Swap Context' },
];

function h3ModeLabel(mode: H3Mode) {
  return H3_MODES.find((item) => item.id === mode)?.label ?? mode;
}

function parseTimecode(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  const parts = text.split(':');
  if (parts.length !== 3) return null;
  const [mm, ss, ff] = parts.map((part) => Number(part));
  if (mm == null || ss == null || ff == null || ![mm, ss, ff].every((n) => Number.isFinite(n))) return null;
  return mm * 60 + ss + ff / 24;
}

const H3_MAX_SECONDS = 30;

/** Minutes : seconds : frames at 24 fps. 00:08:00 is 8 seconds. */
function formatTimecode(seconds: number): string {
  const framesTotal = Math.max(0, Math.round(seconds * 24));
  const ff = framesTotal % 24;
  const whole = Math.floor(framesTotal / 24);
  const ss = whole % 60;
  const mm = Math.floor(whole / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

function h3Seconds(clip: H3Clip) {
  return parseTimecode(clip.durationSec) ?? 8;
}

function h3ImageSrc(image: { fileId: string | null; uploadName: string | null; uploadWorkerId: string | null; preview?: string }, workerId: string | null) {
  if (image.preview?.startsWith('blob:')) return image.preview;
  if (image.fileId) return `/api/v1/files/${image.fileId}/preview`;
  const worker = image.uploadWorkerId || workerId;
  if (image.uploadName && worker) return `/api/v1/comfy/workers/${worker}/input?name=${encodeURIComponent(image.uploadName)}`;
  return '';
}

function blankH3Clip(prompt: string, continuity: H3Join): H3Clip {
  return {
    key: crypto.randomUUID(),
    continuity,
    taskMode: 'ref',
    refImageSize: 'max',
    prompt,
    audioFileId: null,
    audioUploadName: null,
    audioUploadWorkerId: null,
    audioName: null,
    audioTrim: false,
    audioStartSec: 0,
    audioUseSec: 0,
    audioSeconds: null,
    durationSec: '00:08:00',
    images: [],
  };
}

function h3AudioFields(clip: H3Clip) {
  return {
    audioFileId: clip.audioFileId,
    audioUploadName: clip.audioUploadName,
    audioUploadWorkerId: clip.audioUploadWorkerId,
    audioName: clip.audioName,
    audioTrim: clip.audioTrim,
    audioStartSec: clip.audioStartSec,
    audioUseSec: clip.audioUseSec,
    audioSeconds: clip.audioSeconds,
  };
}

function h3AudioLabel(clip: H3Clip, locked: boolean) {
  if (!clip.audioName) return 'MiniMax audio';
  const lock = locked ? ' 🔒' : '';
  if (clip.audioTrim && clip.audioUseSec > 0) return `${clockShort(clip.audioStartSec)}–${clockShort(clip.audioStartSec + clip.audioUseSec)}${lock}`;
  return `${clip.audioName}${lock}`;
}

function H3AudioTrim({
  clip,
  workerId,
  segmentSec,
  onChange,
}: {
  clip: H3Clip;
  workerId: string | null;
  segmentSec: number;
  onChange: (patch: Partial<H3Clip>) => void;
}) {
  const src = clip.audioFileId
    ? `/api/v1/files/${clip.audioFileId}/stream`
    : clip.audioUploadName && (clip.audioUploadWorkerId || workerId)
      ? `/api/v1/comfy/workers/${clip.audioUploadWorkerId || workerId}/input?name=${encodeURIComponent(clip.audioUploadName)}`
      : null;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const total = clip.audioSeconds;
  const cap = Math.min(H3_MAX_SECONDS, total != null && total > 0 ? total : H3_MAX_SECONDS);
  function setTrim(start: number, length: number) {
    const file = total != null && total > 0 ? total : start + Math.max(length, cap);
    const nextStart = Math.max(0, Math.min(start, Math.max(0, file - 0.2)));
    const room = Math.min(H3_MAX_SECONDS, Math.max(0.2, file - nextStart));
    const nextLen = Math.round(Math.max(0.2, Math.min(length, room)) * 10) / 10;
    onChange({
      audioStartSec: Math.round(nextStart * 10) / 10,
      audioUseSec: nextLen,
      durationSec: formatTimecode(nextLen),
    });
  }
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={clip.audioTrim}
          onChange={(e) => {
            const on = e.target.checked;
            const use = clip.audioUseSec > 0 ? Math.min(clip.audioUseSec, cap) : Math.min(cap, segmentSec);
            onChange(
              on
                ? {
                    audioTrim: true,
                    audioStartSec: clip.audioStartSec || 0,
                    audioUseSec: use,
                    durationSec: formatTimecode(use),
                  }
                : { audioTrim: false },
            );
          }}
        />
        Trim this audio
      </label>
      <p className="text-xs text-muted">
        {clip.audioTrim
          ? 'The shot length matches this trim. Change the trim or the Length box and the other follows. The rest of the file stays where it is.'
          : 'The whole uploaded file is added to this segment. The shot length stays as you set it.'}
      </p>
      {clip.audioTrim ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start (seconds)">
              <LooseNumber value={clip.audioStartSec} onValue={(audioStartSec) => setTrim(audioStartSec, clip.audioUseSec || cap)} />
            </Field>
            <Field label="Use (seconds)">
              <LooseNumber value={clip.audioUseSec || cap} onValue={(audioUseSec) => setTrim(clip.audioStartSec, audioUseSec)} />
            </Field>
          </div>
          {total != null && total > 0 ? (
            <TrimBar total={total} start={clip.audioStartSec} length={clip.audioUseSec || cap} onChange={setTrim} />
          ) : (
            <p className="text-xs text-muted">The length appears once the audio has loaded.</p>
          )}
          {src ? (
            <button
              type="button"
              className="text-xs font-semibold text-accent"
              onClick={() => {
                const el = audioRef.current;
                if (!el) return;
                if (!el.paused) {
                  el.pause();
                  return;
                }
                const { start } = clipBounds(clip.audioStartSec, clip.audioUseSec || cap);
                try {
                  el.currentTime = start;
                } catch {
                  /* metadata is still loading */
                }
                void el.play().catch(() => setPlaying(false));
              }}
            >
              {playing ? 'Pause the trim' : 'Play the trim'}
            </button>
          ) : null}
          {src ? (
            <audio
              ref={audioRef}
              className="sr-only"
              src={src}
              preload="metadata"
              onLoadedMetadata={(e) => {
                const duration = e.currentTarget.duration;
                if (Number.isFinite(duration)) {
                  const room = Math.min(H3_MAX_SECONDS, Math.max(0.2, duration - clip.audioStartSec));
                  const use = Math.min(clip.audioUseSec > 0 ? clip.audioUseSec : Math.min(H3_MAX_SECONDS, duration), room);
                  onChange({
                    audioSeconds: duration,
                    ...(clip.audioTrim ? { audioUseSec: use, durationSec: formatTimecode(use) } : {}),
                  });
                }
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => {
                const el = e.currentTarget;
                const { start, end } = clipBounds(clip.audioStartSec, clip.audioUseSec || cap);
                const action = clipPlayback(el.currentTime, start, end, el.seekable.length ? el.seekable.end(el.seekable.length - 1) : null);
                if (action === 'restart') {
                  el.pause();
                  el.currentTime = start;
                } else if (action === 'seek') el.currentTime = start;
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function H3Tab({ onHistory = () => {} }: { onHistory?: () => void }) {
  const scope = useWorkspaceProjectIds();
  const studio = useApi<{
    ready: boolean;
    blockReason: string | null;
    defaults: { prompt: string };
    workers: Worker[];
    draft: {
      projectId?: string | null;
      workerId: string | null;
      aspectRatio?: string;
      megapixels?: number;
      audioLocked?: boolean;
      shareAudio?: boolean;
      segments: (Omit<H3Clip, 'key' | 'durationSec' | 'images' | 'audioName'> & {
        durationSec: number | null;
        audioName?: string | null;
        audioTrim?: boolean;
        audioStartSec?: number | null;
        audioUseSec?: number | null;
        images: Omit<H3Image, 'key'>[];
      })[];
    } | null;
    jobs: Studio['jobs'];
  }>('/comfy/h3');
  const [form, setForm] = useState<{
    projectId: string | null;
    workerId: string | null;
    view: 'individual' | 'combined';
    aspectRatio: string;
    megapixels: number;
    audioLocked: boolean;
    shareAudio: boolean;
    clips: H3Clip[];
  } | null>(null);
  const [selected, setSelected] = useState(0);
  const [browser, setBrowser] = useState(false);
  const [photoQ, setPhotoQ] = useState('');
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [queues, setQueues] = usePcQueue((studio.data?.workers ?? []).map((worker) => worker.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const h3Stage = useRef<HTMLDivElement>(null);
  const [h3Preview, setH3Preview] = useState<string | null>(null);
  const photos = useApi<{ items: { id: string; fileName: string }[] }>(browser ? '/library' : null, {
    query: { kind: 'IMAGE', q: photoQ, limit: 40 },
  });

  useEffect(() => {
    const data = studio.data;
    if (!data || form) return;
    const workers = data.workers ?? [];
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem('cos-h3-worker');
    } catch {
      remembered = null;
    }
    const prompt = data.defaults.prompt;
    const clips: H3Clip[] = (data.draft?.segments ?? []).map((segment, index) => ({
      key: crypto.randomUUID(),
      continuity: index === 0 ? ('shot' as const) : segment.continuity,
      taskMode: segment.taskMode,
      refImageSize: segment.refImageSize === 'match' ? 'match' : 'max',
      prompt: segment.prompt || prompt,
      audioFileId: segment.audioFileId,
      audioUploadName: segment.audioUploadName,
      audioUploadWorkerId: segment.audioUploadWorkerId,
      audioName: segment.audioName ?? segment.audioUploadName,
      audioTrim: segment.audioTrim === true,
      audioStartSec: typeof segment.audioStartSec === 'number' ? segment.audioStartSec : 0,
      audioUseSec: typeof segment.audioUseSec === 'number' ? segment.audioUseSec : 0,
      audioSeconds: null,
      durationSec: segment.durationSec != null ? formatTimecode(segment.durationSec) : '00:08:00',
      images: (segment.images ?? []).map((image) => ({
        ...image,
        key: crypto.randomUUID(),
        shared: image.shared === true,
        preview: h3ImageSrc(image, data.draft?.workerId ?? remembered),
      })),
    }));
    setForm({
      projectId: data.draft?.projectId ?? null,
      workerId:
        (remembered && workers.some((w) => w.id === remembered) ? remembered : null) ??
        data.draft?.workerId ??
        workers.find((w) => w.role === 'primary')?.id ??
        null,
      view: 'individual',
      aspectRatio: h3AspectRatio(data.draft?.aspectRatio || '') ?? '9:16 (Portrait Widescreen)',
      megapixels: data.draft?.megapixels || 1,
      audioLocked: data.draft?.audioLocked !== false,
      shareAudio: data.draft?.shareAudio === true,
      clips: clips.length ? clips : [blankH3Clip(prompt, 'shot'), blankH3Clip(prompt, 'context')],
    });
  }, [studio.data, form]);

  const running = (studio.data?.jobs ?? []).some((j) => j.status === 'QUEUED' || j.status === 'RUNNING');
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh('/comfy/h3'), 4000);
    return () => clearInterval(timer);
  }, [running]);

  function updateClip(index: number, patch: Partial<H3Clip>) {
    setForm((current) => {
      if (!current) return current;
      const share = current.view === 'combined';
      const audioChange =
        patch.audioFileId !== undefined ||
        patch.audioUploadName !== undefined ||
        patch.audioName !== undefined ||
        patch.audioTrim !== undefined ||
        patch.audioStartSec !== undefined ||
        patch.audioUseSec !== undefined ||
        patch.audioSeconds !== undefined;
      return {
        ...current,
        clips: current.clips.map((item, i) => {
          if (i === index) return { ...item, ...patch };
          if (current.shareAudio && audioChange) {
            return {
              ...item,
              ...(patch.audioFileId !== undefined ? { audioFileId: patch.audioFileId } : {}),
              ...(patch.audioUploadName !== undefined ? { audioUploadName: patch.audioUploadName } : {}),
              ...(patch.audioUploadWorkerId !== undefined ? { audioUploadWorkerId: patch.audioUploadWorkerId } : {}),
              ...(patch.audioName !== undefined ? { audioName: patch.audioName } : {}),
              ...(patch.audioTrim !== undefined ? { audioTrim: patch.audioTrim } : {}),
              ...(patch.audioStartSec !== undefined ? { audioStartSec: patch.audioStartSec } : {}),
              ...(patch.audioUseSec !== undefined ? { audioUseSec: patch.audioUseSec } : {}),
              ...(patch.audioSeconds !== undefined ? { audioSeconds: patch.audioSeconds } : {}),
              ...(patch.audioUseSec !== undefined && patch.durationSec !== undefined ? { durationSec: patch.durationSec } : {}),
            };
          }
          if (!share) return item;
          return {
            ...item,
            ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
            ...(patch.images ? { images: patch.images } : {}),
            ...(patch.taskMode ? { taskMode: patch.taskMode } : {}),
            ...(patch.refImageSize ? { refImageSize: patch.refImageSize } : {}),
          };
        }),
      };
    });
  }

  async function upload(kind: 'image' | 'audio', file: File, index: number) {
    if (!form?.workerId) {
      setError('Choose the PC first. The file is saved on that PC.');
      return;
    }
    const clip = form.clips[index];
    if (!clip) return;
    setBusy(`${kind}-${clip.key}`);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/v1/comfy/workers/${form.workerId}/upload?kind=${kind}`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'creatoros', accept: 'application/json' },
      });
      const json = (await res.json().catch(() => null)) as { data?: { name?: string }; error?: { message?: string } } | null;
      if (!res.ok || !json?.data?.name) throw new Error(json?.error?.message ?? 'That file was not saved on the PC.');
      if (kind === 'audio') {
        updateClip(index, {
          audioFileId: null,
          audioUploadName: json.data.name,
          audioUploadWorkerId: form.workerId,
          audioName: file.name,
          audioSeconds: null,
        });
      } else if (clip.images.length < 8) {
        updateClip(index, {
          images: [
            ...clip.images,
            {
              key: crypto.randomUUID(),
              fileId: null,
              uploadName: json.data.name,
              uploadWorkerId: form.workerId,
              name: file.name,
              shared: false,
              preview: URL.createObjectURL(file),
            },
          ],
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file was not saved on the PC.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Async res={studio}>
      {(data) => {
        if (!form) return <Spinner />;
        const index = Math.min(selected, form.clips.length - 1);
        const clip = form.clips[index];
        if (!clip) return <Spinner />;
        const workers = data.workers ?? [];
        let cursor = 0;
        const spans = form.clips.map((item) => {
          const start = cursor;
          cursor += h3Seconds(item);
          return start;
        });
        const payload = {
          projectId: form.projectId,
          workerId: form.workerId,
          imageFileId: form.clips[0]?.images[0]?.fileId ?? null,
          imageUploadName: form.clips[0]?.images[0]?.uploadName ?? null,
          imageUploadWorkerId: form.clips[0]?.images[0]?.uploadWorkerId ?? null,
          prompt: form.clips[0]?.prompt ?? '',
          aspectRatio: form.aspectRatio,
          megapixels: form.megapixels,
          audioLocked: form.audioLocked,
          shareAudio: form.shareAudio,
          segments: form.clips.map((item, i) => ({
            continuity: i === 0 ? 'shot' : item.continuity,
            taskMode: item.taskMode,
            refImageSize: item.refImageSize,
            prompt: item.prompt,
            audioFileId: item.audioFileId,
            audioUploadName: item.audioUploadName,
            audioUploadWorkerId: item.audioUploadWorkerId,
            audioTrim: item.audioTrim,
            audioStartSec: item.audioTrim ? item.audioStartSec : null,
            audioUseSec: item.audioTrim ? item.audioUseSec : null,
            durationSec: (() => {
              const seconds = parseTimecode(item.durationSec);
              return seconds != null && seconds > 0 ? seconds : 8;
            })(),
            images: item.images.map((image) => ({
              fileId: image.fileId,
              uploadName: image.uploadName,
              uploadWorkerId: image.uploadWorkerId,
              shared: image.shared,
            })),
          })),
        };
        const recent = [...data.jobs].filter((job) => inWorkspace(job, scope)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 2);
        const shown = recent.find((job) => job.id === h3Preview) ?? recent[0] ?? null;
        const other = recent.find((job) => job.id !== shown?.id) ?? null;
        const formPane = (
          <div>
          {!uxV5() && (
            <>
            <CardTitle>MiniMax H3</CardTitle>
            <p className="mb-3 text-sm text-muted">
              A timeline of segments. The first one is a new shot. Later ones can continue it. Generate sends the whole timeline. Nothing starts until then.
            </p>
            </>
          )}
            {data.blockReason ? (
              <div className="mb-3">
                <Notice tone="warn">{data.blockReason}</Notice>
              </div>
            ) : null}
            <div className={uxV5() ? 'studio-quad mb-3' : 'mb-3 grid gap-3 sm:grid-cols-2'}>
            <ProjectPick
              value={form.projectId}
              onChange={(projectId) => setForm((current) => (current ? { ...current, projectId } : current))}
              quiet={uxV5()}
            />
            <Field label="Run on" hint={uxV5() ? undefined : 'Green is free. Red is rendering. Choosing a PC checks it again.'}>
              <div className="flex items-center gap-2">
                <GpuDot status={form.workerId ? (queues[form.workerId] ?? workers.find((w) => w.id === form.workerId)?.queue) : undefined} />
                <Select
                  className="min-w-0 flex-1"
                  value={form.workerId ?? ''}
                  onChange={(e) => {
                    const id = e.target.value || null;
                    try {
                      if (id) localStorage.setItem('cos-h3-worker', id);
                    } catch {
                      /* private mode */
                    }
                    setForm((current) => (current ? { ...current, workerId: id } : current));
                  }}
                >
                  <option value="">Choose a PC</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {gpuTitle(w)}
                      {(queues[w.id] ?? w.queue) === 'busy' ? ' — busy' : (queues[w.id] ?? w.queue) === 'offline' ? ' — offline' : ''}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
              <Field label="Aspect">
                <Select
                  value={form.aspectRatio}
                  onChange={(e) => setForm((current) => (current ? { ...current, aspectRatio: e.target.value } : current))}
                >
                  {H3_ASPECTS.map((aspect) => (
                    <option key={aspect} value={aspect}>
                      {aspect}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Megapixels" hint={uxV5() ? undefined : 'MiniMax · 24 fps. The frame size comes from the aspect and this size.'}>
                <Select
                  value={String(form.megapixels)}
                  onChange={(e) => setForm((current) => (current ? { ...current, megapixels: Number(e.target.value) } : current))}
                >
                  <option value="0.5">0.5</option>
                  <option value="1">1</option>
                  <option value="1.5">1.5</option>
                </Select>
              </Field>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[240px_1fr]">
              <div className="rounded-lg border border-border bg-black p-2">
                <div className="grid grid-cols-2 gap-2">
                  {clip.images.map((image, n) => (
                    <div key={image.key} className="min-w-0">
                      <div className="relative aspect-square overflow-hidden rounded bg-zinc-900">
                        <img
                          alt=""
                          className="h-full w-full object-cover"
                          src={h3ImageSrc(image, form.workerId)}
                          onError={(e) => {
                            const img = e.currentTarget;
                            if (img.dataset.full) return;
                            img.dataset.full = '1';
                            if (image.fileId) img.src = `/api/v1/files/${image.fileId}/stream`;
                            else if (image.uploadName && (image.uploadWorkerId || form.workerId)) {
                              img.src = `/api/v1/comfy/workers/${image.uploadWorkerId || form.workerId}/input?name=${encodeURIComponent(image.uploadName)}`;
                            }
                          }}
                        />
                        <span className="absolute left-1 top-1 rounded bg-black/75 px-1 text-[10px] text-white">{n + 1}</span>
                        <button
                          type="button"
                          className="absolute right-1 top-1 rounded bg-black/75 px-1 text-[10px] text-white"
                          onClick={() => updateClip(index, { images: clip.images.filter((item) => item.key !== image.key) })}
                        >
                          ×
                        </button>
                      </div>
                      <label className="mt-1 flex items-center gap-1 text-[10px] text-zinc-200">
                        <input
                          type="checkbox"
                          checked={image.shared}
                          onChange={(e) => {
                            const shared = e.target.checked;
                            setForm((current) => {
                              if (!current) return current;
                              const match = (pic: H3Image) =>
                                (image.fileId && pic.fileId === image.fileId) || (image.uploadName && pic.uploadName === image.uploadName);
                              return {
                                ...current,
                                clips: current.clips.map((item, i) => {
                                  if (i === index) {
                                    return { ...item, images: item.images.map((pic) => (pic.key === image.key ? { ...pic, shared } : pic)) };
                                  }
                                  if (shared) {
                                    if (item.images.some(match)) {
                                      return { ...item, images: item.images.map((pic) => (match(pic) ? { ...pic, shared: true } : pic)) };
                                    }
                                    return { ...item, images: [...item.images, { ...image, key: crypto.randomUUID(), shared: true }] };
                                  }
                                  return { ...item, images: item.images.filter((pic) => !(pic.shared && match(pic))) };
                                }),
                              };
                            });
                          }}
                        />
                        Every prompt
                      </label>
                    </div>
                  ))}
                  {clip.images.length < 8 ? (
                    <button
                      type="button"
                      className="grid aspect-square place-items-center rounded border border-dashed border-zinc-500 text-2xl text-zinc-300"
                      onClick={() => setBrowser(true)}
                    >
                      +
                    </button>
                  ) : null}
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">User prompt</span>
                  <div className="flex gap-1">
                    <Button size="sm" aria-label="Clear prompt" title="Clear prompt" onClick={() => updateClip(index, { prompt: '' })}>
                      ×
                    </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      setForm((current) =>
                        current
                          ? {
                              ...current,
                              clips: current.clips.map((item) => ({
                                ...item,
                                prompt: clip.prompt,
                                images: clip.images.map((image) => ({ ...image, shared: true })),
                                taskMode: clip.taskMode,
                              })),
                            }
                          : current,
                      )
                    }
                  >
                    Apply to all
                  </Button>
                  </div>
                </div>
                <Textarea
                  ref={promptRef}
                  rows={10}
                  value={clip.prompt}
                  onChange={(e) => updateClip(index, { prompt: e.target.value })}
                />
                <AiPromptTools
                  targetType="h3"
                  targetId={clip.key || `h3-${index}`}
                  mode="vocal"
                  currentPrompt={clip.prompt}
                  context={{ idea: clip.prompt, currentPrompt: clip.prompt }}
                  onApply={(text) => updateClip(index, { prompt: text })}
                />
                <div className="mt-2 flex flex-wrap gap-1">
                  {clip.images.map((_, n) => (
                    <Button
                      key={n}
                      size="sm"
                      onClick={() => {
                        const token = `<Picture ${n + 1}>`;
                        const el = promptRef.current;
                        const value = clip.prompt;
                        const start = el?.selectionStart ?? value.length;
                        const end = el?.selectionEnd ?? start;
                        updateClip(index, { prompt: `${value.slice(0, start)}${token}${value.slice(end)}` });
                      }}
                    >
                      Picture {n + 1}
                    </Button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted">Picture 1 is the first photo. The words &lt;Picture 1&gt; in the prompt point at that photo.</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                variant={form.view === 'individual' ? 'primary' : 'ghost'}
                onClick={() => setForm((current) => (current ? { ...current, view: 'individual' } : current))}
              >
                Individual
              </Button>
              <Button
                variant={form.view === 'combined' ? 'primary' : 'ghost'}
                onClick={() =>
                  setForm((current) => {
                    if (!current) return current;
                    const source = current.clips[index] ?? current.clips[0];
                    if (!source) return { ...current, view: 'combined' };
                    return {
                      ...current,
                      view: 'combined',
                      clips: current.clips.map((item) => ({
                        ...item,
                        prompt: source.prompt,
                        images: source.images.map((image) => ({ ...image, shared: true })),
                        taskMode: source.taskMode,
                        refImageSize: source.refImageSize,
                      })),
                    };
                  })
                }
              >
                Combined
              </Button>
            </div>
            <div className="studio-clip mt-3">
              <Field
                label="Length"
                hint={
                  clip.audioTrim
                    ? 'Matches the trimmed audio. 00:08:00 is 8 seconds. 30 seconds is the longest shot.'
                    : '00:08:00 is 8 seconds. The boxes are minutes, seconds, then frames. 30 seconds is the longest shot.'
                }
              >
                <Input
                  className="font-mono"
                  inputMode="numeric"
                  placeholder="00:00:00"
                  value={clip.durationSec}
                  onChange={(e) => updateClip(index, { durationSec: e.target.value })}
                  onBlur={() => {
                    const seconds = parseTimecode(clip.durationSec);
                    if (seconds == null || seconds <= 0) return;
                    if (!clip.audioTrim) {
                      updateClip(index, { durationSec: formatTimecode(Math.min(H3_MAX_SECONDS, seconds)) });
                      return;
                    }
                    const file = clip.audioSeconds;
                    const room = Math.min(H3_MAX_SECONDS, file != null && file > clip.audioStartSec ? file - clip.audioStartSec : H3_MAX_SECONDS);
                    const use = Math.round(Math.max(0.2, Math.min(seconds, room)) * 10) / 10;
                    updateClip(index, { durationSec: formatTimecode(use), audioStartSec: clip.audioStartSec, audioUseSec: use });
                  }}
                />
              </Field>
              <Field label="Join">
                <Select
                  value={index === 0 ? 'shot' : clip.continuity}
                  disabled={index === 0}
                  onChange={(e) => updateClip(index, { continuity: e.target.value as H3Join })}
                >
                  {H3_JOINS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Size">
                <Select value={clip.refImageSize} onChange={(e) => updateClip(index, { refImageSize: e.target.value as H3RefSize })}>
                  <option value="max">Max</option>
                  <option value="match">Match</option>
                </Select>
              </Field>
              <Field label="Mode">
                <Select value={clip.taskMode} onChange={(e) => updateClip(index, { taskMode: e.target.value as H3Mode })}>
                  {H3_MODES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-zinc-950 p-2">
              <div className="flex min-w-[36rem] text-[10px] text-zinc-400">
                {form.clips.map((item, i) => (
                  <div key={item.key} className="min-w-[5.5rem] px-1" style={{ flex: h3Seconds(item) }}>
                    {formatTimecode(spans[i] ?? 0)}
                  </div>
                ))}
              </div>
              <div className="mt-1 flex min-w-[36rem] gap-0.5">
                {form.clips.map((item, i) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`min-w-[5.5rem] truncate rounded px-2 py-2 text-left text-xs text-white ${i === index ? 'bg-violet-500' : 'bg-violet-800'}`}
                    style={{ flex: h3Seconds(item) }}
                    onClick={() => setSelected(i)}
                  >
                    Segment {i + 1} {h3ModeLabel(item.taskMode)} {formatTimecode(h3Seconds(item))}
                  </button>
                ))}
              </div>
              <div className="mt-0.5 flex min-w-[36rem] gap-0.5">
                {form.clips.map((item, i) => {
                  const span = h3Seconds(item);
                  const slice = item.audioTrim && item.audioUseSec > 0 ? Math.min(span, item.audioUseSec) : span;
                  return (
                    <div key={`${item.key}-audio`} className="min-w-[5.5rem]" style={{ flex: span }}>
                      <button
                        type="button"
                        title={item.audioName ?? 'MiniMax audio'}
                        className={`block max-w-full truncate rounded px-2 py-1.5 text-left text-xs text-white ${i === index ? 'bg-sky-500' : 'bg-sky-900'}`}
                        style={{ width: `${Math.max(8, (slice / span) * 100)}%` }}
                        onClick={() => setSelected(i)}
                      >
                        {h3AudioLabel(item, form.audioLocked)}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {form.clips.length < 8 ? (
                <Button
                  onClick={() =>
                    setForm((current) => {
                      if (!current) return current;
                      const next = blankH3Clip(clip.prompt, 'context');
                      next.taskMode = clip.taskMode;
                      next.images = clip.images.filter((image) => image.shared || current.view === 'combined').map((image) => ({
                        ...image,
                        key: crypto.randomUUID(),
                        shared: true,
                      }));
                      if (current.shareAudio) Object.assign(next, h3AudioFields(clip));
                      setSelected(current.clips.length);
                      return { ...current, clips: [...current.clips, next] };
                    })
                  }
                >
                  Add segment
                </Button>
              ) : null}
              {form.clips.length > 1 ? (
                <Button
                  onClick={() =>
                    setForm((current) => {
                      if (!current) return current;
                      const clips = current.clips.filter((item) => item.key !== clip.key);
                      if (clips[0]) clips[0] = { ...clips[0], continuity: 'shot' };
                      setSelected(Math.max(0, index - 1));
                      return { ...current, clips };
                    })
                  }
                >
                  Remove segment
                </Button>
              ) : null}
            </div>
            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.shareAudio}
                  onChange={(e) => {
                    const shareAudio = e.target.checked;
                    setForm((current) => {
                      if (!current) return current;
                      return {
                        ...current,
                        shareAudio,
                        clips: shareAudio ? current.clips.map((item) => ({ ...item, ...h3AudioFields(clip) })) : current.clips,
                      };
                    });
                  }}
                />
                One audio for every segment
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.audioLocked}
                  onChange={(e) => setForm((current) => (current ? { ...current, audioLocked: e.target.checked } : current))}
                />
                Lock audio when a file is attached. A segment with no file lets MiniMax make the sound.
              </label>
              <FilePick
                kind="AUDIO"
                label="Audio"
                selected={clip.audioName}
                uploaded={!!clip.audioUploadName}
                busy={busy === `audio-${clip.key}`}
                onSelect={(file) =>
                  updateClip(index, {
                    audioFileId: file.id,
                    audioUploadName: null,
                    audioUploadWorkerId: null,
                    audioName: file.fileName,
                    audioSeconds: typeof file.tech?.durationMs === 'number' ? file.tech.durationMs / 1000 : null,
                    durationSec: clip.durationSec || (file.tech?.durationMs ? String(Math.round((file.tech.durationMs / 1000) * 100) / 100) : ''),
                  })
                }
                onUpload={(file) => void upload('audio', file, index)}
              />
              {clip.audioFileId || clip.audioUploadName ? (
                <H3AudioTrim
                  clip={clip}
                  workerId={form.workerId}
                  segmentSec={h3Seconds(clip)}
                  onChange={(patch) => updateClip(index, patch)}
                />
              ) : null}
            </div>
            <Dialog open={browser} onClose={() => setBrowser(false)} title="Photos" wide>
              <div className="p-4">
                <Input value={photoQ} placeholder="Search photos" onChange={(e) => setPhotoQ(e.target.value)} />
                <label className="mt-2 inline-flex cursor-pointer text-sm text-accent underline">
                  {busy === `image-${clip.key}` ? 'Uploading…' : 'Upload a photo'}
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void upload('image', file, index);
                    }}
                  />
                </label>
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {(photos.data?.items ?? []).map((file) => (
                    <button
                      key={file.id}
                      type="button"
                      className="overflow-hidden rounded border border-border text-left"
                      onClick={() => {
                        updateClip(index, {
                          images:
                            clip.images.length >= 8 || clip.images.some((image) => image.fileId === file.id)
                              ? clip.images
                              : [
                                  ...clip.images,
                                  {
                                    key: crypto.randomUUID(),
                                    fileId: file.id,
                                    uploadName: null,
                                    uploadWorkerId: null,
                                    name: file.fileName,
                                    shared: false,
                                    preview: `/api/v1/files/${file.id}/stream`,
                                  },
                                ],
                        });
                      }}
                    >
                      <img
                        alt=""
                        className="aspect-square w-full object-cover"
                        title={file.fileName}
                        src={`/api/v1/files/${file.id}/preview`}
                        onError={(e) => {
                          const img = e.currentTarget;
                          if (img.dataset.full) return;
                          img.dataset.full = '1';
                          img.src = `/api/v1/files/${file.id}/stream`;
                        }}
                      />
                    </button>
                  ))}
                </div>
              </div>
            </Dialog>
            {!uxV5() && <LastOnMachine jobs={data.jobs.filter((job) => inWorkspace(job, scope))} workerId={form.workerId} kind="video" />}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                busy={busy === 'draft'}
                onClick={async () => {
                  setBusy('draft');
                  setError('');
                  try {
                    await put('/comfy/h3/draft', payload);
                  } catch (e) {
                    setError(e instanceof ApiError ? e.message : 'That did not save.');
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Save draft
              </Button>
              <Button
                variant="primary"
                busy={busy === 'generate'}
                onClick={async () => {
                  setBusy('generate');
                  setError('');
                  try {
                    await post('/comfy/h3/generate', payload);
                    if (form.workerId) setQueues((q) => ({ ...q, [form.workerId!]: 'busy' }));
                    await refresh('/comfy/h3');
                  } catch (e) {
                    setError(e instanceof ApiError ? e.message : 'The video was not started.');
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Generate
              </Button>
            </div>
            {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
          {!uxV5() && <LastOnMachine jobs={data.jobs.filter((job) => inWorkspace(job, scope))} workerId={form.workerId} kind="video" />}
          </div>
        );
        if (uxV5()) {
          return (
            <StudioSplit
              left={formPane}
              right={
                <StudioResult
                  stageRef={h3Stage}
                  kind="video"
                  tag="MiniMax"
                  ratio={form.aspectRatio}
                  job={shown}
                  other={other}
                  onHistory={onHistory}
                  onPick={setH3Preview}
                />
              }
            />
          );
        }
        return formPane;
      }}
    </Async>
  );
}

