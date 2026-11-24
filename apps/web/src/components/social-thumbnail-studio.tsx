'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog, Input } from '@/components/ui';
import { api, post, refresh } from '@/lib/api';

type CoverStyle = 'cinematic' | 'bold' | 'minimal';
type TextPlacement = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type FontStyle = 'impact' | 'geometric' | 'condensed';
const FONT_STACKS: Record<FontStyle, string> = {
  impact: 'Impact, Arial Black, sans-serif',
  geometric: 'Arial Black, Montserrat, Arial, sans-serif',
  condensed: 'Impact, Arial Narrow, sans-serif',
};
function cleanVisibleCopy(value: string): string {
  // Public titles/thumbnail text should showcase the music, never production tooling.
  return value.replace(/\b(?:AI[ -]?generated|AI[ -]?model|synthetic (?:media|visual)|virtual (?:artist|influencer))\b/gi, '').trim();
}
const FORMATS: Record<string, { w: number; h: number; label: string }> = {
  youtubeShort: { w: 1080, h: 1920, label: 'YouTube Shorts · 9:16' },
  youtubeLong: { w: 1280, h: 720, label: 'YouTube Long Video · 16:9' },
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
  projectId, itemId, accountId, fileId, fileName, title, platform, contentForm, onClose, onSaved,
}: {
  projectId: string; itemId: string; accountId: string; fileId: string;
  fileName: string; title: string; platform: string; contentForm?: string;
  onClose: () => void; onSaved: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [frameTime, setFrameTime] = useState(1);
  const [headline, setHeadline] = useState((title || fileName.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ')).slice(0, 90));
  const [subhead, setSubhead] = useState('MEHAK THAKUR · NEW MUSIC');
  const [style, setStyle] = useState<CoverStyle>('cinematic');
  const [focalX, setFocalX] = useState(0.5);
  const [placement, setPlacement] = useState<TextPlacement>('bottom-left');
  const [fontStyle, setFontStyle] = useState<FontStyle>('geometric');
  const [hookType, setHookType] = useState('');
  const [creativeNotes, setCreativeNotes] = useState('');
  const [ready, setReady] = useState(false);
  const [imageData, setImageData] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Shorts must always be rendered in portrait; regular YouTube videos stay landscape.
  // The metadata aspect hint is descriptive and cannot override the publishing content form.
  const format = platform === 'youtube'
    ? (contentForm?.toUpperCase() === 'SHORT' ? FORMATS.youtubeShort! : FORMATS.youtubeLong!)
    : FORMATS[platform] ?? FORMATS.youtubeShort!;

  useEffect(() => {
    let cancelled = false;
    void api<{
      headline: string; subheadline: string; style: CoverStyle; focalX: number; aspect?: string;
      placement?: TextPlacement; fontStyle?: FontStyle; hookType?: string; notes?: string;
    } | null>(
      `/projects/${projectId}/social-covers/${itemId}/${accountId}/brief`,
    ).then((brief) => {
      if (!brief || cancelled) return;
      if (brief.headline.trim()) setHeadline(cleanVisibleCopy(brief.headline));
      setSubhead(cleanVisibleCopy(brief.subheadline));
      setStyle(brief.style);
      setFocalX(brief.focalX);
      if (brief.placement) setPlacement(brief.placement);
      if (brief.fontStyle) setFontStyle(brief.fontStyle);
      setHookType(brief.hookType ?? '');
      setCreativeNotes(brief.notes ?? '');
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
    const top = placement.startsWith('top');
    const right = placement.endsWith('right');
    const overlay = ctx.createLinearGradient(0, top ? 0 : h, 0, top ? h * 0.65 : h * 0.32);
    const dense = style === 'minimal' ? 0.68 : 0.9;
    overlay.addColorStop(0, `rgba(0,0,0,${dense})`);
    overlay.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, w, h);

    const margin = w * 0.07;
    const maxWidth = landscape ? w * 0.62 : w * 0.84;
    const anchorX = right ? w - margin : margin;
    const fontSize = landscape ? 76 : 94;
    const maxLines = 3;
    const lineHeight = fontSize * 1.13;
    const words = cleanVisibleCopy(headline).toUpperCase().trim().split(/\\s+/).filter(Boolean);
    // Wrap before drawing so right-aligned text respects the same safe area.
    ctx.font = `900 ${fontSize}px ${FONT_STACKS[fontStyle]}`;
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(candidate).width > maxWidth && lines.length < maxLines - 1) {
        lines.push(current);
        current = word;
      } else current = candidate;
    }
    if (current) lines.push(current);
    const subtitleSize = landscape ? 28 : 36;
    const blockHeight = lines.length * lineHeight + subtitleSize * 2 + 28;
    const baseY = top ? h * 0.1 + fontSize : h - h * 0.12 - blockHeight + fontSize;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = right ? 'right' : 'left';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,.65)';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(0,0,0,.86)';
    ctx.lineWidth = Math.max(5, Math.round(fontSize * 0.07));
    ctx.fillStyle = style === 'bold' ? '#ffe3c8' : '#ffffff';
    for (let i = 0; i < lines.length; i++) {
      const lineY = baseY + i * lineHeight;
      ctx.strokeText(lines[i]!, anchorX, lineY, maxWidth);
      ctx.fillText(lines[i]!, anchorX, lineY, maxWidth);
    }
    ctx.shadowBlur = 0;
    const subtitleY = baseY + lines.length * lineHeight + 10;
    ctx.fillStyle = '#e9ad92';
    const ruleWidth = Math.min(maxWidth * 0.35, 200);
    ctx.fillRect(right ? anchorX - ruleWidth : anchorX, subtitleY - 24, ruleWidth, 7);
    ctx.font = `800 ${subtitleSize}px ${FONT_STACKS[fontStyle]}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(cleanVisibleCopy(subhead).toUpperCase().slice(0, 55), anchorX, subtitleY + 23, maxWidth);
    setReady(true);
  }, [format, focalX, headline, style, subhead, placement, fontStyle]);

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
            <Input maxLength={90} value={headline} onChange={(e) => setHeadline(cleanVisibleCopy(e.target.value))} />
          </label>
          <label className="block text-sm font-semibold">Subtitle
            <Input maxLength={55} value={subhead} onChange={(e) => setSubhead(cleanVisibleCopy(e.target.value))} />
          </label>
          <label className="block text-sm font-semibold">Design style
            <select className="mt-1 w-full rounded-lg border border-border bg-panel px-3 py-2" value={style} onChange={(e) => setStyle(e.target.value as CoverStyle)}>
              <option value="cinematic">Cinematic · bold headline</option>
              <option value="bold">High-contrast · click-focused</option>
              <option value="minimal">Minimal · clean artist look</option>
            </select>
          </label>
          <label className="block text-sm font-semibold">Headline position
            <select className="mt-1 w-full rounded-lg border border-border bg-panel px-3 py-2" value={placement} onChange={(e) => setPlacement(e.target.value as TextPlacement)}>
              <option value="top-left">Top left</option>
              <option value="top-right">Top right</option>
              <option value="bottom-left">Bottom left</option>
              <option value="bottom-right">Bottom right</option>
            </select>
          </label>
          <label className="block text-sm font-semibold">Headline font
            <select className="mt-1 w-full rounded-lg border border-border bg-panel px-3 py-2" value={fontStyle} onChange={(e) => setFontStyle(e.target.value as FontStyle)}>
              <option value="geometric">Bold geometric</option>
              <option value="impact">Impact / strong contrast</option>
              <option value="condensed">Condensed / poster</option>
            </select>
          </label>
          {hookType || creativeNotes ? (
            <div className="rounded-lg border border-border p-2 text-xs text-muted">
              {hookType ? <p><strong>Suggested hook:</strong> {hookType}</p> : null}
              {creativeNotes ? <p><strong>Design guidance:</strong> {creativeNotes}</p> : null}
            </div>
          ) : null}
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
