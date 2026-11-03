'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, api, del, post, put, refresh, useApi } from '@/lib/api';
import { FileDownload } from '@/components/file-download';
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

function usePcQueue(workerId: string | null) {
  const [queues, setQueues] = useState<Record<string, NonNullable<Worker['queue']>>>({});
  useEffect(() => {
    if (!workerId) return;
    let gone = false;
    const tick = () => {
      api<{ queue: 'busy' | 'free' | 'offline' }>(`/comfy/workers/${workerId}/queue`)
        .then((r) => {
          if (!gone) setQueues((q) => ({ ...q, [workerId]: r.queue }));
        })
        .catch(() => {
          if (!gone) setQueues((q) => ({ ...q, [workerId]: 'offline' }));
        });
    };
    tick();
    const timer = setInterval(tick, 4000);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [workerId]);
  return [queues, setQueues] as const;
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
  const [tab, setTab] = useState<'ltx' | 'audio' | 'h3' | 'history' | 'settings'>('ltx');
  const [recall, setRecall] = useState<SavedClip | null>(null);
  useEffect(() => {
    if (window.location.hash === '#history') setTab('history');
  }, []);
  return (
    <div>
      <PageHeader
        title="ComfyUI"
        subtitle="Fill the clip and generate only when you press the button. PCs are added under Settings."
      />
      <Tabs
        tabs={[
          { id: 'ltx', label: 'LTX' },
          { id: 'audio', label: 'Audio' },
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
      <div hidden={tab !== 'audio'}>
        <AudioTab />
      </div>
      <div hidden={tab !== 'h3'}>
        <H3Tab />
      </div>
      <div hidden={tab !== 'history'}>
        <HistoryTab
          onUse={(clip) => {
            setRecall(clip);
            setTab('ltx');
          }}
        />
      </div>
      <div hidden={tab !== 'settings'} className="space-y-4">
        {tab === 'settings' ? (
          <>
            <MachineSetup />
            <WindowsTasks />
          </>
        ) : null}
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
  const ltx = useApi<Studio>('/comfy/ltx');
  const h3 = useApi<{ jobs: Studio['jobs'] }>('/comfy/h3');
  const [openFile, setOpenFile] = useState<string | null>(null);
  const clips = [...(ltx.data?.jobs ?? []).map((job) => ({ ...job, kind: 'LTX' as const })), ...(h3.data?.jobs ?? []).map((job) => ({ ...job, kind: 'MiniMax' as const }))]
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
                      <Badge tone={job.status === 'SUCCEEDED' ? 'ok' : job.status === 'FAILED' ? 'bad' : job.status === 'RUNNING' ? 'info' : 'warn'}>
                        {jobLabel(job.status)}
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
                {job.error ? <p className="mt-2 text-sm text-muted">{job.error}</p> : null}
                {job.status === 'SUCCEEDED' && s.outputs?.length ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <video className="w-full max-w-sm rounded-lg" controls src={`/api/v1/comfy/jobs/${job.id}/video`} />
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
  const [form, setForm] = useState<Form | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [audioSeconds, setAudioSeconds] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loras, setLoras] = useState<string[]>([]);
  const [queues, setQueues] = usePcQueue(form?.workerId ?? null);
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
              <LastOnMachine jobs={data.jobs} workerId={form.workerId} kind="video" />
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

function ProjectPick({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const projects = useApi<{ id: string; title: string }[]>('/projects', { query: { limit: 200 } });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [made, setMade] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listed = Array.isArray(projects.data) ? projects.data : [];
  const rows = [...made.filter((item) => !listed.some((p) => p.id === item.id)), ...listed];
  return (
    <Field label="Project" hint="Empty leaves Production and Publishing alone. A later clip on the same project joins the publishing row that is already there.">
      <Select
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
                const created = await post<{ id: string; title: string }>('/projects', { title: name, type: 'OTHER' });
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
            <Badge tone={job.status === 'SUCCEEDED' ? 'ok' : job.status === 'FAILED' ? 'bad' : 'info'}>{jobLabel(job.status)}</Badge>
            <span className="text-muted">{ago(job.createdAt)}</span>
          </div>
          {job.status === 'QUEUED' || job.status === 'RUNNING' ? (
            <p className="text-muted">{job.settings.progress?.detail ?? 'Working on that PC.'}</p>
          ) : null}
          {job.error ? <p className="text-bad">{job.error}</p> : null}
          {job.status === 'SUCCEEDED' ? (
            kind === 'video' ? (
              <video className="w-full max-w-sm rounded-lg" controls src={`/api/v1/comfy/jobs/${job.id}/video`} />
            ) : (
              <audio className="w-full" controls src={`/api/v1/comfy/jobs/${job.id}/audio`} />
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

function AudioTab() {
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
  const [queues, setQueues] = usePcQueue(form?.workerId ?? null);
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
        return (
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
                  <GpuDot status={form.workerId ? queues[form.workerId] : undefined} />
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
            <LastOnMachine jobs={data.jobs} workerId={form.workerId} kind="audio" />
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

const H3_ASPECTS = [
  '9:16 (Portrait Widescreen)',
  '16:9 (Landscape Widescreen)',
  '1:1 (Square)',
  '3:4 (Portrait)',
  '4:3 (Landscape)',
  '2:3 (Portrait)',
  '3:2 (Landscape)',
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
    durationSec: '00:08:00',
    images: [],
  };
}

function H3Tab() {
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
  const [queues, setQueues] = usePcQueue(form?.workerId ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
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
      aspectRatio: data.draft?.aspectRatio || '9:16 (Portrait Widescreen)',
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
      const audioChange = patch.audioFileId !== undefined || patch.audioUploadName !== undefined || patch.audioName !== undefined;
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
        updateClip(index, { audioFileId: null, audioUploadName: json.data.name, audioUploadWorkerId: form.workerId, audioName: file.name });
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
        return (
          <Card>
            <CardTitle>MiniMax H3</CardTitle>
            <p className="mb-3 text-sm text-muted">
              A timeline of segments. The first one is a new shot. Later ones can continue it. Generate sends the whole timeline. Nothing starts until then.
            </p>
            {data.blockReason ? (
              <div className="mb-3">
                <Notice tone="warn">{data.blockReason}</Notice>
              </div>
            ) : null}
            <Field label="Run on" hint="Green is free. Red is rendering. Choosing a PC checks it again.">
              <div className="flex items-center gap-2">
                <GpuDot status={form.workerId ? queues[form.workerId] : undefined} />
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
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
              <Field label="Megapixels" hint="MiniMax · 24 fps. The frame size comes from the aspect and this size.">
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
            <div className="grid gap-3 md:grid-cols-2">
              <ProjectPick
                value={form.projectId}
                onChange={(projectId) => setForm((current) => (current ? { ...current, projectId } : current))}
              />
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
            <div className="mt-3 flex flex-wrap items-end gap-2">
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
              <Field label="Length" hint="00:08:00 is 8 seconds. The boxes are minutes, seconds, then frames.">
                <Input
                  className="w-32 font-mono"
                  inputMode="numeric"
                  placeholder="00:00:00"
                  value={clip.durationSec}
                  onChange={(e) => updateClip(index, { durationSec: e.target.value })}
                  onBlur={() => {
                    const seconds = parseTimecode(clip.durationSec);
                    if (seconds != null && seconds > 0) updateClip(index, { durationSec: formatTimecode(seconds) });
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
                {form.clips.map((item, i) => (
                  <button
                    key={`${item.key}-audio`}
                    type="button"
                    className={`min-w-[5.5rem] truncate rounded px-2 py-1.5 text-left text-xs text-white ${i === index ? 'bg-sky-500' : 'bg-sky-900'}`}
                    style={{ flex: h3Seconds(item) }}
                    onClick={() => setSelected(i)}
                  >
                    {item.audioName ? `${item.audioName}${form.audioLocked ? ' 🔒' : ''}` : 'MiniMax audio'}
                  </button>
                ))}
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
                      if (current.shareAudio) {
                        next.audioFileId = clip.audioFileId;
                        next.audioUploadName = clip.audioUploadName;
                        next.audioUploadWorkerId = clip.audioUploadWorkerId;
                        next.audioName = clip.audioName;
                      }
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
                        clips: shareAudio
                          ? current.clips.map((item) => ({
                              ...item,
                              audioFileId: clip.audioFileId,
                              audioUploadName: clip.audioUploadName,
                              audioUploadWorkerId: clip.audioUploadWorkerId,
                              audioName: clip.audioName,
                            }))
                          : current.clips,
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
                    durationSec: clip.durationSec || (file.tech?.durationMs ? String(Math.round((file.tech.durationMs / 1000) * 100) / 100) : ''),
                  })
                }
                onUpload={(file) => void upload('audio', file, index)}
              />
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
            <LastOnMachine jobs={data.jobs} workerId={form.workerId} kind="video" />
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
          </Card>
        );
      }}
    </Async>
  );
}

