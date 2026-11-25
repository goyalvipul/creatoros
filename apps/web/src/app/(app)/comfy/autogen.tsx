'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { ApiError, post, refresh, useApi } from '@/lib/api';
import { Badge, Button, Card, CardTitle, EmptyState, Field, Textarea } from '@/components/ui';

type Clip = {
  id: string;
  ordinal: number;
  startSec: number;
  durationSec: number | null;
  status: string;
  attempt: number;
  workerLabel: string | null;
  promptId: string | null;
  error: string | null;
};

type Run = {
  id: string;
  title: string;
  prompt: string;
  status: string;
  projectId: string | null;
  audioLengthSec: number | null;
  createdAt: string;
  clips: Clip[];
};

type Board = {
  workers: { id: string; label: string; enabled: boolean }[];
  runs: Run[];
};

const AUTOGEN_PROMPT = `mehaklora OHWXPERSON young woman vocalist singing passionately into a large condenser microphone, viking tattoos on the face, strictly maintain the character consistency, heavy girl voice, mouth open and moving with the music, jaw and lip sync precise and realistic, head moving slightly with the rhythm, eyes expressive and alive, professional recording studio background, warm stage lighting, smooth natural motion, static locked camera, sharp focus on face and lips throughout. The person is singing, and she says: "Tsamina mina, eh, eh
Waka waka, eh, eh
Tsamina mina zangalewa
This time for Africa
Listen to your God, this is our motto
Your time to shine, don't wait in line, y vamos por todo
People are raising their expectations
Go on and feed them, this is your moment, no hesitation"`;

function clipLabel(clip: Clip) {
  if (clip.status === 'READY') return 'Ready';
  if (clip.status === 'FAILED') return 'Failed';
  if (clip.status === 'CANCELLED') return 'Cancelled';
  if (clip.status === 'RUNNING' || clip.status === 'CLAIMED') return 'Running';
  if (clip.attempt > 0) return 'Waiting for the other PC';
  return 'Waiting';
}

function clipTone(clip: Clip): 'ok' | 'bad' | 'neutral' | 'info' {
  if (clip.status === 'READY') return 'ok';
  if (clip.status === 'FAILED') return 'bad';
  if (clip.status === 'CANCELLED') return 'neutral';
  if (clip.status === 'RUNNING' || clip.status === 'CLAIMED') return 'info';
  return 'neutral';
}

export function AutoGen({ active }: { active: boolean }) {
  const board = useApi<Board>(active ? '/comfy/autogen' : null);
  const [song, setSong] = useState<{ id: string | null; name: string; uploadName: string | null; workerId: string | null; seconds: number | null }>({
    id: null, name: '', uploadName: null, workerId: null, seconds: null,
  });
  const [image, setImage] = useState<{ id: string | null; name: string; uploadName: string | null; workerId: string | null }>({
    id: null, name: '', uploadName: null, workerId: null,
  });
  const [timestamps, setTimestamps] = useState('0, 30, 60');
  const [prompt, setPrompt] = useState(AUTOGEN_PROMPT);
  const [busy, setBusy] = useState<'song' | 'image' | 'run' | null>(null);
  const [error, setError] = useState('');
  const [cancelBusy, setCancelBusy] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState('');
  const running = (board.data?.runs ?? []).some((run) => run.status === 'RUNNING' || run.clips.some((clip) => clip.status === 'WAITING' || clip.status === 'RUNNING' || clip.status === 'CLAIMED'));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh('/comfy/autogen'), running ? 5000 : 15000);
    return () => clearInterval(timer);
  }, [active, running]);

  async function cancelClip(clip: Clip) {
    const queued = clip.status === 'WAITING';
    if (!window.confirm(queued
      ? `Cancel queued AutoGen clip starting at ${clip.startSec}s? It will not be dispatched to a GPU.`
      : `Stop the AutoGen clip starting at ${clip.startSec}s on ${clip.workerLabel ?? 'its assigned GPU'}? Only this clip is targeted.`)) return;
    setCancelBusy(clip.id);
    setCancelError('');
    try {
      await post(`/comfy/autogen/clips/${clip.id}/cancel`, {});
      await refresh('/comfy/autogen');
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'The clip could not be stopped.');
    } finally {
      setCancelBusy(null);
    }
  }

  const uploadWorker = board.data?.workers?.[0];

  async function upload(kind: 'audio' | 'image', file: File) {
    if (!uploadWorker) {
      setError('No PC is saved yet. Add the 3060 or the 3090 under Settings, then upload.');
      return;
    }
    setBusy(kind === 'audio' ? 'song' : 'image');
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/v1/comfy/workers/${uploadWorker.id}/upload?kind=${kind === 'audio' ? 'audio' : 'image'}`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'creatoros', accept: 'application/json' },
      });
      const json = (await res.json().catch(() => null)) as { data?: { name?: string }; error?: { message?: string } } | null;
      if (!res.ok || !json?.data?.name) throw new ApiError(res.status, 'ERROR', json?.error?.message ?? 'That file was not saved.');
      if (kind === 'audio') {
        setSong({ id: null, name: file.name, uploadName: json.data.name, workerId: uploadWorker.id, seconds: await audioSeconds(file) });
      } else {
        setImage({ id: null, name: file.name, uploadName: json.data.name, workerId: uploadWorker.id });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That file was not saved.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>AutoGen</CardTitle>
        <p className="mb-3 text-sm text-muted">
          One song, one reference image, and one prompt. Each start time becomes an LTX Shorts clip. The RTX 3090 renders 30 seconds and the RTX 3060 renders 20. A start near the end of the song is shorter. A failed clip is tried once on the other PC. The song name is the Production project and the Publishing row. Finished videos are attached there and are not posted.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <LibraryOrUpload
            kind="AUDIO"
            label="Song"
            selected={song.name}
            busy={busy === 'song'}
            onLibrary={(file) => {
              const ms = file.tech?.durationMs;
              setSong({ id: file.id, name: file.fileName, uploadName: null, workerId: null, seconds: typeof ms === 'number' ? ms / 1000 : null });
            }}
            onUpload={(file) => void upload('audio', file)}
          />
          <LibraryOrUpload
            kind="IMAGE"
            label="Reference image"
            selected={image.name}
            busy={busy === 'image'}
            onLibrary={(file) => setImage({ id: file.id, name: file.fileName, uploadName: null, workerId: null })}
            onUpload={(file) => void upload('image', file)}
          />
          <Field label="Start times (seconds)" hint="Each number is where a clip starts. Example: 0, 30, 75.">
            <Textarea value={timestamps} onChange={(e) => setTimestamps(e.target.value)} rows={3} />
          </Field>
          <Field label="Prompt" hint="Used for every clip, on the LTX workflow.">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={10} />
          </Field>
        </div>
        {song.seconds != null ? <p className="mt-2 text-xs text-muted">Song length {song.seconds.toFixed(1)} seconds.</p> : null}
        {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
        <Button
          className="mt-3"
          variant="primary"
          busy={busy === 'run'}
          onClick={async () => {
            setBusy('run');
            setError('');
            try {
              await post('/comfy/autogen', {
                prompt,
                timestamps,
                songName: song.name || 'Song',
                audioLengthSec: song.seconds,
                audioFileId: song.id,
                imageFileId: image.id,
                audioUploadName: song.uploadName,
                audioUploadWorkerId: song.workerId,
                imageUploadName: image.uploadName,
                imageUploadWorkerId: image.workerId,
              });
              await refresh('/comfy/autogen');
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'AutoGen did not start.');
            } finally {
              setBusy(null);
            }
          }}
        >
          Make the clips
        </Button>
      </Card>
      {board.data && board.data.runs.length === 0 ? <EmptyState title="No AutoGen runs yet">The row for each song appears here, with the PC that is rendering each clip.</EmptyState> : null}
      {cancelError ? <p role="alert" className="text-sm text-bad">{cancelError}</p> : null}
      {(board.data?.runs ?? []).map((run) => {
        const ready = run.clips.filter((clip) => clip.status === 'READY').length;
        const failed = run.clips.filter((clip) => clip.status === 'FAILED').length;
        const cancelled = run.clips.filter((clip) => clip.status === 'CANCELLED').length;
        const activeClips = run.clips.filter((clip) => clip.status === 'RUNNING' || clip.status === 'CLAIMED');
        return (
          <Card key={run.id}>
            <details defaultOpen={run.status !== 'DONE'} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
                <span className="min-w-0 font-semibold">{run.title}</span>
                <Badge tone={run.status === 'DONE' ? 'ok' : 'info'}>{run.status === 'DONE' ? 'Done' : 'In progress'}</Badge>
                <span className="text-sm text-muted">{ready} of {run.clips.length} ready
                  {failed ? `, ${failed} failed` : ''}
                  {cancelled ? `, ${cancelled} cancelled` : ''}
                </span>
                <span className="ml-auto text-xs text-muted">Expand / collapse</span>
              </summary>
              <div className="mt-3">
                {run.projectId ? (
                  <Link className="text-sm font-medium underline" href={`/production/${run.projectId}`}>Open project</Link>
                ) : null}
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted">{run.prompt}</p>
                {activeClips.map((clip) => (
                  <p key={clip.id} className="mt-1 text-sm">
                    {clip.workerLabel || 'A PC'} is rendering the clip that starts at {clip.startSec}s.
                  </p>
                ))}
                <ul className="mt-3 space-y-2">
                  {run.clips.map((clip) => {
                    const waiting = clip.status === 'WAITING';
                    const runningClip = clip.status === 'RUNNING' && Boolean(clip.promptId);
                    const submitting = clip.status === 'RUNNING' && !clip.promptId;
                    const staging = clip.status === 'CLAIMED';
                    return (
                      <li key={clip.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">Starts at {clip.startSec}s</span>
                            <Badge tone={clipTone(clip)}>{clipLabel(clip)}</Badge>
                            {clip.durationSec != null ? <span className="text-muted">{clip.durationSec}s</span> : null}
                          </div>
                          <div className="text-xs text-muted">{clip.workerLabel || 'Waiting for GPU assignment'}</div>
                          {clip.error ? <div className={clip.status === 'CANCELLED' ? 'text-xs text-muted' : 'text-xs text-bad'}>{clip.error}</div> : null}
                          {(staging || submitting) ? <p className="text-xs text-muted">Submitting to the GPU; stop becomes available once ComfyUI confirms the prompt.</p> : null}
                        </div>
                        {(waiting || runningClip) ? (
                          <Button size="sm" variant={waiting ? "secondary" : "danger"} busy={cancelBusy === clip.id}
                            disabled={cancelBusy !== null} onClick={() => void cancelClip(clip)}>
                            {waiting ? 'Cancel queued' : `Stop on ${clip.workerLabel ?? 'GPU'}`}
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          </Card>
        );
      })}
    </div>
  );
}

function audioSeconds(file: File): Promise<number | null> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? audio.duration : null);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    audio.src = url;
  });
}

function LibraryOrUpload({
  kind,
  label,
  selected,
  busy,
  onLibrary,
  onUpload,
}: {
  kind: 'AUDIO' | 'IMAGE';
  label: string;
  selected: string;
  busy: boolean;
  onLibrary: (file: { id: string; fileName: string; tech?: { durationMs?: number } }) => void;
  onUpload: (file: File) => void;
}) {
  const [q, setQ] = useState('');
  const list = useApi<{ items: { id: string; fileName: string; tech?: { durationMs?: number } }[] }>(q.trim() ? '/library' : null, {
    query: { kind, q, limit: 8 },
  });
  return (
    <Field label={label} hint={selected ? selected : 'Search the library, or upload a file. A library file can run on either PC.'}>
      <input
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
        value={q}
        placeholder={kind === 'IMAGE' ? 'Search images' : 'Search songs'}
        onChange={(e) => setQ(e.target.value)}
      />
      {list.data?.items?.length ? (
        <ul className="mt-2 max-h-32 overflow-auto text-sm">
          {list.data.items.map((file) => (
            <li key={file.id}>
              <button type="button" className="underline" onClick={() => { onLibrary(file); setQ(''); }}>
                {file.fileName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="mt-2 inline-flex cursor-pointer text-sm text-accent underline">
        {busy ? 'Uploading…' : 'Upload'}
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
    </Field>
  );
}
