'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog, Input } from '@/components/ui';
import { api, post, refresh } from '@/lib/api';

type CoverStyle = 'cinematic' | 'bold' | 'minimal';
const FORMATS: Record<string, { w: number; h: number; label: string }> = {
  youtube: { w: 1280, h: 720, label: 'YouTube · 16:9' },
  instagram: { w: 1080, h: 1920, label: 'Instagram Reels · 9:16' },
  facebook: { w: 1200, h: 630, label: 'Facebook · 1.91:1' },
  tiktok: { w: 1080, h: 1920, label: 'TikTok · 9:16' },
  threads: { w: 1080, h: 1350, label: 'Threads · 4:5' },
};
function drawWrapped(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number, line: number, limit: number) {
  const words = value.trim().split(/\s+/);
  let current = '';
  let count = 0;
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (current && ctx.measureText(test).width > maxWidth && count < limit - 1) {
      ctx.fillText(current, x, y + count * line);
      count++;
      current = word;
    } else current = test;
  }
  if (current) ctx.fillText(current, x, y + count * line);
  return count + 1;
}
function drawImageCover(ctx: CanvasRenderingContext2D, image: CanvasImageSource, iw: number, ih: number, w: number, h: number, focalX: number) {
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  const sx = Math.max(0, Math.min(iw - sw, (iw - sw) * focalX));
  const sy = Math.max(0, (ih - sh) / 2);
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, w, h);
}

export function SocialThumbnailStudio({
  projectId, itemId, accountId, fileId, fileName, title, platform, onClose, onSaved,
}: {
  projectId: string; itemId: string; accountId: string; fileId: string;
  fileName: string; title: string; platform: string;
  onClose: () => void; onSaved: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [frameTime, setFrameTime] = useState(1);
  const [headline, setHeadline] = useState((title || fileName.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ')).slice(0, 90));
  const [subhead, setSubhead] = useState('MEHAK THAKUR · NEW MUSIC');
  const [style, setStyle] = useState<CoverStyle>('cinematic');
  const [focalX, setFocalX] = useState(0.5);
  const [ready, setReady] = useState(false);
  const [imageData, setImageData] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const format = FORMATS[platform] ?? FORMATS.youtube!;

  useEffect(() => {
    let cancelled = false;
    void api<{ headline: string; subheadline: string; style: CoverStyle; focalX: number } | null>(
      `/projects/${projectId}/social-covers/${itemId}/${accountId}/brief`,
    ).then((brief) => {
      if (!brief || cancelled) return;
      if (brief.headline.trim()) setHeadline(brief.headline);
      setSubhead(brief.subheadline);
      setStyle(brief.style);
      setFocalX(brief.focalX);
    }).catch(() => undefined); // Missing analysis falls back to editable video title.
    return () => { cancelled = true; };
  }, [projectId, itemId, accountId]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !video.videoWidth || !video.videoHeight) return;
    const { w, h } = format;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawImageCover(ctx, video, video.videoWidth, video.videoHeight, w, h, focalX);

    const landscape = w > h;
    const overlay = ctx.createLinearGradient(landscape ? 0 : 0, landscape ? 0 : h * 0.36, landscape ? w * 0.82 : 0, h);
    if (style === 'minimal') {
      overlay.addColorStop(0, 'rgba(0,0,0,.18)');
      overlay.addColorStop(1, 'rgba(0,0,0,.7)');
    } else {
      overlay.addColorStop(0, landscape ? 'rgba(0,0,0,.93)' : 'rgba(0,0,0,.04)');
      overlay.addColorStop(1, landscape ? 'rgba(0,0,0,.04)' : 'rgba(0,0,0,.9)');
    }
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, w, h);

    const px = landscape ? w * 0.065 : w * 0.07;
    const base = landscape ? h * 0.52 : h * 0.76;
    const maxWidth = landscape ? w * 0.65 : w * 0.86;
    const fontSize = landscape ? 85 : 100;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 14;
    ctx.font = `800 ${fontSize}px Arial, sans-serif`;
    ctx.fillStyle = style === 'bold' ? '#ffe2c9' : '#ffffff';
    const lines = drawWrapped(ctx, headline.toUpperCase(), px, base, maxWidth, fontSize * 1.12, 3);
    ctx.shadowBlur = 0;
    const subtitleY = base + lines * fontSize * 1.12 + 10;
    ctx.fillStyle = '#e9ad92';
    ctx.fillRect(px, subtitleY - 42, Math.min(maxWidth, 220), 8);
    ctx.font = `700 ${landscape ? 28 : 38}px Arial, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(subhead.toUpperCase().slice(0, 55), px, subtitleY + 8, maxWidth);
    setReady(true);
  }, [format, focalX, headline, style, subhead]);

  useEffect(() => { if (ready) render(); }, [render, ready]);

  function seek(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    const bounded = Math.max(0, Math.min(seconds, Math.max(0, video.duration - 0.1) || 0));
    setFrameTime(bounded);
    video.currentTime = bounded;
  }

  async function save(data: string) {
    setBusy(true); setError('');
    try {
      await post(`/projects/${projectId}/social-covers/${itemId}/${accountId}`, { data });
      await refresh(`/projects/${projectId}/social-drafts`);
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Thumbnail could not be saved.'); }
    finally { setBusy(false); }
  }

  return (
    <Dialog title={`Design ${platform} thumbnail`} wide open onClose={onClose}>
      <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <p className="text-sm font-semibold">{format.label}</p>
          <video
            ref={videoRef} className="hidden" crossOrigin="anonymous"
            src={`/api/v1/files/${fileId}/stream`} preload="auto" muted playsInline
            onLoadedData={() => seek(frameTime)}
            onSeeked={render}
            onError={() => setError('The video frame could not be loaded. Upload a custom JPG or PNG instead.')}
          />
          <canvas ref={canvasRef} className="max-h-[430px] w-full rounded-lg border border-border bg-black object-contain" />
          {!ready ? <p className="text-xs text-muted">Loading a frame from the video…</p> : null}
          <p className="text-xs text-muted">
            A designed image is saved separately for this video and account. YouTube, Facebook, and Instagram can use custom covers through their publishing APIs. TikTok and Threads may use platform-selected frames instead.
          </p>
        </div>
        <div className="space-y-3">
          <label className="block text-sm font-semibold">Headline
            <Input maxLength={90} value={headline} onChange={(e) => setHeadline(e.target.value)} />
          </label>
          <label className="block text-sm font-semibold">Subtitle
            <Input maxLength={55} value={subhead} onChange={(e) => setSubhead(e.target.value)} />
          </label>
          <label className="block text-sm font-semibold">Design style
            <select className="mt-1 w-full rounded-lg border border-border bg-panel px-3 py-2" value={style} onChange={(e) => setStyle(e.target.value as CoverStyle)}>
              <option value="cinematic">Cinematic · bold headline</option>
              <option value="bold">High-contrast · click-focused</option>
              <option value="minimal">Minimal · clean artist look</option>
            </select>
          </label>
          <label className="block text-sm font-semibold">Video frame (seconds)
            <Input type="number" min={0} max={3600} step={0.5} value={frameTime}
              onChange={(e) => seek(Number(e.target.value))} />
          </label>
          <label className="block text-sm font-semibold">Face framing
            <input className="block w-full" type="range" min="0" max="1" step="0.05"
              value={focalX} onChange={(e) => setFocalX(Number(e.target.value))}/>
            <span className="text-xs text-muted">Adjust horizontal crop to keep Mehak's face in the thumbnail.</span>
          </label>
          <label className="block text-sm font-semibold">
            Or upload a custom image
            <input className="mt-1 block w-full text-xs" type="file" accept="image/png,image/jpeg,image/webp"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 2_000_000) { setError('Image must be 2 MB or smaller.'); return; }
                const reader = new FileReader();
                reader.onload = () => setImageData(String(reader.result ?? ''));
                reader.readAsDataURL(f);
              }}
            />
          </label>
          {imageData ? <p className="text-xs text-muted">Uploaded image selected. Save will use it instead of the frame design.</p> : null}
          {error ? <p className="text-sm text-bad">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" busy={busy} disabled={!ready && !imageData}
              onClick={() => void save(imageData || canvasRef.current!.toDataURL('image/jpeg', 0.84))}>
              Save this social thumbnail
            </Button>
            <Button disabled={!ready} onClick={() => {
              const image = canvasRef.current?.toDataURL('image/jpeg', 0.84);
              if (!image) return;
              const a = document.createElement('a');
              a.href = image; a.download = `${platform}-${itemId}.jpg`; a.click();
            }}>Download design</Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
