'use client';

import { useRef, useState } from 'react';
import { del, post } from '@/lib/api';

/** Six frames from the video, plus an upload. One choice is sent with every post of this file. */
export function ThumbnailPicker({
  variantId,
  itemId,
  fileId,
  durationMs,
  online,
  hasCover,
  onSaved,
}: {
  variantId: string;
  itemId: string;
  fileId: string;
  durationMs: number;
  online: boolean;
  hasCover: boolean;
  onSaved: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [frames, setFrames] = useState<{ at: number; url: string }[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function shot(at: number, wide: boolean) {
    const video = videoRef.current;
    if (!video) throw new Error('The video is not ready.');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('That frame did not load.')), 8000);
      video.addEventListener(
        'seeked',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.currentTime = at;
    });
    const sourceW = video.videoWidth || 72;
    const sourceH = video.videoHeight || 72;
    const edge = wide ? 1920 : 160;
    const scale = Math.min(1, edge / Math.max(sourceW, sourceH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceW * scale));
    canvas.height = Math.max(1, Math.round(sourceH * scale));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
    let quality = wide ? 0.92 : 0.8;
    let url = canvas.toDataURL('image/jpeg', quality);
    while (wide && url.length > 2_600_000 && quality > 0.74) {
      quality -= 0.06;
      url = canvas.toDataURL('image/jpeg', quality);
    }
    return url;
  }

  async function grab(total: number) {
    if (!total || frames.length) return;
    const shots: { at: number; url: string }[] = [];
    for (let i = 0; i < 6; i++) {
      const at = Math.min(total - 0.05, Math.max(0, (total * (i + 0.5)) / 6));
      try {
        shots.push({ at, url: await shot(at, false) });
      } catch {
        break;
      }
    }
    if (shots.length) setFrames(shots);
  }

  async function save(data: string, source: 'frame' | 'upload', atMs?: number) {
    setBusy(true);
    setError(null);
    try {
      await post(`/variants/${variantId}/files/${itemId}/cover`, { data, source, atMs: atMs ?? null });
      setTick((n) => n + 1);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The thumbnail was not saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Thumbnail</p>
        {hasCover ? (
          <button
            type="button"
            className="text-xs font-semibold text-muted underline"
            onClick={() => {
              setPicked(null);
              void del(`/variants/${variantId}/files/${itemId}/cover`)
                .then(onSaved)
                .catch((e) => setError(e instanceof Error ? e.message : 'Could not clear it.'));
            }}
          >
            Use the video
          </button>
        ) : null}
      </div>
      <video
        ref={videoRef}
        className="pointer-events-none fixed top-0 -left-[120vw] max-w-none opacity-0"
        muted
        playsInline
        preload="auto"
        src={online ? `/api/v1/files/${fileId}/stream` : undefined}
        onLoadedMetadata={(e) => void grab(e.currentTarget.duration || durationMs / 1000)}
      />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {hasCover ? (
          <img
            alt="Chosen thumbnail"
            src={`/api/v1/publish-items/${itemId}/cover?v=${tick}`}
            className="h-16 w-12 shrink-0 rounded-md object-cover ring-2 ring-[#1d5748]"
          />
        ) : null}
        {frames.map((frame) => (
          <button
            key={frame.at}
            type="button"
            disabled={busy}
            aria-pressed={picked === frame.at}
            className={`h-16 w-12 shrink-0 overflow-hidden rounded-md border ${picked === frame.at ? 'border-[#1d5748] ring-2 ring-[#1d5748]' : 'border-border'}`}
            onClick={() => {
              setPicked(frame.at);
              void shot(frame.at, true)
                .then((big) => save(big, 'frame', Math.round(frame.at * 1000)))
                .catch((e) => setError(e instanceof Error ? e.message : 'That frame could not be read.'));
            }}
          >
            <img alt="" src={frame.url} className="size-full object-cover" />
          </button>
        ))}
        <label className="flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center rounded-md border border-dashed border-border text-center text-[10px] font-semibold text-muted">
          Upload
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setPicked(null);
              if (file.size <= 1_800_000) {
                const reader = new FileReader();
                reader.onload = () => void save(String(reader.result ?? ''), 'upload');
                reader.readAsDataURL(file);
                return;
              }
              const url = URL.createObjectURL(file);
              const img = new Image();
              img.onload = () => {
                URL.revokeObjectURL(url);
                const scale = Math.min(1, 1920 / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                  setError('Could not read that picture.');
                  return;
                }
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                void save(canvas.toDataURL('image/jpeg', 0.92), 'upload');
              };
              img.onerror = () => {
                URL.revokeObjectURL(url);
                setError('Could not read that picture.');
              };
              img.src = url;
            }}
          />
        </label>
      </div>
      {!online ? (
        <p className="text-xs text-muted">The PC that holds this video is off, so frames cannot be read. You can still upload a picture.</p>
      ) : null}
      {!frames.length && online ? <p className="text-xs text-muted">Frames appear when the video can play.</p> : null}
      <p className="text-xs text-muted">
        YouTube and Facebook get this picture. Instagram uses the frame time, or the uploaded picture. TikTok uses the frame time only. Threads picks its own frame.
      </p>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {busy ? <p className="text-xs text-muted">Saving thumbnail…</p> : null}
    </div>
  );
}
