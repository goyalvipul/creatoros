'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, del, patch, post, refresh, useApi } from '@/lib/api';
import { Button, Card, CardTitle, EmptyState, Field, Input, Notice, Select } from '@/components/ui';

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
  prompt: string;
  status: string;
  jobId: string | null;
  shownJobId: string | null;
  priorJobId: string | null;
  takePath: string | null;
  priorTakePath: string | null;
  outdated: boolean;
  error: string | null;
};
type RefImage = { id: string; sceneId: string | null; name: string };
type Detail = { project: Project; scenes: Scene[]; refs: RefImage[]; workers: Worker[] };
type Worker = { id: string; label: string; enabled: boolean };

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function LongVideos() {
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
  if (openId) return <Editor id={openId} onBack={() => choose(null)} />;
  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardTitle>New long video</CardTitle>
        <p className="mt-1 text-sm text-muted">Upload a song, split it into scenes, then generate each scene with the MiniMax PC you already use.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_240px_auto]">
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
          <div className="flex items-end">
            <Button
              onClick={() => {
                setError(null);
                post<Project>('/long-videos', { title, aspect })
                  .then((row) => {
                    refresh('/long-videos');
                    choose(row.id);
                  })
                  .catch((e: ApiError) => setError(e.message));
              }}
            >
              Create project
            </Button>
          </div>
        </div>
        {error ? <Notice tone="bad">{error}</Notice> : null}
      </Card>
      {list.data?.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {list.data.map((project) => (
            <button key={project.id} type="button" className="text-left" onClick={() => choose(project.id)}>
              <Card>
                <div className="font-medium">{project.title}</div>
                <div className="mt-1 text-sm text-muted">
                  {project.aspect} · {project.durationMs ? clock(project.durationMs) : 'No song yet'} · {project.status}
                  {project.batchState === 'run' ? ' · generating' : ''}
                </div>
              </Card>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState title="No long videos yet">Create a project and upload the song. The MiniMax form on the other tab is left alone.</EmptyState>
      )}
    </div>
  );
}

function Editor({ id, onBack }: { id: string; onBack: () => void }) {
  const detail = useApi<Detail>(`/long-videos/${id}`, { refreshInterval: 4000 });
  const audio = useRef<HTMLAudioElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const project = detail.data?.project;
  const scenes = detail.data?.scenes ?? [];
  const refs = detail.data?.refs ?? [];
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
  const playScene = (scene: Scene) => {
    const node = audio.current;
    if (!node || !project?.durationMs) return;
    node.currentTime = scene.startMs / 1000;
    void node.play();
    setPlaying(scene.id);
  };
  if (!project) return <div className="p-4 text-sm text-muted">Loading the project…</div>;
  const ready = scenes.filter((s) => s.status === 'READY').length;
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <h2 className="text-lg font-semibold">{project.title}</h2>
        <span className="text-sm text-muted">{ready}/{scenes.length || 0} scenes ready</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => act(post(`/long-videos/${id}/batch`, { state: 'pause' }))}>Pause</Button>
          <Button onClick={() => act(post(`/long-videos/${id}/batch`, { state: 'run' }))}>Generate all</Button>
          <Button variant="ghost" onClick={() => act(post(`/long-videos/${id}/export`))}>Export MP4</Button>
        </div>
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {project.exportError ? <Notice tone="bad">{project.exportError}</Notice> : null}
      {project.exportStatus === 'READY' ? (
        <a className="text-sm underline" href={`/api/v1/long-videos/${id}/export`}>Download the finished video</a>
      ) : project.exportStatus === 'QUEUED' ? (
        <p className="text-sm text-muted">The export is waiting for the worker.</p>
      ) : null}
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
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FileButton label={project.audioName ? 'Replace song' : 'Upload song'} accept="audio/*,.mp3,.wav,.m4a,.flac" onFile={(file) => uploadAudio(id, file, setError)} />
          <LibraryPick kind="AUDIO" onPick={(file) => act(post(`/long-videos/${id}/library`, { fileId: file.id }))} />
          {project.audioName ? <span className="text-sm text-muted">{project.audioName} · {clock(project.durationMs ?? 0)}</span> : null}
          <Button size="sm" variant="ghost" onClick={() => act(post(`/long-videos/${id}/rebalance`))}>Rebuild 10s scenes</Button>
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
        {project.durationMs ? <audio ref={audio} src={`/api/v1/long-videos/${id}/audio`} preload="auto" /> : null}
      </Card>
      <div className="grid gap-3 lg:grid-cols-3">
        {scenes.map((scene, index) => (
          <SceneCard
            key={scene.id}
            projectId={id}
            scene={scene}
            first={index === 0}
            last={index === scenes.length - 1}
            portrait={shownAspect(project.aspect).startsWith('9:16')}
            canPlay={!!project.durationMs}
            own={refs.filter((r) => r.sceneId === scene.id)}
            shared={refs.filter((r) => r.sceneId == null)}
            onPlay={() => playScene(scene)}
            onError={setError}
            run={(work) => act(work)}
          />
        ))}
      </div>
    </div>
  );
}

const H3_ASPECTS = [
  '9:16 (Portrait Widescreen)',
  '16:9 (Widescreen)',
  '1:1 (Square)',
  '2:3 (Portrait Photo)',
  '3:2 (Photo)',
  '3:4 (Portrait Standard)',
  '4:3 (Standard)',
  '21:9 (Ultrawide)',
];

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

function flushScene(projectId: string, sceneId: string) {
  const live = sceneLive.get(sceneId);
  if (!live) return;
  const text = sceneText(live);
  const sec = Number(live.seconds);
  const current = Number(live.serverSeconds);
  const duration = live.status !== 'QUEUED' && live.status !== 'RUNNING' && Number.isFinite(sec) && Math.abs(sec - current) >= 0.05;
  if (Object.keys(text).length) void patch(`/long-videos/${projectId}/scenes/${sceneId}`, text, { keepalive: true }).catch(() => undefined);
  if (duration) void patch(`/long-videos/${projectId}/scenes/${sceneId}`, { durationSec: sec }, { keepalive: true }).catch(() => undefined);
}

const sceneLive = new Map<string, { label: string; prompt: string; seconds: string; mode: string; continuity: string; first: boolean; status: string; serverLabel: string; serverPrompt: string; serverMode: string; serverContinuity: string; serverSeconds: string }>();

function shownAspect(value: string) {
  if (value === '9:16' || value.startsWith('9:16')) return '9:16 (Portrait Widescreen)';
  if (value === '16:9' || value.includes('16:9')) return '16:9 (Widescreen)';
  return H3_ASPECTS.includes(value) ? value : '16:9 (Widescreen)';
}

function SceneCard({
  projectId,
  scene,
  first,
  last,
  portrait,
  canPlay,
  own,
  shared,
  onPlay,
  onError,
  run,
}: {
  projectId: string;
  scene: Scene;
  first: boolean;
  last: boolean;
  portrait: boolean;
  canPlay: boolean;
  own: RefImage[];
  shared: RefImage[];
  onPlay: () => void;
  onError: (message: string | null) => void;
  run: (work: Promise<unknown>) => void;
}) {
  const [label, setLabel] = useState(scene.label);
  const [prompt, setPrompt] = useState(scene.prompt);
  const [seconds, setSeconds] = useState(sceneSeconds(scene));
  const [mode, setMode] = useState(scene.mode === 'broll' ? 'broll' : 'vocal');
  const [continuity, setContinuity] = useState(scene.continuity === 'context' ? 'context' : 'shot');
  const [showPrior, setShowPrior] = useState(false);
  const [timing, setTiming] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const saved = useRef({ label: scene.label, prompt: scene.prompt, mode: scene.mode, continuity: scene.continuity });
  const live = useRef({ label, prompt, seconds, mode, continuity, first, status: scene.status, serverLabel: scene.label, serverPrompt: scene.prompt, serverMode: scene.mode, serverContinuity: scene.continuity, serverSeconds: sceneSeconds(scene) });
  live.current = { label, prompt, seconds, mode, continuity, first, status: scene.status, serverLabel: scene.label, serverPrompt: scene.prompt, serverMode: scene.mode, serverContinuity: scene.continuity, serverSeconds: sceneSeconds(scene) };
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
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const d = live.current;
      const text = sceneText(d);
      const sec = Number(d.seconds);
      const current = Number(d.serverSeconds);
      const duration = !timing && d.status !== 'QUEUED' && d.status !== 'RUNNING' && Number.isFinite(sec) && Math.abs(sec - current) >= 0.05;
      const done = () => refresh(`/long-videos/${projectId}`);
      if (Object.keys(text).length) {
        patch(`/long-videos/${projectId}/scenes/${scene.id}`, text).then(done).catch((e: ApiError) => onError(e.message));
      }
      if (duration) {
        patch(`/long-videos/${projectId}/scenes/${scene.id}`, { durationSec: sec }).then(done).catch((e: ApiError) => onError(e.message));
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [hydrated, timing, label, prompt, seconds, mode, continuity, projectId, scene.id, scene.label, scene.prompt, scene.mode, scene.continuity, scene.startMs, scene.endMs, scene.status, onError]);
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
      <Input className="mt-2" placeholder="Section, such as Chorus 1" value={label} onChange={(e) => setLabel(e.target.value)} />
      {scenePreview(projectId, scene, showPrior) ? (
        <video key={scenePreview(projectId, scene, showPrior)} className={`mt-2 w-full rounded-lg bg-black ${portrait ? 'mx-auto aspect-[9/16] max-h-72' : 'aspect-video'}`} src={scenePreview(projectId, scene, showPrior) ?? undefined} controls playsInline />
      ) : (
        <div className={`mt-2 flex items-center justify-center rounded-lg bg-black/5 text-xs text-muted ${portrait ? 'mx-auto aspect-[9/16] max-h-72' : 'aspect-video'}`}>
          {scene.status === 'QUEUED' || scene.status === 'RUNNING' ? 'Generating' : 'Preview'}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <Button variant={mode === 'vocal' ? 'primary' : 'ghost'} onClick={() => { setMode('vocal'); run(patch(`/long-videos/${projectId}/scenes/${scene.id}`, { mode: 'vocal' })); }}>Vocal</Button>
        <Button variant={mode === 'broll' ? 'primary' : 'ghost'} onClick={() => { setMode('broll'); run(patch(`/long-videos/${projectId}/scenes/${scene.id}`, { mode: 'broll' })); }}>B-roll</Button>
        <Button variant="ghost" onClick={onPlay} disabled={!canPlay}>Play</Button>
      </div>
      <textarea
        className="mt-2 min-h-20 w-full rounded-md border bg-transparent p-2 text-sm"
        placeholder={mode === 'vocal' ? 'How this person sings in this moment' : 'What the camera sees'}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
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
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <RefRow projectId={projectId} refs={own} />
        <RefRow projectId={projectId} refs={shared} shared />
        <FileButton label="Add" accept="image/*" onFile={(file) => uploadRef(projectId, scene.id, file, onError)} />
        <LibraryPick kind="IMAGE" onPick={(file) => run(post(`/long-videos/${projectId}/library`, { fileId: file.id, sceneId: scene.id }))} />
      </div>
      {scene.error ? <p className="mt-2 text-sm text-red-500">{scene.error}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => run(post(`/long-videos/${projectId}/scenes/${scene.id}/generate`))} disabled={scene.status === 'QUEUED' || scene.status === 'RUNNING'}>
          {scene.takePath ? 'Regenerate' : 'Generate'}
        </Button>
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
    <div className="relative">
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen((value) => !value)}>Library</Button>
      {open ? (
        <div className="absolute z-20 mt-1 w-64 rounded-lg border border-border bg-panel p-2 shadow-lg">
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

function RefRow({ projectId, refs, shared }: { projectId: string; refs: RefImage[]; shared?: boolean }) {
  if (!refs.length) return null;
  return (
    <>
      {refs.map((ref) => (
        <img
          key={ref.id}
          src={`/api/v1/long-videos/${projectId}/refs/${ref.id}`}
          alt={ref.name}
          title={shared ? `Shared · ${ref.name}` : ref.name}
          className={`size-8 rounded-full object-cover ${shared ? 'ring-2 ring-border' : 'ring-2 ring-accent'}`}
        />
      ))}
    </>
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
