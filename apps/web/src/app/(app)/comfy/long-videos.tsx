'use client';

import { useEffect, useRef, useState } from 'react';
import { H3_ASPECTS, clipTitle, h3AspectRatio, longVideoOutputFolder, orderByPlanName } from '@creatoros/domain';
import { ApiError, del, patch, post, refresh, useApi } from '@/lib/api';
import { Button, Card, CardTitle, EmptyState, Field, Input, Notice, Select } from '@/components/ui';
import { AiImageTools, AiPromptTools } from '@/components/ai-tools';
import { FileDownload } from '@/components/file-download';

type Project = {
  id: string;
  title: string;
  status: string;
  aspect: string;
  durationMs: number | null;
  audioName: string | null;
  peaks: number[];
  megapixels: number;
  taskMode: string;
  continuity: string;
  refSize: string;
  fps: number;
  workerId: string | null;
  batchState: string;
  exportStatus: string | null;
  exportPath: string | null;
  exportError: string | null;
  targetSceneMs: number;
};
type Scene = {
  id: string;
  position: number;
  startMs: number;
  endMs: number;
  label: string;
  mode: string;
  continuity: string;
  workerId: string | null;
  prompt: string;
  songNotes: string;
  imageNotes: string;
  imageOrder: string[];
  status: string;
  jobId: string | null;
  shownJobId: string | null;
  priorJobId: string | null;
  takePath: string | null;
  priorTakePath: string | null;
  outdated: boolean;
  error: string | null;
};
type RefImage = { id: string; sceneId: string | null; name: string; createdAt?: string };
type Detail = { project: Project; scenes: Scene[]; refs: RefImage[]; workers: Worker[] };
type Worker = { id: string; label: string; enabled: boolean };

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

type PlanResult = { sceneCount: number; globalImages: string[]; songDifferenceMs: number; shortSceneCount: number; unusedImages: string[] };

function planSummary(data: PlanResult) {
  const parts = [`Filled ${data.sceneCount} sections.`];
  parts.push(data.globalImages.length ? `Shared pictures: ${data.globalImages.join(', ')}.` : 'No picture is on every clip, so each picture stays on its own section.');
  if (data.songDifferenceMs > 0) parts.push(`The sections run ${(data.songDifferenceMs / 1000).toFixed(1)}s past the song.`);
  if (data.songDifferenceMs < 0) parts.push(`The sections end ${(Math.abs(data.songDifferenceMs) / 1000).toFixed(1)}s before the song ends.`);
  parts.push(data.shortSceneCount > 0 ? `${data.shortSceneCount} section${data.shortSceneCount === 1 ? '' : 's'} of 5 seconds or less use the 3060. The rest use the 3090.` : 'Every section uses the 3090.');
  if (data.unusedImages.length) parts.push(`Not used: ${data.unusedImages.join(', ')}.`);
  return parts.join(' ');
}

async function readUploadError(res: Response, fallback: string) {
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return json?.error?.message ?? fallback;
}

function uploadSong(projectId: string, file: File) {
  const body = new FormData();
  body.append('file', file);
  return fetch(`/api/v1/long-videos/${projectId}/audio`, { method: 'POST', credentials: 'same-origin', headers: { 'x-requested-with': 'creatoros' }, body }).then(async (res) => {
    if (!res.ok) throw new ApiError(res.status, 'ERROR', await readUploadError(res, 'The song did not upload.'));
  });
}

function applyClipPlan(projectId: string, planFile: File, images: File[]) {
  const body = new FormData();
  body.append('plan', planFile);
  for (const image of images) body.append('images', image);
  return fetch(`/api/v1/long-videos/${projectId}/plan`, { method: 'POST', credentials: 'same-origin', headers: { 'x-requested-with': 'creatoros' }, body }).then(async (res) => {
    const json = (await res.json()) as { data?: PlanResult; error?: { message?: string } };
    if (!res.ok || !json.data) throw new ApiError(res.status, 'ERROR', json.error?.message ?? 'That plan did not apply.');
    return planSummary(json.data);
  });
}

export function LongVideos({ active = true }: { active?: boolean }) {
  const list = useApi<Project[]>('/long-videos');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const saved = sessionStorage.getItem('cos-long-video');
    if (saved) setOpenId(saved);
  }, []);
  const choose = (id: string | null) => {
    setOpenId(id);
    if (id) sessionStorage.setItem('cos-long-video', id);
    else sessionStorage.removeItem('cos-long-video');
  };
  const [title, setTitle] = useState('Price Tag');
  const [aspect, setAspect] = useState('16:9 (Widescreen)');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [song, setSong] = useState<File | null>(null);
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const songInput = useRef<HTMLInputElement>(null);
  const planInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const create = () => {
    const name = title.trim();
    if (!name) {
      setError('Name the project.');
      return;
    }
    if ((planFile || images.length > 0) && !song) {
      setError('Choose the song as well. The sections are timed from it.');
      return;
    }
    if (images.length > 0 && !planFile) {
      setError('Choose the clip JSON for these pictures.');
      return;
    }
    setBusy(true);
    setError(null);
    post<Project>('/long-videos', { title: name, aspect })
      .then(async (row) => {
        try {
          if (song) await uploadSong(row.id, song);
          if (planFile) sessionStorage.setItem('cos-long-plan-note', await applyClipPlan(row.id, planFile, images));
        } catch (err) {
          await del(`/long-videos/${row.id}`).catch(() => undefined);
          throw err;
        }
        refresh('/long-videos');
        choose(row.id);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'That project was not created.'))
      .finally(() => setBusy(false));
  };
  if (openId) return <Editor id={openId} active={active} onBack={() => choose(null)} />;
  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardTitle>New long video</CardTitle>
        <p className="mt-1 text-sm text-muted">Name the project, then add the song, the clip JSON, and the pictures. Create builds every section from that file.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_240px]">
          <Field label="Project name">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Aspect">
            <Select value={aspect} onChange={(e) => setAspect(e.target.value)}>
              {H3_ASPECTS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" type="button" disabled={busy} onClick={() => songInput.current?.click()}>Song</Button>
          <input ref={songInput} className="sr-only" type="file" accept="audio/*,.mp3,.wav,.m4a,.flac" onChange={(e) => { setSong(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          <Button size="sm" type="button" disabled={busy} onClick={() => planInput.current?.click()}>Clip plan</Button>
          <input ref={planInput} className="sr-only" type="file" accept="application/json,.json" onChange={(e) => { setPlanFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          <Button size="sm" type="button" disabled={busy} onClick={() => imageInput.current?.click()}>Pictures</Button>
          <input ref={imageInput} className="sr-only" type="file" accept="image/*,.png,.jpg,.jpeg,.webp" multiple onChange={(e) => { setImages([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <Button type="button" disabled={busy} onClick={create}>{busy ? 'Creating' : 'Create project'}</Button>
          <span className="text-xs text-muted">{song ? song.name : 'No song'} · {planFile ? planFile.name : 'No JSON'} · {images.length ? `${images.length} pictures` : 'no pictures yet'}</span>
        </div>
        {error ? <Notice tone="bad">{error}</Notice> : null}
      </Card>
      {list.data?.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {list.data.map((project) => (
            <Card key={project.id}>
              <div className="font-medium">{project.title}</div>
              <div className="mt-1 text-sm text-muted">
                {project.aspect} · {project.durationMs ? clock(project.durationMs) : 'No song yet'} · {project.status}
                {project.batchState === 'run' ? ' · generating' : ''}
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => choose(project.id)}>Edit</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (!window.confirm(`Delete ${project.title}? A render that is still going is stopped. The song file on the PC is left where it is.`)) return;
                    setError(null);
                    del(`/long-videos/${project.id}`)
                      .then(() => refresh('/long-videos'))
                      .catch((e: ApiError) => setError(e.message));
                  }}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No long videos yet">Create a project and upload the song. The MiniMax form on the other tab is left alone.</EmptyState>
      )}
    </div>
  );
}

function Editor({ id, active, onBack }: { id: string; active: boolean; onBack: () => void }) {
  const detail = useApi<Detail>(`/long-videos/${id}`, { refreshInterval: 4000 });
  const audio = useRef<HTMLAudioElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [sectionSeconds, setSectionSeconds] = useState<string | null>(null);
  const [planEpoch, setPlanEpoch] = useState(0);
  const [planNote, setPlanNote] = useState<string | null>(null);
  useEffect(() => {
    setSectionSeconds(null);
    const note = sessionStorage.getItem('cos-long-plan-note');
    if (!note) return;
    setPlanNote(note);
    sessionStorage.removeItem('cos-long-plan-note');
  }, [id]);
  const project = detail.data?.project;
  const scenes = detail.data?.scenes ?? [];
  const refs = detail.data?.refs ?? [];
  const workers = (detail.data?.workers ?? []).filter((worker) => worker.enabled);
  const ai = useApi<{ settings?: { enabled?: boolean } }>('/ai/status');
  const aiOn = !!ai.data && ai.data.settings?.enabled !== false;
  useEffect(() => {
    const node = audio.current;
    if (!node) return;
    const stop = () => {
      const scene = scenes.find((s) => s.id === playing);
      if (scene && node.currentTime >= scene.endMs / 1000 - 0.05) {
        node.pause();
        setPlaying(null);
      }
    };
    node.addEventListener('timeupdate', stop);
    return () => node.removeEventListener('timeupdate', stop);
  }, [playing, scenes]);
  const act = (work: Promise<unknown>) => {
    setError(null);
    work.then(() => refresh(`/long-videos/${id}`)).catch((e: ApiError) => setError(e.message));
  };
  const playScene = (scene: Scene, offsetSec = 0) => {
    const node = audio.current;
    if (!node || !project?.durationMs) return;
    const start = scene.startMs / 1000 + Math.max(0, offsetSec);
    if (start >= scene.endMs / 1000 - 0.05) {
      node.pause();
      return;
    }
    node.currentTime = start;
    void node.play();
    setPlaying(scene.id);
  };
  const stopAudio = () => {
    audio.current?.pause();
    setPlaying(null);
  };
  if (!project) return <div className="p-4 text-sm text-muted">Loading the project…</div>;
  const ready = scenes.filter((s) => s.status === 'READY').length;
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <input
          className="min-w-40 flex-1 rounded-md border bg-transparent px-2 py-1 text-lg font-semibold"
          aria-label="Project name"
          value={title ?? project.title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const next = (title ?? project.title).trim();
            if (!next || next === project.title) {
              setTitle(null);
              return;
            }
            act(patch(`/long-videos/${id}`, { title: next }));
            setTitle(null);
          }}
        />
        <span className="text-sm text-muted">{ready}/{scenes.length || 0} scenes ready</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              if (!window.confirm(`Delete ${project.title}? A render that is still going is stopped. The song file on the PC is left where it is.`)) return;
              del(`/long-videos/${id}`).then(onBack).catch((e: ApiError) => setError(e.message));
            }}
          >
            Delete
          </Button>
          <Button variant="ghost" onClick={() => act(post(`/long-videos/${id}/batch`, { state: 'pause' }))}>Pause</Button>
          <Button onClick={() => act(post(`/long-videos/${id}/batch`, { state: 'run' }))}>Generate all</Button>
          {aiOn ? (
            <Button variant="ghost" onClick={() => {
              if (!window.confirm('Generate images only for scenes that have none? Up to 4, one at a time. Cost estimate unavailable — this may be billable. MiniMax will not start.')) return;
              act(post(`/ai/images/missing`, { projectId: id, acceptBillable: true }));
            }}>Generate missing images</Button>
          ) : null}
          {scenes.some((scene) => sceneDownload(id, scene)) ? (
            <FileDownload href={`/api/v1/long-videos/${id}/scenes.zip`} name={`${project.title.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'long-video'}.zip`} label="Download all scenes" busyLabel="Downloading…" />
          ) : null}
        </div>
      </div>
      <p className="text-sm text-muted">
        Videos are saved on the PC that renders them, in easy_media/projects/{longVideoOutputFolder(project.title)}.
        Production and Publishing use this same name. A finished video is linked there after that PC is scanned.
      </p>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Notice>
        Vocal and B-roll are labels for you. Every scene sends its slice of the song with the MiniMax fields below, and the prompt is sent as you wrote it. Pause holds the next scene. A clip already running on the PC finishes.
      </Notice>
      <Card>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="PC">
            <Select
              value={project.workerId ?? ''}
              onChange={(e) => act(patch(`/long-videos/${id}`, { workerId: e.target.value || null }))}
            >
              <option value="">Choose a PC</option>
              {(detail.data?.workers ?? []).filter((w) => w.enabled).map((w) => (
                <option key={w.id} value={w.id}>{w.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Megapixels">
            <Select value={String(project.megapixels || 1)} onChange={(e) => act(patch(`/long-videos/${id}`, { megapixels: Number(e.target.value) }))}>
              <option value="0.5">0.5</option>
              <option value="1">1</option>
              <option value="1.5">1.5</option>
            </Select>
          </Field>
          <Field label="Size">
            <Select value={project.refSize || 'max'} onChange={(e) => act(patch(`/long-videos/${id}`, { refSize: e.target.value }))}>
              <option value="max">Max</option>
              <option value="match">Match</option>
            </Select>
          </Field>
          <Field label="Mode">
            <Select value={project.taskMode || 'ref'} onChange={(e) => act(patch(`/long-videos/${id}`, { taskMode: e.target.value }))}>
              <option value="ref">R2V</option>
              <option value="i2v">I2V</option>
              <option value="v2v">V2V</option>
              <option value="l2v">L2V</option>
            </Select>
          </Field>
          <Field label="Export frames">
            <Select value={String(project.fps)} onChange={(e) => act(patch(`/long-videos/${id}`, { fps: Number(e.target.value) }))}>
              <option value="30">30 fps</option>
              <option value="24">24 fps</option>
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-start gap-2">
          <FileButton label={project.audioName ? 'Replace song' : 'Upload song'} accept="audio/*,.mp3,.wav,.m4a,.flac" onFile={(file) => uploadAudio(id, file, setError)} />
          <LibraryPick kind="AUDIO" onPick={(file) => act(post(`/long-videos/${id}/library`, { fileId: file.id }))} />
          {project.audioName ? <span className="text-sm text-muted">{project.audioName} · {clock(project.durationMs ?? 0)}</span> : null}
          <label className="flex items-center gap-1 text-xs text-muted">
            Each section
            <input
              className="w-16 rounded-md border bg-transparent px-2 py-1 text-sm"
              inputMode="decimal"
              aria-label="Seconds for each section"
              value={sectionSeconds ?? String((project.targetSceneMs || 10000) / 1000)}
              onChange={(e) => setSectionSeconds(e.target.value)}
            />
            s
          </label>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const sec = Number(sectionSeconds ?? (project.targetSceneMs || 10000) / 1000);
              if (!Number.isFinite(sec) || sec < 4 || sec > 15) {
                setError('Each section can be from 4 to 15 seconds.');
                return;
              }
              act(post(`/long-videos/${id}/rebalance`, { seconds: sec }));
            }}
          >
            Rebuild scenes
          </Button>
          <PlanImport
            projectId={id}
            hasSong={!!project.durationMs}
            sceneIds={scenes.map((scene) => scene.id)}
            onBegin={() => {
              planEpochLive += 1;
            }}
            onAbort={() => {
              planEpochLive -= 1;
            }}
            onMessage={(message) => {
              setError(null);
              setPlanNote(message);
              setPlanEpoch(planEpochLive);
            }}
            onError={setError}
          />
          <FileButton label="Add picture" accept="image/*" onFile={(file) => uploadRef(id, null, file, setError)} />
          <LibraryPick kind="IMAGE" onPick={(file) => act(post(`/long-videos/${id}/library`, { fileId: file.id }))} />
          <RefRow projectId={id} refs={refs.filter((r) => r.sceneId == null)} />
        </div>
        {project.peaks?.length ? (
          <div className="mt-4 flex h-16 items-end gap-px" aria-hidden>
            {project.peaks.map((n, i) => (
              <span key={i} className="w-1 rounded-sm bg-current opacity-70" style={{ height: `${Math.max(4, n)}%` }} />
            ))}
          </div>
        ) : null}
        {planNote ? <p className="mt-3 text-sm text-muted">{planNote}</p> : null}
        {project.durationMs ? <audio ref={audio} src={active ? `/api/v1/long-videos/${id}/audio` : undefined} preload={active ? 'auto' : 'none'} /> : null}
      </Card>
      <div className="grid gap-3 lg:grid-cols-3">
        {scenes.map((scene, index) => (
          <SceneCard
            key={`${scene.id}-${planEpoch}`}
            planEpoch={planEpoch}
            projectId={id}
            scene={scene}
            first={index === 0}
            last={index === scenes.length - 1}
            projectTitle={project.title}
            workers={workers}
            projectWorkerId={project.workerId}
            active={active}
            portrait={shownAspect(project.aspect).startsWith('9:16')}
            canPlay={!!project.durationMs}
            own={refs.filter((r) => r.sceneId === scene.id)}
            shared={refs.filter((r) => r.sceneId == null)}
            onPlay={(offset) => playScene(scene, offset)}
            onStop={stopAudio}
            onError={setError}
            run={(work) => act(work)}
          />
        ))}
      </div>
    </div>
  );
}

function sectionFileName(scene: Scene) {
  const clean = (scene.label.trim() || `scene-${String(scene.position).padStart(2, '0')}`).replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(0, 40);
  return `${String(scene.position).padStart(2, '0')}-${clean || 'scene'}.mp4`;
}

function sceneDownload(projectId: string, scene: Scene) {
  const name = sectionFileName(scene);
  if (scene.takePath?.startsWith('long-videos/')) return { href: `/api/v1/long-videos/${projectId}/scenes/${scene.id}/video?download=1`, name };
  const jobId = scene.shownJobId ?? (scene.status === 'READY' ? scene.jobId : null);
  return jobId ? { href: `/api/v1/comfy/jobs/${jobId}/video?download=1`, name } : null;
}

function scenePreview(projectId: string, scene: Scene, prior: boolean) {
  if (prior) {
    if (scene.priorTakePath?.startsWith('long-videos/')) return `/api/v1/long-videos/${projectId}/scenes/${scene.id}/video?take=prior`;
    if (scene.priorJobId) return `/api/v1/comfy/jobs/${scene.priorJobId}/video`;
    return null;
  }
  if (scene.takePath?.startsWith('long-videos/')) return `/api/v1/long-videos/${projectId}/scenes/${scene.id}/video`;
  const jobId = scene.shownJobId ?? (scene.status === 'READY' ? scene.jobId : null);
  return jobId ? `/api/v1/comfy/jobs/${jobId}/video` : null;
}

function sceneSeconds(scene: Scene) {
  return ((scene.endMs - scene.startMs) / 1000).toFixed(1);
}

type SceneDraft = { label: string; prompt: string; seconds: string; mode: 'vocal' | 'broll'; continuity: 'shot' | 'context' };

function sceneDraftKey(id: string) {
  return `cos-long-scene:${id}`;
}

function readSceneDraft(id: string): SceneDraft | null {
  try {
    const raw = sessionStorage.getItem(sceneDraftKey(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<SceneDraft>;
    if (typeof d.label !== 'string' || typeof d.prompt !== 'string' || typeof d.seconds !== 'string') return null;
    return {
      label: d.label,
      prompt: d.prompt,
      seconds: d.seconds,
      mode: d.mode === 'broll' ? 'broll' : 'vocal',
      continuity: d.continuity === 'context' ? 'context' : 'shot',
    };
  } catch {
    return null;
  }
}

function sceneText(d: { label: string; prompt: string; mode: string; continuity: string; first: boolean; serverLabel: string; serverPrompt: string; serverMode: string; serverContinuity: string }) {
  const text: { label?: string; prompt?: string; mode?: 'vocal' | 'broll'; continuity?: 'shot' | 'context' } = {};
  if (d.label !== d.serverLabel) text.label = d.label;
  if (d.prompt !== d.serverPrompt) text.prompt = d.prompt;
  if (d.mode !== d.serverMode && (d.mode === 'vocal' || d.mode === 'broll')) text.mode = d.mode;
  if (!d.first && d.continuity !== d.serverContinuity && (d.continuity === 'shot' || d.continuity === 'context')) text.continuity = d.continuity;
  return text;
}

function sceneSave(d: { label: string; prompt: string; seconds: string; mode: string; continuity: string; first: boolean; status: string; serverLabel: string; serverPrompt: string; serverMode: string; serverContinuity: string; serverSeconds: string }, timing: boolean) {
  const text = sceneText(d);
  if (text.label != null && text.label.length > 160) return { error: 'The section name can be 160 characters.' };
  const sec = Number(d.seconds);
  const current = Number(d.serverSeconds);
  const duration = !timing && d.status !== 'QUEUED' && d.status !== 'RUNNING' && Number.isFinite(sec) && Math.abs(sec - current) >= 0.05;
  if (duration && (sec < 1 || sec > 120)) return { error: 'A section can be from 1 to 120 seconds.' };
  return { text, duration: duration ? sec : null };
}

function fieldError(e: unknown) {
  if (!(e instanceof ApiError)) return 'That did not save.';
  const issue = Array.isArray(e.details) ? (e.details[0] as { path?: string; message?: string } | undefined) : undefined;
  if (issue?.message) return issue.path ? `${issue.path}: ${issue.message}` : issue.message;
  return e.message;
}

let planEpochLive = 0;

function flushScene(projectId: string, sceneId: string) {
  const live = sceneLive.get(sceneId);
  if (!live || live.epoch !== planEpochLive) return;
  const plan = sceneSave(live, false);
  if ('error' in plan) return;
  if (Object.keys(plan.text).length) void patch(`/long-videos/${projectId}/scenes/${sceneId}`, plan.text, { keepalive: true }).catch(() => undefined);
  if (plan.duration != null) void patch(`/long-videos/${projectId}/scenes/${sceneId}`, { durationSec: plan.duration }, { keepalive: true }).catch(() => undefined);
}

const sceneLive = new Map<string, { epoch: number; label: string; prompt: string; seconds: string; mode: string; continuity: string; first: boolean; status: string; serverLabel: string; serverPrompt: string; serverMode: string; serverContinuity: string; serverSeconds: string }>();

function shownAspect(value: string) {
  return h3AspectRatio(value) ?? '16:9 (Widescreen)';
}

function SceneCard({
  projectId,
  planEpoch,
  scene,
  projectTitle,
  workers,
  projectWorkerId,
  active,
  first,
  last,
  portrait,
  canPlay,
  own,
  shared,
  onPlay,
  onStop,
  onError,
  run,
}: {
  projectId: string;
  planEpoch: number;
  scene: Scene;
  projectTitle: string;
  workers: Worker[];
  projectWorkerId: string | null;
  active: boolean;
  first: boolean;
  last: boolean;
  portrait: boolean;
  canPlay: boolean;
  own: RefImage[];
  shared: RefImage[];
  onPlay: (offsetSec?: number) => void;
  onStop: () => void;
  onError: (message: string | null) => void;
  run: (work: Promise<unknown>) => void;
}) {
  const [label, setLabel] = useState(scene.label.trim() ? scene.label : clipTitle(scene.position));
  const [prompt, setPrompt] = useState(scene.prompt);
  const [seconds, setSeconds] = useState(sceneSeconds(scene));
  const [mode, setMode] = useState(scene.mode === 'broll' ? 'broll' : 'vocal');
  const [continuity, setContinuity] = useState(scene.continuity === 'context' ? 'context' : 'shot');
  const [showPrior, setShowPrior] = useState(false);
  const [timing, setTiming] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const saved = useRef({ label: scene.label, prompt: scene.prompt, mode: scene.mode, continuity: scene.continuity });
  const live = useRef({ epoch: planEpoch, label, prompt, seconds, mode, continuity, first, status: scene.status, serverLabel: scene.label, serverPrompt: scene.prompt, serverMode: scene.mode, serverContinuity: scene.continuity, serverSeconds: sceneSeconds(scene) });
  live.current = { epoch: planEpoch, label, prompt, seconds, mode, continuity, first, status: scene.status, serverLabel: scene.label, serverPrompt: scene.prompt, serverMode: scene.mode, serverContinuity: scene.continuity, serverSeconds: sceneSeconds(scene) };
  sceneLive.set(scene.id, live.current);
  useEffect(() => {
    const draft = readSceneDraft(scene.id);
    if (draft) {
      setLabel(draft.label);
      setPrompt(draft.prompt);
      setSeconds(draft.seconds);
      setMode(draft.mode);
      setContinuity(first ? 'shot' : draft.continuity);
    }
    setHydrated(true);
  }, [scene.id, first]);
  useEffect(() => {
    if (label === saved.current.label && scene.label !== saved.current.label) setLabel(scene.label);
    saved.current.label = scene.label;
  }, [scene.label, label]);
  useEffect(() => {
    if (prompt === saved.current.prompt && scene.prompt !== saved.current.prompt) setPrompt(scene.prompt);
    saved.current.prompt = scene.prompt;
  }, [scene.prompt, prompt]);
  useEffect(() => {
    if (mode === saved.current.mode && scene.mode !== saved.current.mode) setMode(scene.mode === 'broll' ? 'broll' : 'vocal');
    saved.current.mode = scene.mode;
  }, [scene.mode, mode]);
  useEffect(() => {
    if (continuity === saved.current.continuity && scene.continuity !== saved.current.continuity) setContinuity(scene.continuity === 'context' ? 'context' : 'shot');
    saved.current.continuity = scene.continuity;
  }, [scene.continuity, continuity]);
  useEffect(() => {
    if (timing) return;
    if (seconds !== sceneSeconds(scene) && sessionStorage.getItem(sceneDraftKey(scene.id))) return;
    setSeconds(sceneSeconds(scene));
  }, [scene.startMs, scene.endMs, timing, seconds, scene.id]);
  useEffect(() => {
    if (!hydrated) return;
    const dirty = label !== scene.label || prompt !== scene.prompt || mode !== scene.mode || continuity !== scene.continuity || seconds !== sceneSeconds(scene);
    if (!dirty) sessionStorage.removeItem(sceneDraftKey(scene.id));
    else sessionStorage.setItem(sceneDraftKey(scene.id), JSON.stringify({ label, prompt, seconds, mode, continuity: first ? 'shot' : continuity }));
  }, [hydrated, label, prompt, seconds, mode, continuity, first, scene]);
  useEffect(() => {
    if (!hydrated || !active) return;
    const timer = window.setTimeout(() => {
      if (live.current.epoch !== planEpochLive) return;
      const plan = sceneSave(live.current, timing);
      if ('error' in plan) {
        onError(plan.error ?? 'That did not save.');
        return;
      }
      if (!Object.keys(plan.text).length && plan.duration == null) return;
      const done = () => refresh(`/long-videos/${projectId}`);
      const fail = (e: unknown) => onError(fieldError(e));
      onError(null);
      if (Object.keys(plan.text).length) {
        patch(`/long-videos/${projectId}/scenes/${scene.id}`, plan.text).then(done).catch(fail);
      }
      if (plan.duration != null) {
        patch(`/long-videos/${projectId}/scenes/${scene.id}`, { durationSec: plan.duration }).then(done).catch(fail);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [active, hydrated, timing, label, prompt, seconds, mode, continuity, projectId, scene.id, scene.label, scene.prompt, scene.mode, scene.continuity, scene.startMs, scene.endMs, scene.status, onError]);
  useEffect(() => {
    const id = scene.id;
    const hide = () => flushScene(projectId, id);
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('pagehide', hide);
      flushScene(projectId, id);
    };
  }, [projectId, scene.id]);
  const applyLength = () => {
    setTiming(false);
    const next = Number(seconds);
    const current = (scene.endMs - scene.startMs) / 1000;
    if (!Number.isFinite(next) || Math.abs(next - current) < 0.05) return;
    run(patch(`/long-videos/${projectId}/scenes/${scene.id}`, { durationSec: next }));
  };
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">Scene {String(scene.position).padStart(2, '0')}</div>
        <span className="text-xs text-muted">{scene.status}{scene.outdated ? ' · old take' : ''}</span>
      </div>
      <div className="mt-1 text-sm text-muted">{clock(scene.startMs)}–{clock(scene.endMs)} · {((scene.endMs - scene.startMs) / 1000).toFixed(1)}s</div>
      <Input className="mt-2" aria-label="Clip title" placeholder={clipTitle(scene.position)} value={label} onChange={(e) => setLabel(e.target.value)} />
      <Field label="PC">
        <Select
          value={scene.workerId ?? projectWorkerId ?? ''}
          onChange={(e) => {
            const value = e.target.value;
            run(patch(`/long-videos/${projectId}/scenes/${scene.id}`, { workerId: value && value !== (projectWorkerId ?? '') ? value : null }));
          }}
        >
          {projectWorkerId ? null : <option value="">Choose a PC</option>}
          {workers.map((worker) => (
            <option key={worker.id} value={worker.id}>{worker.label}</option>
          ))}
        </Select>
      </Field>
      {scenePreview(projectId, scene, showPrior) ? (
        <video
          key={scenePreview(projectId, scene, showPrior)}
          className={`mt-2 w-full rounded-lg bg-black ${portrait ? 'mx-auto aspect-[9/16] max-h-72' : 'aspect-video'}`}
          src={scenePreview(projectId, scene, showPrior) ?? undefined}
          controls
          playsInline
          muted
          onPlay={(event) => onPlay(event.currentTarget.currentTime)}
          onPause={(event) => {
            const video = event.currentTarget;
            const limit = (scene.endMs - scene.startMs) / 1000;
            if (video.currentTime < limit - 0.2 && !video.ended) onStop();
          }}
          onTimeUpdate={(event) => {
            const limit = (scene.endMs - scene.startMs) / 1000;
            if (event.currentTarget.currentTime >= limit - 0.05) event.currentTarget.pause();
          }}
        />
      ) : (
        <div className={`mt-2 flex items-center justify-center rounded-lg bg-black/5 text-xs text-muted ${portrait ? 'mx-auto aspect-[9/16] max-h-72' : 'aspect-video'}`}>
          {scene.status === 'QUEUED' || scene.status === 'RUNNING' ? 'Generating' : 'Preview'}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <Button variant={mode === 'vocal' ? 'primary' : 'ghost'} onClick={() => { setMode('vocal'); run(patch(`/long-videos/${projectId}/scenes/${scene.id}`, { mode: 'vocal' })); }}>Vocal</Button>
        <Button variant={mode === 'broll' ? 'primary' : 'ghost'} onClick={() => { setMode('broll'); run(patch(`/long-videos/${projectId}/scenes/${scene.id}`, { mode: 'broll' })); }}>B-roll</Button>
        <Button variant="ghost" onClick={() => onPlay()} disabled={!canPlay}>Play</Button>
      </div>
      <details className="mt-2 rounded-md border border-border px-2 py-1">
        <summary className="cursor-pointer text-sm">Details</summary>
        <div className="mt-2 space-y-2 pb-1">
          <div>
            <div className="text-xs text-muted">Song</div>
            <p className="whitespace-pre-wrap text-sm">{scene.songNotes?.trim() ? scene.songNotes : 'No song lines in the plan.'}</p>
          </div>
          <div>
            <div className="text-xs text-muted">Pictures</div>
            <p className="whitespace-pre-wrap text-sm">{scene.imageNotes?.trim() ? scene.imageNotes : 'No picture order in the plan.'}</p>
          </div>
        </div>
      </details>
      <textarea
        className="mt-2 min-h-20 w-full rounded-md border bg-transparent p-2 text-sm"
        placeholder={mode === 'vocal' ? 'How this person sings in this moment' : 'What the camera sees'}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <AiPromptTools
        targetType="long_scene"
        targetId={scene.id}
        mode={mode === 'broll' ? 'broll' : 'vocal'}
        currentPrompt={prompt}
        context={{ projectTitle, sceneNumber: scene.position, timeRange: `${clock(scene.startMs)}–${clock(scene.endMs)}`, idea: prompt, currentPrompt: prompt }}
        onApply={(text) => setPrompt(text)}
      />
      <AiImageTools projectId={projectId} sceneId={scene.id} prompt={prompt} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={continuity === 'context' ? 'primary' : 'ghost'}
          disabled={first}
          title={first ? 'The first scene is always a new shot.' : 'Render this scene in the same MiniMax job as the one before it.'}
          onClick={() => {
            const next = continuity === 'context' ? 'shot' : 'context';
            setContinuity(next);
            run(patch(`/long-videos/${projectId}/scenes/${scene.id}`, { continuity: next }));
          }}
        >
          Context
        </Button>
        {scene.priorJobId || scene.priorTakePath ? (
          <Button size="sm" variant="ghost" onClick={() => setShowPrior((value) => !value)}>{showPrior ? 'Current take' : 'Previous take'}</Button>
        ) : null}
        {scene.status === 'QUEUED' || scene.status === 'RUNNING' ? <span className="text-xs text-muted">A new take is rendering.</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-start gap-1.5">
        <RefRow projectId={projectId} refs={scene.imageOrder?.length ? orderByPlanName([...own, ...shared], scene.imageOrder) : [...own, ...shared].sort(pictureOrder)} />
        <FileButton label="Add" accept="image/*" onFile={(file) => uploadRef(projectId, scene.id, file, onError)} />
        <LibraryPick kind="IMAGE" onPick={(file) => run(post(`/long-videos/${projectId}/library`, { fileId: file.id, sceneId: scene.id }))} />
      </div>
      {scene.error ? <p className="mt-2 text-sm text-red-500">{scene.error}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => run(post(`/long-videos/${projectId}/scenes/${scene.id}/generate`))} disabled={scene.status === 'QUEUED' || scene.status === 'RUNNING'}>
          {scene.takePath ? 'Regenerate' : 'Generate'}
        </Button>
        {scene.status === 'QUEUED' || scene.status === 'RUNNING' ? (
          <Button
            variant="ghost"
            onClick={() => {
              if (!window.confirm('Stop this render? Sections sent in the same MiniMax job stop with it. A finished video stays.')) return;
              run(post(`/long-videos/${projectId}/scenes/${scene.id}/cancel`));
            }}
          >
            Stop
          </Button>
        ) : null}
        <label className="flex items-center gap-1 text-xs text-muted">
          Seconds
          <input
            className="w-16 rounded-md border bg-transparent px-2 py-1 text-sm"
            inputMode="decimal"
            value={seconds}
            aria-label="Scene length in seconds"
            onFocus={() => setTiming(true)}
            onChange={(e) => setSeconds(e.target.value)}
            onBlur={applyLength}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
        {sceneDownload(projectId, scene) ? <FileDownload href={sceneDownload(projectId, scene)!.href} name={sceneDownload(projectId, scene)!.name} label="Download" /> : null}
        <Button variant="ghost" onClick={() => run(post(`/long-videos/${projectId}/scenes/${scene.id}/split`))}>Split</Button>
        <Button variant="ghost" onClick={() => run(del(`/long-videos/${projectId}/scenes/${scene.id}`))}>Remove</Button>
      </div>
      <p className="mt-1 text-[11px] text-muted">{last ? 'The last scene takes extra time from the one before it.' : 'A shorter length gives the spare seconds to the next scene.'}</p>
    </Card>
  );
}

function LibraryPick({ kind, onPick }: { kind: 'AUDIO' | 'IMAGE'; onPick: (file: { id: string; fileName: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const list = useApi<{ items: { id: string; fileName: string }[] }>(open ? '/library' : null, {
    query: { kind, q: q.trim() || undefined, limit: 20 },
  });
  return (
    <div>
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen((value) => !value)}>Library</Button>
      {open ? (
        <div className="mt-1 w-64 max-w-full rounded-lg border border-border bg-panel p-2">
          <Input value={q} placeholder={kind === 'AUDIO' ? 'Search songs' : 'Search images'} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-1 max-h-40 overflow-auto">
            {(list.data?.items ?? []).map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  className="w-full truncate px-1 py-1 text-left text-sm hover:bg-panel2"
                  onClick={() => {
                    onPick(file);
                    setOpen(false);
                  }}
                >
                  {file.fileName}
                </button>
              </li>
            ))}
          </ul>
          {list.data && list.data.items.length === 0 ? <p className="px-1 py-1 text-xs text-muted">Nothing matched.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function FileButton({ label, accept, onFile }: { label: string; accept: string; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button size="sm" type="button" onClick={() => input.current?.click()}>{label}</Button>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept={accept}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}

function pictureOrder(a: RefImage, b: RefImage) {
  return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
}

function RefRow({ projectId, refs }: { projectId: string; refs: RefImage[] }) {
  if (!refs.length) return null;
  return (
    <>
      {refs.map((ref) => {
        const shared = ref.sceneId == null;
        return (
        <span key={ref.id} className="relative inline-flex">
          <img
            src={`/api/v1/long-videos/${projectId}/refs/${ref.id}`}
            alt={ref.name}
            title={shared ? `Shared · ${ref.name}` : ref.name}
            className={`size-12 rounded-md object-cover ${shared ? 'ring-2 ring-border' : 'ring-2 ring-accent'}`}
          />
          <button
            type="button"
            className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border border-border bg-panel text-xs"
            aria-label={`Remove ${ref.name}`}
            onClick={() => {
              const message = shared ? `Remove the shared picture ${ref.name}? Scenes that use it will no longer have it.` : `Remove ${ref.name}?`;
              if (!window.confirm(message)) return;
              del(`/long-videos/${projectId}/refs/${ref.id}`).then(() => refresh(`/long-videos/${projectId}`)).catch(() => undefined);
            }}
          >
            ×
          </button>
        </span>
        );
      })}
    </>
  );
}

function PlanImport({
  projectId,
  hasSong,
  sceneIds,
  onBegin,
  onAbort,
  onMessage,
  onError,
}: {
  projectId: string;
  hasSong: boolean;
  sceneIds: string[];
  onBegin: () => void;
  onAbort: () => void;
  onMessage: (message: string) => void;
  onError: (message: string | null) => void;
}) {
  const jsonInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const apply = () => {
    if (!hasSong) {
      onError('Upload the song before applying a clip plan.');
      return;
    }
    if (!planFile) {
      onError('Choose the clip JSON file.');
      return;
    }
    if (!window.confirm('Apply this clip plan? It replaces the sections and pictures on this long video. A video already rendered stays on a section that is still in the plan.')) return;
    setBusy(true);
    onError(null);
    onBegin();
    applyClipPlan(projectId, planFile, images)
      .then(async (message) => {
        for (const sceneId of sceneIds) sessionStorage.removeItem(sceneDraftKey(sceneId));
        await refresh(`/long-videos/${projectId}`);
        onMessage(message);
      })
      .catch((err: unknown) => {
        onAbort();
        onError(err instanceof ApiError ? err.message : 'That plan did not apply.');
      })
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Button size="sm" type="button" disabled={busy} onClick={() => jsonInput.current?.click()}>Clip plan</Button>
      <input
        ref={jsonInput}
        className="sr-only"
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          setPlanFile(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      <Button size="sm" type="button" disabled={busy} onClick={() => imageInput.current?.click()}>Pictures</Button>
      <input
        ref={imageInput}
        className="sr-only"
        type="file"
        accept="image/*,.png,.jpg,.jpeg,.webp"
        multiple
        onChange={(e) => {
          setImages([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <Button size="sm" type="button" disabled={busy} onClick={apply}>{busy ? 'Applying' : 'Apply plan'}</Button>
      <span className="text-xs text-muted">{planFile ? planFile.name : 'No JSON'} · {images.length ? `${images.length} pictures` : 'no pictures yet'}</span>
      <p className="w-full text-xs text-muted">JSON list of clips: clip_name, images_attached, clip_duration (seconds), vocal (yes or no), prompt, song_details, image_details. Picture file names must match images_attached. A picture named on every clip is shared. Quotes and line breaks in a prompt use normal JSON escaping and are kept as written.</p>
    </div>
  );
}

function uploadAudio(projectId: string, file: File, setError: (m: string | null) => void) {
  const body = new FormData();
  body.append('file', file);
  setError(null);
  fetch(`/api/v1/long-videos/${projectId}/audio`, { method: 'POST', credentials: 'same-origin', headers: { 'x-requested-with': 'creatoros' }, body })
    .then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, 'ERROR', (await res.json()).error?.message ?? 'Upload failed');
      refresh(`/long-videos/${projectId}`);
    })
    .catch((err: ApiError) => setError(err.message));
}

function uploadRef(projectId: string, sceneId: string | null, file: File | undefined, setError: (m: string | null) => void) {
  if (!file) return;
  const body = new FormData();
  body.append('file', file);
  const query = sceneId ? `?sceneId=${sceneId}` : '';
  setError(null);
  fetch(`/api/v1/long-videos/${projectId}/refs${query}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-requested-with': 'creatoros' },
    body,
  })
    .then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, 'ERROR', (await res.json()).error?.message ?? 'Upload failed');
      refresh(`/long-videos/${projectId}`);
    })
    .catch((err: ApiError) => setError(err.message));
}
