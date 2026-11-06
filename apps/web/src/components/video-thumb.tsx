'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

export function cardWidth(ratio: number | null) {
  if (ratio != null && ratio < 0.9) return '11.5rem';
  if (ratio != null && ratio <= 1.15) return '15rem';
  return '20rem';
}

const IMAGE_NAME = /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif|tiff?)$/i;

const stillCache = new Map<string, string>();
const stillWait = new Map<string, Array<(url: string | null) => void>>();
const stillQueue: string[] = [];
let stillBusy = false;

/** One still at a time, kept for this browser session. The server preview cache is empty for these files. */
function enqueueStill(src: string, done: (url: string | null) => void) {
  const hit = stillCache.get(src);
  if (hit) {
    done(hit);
    return () => {};
  }
  let live = true;
  const wrapped = (url: string | null) => {
    if (live) done(url);
  };
  const waiting = stillWait.get(src);
  if (waiting) waiting.push(wrapped);
  else {
    stillWait.set(src, [wrapped]);
    stillQueue.push(src);
    void drainStills();
  }
  return () => {
    live = false;
  };
}

async function drainStills() {
  if (stillBusy) return;
  stillBusy = true;
  try {
    while (stillQueue.length > 0) {
      const src = stillQueue.shift();
      if (!src) continue;
      const listeners = stillWait.get(src) ?? [];
      stillWait.delete(src);
      if (listeners.length === 0) continue;
      let url = stillCache.get(src) ?? null;
      if (!url) {
        url = await captureStill(src);
        if (url) {
          stillCache.set(src, url);
          while (stillCache.size > 80) {
            const oldest = stillCache.keys().next().value;
            if (!oldest) break;
            const gone = stillCache.get(oldest);
            stillCache.delete(oldest);
            if (gone) URL.revokeObjectURL(gone);
          }
        }
      }
      listeners.forEach((fn) => fn(url));
    }
  } finally {
    stillBusy = false;
    if (stillQueue.length > 0) void drainStills();
  }
}

function captureStill(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.cssText = 'position:fixed;left:-9999px;width:320px;height:180px;opacity:0;pointer-events:none';
    document.body.appendChild(video);
    let settled = false;
    const done = (url: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      resolve(url);
    };
    const draw = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return done(null);
      const scale = Math.min(1, 480 / w);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return done(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => done(blob ? URL.createObjectURL(blob) : null), 'image/jpeg', 0.72);
    };
    const timer = window.setTimeout(() => done(null), 12000);
    video.addEventListener('error', () => done(null), { once: true });
    video.addEventListener(
      'loadeddata',
      () => {
        const dur = Number.isFinite(video.duration) ? video.duration : 0;
        const at = dur > 1 ? Math.min(0.8, dur * 0.12) : 0;
        if (at > 0.05) {
          video.addEventListener('seeked', () => draw(), { once: true });
          try {
            video.currentTime = at;
          } catch {
            draw();
          }
        } else draw();
      },
      { once: true },
    );
    video.src = src;
  });
}

export function isImageName(name?: string | null) {
  return IMAGE_NAME.test(name ?? '');
}

export function ImageThumb({
  fileId,
  online = true,
  onRatio,
  className,
}: {
  fileId: string;
  online?: boolean;
  onRatio?: (ratio: number) => void;
  className?: string;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  if (!online) {
    return <p className="grid h-28 place-items-center px-3 text-center text-xs text-muted">That PC is off</p>;
  }
  if (failed) {
    return <p className="grid h-28 place-items-center px-3 text-center text-xs text-muted">This image cannot be shown here.</p>;
  }
  return (
    <img
      alt=""
      src={`/api/v1/files/${fileId}/stream`}
      className={clsx('bg-panel2 object-cover', className)}
      style={{ width: '100%', aspectRatio: ratio ? String(ratio) : '1', maxHeight: '18rem' }}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (!img.naturalWidth || !img.naturalHeight) return;
        const next = img.naturalWidth / img.naturalHeight;
        setRatio(next);
        onRatio?.(next);
      }}
      onError={() => setFailed(true)}
    />
  );
}

export function SizedFrame({
  fileId,
  kind,
  online = true,
  interactive = false,
  playing = false,
  onPlay,
}: {
  fileId: string;
  kind: 'VIDEO' | 'IMAGE';
  online?: boolean;
  interactive?: boolean;
  playing?: boolean;
  onPlay?: () => void;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  return (
    <div style={{ width: cardWidth(ratio) }}>
      {kind === 'IMAGE' ? (
        <ImageThumb fileId={fileId} online={online} onRatio={setRatio} />
      ) : (
        <VideoThumb
          fileId={fileId}
          online={online}
          interactive={interactive}
          playing={playing}
          onPlay={onPlay}
          onRatio={setRatio}
          className="w-full"
        />
      )}
    </div>
  );
}

export function VideoThumb({
  fileId,
  src,
  poster,
  online = true,
  playing = false,
  onPlay,
  interactive = true,
  onRatio,
  compact = false,
  flush = false,
  ratioHint,
  className,
}: {
  fileId?: string;
  src?: string;
  poster?: string;
  online?: boolean;
  playing?: boolean;
  onPlay?: () => void;
  interactive?: boolean;
  onRatio?: (ratio: number) => void;
  compact?: boolean;
  /** Edge-to-edge picture. No native control bar and no letterbox. */
  flush?: boolean;
  ratioHint?: number | null;
  className?: string;
}) {
  const stream = src ?? (fileId ? `/api/v1/files/${fileId}/stream` : '');
  const preview = poster ?? (fileId ? `/api/v1/files/${fileId}/preview` : undefined);
  const box = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [seen, setSeen] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [localPlay, setLocalPlay] = useState(false);
  const [paused, setPaused] = useState(false);
  const showVideo = interactive && (playing || localPlay);
  const frameRatio = ratio ?? (ratioHint && ratioHint > 0 ? ratioHint : null);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: '120px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!online || !seen || showVideo) return;
    let stop = false;
    let cancel = () => {};
    const fromFile = () => {
      if (stop || !stream) return;
      cancel = enqueueStill(stream, (url) => {
        if (!stop && url) setShot(url);
      });
    };
    if (!preview) {
      fromFile();
      return () => {
        stop = true;
        cancel();
      };
    }
    const img = new Image();
    img.onload = () => {
      if (!stop && img.naturalWidth > 0) setShot(preview);
    };
    img.onerror = () => fromFile();
    img.src = preview;
    return () => {
      stop = true;
      cancel();
    };
  }, [online, preview, seen, showVideo, stream]);

  return (
    <div
      ref={box}
      className={clsx('relative overflow-hidden', !flush && 'rounded-lg bg-panel2', className)}
      style={
        compact
          ? { position: 'absolute', inset: 0, width: '100%', height: '100%' }
          : flush
            ? { width: '100%', aspectRatio: frameRatio ? String(frameRatio) : '9 / 16' }
            : {
                width: '100%',
                aspectRatio: frameRatio ? String(frameRatio) : '16 / 9',
                maxHeight: frameRatio != null && frameRatio < 0.9 ? '22rem' : '13rem',
              }
      }
    >
      {!online ? (
        <p className="grid h-full place-items-center px-3 text-center text-xs text-muted">That PC is off</p>
      ) : showVideo ? (
        <video
          ref={videoRef}
          className={clsx('h-full w-full', flush ? 'object-cover' : 'bg-panel2 object-contain')}
          controls={!flush}
          autoPlay
          playsInline
          preload="metadata"
          poster={shot ?? undefined}
          src={stream}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            v.playbackRate = 1;
            if (!v.videoWidth || !v.videoHeight) return;
            const next = v.videoWidth / v.videoHeight;
            setRatio(next);
            onRatio?.(next);
          }}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onClick={() => {
            if (!flush) return;
            const v = videoRef.current;
            if (!v || v.paused) return;
            v.pause();
          }}
        />
      ) : shot ? (
        <img
          alt=""
          src={shot}
          className={clsx('h-full w-full', compact || flush ? 'object-cover' : 'object-contain')}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (!img.naturalWidth || !img.naturalHeight) return;
            const next = img.naturalWidth / img.naturalHeight;
            setRatio(next);
            onRatio?.(next);
          }}
        />
      ) : (
        <div className="h-full w-full bg-panel2" />
      )}
      {online && interactive && (!showVideo || (flush && paused)) && (
        <button
          type="button"
          aria-label="Play video"
          className="absolute inset-0 cursor-pointer"
          onClick={() => {
            if (showVideo) void videoRef.current?.play();
            else if (onPlay) onPlay();
            else setLocalPlay(true);
          }}
        >
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid size-11 place-items-center rounded-full bg-black/55 text-lg text-white">▶</span>
          </span>
        </button>
      )}
    </div>
  );
}
