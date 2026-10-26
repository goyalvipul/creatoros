'use client';

import { useEffect, useState } from 'react';
import { ApiError, api, del, post, put, refresh, useApi } from '@/lib/api';
import { ActionButton, Async, Badge, Button, Card, CardTitle, EmptyState, Field, Input, Notice, PageHeader, Select, Spinner, Tabs, Textarea } from '@/components/ui';

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
};
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
    status: string;
    outcome: string;
    error: string | null;
    createdAt: string;
    settings: { workerLabel?: string; imageName?: string; durationSec?: number; outputs?: { filename: string }[] };
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
  loraStrength: number;
  wantUpscale: boolean;
};
type CheckResult = { ok?: boolean; errors?: Issue[]; warnings?: Issue[]; blockReason?: string | null; prompted?: boolean };

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
  const [tab, setTab] = useState<'ltx' | 'h3'>('ltx');
  return (
    <div>
      <PageHeader
        title="ComfyUI"
        subtitle="Pick the PC, fill the clip, and generate only when you press the button."
      />
      <Tabs
        tabs={[
          { id: 'ltx', label: 'LTX' },
          { id: 'h3', label: 'MiniMax H3' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'h3' ? (
        <Notice tone="info" dismissible={false} title="Coming later">
          MiniMax H3 is not connected. This tab does not start a job.
        </Notice>
      ) : (
        <LtxStudio />
      )}
    </div>
  );
}

function LtxStudio() {
  const studio = useApi<Studio>('/comfy/ltx');
  const projects = useApi<{ id: string; title: string }[]>('/projects', { query: { limit: 200 } });
  const [form, setForm] = useState<Form | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [audioSeconds, setAudioSeconds] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [machine, setMachine] = useState({ label: '', baseUrl: '', role: 'primary', expectedVramGb: '24' });

  useEffect(() => {
    if (!studio.data || form) return;
    const d = studio.data.draft;
    const p = studio.data.preset ?? PRESET_FALLBACK;
    const workers = Array.isArray(studio.data.workers) ? studio.data.workers : [];
    setForm({
      projectId: d?.projectId ?? null,
      workerId: d?.workerId ?? workers.find((w) => w.role === 'primary')?.id ?? null,
      imageFileId: d?.imageFileId ?? null,
      audioFileId: d?.audioFileId ?? null,
      audioStartSec: d?.audioStartSec ?? p.audioStartSec,
      durationSec: d?.durationSec ?? p.durationSec,
      prompt: d?.prompt ?? p.prompt,
      negativePrompt: d?.negativePrompt ?? p.negativePrompt,
      width: d?.width ?? p.width,
      height: d?.height ?? p.height,
      fps: d?.fps ?? p.fps,
      loraStrength: d?.loraStrength ?? p.loraStrength,
      wantUpscale: d?.wantUpscale ?? true,
    });
    setImageName(d?.imageName ?? null);
    setAudioName(d?.audioName ?? null);
    setAudioSeconds(d?.audioDurationMs != null ? d.audioDurationMs / 1000 : null);
  }, [studio.data, form]);

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

  const rendering = (studio.data?.jobs ?? []).some((j) => j.status === 'QUEUED' || j.status === 'RUNNING');
  useEffect(() => {
    if (!rendering) return;
    const timer = setInterval(() => void refresh('/comfy/ltx'), 4000);
    return () => clearInterval(timer);
  }, [rendering]);

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

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
        const jobs = Array.isArray(data.jobs) ? data.jobs : [];
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
              <CardTitle>Machines</CardTitle>
              <p className="mb-3 text-sm text-muted">
                Add the 3090, the 3060, or any other PC that runs this ComfyUI. Use its Tailscale or LAN address. The graph was built for a 24GB card. A 12GB card stays selectable and is warned when the models may not fit.
              </p>
              {workers.length === 0 ? (
                <EmptyState title="No PC yet">Add the address of a ComfyUI you can reach from this server.</EmptyState>
              ) : (
                <ul className="mb-4 space-y-2">
                  {workers.map((w) => (
                    <li key={w.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3">
                      <div className="min-w-0">
                        <div className="font-medium">
                          {w.label}{' '}
                          <Badge tone={w.role === 'primary' ? 'info' : 'neutral'}>{w.role === 'primary' ? 'Preferred' : 'Other'}</Badge>
                          {w.expectedVramGb ? <Badge tone={w.expectedVramGb < 20 ? 'warn' : 'neutral'}>{w.expectedVramGb} GB expected</Badge> : null}
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
                            if (form.workerId === w.id) set({ workerId: null });
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
              <Button
                className="mt-3"
                busy={busy === 'add'}
                onClick={async () => {
                  setBusy('add');
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
                    setResult({ ok: false, errors: [{ field: 'worker', message: e instanceof ApiError ? e.message : 'Could not add that PC.' }], warnings: [] });
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Add PC
              </Button>
            </Card>

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
                <Field label="Run on">
                  <Select value={form.workerId ?? ''} onChange={(e) => set({ workerId: e.target.value || null })}>
                    <option value="">Choose a PC</option>
                    {workers.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.label}
                        {w.expectedVramGb ? ` (${w.expectedVramGb} GB)` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <FilePick
                  kind="IMAGE"
                  label="Starting image"
                  selected={imageName}
                  onSelect={(file) => {
                    set({ imageFileId: file.id });
                    setImageName(file.fileName);
                  }}
                />
                <FilePick
                  kind="AUDIO"
                  label="Song"
                  selected={audioName}
                  onSelect={(file) => {
                    set({ audioFileId: file.id });
                    setAudioName(file.fileName);
                    const ms = file.tech?.durationMs;
                    setAudioSeconds(typeof ms === 'number' ? ms / 1000 : null);
                  }}
                />
                <Field label="Start (seconds)" hint={audioSeconds != null ? `Song length ${audioSeconds.toFixed(1)}s` : 'Length appears after the file has been probed.'}>
                  <Input type="number" min={0} step="0.1" value={form.audioStartSec} onChange={(e) => set({ audioStartSec: Number(e.target.value) })} />
                </Field>
                <Field label="Duration (seconds)" hint={`The workflow file uses ${preset.durationSec} seconds.`}>
                  <Input type="number" min={1} max={120} step="0.1" value={form.durationSec} onChange={(e) => set({ durationSec: Number(e.target.value) })} />
                </Field>
                <Field label="Width">
                  <Input type="number" value={form.width} onChange={(e) => set({ width: Number(e.target.value) })} />
                </Field>
                <Field label="Height">
                  <Input type="number" value={form.height} onChange={(e) => set({ height: Number(e.target.value) })} />
                </Field>
                <Field label="Frame rate">
                  <Input type="number" value={form.fps} onChange={(e) => set({ fps: Number(e.target.value) })} />
                </Field>
                <Field label="LoRA strength" hint={`The workflow file uses ${preset.loraStrength}.`}>
                  <Input type="number" min={0} max={2} step="0.05" value={form.loraStrength} onChange={(e) => set({ loraStrength: Number(e.target.value) })} />
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
              {audioUrl ? <audio className="mt-3 w-full" controls src={audioUrl} preload="metadata" /> : null}
              <Field label="Prompt" className="mt-3">
                <Textarea rows={6} value={form.prompt} onChange={(e) => set({ prompt: e.target.value })} />
              </Field>
              <Field label="Negative prompt" className="mt-3">
                <Textarea rows={4} value={form.negativePrompt} onChange={(e) => set({ negativePrompt: e.target.value })} />
              </Field>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.wantUpscale} onChange={(e) => set({ wantUpscale: e.target.checked })} />
                Keep the upscale ({preset.upscale.width}×{preset.upscale.height})
              </label>
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
                  {result.ok && !result.prompted && !result.blockReason ? <p>Saved. Nothing was sent to a GPU.</p> : null}
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

            <Card>
              <CardTitle>Jobs</CardTitle>
              {jobs.length === 0 ? (
                <EmptyState title="No LTX jobs">Generate sends one clip to the PC you picked.</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {jobs.map((j) => (
                    <li key={j.id} className="rounded-lg border border-border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={j.status === 'SUCCEEDED' ? 'ok' : j.status === 'FAILED' ? 'bad' : j.status === 'RUNNING' ? 'info' : 'warn'}>
                          {j.status === 'QUEUED' ? 'Waiting' : j.status === 'RUNNING' ? 'Rendering' : j.status === 'SUCCEEDED' ? 'Ready' : j.status === 'FAILED' ? 'Failed' : j.status}
                        </Badge>
                        <span>{j.settings?.workerLabel ?? 'No PC'}</span>
                        <span className="text-muted">{j.settings?.imageName}</span>
                        <span className="text-muted">{j.settings?.durationSec}s</span>
                      </div>
                      {j.error ? <p className="mt-1 text-muted">{j.error}</p> : null}
                      {j.status === 'SUCCEEDED' && j.settings?.outputs?.length ? (
                        <video className="mt-2 w-full max-w-sm rounded-lg" controls src={`/api/v1/comfy/jobs/${j.id}/video`} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        );
      }}
    </Async>
  );
}

function FilePick({
  kind,
  label,
  selected,
  onSelect,
}: {
  kind: 'IMAGE' | 'AUDIO';
  label: string;
  selected: string | null;
  onSelect: (file: { id: string; fileName: string; tech?: { durationMs?: number } }) => void;
}) {
  const [q, setQ] = useState('');
  const list = useApi<{ items: { id: string; fileName: string; tech?: { durationMs?: number } }[] }>(q.trim() ? '/library' : null, {
    query: { kind, q, limit: 20 },
  });
  return (
    <Field label={label} hint={selected ? `Selected: ${selected}` : 'Search the library by file name.'}>
      <Input value={q} placeholder={kind === 'IMAGE' ? 'Search images' : 'Search audio'} onChange={(e) => setQ(e.target.value)} />
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
