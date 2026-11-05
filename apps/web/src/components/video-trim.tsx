'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button, Dialog, Notice } from '@/components/ui';
import { ApiError, api, post, refresh } from '@/lib/api';

type Probe = {
  durationMs?: number;
  fps?: number;
  width?: number;
  height?: number;
  codec?: string;
  audioCodec?: string;
  hasAudio?: boolean;
  rotation?: number;
  formatName?: string;
};

type Edit = {
  id: string;
  status: string;
  mode: string;
  startMs: number;
  endMs: number;
  progressPct: number;
  error: string | null;
  outputFileId: string | null;
  outputName: string | null;
};

function fmt(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

function frameAt(sec: number, fps: number) {
  return Math.max(0, Math.round(sec * fps));
}

export function VideoTrim({
  fileId,
  projectId,
  variantId,
  onClose,
}: {
  fileId: string;
  projectId?: string | null;
  variantId?: string | null;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const grabRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [picture, setPicture] = useState<{ width: number; height: number; duration: number } | null>(null);
  const [meta, setMeta] = useState<{ name: string; probe: Probe } | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [frames, setFrames] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [selectionOnly, setSelectionOnly] = useState(false);
  const [mode, setMode] = useState<'ACCURATE' | 'FAST'>('ACCURATE');
  const [clipName, setClipName] = useState('');
  const [replaceFile, setReplaceFile] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const ready = duration > 0 && end > start;

  useEffect(() => {
    let gone = false;
    void api<{ fileName: string; tech?: Probe }>(`/files/${fileId}`).then((file) => {
      if (gone || !file) return;
      setMeta({ name: file.fileName, probe: file.tech ?? {} });
      const stem = file.fileName.replace(/\.[^.]+$/, '') || 'clip';
      setClipName(`${stem}-trim`);
      const known = Number(file.tech?.durationMs);
      if (known > 0) {
        setDuration(known / 1000);
        setEnd(known / 1000);
      }
    });
    return () => {
      gone = true;
    };
  }, [fileId]);

  useEffect(() => {
    if (!edit || edit.status === 'SUCCEEDED' || edit.status === 'CANCELLED') return;
    if (edit.status === 'FAILED' && !/ffmpeg is not installed/i.test(edit.error ?? '')) return;
    const timer = setInterval(() => {
      void api<{ edits: Edit[] }>(`/files/${fileId}/trims`).then((page) => {
        const next = page?.edits?.find((row) => row.id === edit.id);
        if (!next) return;
        setEdit(next);
        if (next.status === 'SUCCEEDED') void refresh('/library', '/files', '/variants');
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [edit, fileId]);

  const fps = meta?.probe.fps && meta.probe.fps > 1 ? meta.probe.fps : 30;
  const portrait = (meta?.probe.height ?? picture?.height ?? 0) > (meta?.probe.width ?? picture?.width ?? 1);

  function onLoaded(video: HTMLVideoElement) {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setPicture({ width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : 0 });
    }
    if (!duration && video.duration && Number.isFinite(video.duration)) {
      setDuration(video.duration);
      setEnd(video.duration);
    }
    void grabStrip(video.duration || duration);
  }

  async function grabStrip(total: number) {
    const video = grabRef.current;
    if (!video || !total || frames.length) return;
    const count = 10;
    const shots: string[] = [];
    for (let i = 0; i < count; i++) {
      const at = (total * (i + 0.5)) / count;
      try {
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          video.addEventListener('seeked', done, { once: true });
          video.currentTime = Math.min(total - 0.05, Math.max(0, at));
        });
        const canvas = document.createElement('canvas');
        const scale = 80 / (video.videoHeight || 80);
        canvas.width = Math.max(1, Math.round((video.videoWidth || 80) * scale));
        canvas.height = 80;
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        shots.push(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        break;
      }
    }
    if (shots.length) setFrames(shots);
  }

  function seekRatio(clientX: number) {
    const bar = barRef.current;
    if (!bar || !duration) return 0;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  function drag(which: 'in' | 'out', event: ReactPointerEvent) {
    event.preventDefault();
    const move = (e: PointerEvent) => {
      const t = seekRatio(e.clientX);
      if (which === 'in') setStart(Math.min(t, end - 1 / fps));
      else setEnd(Math.max(t, start + 1 / fps));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function seekTo(sec: number) {
    const t = Math.min(duration || sec, Math.max(0, sec));
    setPlayhead(t);
    const video = videoRef.current;
    if (video) video.currentTime = t;
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime < start || video.currentTime >= end) video.currentTime = start;
      void video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  function playSelection() {
    const video = videoRef.current;
    if (!video) return;
    setSelectionOnly(true);
    video.currentTime = start;
    void video.play();
    setPlaying(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await post<{ id: string; status: string; fileName: string; deviceName: string; deviceState: string }>(
        `/files/${fileId}/trims`,
        {
          startMs: Math.round(start * 1000),
          endMs: Math.round(end * 1000),
          mode,
          fileName: replaceFile ? meta?.name ?? clipName.trim() : clipName.trim() || null,
          replaceOriginal: replaceFile,
          projectId: projectId ?? null,
          variantId: variantId ?? null,
        },
      );
      setEdit({
        id: saved.id,
        status: saved.status,
        mode,
        startMs: Math.round(start * 1000),
        endMs: Math.round(end * 1000),
        progressPct: 0,
        error: null,
        outputFileId: null,
        outputName: saved.fileName,
      });
      if (saved.deviceState && saved.deviceState !== 'ONLINE') {
        setError(`${saved.deviceName} is off. The trim stays queued until that PC is on. The original was not changed.`);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The trim could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const statusLine =
    edit?.status === 'SUCCEEDED'
      ? replaceFile
        ? `Replaced the original with ${edit.outputName ?? 'this cut'}.`
        : `Saved ${edit.outputName ?? 'the new clip'}. The original was not changed.`
      : edit?.status === 'FAILED' && /ffmpeg is not installed/i.test(edit.error ?? '')
        ? 'The scanner has no ffmpeg. This cut will be made here and the new file goes back to that PC.'
        : edit?.status === 'FAILED'
          ? edit.error || 'The trim failed. The original was not changed.'
          : edit?.status === 'RUNNING'
            ? `Cutting the clip… ${edit.progressPct}%`
            : edit?.status === 'PENDING'
              ? 'Waiting to cut this clip.'
              : null;

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={meta?.name ? `Edit ${meta.name}` : 'Edit video'}
      footer={
        <>
          <Button onClick={() => { setStart(0); setEnd(duration); setSelectionOnly(false); }}>Reset trim</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!ready || !clipName.trim() || edit?.status === 'PENDING' || edit?.status === 'RUNNING'}
            onClick={() => {
              if (replaceFile && !window.confirm('Replace the original file with this cut? The current file is removed after the new one is saved.')) return;
              void save();
            }}
          >
            {replaceFile ? 'Replace this file' : 'Save as New Clip'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <video
          ref={videoRef}
          className="mx-auto max-h-[46vh] w-full rounded-lg bg-black object-contain"
          style={portrait ? { maxWidth: '20rem' } : undefined}
          playsInline
          preload="metadata"
          src={`/api/v1/files/${fileId}/stream`}
          onLoadedMetadata={(e) => onLoaded(e.currentTarget)}
          onTimeUpdate={(e) => {
            setPlayhead(e.currentTarget.currentTime);
            if (!selectionOnly) return;
            if (e.currentTarget.currentTime >= end) {
              e.currentTarget.pause();
              e.currentTarget.currentTime = start;
              setPlaying(false);
            }
          }}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
        />
        <video ref={grabRef} className="hidden" preload="auto" src={`/api/v1/files/${fileId}/stream`} muted />
        <label className="grid gap-1 text-xs text-muted">
          Play from {fmt(playhead)}
          <input
            aria-label="Play from"
            className="w-full accent-current"
            type="range"
            min={0}
            max={duration || 0}
            step={0.05}
            value={Math.min(playhead, duration || 0)}
            disabled={!duration}
            onChange={(e) => seekTo(Number(e.target.value))}
          />
        </label>
        <div
          ref={barRef}
          className="relative h-16 select-none overflow-hidden rounded-lg bg-black"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            seekTo(seekRatio(e.clientX));
          }}
        >
          <div className="flex h-full">
            {frames.length
              ? frames.map((src, i) => (
                  // Filmstrip stills are generated in this browser from the stream. They are not stored.
                  <img key={i} alt="" src={src} className="h-full flex-1 object-cover" draggable={false} />
                ))
              : <div className="grid w-full place-items-center text-xs text-white/70">Reading frames…</div>}
          </div>
          {duration > 0 ? (
            <>
              <div
                className="absolute inset-y-0 border-y-2 border-white/80 bg-white/10"
                style={{ left: `${(start / duration) * 100}%`, right: `${100 - (end / duration) * 100}%` }}
              />
              <div
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-white"
                style={{ left: `${(playhead / duration) * 100}%` }}
              />
              <button
                type="button"
                aria-label="Trim in"
                className="absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize bg-white"
                style={{ left: `${(start / duration) * 100}%` }}
                onPointerDown={(e) => drag('in', e)}
              />
              <button
                type="button"
                aria-label="Trim out"
                className="absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize bg-white"
                style={{ left: `${(end / duration) * 100}%` }}
                onPointerDown={(e) => drag('out', e)}
              />
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="grid gap-1">
            <span className="text-xs text-muted">In · frame {frameAt(start, fps)}</span>
            <input
              className="w-28 rounded-lg border border-border bg-panel2 px-2 py-1"
              type="number"
              min={0}
              max={duration}
              step={1 / fps}
              value={Number(start.toFixed(3))}
              onChange={(e) => setStart(Math.min(end - 1 / fps, Math.max(0, Number(e.target.value) || 0)))}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted">Out · frame {frameAt(end, fps)}</span>
            <input
              className="w-28 rounded-lg border border-border bg-panel2 px-2 py-1"
              type="number"
              min={0}
              max={duration}
              step={1 / fps}
              value={Number(end.toFixed(3))}
              onChange={(e) => setEnd(Math.max(start + 1 / fps, Math.min(duration, Number(e.target.value) || 0)))}
            />
          </label>
          <div className="pb-1 text-xs text-muted">
            {fmt(start)} – {fmt(end)} · {fmt(Math.max(0, end - start))} selected
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</Button>
          <Button size="sm" onClick={playSelection}>Play selection</Button>
          <label className="flex items-center gap-2 text-xs text-muted">
            Cut
            <select
              className="rounded-lg border border-border bg-panel2 px-2 py-1 text-sm text-text"
              value={mode}
              onChange={(e) => setMode(e.target.value === 'FAST' ? 'FAST' : 'ACCURATE')}
            >
              <option value="ACCURATE">Accurate</option>
              <option value="FAST">Fast keyframe</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-muted">
          {mode === 'FAST'
            ? 'Fast keyframe copies the original picture and sound, so it finishes sooner. The clip can start a little earlier than In, on the previous keyframe.'
            : 'Accurate rebuilds the picture so the clip starts and ends on the times you set. It takes longer than a keyframe copy.'}
        </p>
        <label className="grid gap-1 text-sm">
          <span className="text-xs text-muted">File name</span>
          <input
            className="w-full rounded-lg border border-border bg-panel2 px-2 py-1"
            value={replaceFile ? (meta?.name?.replace(/\.[^.]+$/, '') ?? clipName) : clipName}
            readOnly={replaceFile}
            onChange={(e) => setClipName(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={replaceFile} onChange={(e) => setReplaceFile(e.target.checked)} />
          Replace the original file
        </label>
        <p className="text-xs text-muted">
          {[
            meta?.probe.width && meta.probe.height ? `${meta.probe.width}×${meta.probe.height}` : picture ? `${picture.width}×${picture.height}` : null,
            meta?.probe.fps ? `${Math.round(meta.probe.fps)} fps` : null,
            meta?.probe.codec,
            meta?.probe.hasAudio === false ? 'No audio' : meta?.probe.audioCodec,
            meta?.probe.rotation ? `Rotated ${meta.probe.rotation}°` : null,
            picture ? fmt(picture.duration) : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Reading the video…'}
        </p>
        {statusLine ? <p className="text-sm">{statusLine}</p> : null}
        {error ? (
          <Notice tone="warn" title="Trim">
            {error}
          </Notice>
        ) : null}
        <p className="text-xs text-muted">
          {replaceFile
            ? 'Nothing is written until you confirm. This cut replaces the file you opened. The previous video is removed.'
            : 'Nothing is written until Save as New Clip. The original stays where it is. The new clip is saved in the same folder on that PC.'}
        </p>
      </div>
    </Dialog>
  );
}
