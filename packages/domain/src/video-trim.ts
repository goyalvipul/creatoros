import { canonicalPath, dirName, extName, isInsideRoot, pathSeparator, type PathOs } from './paths';
import type { FileOpRoot } from './file-ops';

export class TrimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrimError';
  }
}

export function frameMs(fps: number | null | undefined): number {
  if (!fps || !Number.isFinite(fps) || fps <= 0 || fps > 240) return 40;
  return Math.max(1, Math.round(1000 / fps));
}

/** Whole milliseconds. The span has to cover at least one frame and stay inside the file when duration is known. */
export function validateTrimRange(input: {
  startMs: number;
  endMs: number;
  durationMs: number | null;
  fps: number | null;
}): { startMs: number; endMs: number; spanMs: number } {
  const { startMs, endMs } = input;
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs)) throw new TrimError('Start and end must be whole milliseconds.');
  if (startMs < 0 || endMs <= startMs) throw new TrimError('The end has to be after the start.');
  const frame = frameMs(input.fps);
  if (endMs - startMs < frame) throw new TrimError('Select at least one frame.');
  if (endMs - startMs > 6 * 60 * 60 * 1000) throw new TrimError('A clip cannot be longer than 6 hours.');
  if (input.durationMs != null) {
    if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) throw new TrimError('This video has no duration yet.');
    if (endMs > input.durationMs + frame * 2) throw new TrimError('The end is past the end of the video.');
  }
  return { startMs, endMs, spanMs: endMs - startMs };
}

export function trimSeconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/**
 * Frame-accurate re-encode. -ss and -to come after -i so the cut is not limited to a keyframe.
 * Audio is optional (`0:a?`). Rotation is written back onto the video stream when the source had it.
 */
export function accurateTrimArgs(input: { startMs: number; endMs: number; rotate?: number | null }): string[] {
  const args = [
    '-y',
    '-hide_banner',
    '-nostdin',
    '-noautorotate',
    '-i',
    'INPUT',
    '-ss',
    trimSeconds(input.startMs),
    '-to',
    trimSeconds(input.endMs),
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-avoid_negative_ts',
    'make_zero',
    '-progress',
    'pipe:1',
    '-nostats',
  ];
  if (input.rotate) args.push('-metadata:s:v:0', `rotate=${input.rotate}`);
  args.push('OUTPUT');
  return args;
}

/** Keyframe-aligned copy. Faster, and the cut can land on the previous keyframe. */
export function fastTrimArgs(input: { startMs: number; endMs: number }): string[] {
  return [
    '-y',
    '-hide_banner',
    '-nostdin',
    '-ss',
    trimSeconds(input.startMs),
    '-i',
    'INPUT',
    '-t',
    trimSeconds(input.endMs - input.startMs),
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    'OUTPUT',
  ];
}

function longestRoot(roots: FileOpRoot[], key: string, os: PathOs): FileOpRoot | null {
  let best: FileOpRoot | null = null;
  for (const root of roots) {
    if (!isInsideRoot(root.canonicalPath, key, os)) continue;
    if (!best || root.canonicalPath.length > best.canonicalPath.length) best = root;
  }
  return best;
}

function separators(p: string, os: PathOs): string {
  const sep = pathSeparator(os);
  const other = os === 'windows' ? '/' : '\\';
  return p.split(other).join(sep);
}

/** A single mp4 file name. Slashes and Windows-forbidden characters are removed. */
export function clipFileName(raw: string): string {
  const cleaned = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim();
  const dot = cleaned.lastIndexOf('.');
  const stem = (dot > 0 ? cleaned.slice(0, dot) : cleaned).replace(/\.+$/g, '').trim();
  if (!stem) throw new TrimError('Enter a file name.');
  return `${stem.slice(0, 80)}.mp4`;
}

export function trimFileName(sourceName: string, startMs: number, endMs: number, taken: Iterable<string>): string {
  const dot = sourceName.lastIndexOf('.');
  const raw = (dot > 0 ? sourceName.slice(0, dot) : sourceName).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim();
  const stem = (raw || 'clip').slice(0, 80);
  const stamp = `${String(startMs).padStart(7, '0')}-${String(endMs).padStart(7, '0')}`;
  const base = `${stem}-trim-${stamp}`;
  const used = new Set([...taken].map((name) => name.toLowerCase()));
  let name = `${base}.mp4`;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    name = `${base}-${n}.mp4`;
    n += 1;
    if (n > 40) throw new TrimError('Too many trims of this clip already exist in that folder.');
  }
  return name;
}

/** New mp4 beside the source, inside a folder that machine already indexes. */
export function planTrimOutput(input: {
  displayPath: string;
  fileName: string;
  os: PathOs;
  roots: FileOpRoot[];
  startMs: number;
  endMs: number;
  durationMs: number | null;
  fps: number | null;
  takenNames: string[];
  /** When set, this exact name is used instead of the generated trim name. */
  requestedName?: string | null;
  /** Remove the original after the new clip is in place. The same name replaces that path. */
  replace?: boolean;
}): {
  displayPath: string;
  canonicalPath: string;
  fileName: string;
  rootId: string;
  ext: string;
  startMs: number;
  endMs: number;
  replaceOriginal: boolean;
} {
  const range = validateTrimRange(input);
  const fromPath = input.displayPath.trim();
  if (!fromPath) throw new TrimError('This file has no path.');
  const fromKey = canonicalPath(fromPath, input.os);
  const source = longestRoot(input.roots, fromKey, input.os);
  if (!source) throw new TrimError('This file is outside the folders this machine is indexing.');
  const dir = dirName(fromPath);
  if (!dir) throw new TrimError('This file has no folder.');
  const sourceName = (input.fileName || 'clip.mp4').trim();
  const used = new Set(input.takenNames.map((name) => name.toLowerCase()));
  const fileName = input.requestedName?.trim()
    ? clipFileName(input.requestedName)
    : trimFileName(sourceName, range.startMs, range.endMs, input.takenNames);
  if (extName(fileName) !== 'mp4') throw new TrimError('The new clip has to be an mp4.');
  const sameFile = fileName.toLowerCase() === sourceName.toLowerCase();
  if (sameFile && !input.replace) {
    throw new TrimError('That name is the original file. Turn on Replace the original file, or choose another name.');
  }
  if (!sameFile && used.has(fileName.toLowerCase())) {
    throw new TrimError('A file with that name is already in that folder.');
  }
  if (sameFile) {
    return {
      displayPath: fromPath,
      canonicalPath: fromKey,
      fileName,
      rootId: source.id,
      ext: 'mp4',
      startMs: range.startMs,
      endMs: range.endMs,
      replaceOriginal: true,
    };
  }
  const displayPath = separators(dir, input.os).replace(/[\\/]+$/, '') + pathSeparator(input.os) + fileName;
  const key = canonicalPath(displayPath, input.os);
  if (key === fromKey) throw new TrimError('The new clip would replace the original.');
  const dest = longestRoot(input.roots, key, input.os);
  if (!dest) throw new TrimError('The new clip would land outside a folder this machine is indexing.');
  return {
    displayPath,
    canonicalPath: key,
    fileName,
    rootId: dest.id,
    ext: 'mp4',
    startMs: range.startMs,
    endMs: range.endMs,
    replaceOriginal: Boolean(input.replace),
  };
}

/** Accurate cuts should match the requested length. Fast copies may start at the previous keyframe. */
export function trimDurationOk(mode: 'ACCURATE' | 'FAST', requestedMs: number, actualMs: number, fps: number | null): boolean {
  if (!Number.isFinite(actualMs) || actualMs < 50) return false;
  const frame = frameMs(fps);
  if (mode === 'ACCURATE') return Math.abs(actualMs - requestedMs) <= Math.max(150, frame * 2);
  return actualMs > 50 && actualMs <= requestedMs + 10_000;
}
