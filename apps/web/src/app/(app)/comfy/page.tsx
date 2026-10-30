'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, api, del, post, put, refresh, useApi } from '@/lib/api';
import { ActionButton, Async, Badge, Button, Card, CardTitle, Dialog, EmptyState, Field, Input, Notice, PageHeader, Select, Spinner, Tabs, Textarea } from '@/components/ui';
import { ago } from '@/lib/format';

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
  /** Checked once when the page loads. busy = red, free = green. */
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

/** e.g. RTX 3090 + 24 → "24GB (3090)" */
function gpuTitle(w: Pick<Worker, 'label' | 'expectedVramGb'>) {
  const short = w.label.replace(/^RTX\s+/i, '').trim() || w.label;
  return w.expectedVramGb != null ? `${w.expectedVramGb}GB (${short})` : short;
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
    projectTitle?: string | null;
    status: string;
    outcome: string;
    error: string | null;
    createdAt: string;
    settings: SavedClip['settings'] & {
      progress?: { phase: string; value: number | null; max: number | null; detail: string };
      outputs?: { filename: string }[];
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
  const [tab, setTab] = useState<'ltx' | 'h3' | 'history' | 'settings'>('ltx');
  const [recall, setRecall] = useState<SavedClip | null>(null);
  return (
    <div>
      <PageHeader
        title="ComfyUI"
        subtitle="Fill the clip and generate only when you press the button. PCs are added under Settings."
      />
      <Tabs
        tabs={[
          { id: 'ltx', label: 'LTX' },
          { id: 'h3', label: 'MiniMax H3' },
          { id: 'history', label: 'History' },
          { id: 'settings', label: 'Settings' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div hidden={tab !== 'ltx'}>
        <LtxStudio recall={recall} />
      </div>
      <div hidden={tab !== 'h3'}>
        <Notice tone="info" dismissible={false} title="Coming later">
          MiniMax H3 is not connected. This tab does not start a job.
        </Notice>
      </div>
      <div hidden={tab !== 'history'}>
        <HistoryTab
          onUse={(clip) => {
            setRecall(clip);
            setTab('ltx');
          }}
        />
      </div>
      <div hidden={tab !== 'settings'}>
        <MachineSetup />
      </div>
    </div>
  );
}

function jobLabel(status: string) {
  if (status === 'SUCCEEDED') return 'Ready';
  if (status === 'FAILED') return 'Failed';
  if (status === 'RUNNING') return 'Rendering';
  if (status === 'QUEUED') return 'Waiting';
  return status;
}

function HistoryTab({ onUse }: { onUse: (clip: SavedClip) => void }) {
  const studio = useApi<Studio>('/comfy/ltx');
  const [openFile, setOpenFile] = useState<string | null>(null);
  const rendering = (studio.data?.jobs ?? []).some((j) => j.status === 'QUEUED' || j.status === 'RUNNING');
  useEffect(() => {
    if (!rendering) return;
    const timer = setInterval(() => void refresh('/comfy/ltx'), 4000);
    return () => clearInterval(timer);
  }, [rendering]);
  return (
    <Async res={studio}>
      {(data) => {
        const clips = (data.jobs ?? []).slice(0, 10);
        if (clips.length === 0) {
          return <EmptyState title="No generations yet">Generate a clip on the LTX tab. The last 10 stay here so you can run them again.</EmptyState>;
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
                            <Badge tone={job.status === 'SUCCEEDED' ? 'ok' : job.status === 'FAILED' ? 'bad' : job.status === 'RUNNING' ? 'info' : 'warn'}>
                              {jobLabel(job.status)}
                            </Badge>
                            <span className="font-medium">{machine}</span>
                            <span className="text-sm">{project}</span>
                          </div>
                          <div className="mt-1 font-medium">{prompt ? prompt.slice(0, 120) : 'No prompt'}</div>
                          <p className="mt-1 text-xs text-muted">
                            {s.imageName ?? 'No image'} · {s.audioName ?? 'No song'} · from {s.audioStartSec ?? 0}s for {s.durationSec ?? 0}s · {s.width ?? '—'}×{s.height ?? '—'} · {ago(job.createdAt)}
                          </p>
                        </div>
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
                      {job.error ? <p className="mt-2 text-sm text-muted">{job.error}</p> : null}
                      {job.status === 'SUCCEEDED' && s.outputs?.length ? (
                        <video className="mt-2 w-full max-w-sm rounded-lg" controls src={`/api/v1/comfy/jobs/${job.id}/video`} />
                      ) : null}
                      {job.files?.some((f) => f.fileId) ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {job.files.filter((f) => f.fileId).map((f) => (
                            <Button key={f.fileId ?? f.expectedPath} size="sm" onClick={() => f.fileId && setOpenFile(f.fileId)}>
                              Open {f.assetTitle ? `${f.assetTitle} / ` : ''}{f.fileName ?? 'library file'}
                            </Button>
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
          </>
        );
      }}
    </Async>
  );
}

function MachineSetup() {
  const studio = useApi<Studio>('/comfy/ltx');
  const [machine, setMachine] = useState({ label: '', baseUrl: '', role: 'primary', expectedVramGb: '24' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <Async res={studio}>
      {(data) => {
        const workers = Array.isArray(data.workers) ? data.workers : [];
        return (
          <Card>
            <CardTitle>Machines</CardTitle>
            <p className="mb-3 text-sm text-muted">
              Add the 3090, the 3060, or any other PC that runs ComfyUI. Use its Tailscale or LAN address. The LTX graph was built for a 24GB card. A 12GB card stays selectable and is warned when the models may not fit.
            </p>
            {workers.length === 0 ? (
              <EmptyState title="No PC yet">Add the address of a ComfyUI you can reach from this server.</EmptyState>
            ) : (
              <ul className="mb-4 space-y-2">
                {workers.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <GpuDot status={w.queue} />
                        <span>{gpuTitle(w)}</span>
                        <Badge tone={w.role === 'primary' ? 'info' : 'neutral'}>{w.role === 'primary' ? 'Preferred' : 'Other'}</Badge>
                        <span className="text-xs font-normal text-muted">
                          {w.queue === 'busy' ? 'Rendering' : w.queue === 'free' ? 'Free' : 'Offline'}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted">{w.baseUrl}</div>
                      <div className="text-xs text-muted">
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
                ))}
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

function LtxStudio({ recall }: { recall: SavedClip | null }) {
  const studio = useApi<Studio>('/comfy/ltx');
  const projects = useApi<{ id: string; title: string }[]>('/projects', { query: { limit: 200 } });
  const [form, setForm] = useState<Form | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [audioSeconds, setAudioSeconds] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loras, setLoras] = useState<string[]>([]);
  const [queues, setQueues] = useState<Record<string, NonNullable<Worker['queue']>>>({});
  const [clipNote, setClipNote] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);

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
    setForm({
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
      wantUpscale: d?.wantUpscale ?? true,
      imageUploadName: d?.imageUploadName ?? null,
      imageUploadWorkerId: d?.imageUploadWorkerId ?? null,
      audioUploadName: d?.audioUploadName ?? null,
      audioUploadWorkerId: d?.audioUploadWorkerId ?? null,
    });
    setImageName(d?.imageName ?? null);
    setAudioName(d?.audioName ?? null);
    setAudioSeconds(d?.audioDurationMs != null ? d.audioDurationMs / 1000 : null);
  }, [studio.data, form]);

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

  useEffect(() => {
    if (!form?.workerId) return;
    const id = form.workerId;
    let gone = false;
    api<{ queue: 'busy' | 'free' | 'offline' }>(`/comfy/workers/${id}/queue`)
      .then((r) => {
        if (!gone) setQueues((q) => ({ ...q, [id]: r.queue }));
      })
      .catch(() => {
        if (!gone) setQueues((q) => ({ ...q, [id]: 'offline' }));
      });
    return () => {
      gone = true;
    };
  }, [form?.workerId]);

  useEffect(() => {
    if (!form?.audioFileId) {
      setAudioUrl(null);
      return;
    }
    let gone = false;
    post<{ url: string }>(`/files/${form.audioFileId}/stream-token`)
      .then((r) => {
        if (!gone) setAudioUrl(r.url);
      })
      .catch(() => {
        if (!gone) setAudioUrl(null);
      });
    return () => {
      gone = true;
    };
  }, [form?.audioFileId]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !form || el.readyState < 1) return;
    const start = Math.max(0, form.audioStartSec);
    if (Number.isFinite(el.duration) && start >= el.duration) {
      setClipNote(`This file is ${el.duration.toFixed(1)}s, so it cannot start at ${start}s.`);
      return;
    }
    el.currentTime = start;
    setClipNote(`Playing from ${start}s for ${form.durationSec}s.`);
  }, [audioUrl, form?.audioStartSec, form?.durationSec]);

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
        const projectsRows = Array.isArray(projects.data) ? projects.data : [];
        if (!form) return <Spinner />;
        return (
          <div className="space-y-4">
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
                <Field label="Project">
                  <Select value={form.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || null })}>
                    <option value="">No project</option>
                    {projectsRows.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </Select>
                </Field>
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
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  src={`/api/v1/files/${form.imageFileId}/preview`}
                  className="mt-3 max-h-48 rounded-lg"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : null}
              {audioUrl && form ? (
                <div className="mt-3">
                  <audio
                    ref={audioRef}
                    className="w-full"
                    controls
                    src={audioUrl}
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      const el = e.currentTarget;
                      if (Number.isFinite(el.duration)) setAudioSeconds(el.duration);
                      const start = Math.max(0, form.audioStartSec);
                      if (Number.isFinite(el.duration) && start >= el.duration) {
                        setClipNote(`This file is ${el.duration.toFixed(1)}s, so it cannot start at ${start}s.`);
                        return;
                      }
                      el.currentTime = start;
                      setClipNote(`Playing from ${start}s for ${form.durationSec}s.`);
                    }}
                    onTimeUpdate={(e) => {
                      const el = e.currentTarget;
                      const end = form.audioStartSec + form.durationSec;
                      if (el.currentTime >= end) {
                        el.pause();
                        el.currentTime = Math.max(0, form.audioStartSec);
                      }
                    }}
                    onPlay={(e) => {
                      const el = e.currentTarget;
                      const start = Math.max(0, form.audioStartSec);
                      const end = start + form.durationSec;
                      if (el.currentTime < start || el.currentTime >= end - 0.05) el.currentTime = start;
                    }}
                  />
                  {clipNote ? <p className="mt-1 text-xs text-muted">{clipNote}</p> : null}
                </div>
              ) : null}
              <Field label="Prompt" className="mt-3">
                <Textarea rows={6} value={form.prompt} onChange={(e) => set({ prompt: e.target.value })} />
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
                    <SizeChart title="Upscale resolution" rows={UPSCALE_SIZES} onPick={(upscaleWidth, upscaleHeight) => set({ upscaleWidth, upscaleHeight })} />
                  </div>
                  <Field label="Upscale width">
                    <LooseNumber value={form.upscaleWidth} onValue={(upscaleWidth) => set({ upscaleWidth })} />
                  </Field>
                  <Field label="Upscale height">
                    <LooseNumber value={form.upscaleHeight} onValue={(upscaleHeight) => set({ upscaleHeight })} />
                  </Field>
                </div>
              ) : null}
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
        );
      }}
    </Async>
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
              <video className="max-h-80 w-full rounded-lg bg-black" controls preload="metadata" src={`/api/v1/files/${id}/stream`} />
            ) : null}
            {row.fileType === 'AUDIO' ? <audio className="w-full" controls src={`/api/v1/files/${id}/stream`} /> : null}
            {row.fileType === 'IMAGE' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" className="max-h-64 rounded-lg" src={`/api/v1/files/${id}/preview`} />
            ) : null}
            <p className="break-all text-xs text-muted">{row.copyPaths?.local || row.displayPath || 'Path is on the PC that holds this file.'}</p>
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
  onSelect,
  onUpload,
}: {
  kind: 'IMAGE' | 'AUDIO';
  label: string;
  selected: string | null;
  uploaded?: boolean;
  busy?: boolean;
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
        selected
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
