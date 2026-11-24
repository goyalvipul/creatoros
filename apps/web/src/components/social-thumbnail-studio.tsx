'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog, Input } from '@/components/ui';
import { api, post, refresh } from '@/lib/api';

type CoverStyle = 'cinematic' | 'bold' | 'minimal';
type TextPlacement = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type FontStyle = 'impact' | 'geometric' | 'condensed' | 'anton' | 'bebas' | 'spartan' | 'sora' | 'space-grotesk' | 'montserrat';
type TextPreset = 'bold-viral' | 'premium-music' | 'highlight-box' | 'cinematic-poster' | 'neon-stage' | 'sticker-punch' | 'minimal-clean';
const FONT_STACKS: Record<FontStyle, string> = {
  impact: 'Impact, Arial Black, sans-serif',
  geometric: 'Arial Black, Arial, sans-serif',
  condensed: 'Impact, Arial Narrow, sans-serif',
  anton: '"Anton", Impact, sans-serif',
  bebas: '"Bebas Neue", Impact, sans-serif',
  spartan: '"League Spartan", Arial Black, sans-serif',
  sora: '"Sora", Arial Black, sans-serif',
  'space-grotesk': '"Space Grotesk", Arial Black, sans-serif',
  montserrat: '"Montserrat", Arial Black, sans-serif',
};
const FONT_FAMILIES: Record<FontStyle, string | null> = {
  impact: null, geometric: null, condensed: null,
  anton: 'Anton', bebas: 'Bebas Neue', spartan: 'League Spartan',
  sora: 'Sora', 'space-grotesk': 'Space Grotesk', montserrat: 'Montserrat',
};
const PRESETS: Record<TextPreset, { label: string; font: FontStyle; accent: string; placement: TextPlacement; treatment: CoverStyle }> = {
  'bold-viral': { label: 'Bold Viral · large outlined type', font: 'anton', accent: '#ffdc4a', placement: 'top-left', treatment: 'bold' },
  'premium-music': { label: 'Premium Music · elegant gold accent', font: 'spartan', accent: '#e7bb8c', placement: 'bottom-left', treatment: 'cinematic' },
  'highlight-box': { label: 'Highlight Box · colored keyword', font: 'montserrat', accent: '#ffd44f', placement: 'top-left', treatment: 'bold' },
  'cinematic-poster': { label: 'Cinematic Poster · tall type', font: 'bebas', accent: '#f7c3a4', placement: 'bottom-left', treatment: 'cinematic' },
  'neon-stage': { label: 'Neon Stage · subtle colored glow', font: 'space-grotesk', accent: '#b8f7eb', placement: 'bottom-left', treatment: 'bold' },
  'sticker-punch': { label: 'Sticker Punch · playful label', font: 'sora', accent: '#ffb6c7', placement: 'top-right', treatment: 'bold' },
  'minimal-clean': { label: 'Minimal Clean · modern restraint', font: 'sora', accent: '#e5dfd7', placement: 'bottom-left', treatment: 'minimal' },
};
const FONTS_STYLESHEET = 'kemokem-thumbnail-fonts';
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=League+Spartan:wght@700;800;900&family=Montserrat:wght@700;800;900&family=Sora:wght@700;800&family=Space+Grotesk:wght@700&display=swap';
function cleanVisibleCopy(value: string): string {
  return value.replace(/\\b(?:AI[ -]?generated|AI[ -]?model|synthetic (?:media|visual)|virtual (?:artist|influencer))\\b/gi, '').trim();
}
function boundedAccent(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#e7bb8c';
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
  const [fontStyle, setFontStyle] = useState<FontStyle>('spartan');
  const [preset, setPreset] = useState<TextPreset>('premium-music');
  const [accent, setAccent] = useState('#e7bb8c');
  const [highlightWord, setHighlightWord] = useState('');
  const [typeScale, setTypeScale] = useState(1);
  const [outline, setOutline] = useState(6);
  const [fontReady, setFontReady] = useState(false);
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
      designPreset?: TextPreset; accentColor?: string; highlightWord?: string;
    } | null>(
      `/projects/${projectId}/social-covers/${itemId}/${accountId}/brief`,
    ).then((brief) => {
      if (!brief || cancelled) return;
      if (brief.headline.trim()) setHeadline(cleanVisibleCopy(brief.headline));
      setSubhead(cleanVisibleCopy(brief.subheadline));
      setStyle(brief.style);
      setFocalX(brief.focalX);
      if (brief.placement) setPlacement(brief.placement);
      if (brief.fontStyle && FONT_STACKS[brief.fontStyle]) setFontStyle(brief.fontStyle);
      if (brief.designPreset && PRESETS[brief.designPreset]) {
        const choice = PRESETS[brief.designPreset];
        setPreset(brief.designPreset);
        if (!brief.fontStyle) setFontStyle(choice.font);
        if (!brief.placement) setPlacement(choice.placement);
        setStyle(choice.treatment);
        setAccent(choice.accent);
      }
      if (brief.accentColor) setAccent(boundedAccent(brief.accentColor));
      if (brief.highlightWord) setHighlightWord(cleanVisibleCopy(brief.highlightWord));
      setHookType(brief.hookType ?? '');
      setCreativeNotes(brief.notes ?? '');
    }).catch(() => undefined); // Missing analysis falls back to editable video title.
    return () => { cancelled = true; };
  }, [projectId, itemId, accountId]);

  // Canvas does not wait for web fonts automatically; load the exact selected face
  // before allowing image export, so preview and saved JPG use the same glyphs.
  useEffect(() => {
    if (!document.getElementById(FONTS_STYLESHEET)) {
      const link = document.createElement('link');
      link.id = FONTS_STYLESHEET;
      link.rel = 'stylesheet';
      link.href = FONTS_URL;
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    const family = FONT_FAMILIES[fontStyle];
    let cancelled = false;
    setFontReady(false);
    if (!family) { setFontReady(true); return; }
    void document.fonts.load(`800 48px "${family}"`).then(() => {
      if (!cancelled) setFontReady(document.fonts.check(`800 48px "${family}"`));
    }).catch(() => { if (!cancelled) setError('Could not load the selected font. Choose a system font to export.'); });
    return () => { cancelled = true; };
  }, [fontStyle]);

  function applyPreset(value: TextPreset) {
    const config = PRESETS[value];
    setPreset(value);
    setFontStyle(config.font);
    setAccent(config.accent);
    setPlacement(config.placement);
    setStyle(config.treatment);
    setHighlightWord('');
  }

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
    const marginX = w * 0.075;
    // On vertical Shorts/Reels reserve the extreme top and bottom for platform controls.
    const safeY = landscape ? h * 0.09 : h * 0.17;
    const maxWidth = landscape ? w * 0.65 : w * 0.82;
    const textSize = Math.round((landscape ? 82 : 105) * typeScale);
    const family = FONT_STACKS[fontStyle];
    const lineHeight = textSize * 1.11;
    const highlight = cleanVisibleCopy(highlightWord).toUpperCase().trim();
    const emphasis = boundedAccent(accent);
    const words = cleanVisibleCopy(headline).toUpperCase().split(/\\s+/).filter(Boolean);
    ctx.font = `800 ${textSize}px ${family}`;
    const lines: string[][] = [];
    let current: string[] = [];
    for (const word of words) {
      const candidate = [...current, word];
      if (current.length && ctx.measureText(candidate.join(' ')).width > maxWidth && lines.length < 2) {
        lines.push(current);
        current = [word];
      } else current = candidate;
    }
    if (current.length) lines.push(current);
    const subtitleSize = landscape ? 31 : 37;
    const titleHeight = lines.length * lineHeight;
    const blockHeight = titleHeight + (subhead.trim() ? subtitleSize + 52 : 0);
    const leftX = right ? w - marginX : marginX;
    const firstY = top ? safeY + textSize : h - safeY - blockHeight + textSize;
    // Keep the heavy contrast behind the copy only; do not black out the subject.
    const gradient = ctx.createLinearGradient(0, top ? 0 : h, 0, top ? h * 0.54 : h * 0.46);
    gradient.addColorStop(0, preset === 'minimal-clean' ? 'rgba(0,0,0,.62)' : 'rgba(0,0,0,.88)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = right ? 'right' : 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    const outlineWidth = outline * (textSize / 100);
    const boxHeight = textSize * 1.12;
    for (let i = 0; i < lines.length; i++) {
      const items = lines[i]!;
      const y = firstY + i * lineHeight;
      const widths = items.map((word) => ctx.measureText(word).width);
      const space = ctx.measureText(' ').width;
      const fullWidth = widths.reduce((acc, value) => acc + value, 0) + (items.length - 1) * space;
      const startingX = right ? leftX - fullWidth : leftX;
      if (preset === 'highlight-box' || preset === 'sticker-punch') {
        ctx.fillStyle = preset === 'highlight-box' ? 'rgba(15,15,15,.87)' : emphasis;
        ctx.beginPath();
        ctx.roundRect(startingX - 16, y - textSize + 5, Math.min(maxWidth + 32, fullWidth + 32), boxHeight, preset === 'sticker-punch' ? 18 : 8);
        ctx.fill();
      }
      let cursor = startingX;
      ctx.textAlign = 'left';
      for (let j = 0; j < items.length; j++) {
        const word = items[j]!;
        const selected = highlight && (word.replace(/[^A-Z0-9]/g, '') === highlight.replace(/[^A-Z0-9]/g, ''));
        ctx.fillStyle = selected ? emphasis : preset === 'sticker-punch' ? '#111111' : '#ffffff';
        ctx.strokeStyle = preset === 'minimal-clean' ? 'rgba(0,0,0,.3)' : '#0e0d10';
        ctx.lineWidth = preset === 'minimal-clean' ? 2 : outlineWidth;
        ctx.shadowColor = preset === 'neon-stage' ? emphasis : 'rgba(0,0,0,.5)';
        ctx.shadowBlur = preset === 'neon-stage' ? 24 : preset === 'minimal-clean' ? 0 : 7;
        if (outline > 0 && preset !== 'highlight-box') ctx.strokeText(word, cursor, y, maxWidth);
        ctx.fillText(word, cursor, y, maxWidth);
        cursor += widths[j]! + space;
      }
      ctx.textAlign = right ? 'right' : 'left';
    }
    ctx.shadowBlur = 0;
    if (subhead.trim()) {
      const subY = firstY + titleHeight + 9;
      ctx.font = `700 ${subtitleSize}px ${family}`;
      ctx.fillStyle = emphasis;
      const ruleWidth = Math.min(maxWidth * 0.3, 175);
      ctx.fillRect(right ? leftX - ruleWidth : leftX, subY - 24, ruleWidth, 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(cleanVisibleCopy(subhead).toUpperCase().slice(0, 55), leftX, subY + 29, maxWidth);
    }
    setReady(true);
  }, [format, focalX, headline, style, subhead, placement, fontStyle, preset, accent, highlightWord, typeScale, outline]);

  useEffect(() => { if (ready && fontReady) render(); }, [render, ready, fontReady]);

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
            onSeeked={() => { if (fontReady) render(); }}
            onError={() => setError('The video frame could not be loaded. Upload a custom JPG or PNG instead.')}
          />
          <canvas ref={canvasRef} className="max-h-[430px] w-full rounded-lg border border-border bg-black object-contain" />
          {!ready || !fontReady ? <p className="text-xs text-muted">Loading video frame and selected font…</p> : null}
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
          <label className="block text-sm font-semibold">Creator typography preset
            <select className="mt-1 w-full rounded-lg border border-border bg-panel px-3 py-2" value={preset} onChange={(e) => applyPreset(e.target.value as TextPreset)}>
              {Object.entries(PRESETS).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold">Emphasize one keyword
            <Input maxLength={24} placeholder="e.g. THUNDER" value={highlightWord} onChange={(e) => setHighlightWord(cleanVisibleCopy(e.target.value))} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm font-semibold">Accent
              <input type="color" className="mt-1 block h-10 w-full cursor-pointer rounded border border-border" value={accent} onChange={(e) => setAccent(boundedAccent(e.target.value))}/>
            </label>
            <label className="block text-sm font-semibold">Text size
              <input className="mt-3 block w-full" type="range" min="0.7" max="1.35" step="0.05" value={typeScale} onChange={(e) => setTypeScale(Number(e.target.value))}/>
              <span className="text-xs text-muted">{Math.round(typeScale * 100)}%</span>
            </label>
          </div>
          <label className="block text-sm font-semibold">Outline thickness
            <input className="mt-2 block w-full" type="range" min="0" max="12" step="1" value={outline} onChange={(e) => setOutline(Number(e.target.value))}/>
            <span className="text-xs text-muted">{outline}px relative to text size</span>
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
              <option value="anton">Anton · heavyweight hook</option>
              <option value="bebas">Bebas Neue · tall poster</option>
              <option value="spartan">League Spartan · premium bold</option>
              <option value="sora">Sora · modern rounded</option>
              <option value="space-grotesk">Space Grotesk · editorial</option>
              <option value="montserrat">Montserrat · clean creator</option>
              <option value="geometric">System Bold · offline fallback</option>
              <option value="impact">Impact · offline fallback</option>
              <option value="condensed">Condensed · offline fallback</option>
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
          <p className="text-xs text-muted">This editor creates a static JPG cover, not animated burned-in video captions. Text is kept inside conservative vertical safe areas; review platform-specific overlays before publishing.</p>
          {error ? <p className="text-sm text-bad">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" busy={busy} disabled={(!ready || !fontReady) && !imageData}
              onClick={() => void save(imageData || canvasRef.current!.toDataURL('image/jpeg', 0.84))}>
              Save this social thumbnail
            </Button>
            <Button disabled={!ready || !fontReady} onClick={() => {
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
