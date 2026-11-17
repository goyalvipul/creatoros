/** Timeline math for a long video. Times are integer milliseconds so scenes do not drift. */

export interface SceneSpan {
  startMs: number;
  endMs: number;
}

/** Folder on the PC that renders the video. MiniMax creates easy_media/projects/<this name>. */
/** Default section title. Position 1 is "clip 01". */
export function clipTitle(position: number) {
  return `clip ${String(Math.max(1, position)).padStart(2, '0')}`;
}

export function isDefaultClipTitle(label: string) {
  return /^clip \d{2}$/i.test(label.trim());
}

export function longVideoOutputFolder(title: string) {
  const clean = title.trim().replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  const base = clean || 'video';
  return base.endsWith('_longvideo') ? base : `${base}_longvideo`;
}

export function planScenes(durationMs: number, targetMs = 10_000): SceneSpan[] {
  const total = Math.round(durationMs);
  const target = Math.max(1000, Math.round(targetMs));
  if (total <= 0) return [];
  const scenes: SceneSpan[] = [];
  let cursor = 0;
  while (cursor < total) {
    const end = Math.min(total, cursor + target);
    scenes.push({ startMs: cursor, endMs: end });
    cursor = end;
  }
  return scenes;
}

/** MiniMax H3 on this install renders 4–15 seconds. A shorter slice is rendered at 4 and trimmed on export. */
export function generationSeconds(sliceMs: number): { requestSec: number; note: string | null } {
  const slice = Math.max(0, sliceMs) / 1000;
  const requestSec = Math.min(15, Math.max(4, Math.ceil(slice)));
  const note =
    slice > 0 && slice < 4
      ? 'This slice is under 4 seconds. MiniMax renders 4 seconds and the export trims it back to the song.'
      : slice > 15
        ? 'This slice is over 15 seconds. Split it before generating. MiniMax H3 on this install stops at 15 seconds.'
        : null;
  return { requestSec, note };
}

export interface GenerationScene {
  id: string;
  continuity: 'shot' | 'context';
  status: string;
  /** A video is already attached to this section. Generate all leaves it alone. */
  hasVideo?: boolean;
}

const BUSY = new Set(['QUEUED', 'RUNNING']);
const DONE = new Set(['READY']);

function alreadyDone(scene: GenerationScene) {
  return DONE.has(scene.status) || scene.hasVideo === true;
}

/** Groups scenes into MiniMax jobs. Context continues the current group. A finished or already linked scene is left out. A group holds at most 8 scenes. */
export function planGenerationGroups(scenes: GenerationScene[], mode: 'one' | 'all', selectedId?: string): string[][] {
  if (mode === 'one') {
    const index = scenes.findIndex((scene) => scene.id === selectedId);
    const scene = index >= 0 ? scenes[index] : undefined;
    if (!scene || BUSY.has(scene.status)) return [];
    const previous = index > 0 ? scenes[index - 1] : undefined;
    if (scene.continuity === 'context' && previous && !BUSY.has(previous.status)) return [[previous.id, scene.id]];
    return [[scene.id]];
  }
  const groups: string[][] = [];
  let current: string[] = [];
  const close = () => {
    if (current.length) groups.push(current);
    current = [];
  };
  for (const scene of scenes) {
    if (BUSY.has(scene.status) || alreadyDone(scene)) {
      close();
      continue;
    }
    const join = scene.continuity === 'context' && current.length > 0 && current.length < 8;
    if (!join) close();
    current.push(scene.id);
    if (current.length >= 8) close();
  }
  close();
  return groups;
}

export interface SceneResize {
  spans: SceneSpan[];
  /** Indexes in the original list that were fully consumed and should be removed. */
  removed: number[];
  /** The last scene traded time with the scenes before it. The song length did not change. */
  tradedWithPrevious: boolean;
}

/**
 * Move one section's length without opening a gap or an overlap.
 * A shorter section gives the spare song to the start of the next section.
 * A longer section takes that song from the following sections. A following section that is fully used is removed.
 * A section left with less than 1 second is refused, so a 1 second stub is not created.
 * The last section trades with the sections before it. The song still starts at 0 and ends at its full length.
 */
export function resizeSceneSpan(spans: SceneSpan[], index: number, durationMs: number): SceneResize | { error: string } {
  const scene = spans[index];
  if (!scene) return { error: 'That section is not on this song.' };
  const want = Math.round(durationMs);
  if (want < 1000) return { error: 'A scene needs at least 1 second.' };
  if (spans.length < 2) return { error: 'This is the only scene, so its length stays the length of the song.' };
  const current = scene.endMs - scene.startMs;
  const delta = want - current;
  if (delta === 0) return { spans, removed: [], tradedWithPrevious: false };
  const songEnd = spans[spans.length - 1]!.endMs;
  if (index < spans.length - 1) {
    const newEnd = scene.startMs + want;
    if (newEnd > songEnd) return { error: 'That is longer than the song still left after this section.' };
    if (delta < 0) {
      const next = spans[index + 1]!;
      return {
        spans: spans.map((span, i) => {
          if (i === index) return { startMs: scene.startMs, endMs: newEnd };
          if (i === index + 1) return { startMs: newEnd, endMs: next.endMs };
          return { ...span };
        }),
        removed: [],
        tradedWithPrevious: false,
      };
    }
    let eat = delta;
    const removed: number[] = [];
    const kept: SceneSpan[] = spans.slice(0, index).map((span) => ({ ...span }));
    kept.push({ startMs: scene.startMs, endMs: newEnd });
    for (let j = index + 1; j < spans.length; j++) {
      const len = spans[j]!.endMs - spans[j]!.startMs;
      if (eat >= len) {
        eat -= len;
        removed.push(j);
        continue;
      }
      const left = len - eat;
      if (left < 1000) return { error: 'That would leave the next section under 1 second. Lengthen this section enough to take the whole next section, or stop 1 second short of it.' };
      eat = 0;
      kept.push({ startMs: newEnd, endMs: newEnd + left });
      for (let k = j + 1; k < spans.length; k++) {
        const follow = spans[k]!;
        const followLen = follow.endMs - follow.startMs;
        const start = kept[kept.length - 1]!.endMs;
        kept.push({ startMs: start, endMs: start + followLen });
      }
      break;
    }
    if (eat > 0) return { error: 'That is longer than the song still left after this section.' };
    return { spans: kept, removed, tradedWithPrevious: false };
  }
  const newStart = scene.endMs - want;
  if (newStart < 0) return { error: 'That is longer than the song.' };
  if (delta < 0) {
    const prev = spans[index - 1]!;
    return {
      spans: spans.map((span, i) => {
        if (i === index - 1) return { startMs: prev.startMs, endMs: newStart };
        if (i === index) return { startMs: newStart, endMs: scene.endMs };
        return { ...span };
      }),
      removed: [],
      tradedWithPrevious: true,
    };
  }
  let eat = delta;
  const removed: number[] = [];
  const tail: SceneSpan[] = [];
  for (let j = index - 1; j >= 0; j--) {
    const len = spans[j]!.endMs - spans[j]!.startMs;
    if (eat >= len) {
      eat -= len;
      removed.push(j);
      continue;
    }
    const left = len - eat;
    if (left < 1000) return { error: 'That would leave the previous section under 1 second. Lengthen this section enough to take the whole previous section, or stop 1 second short of it.' };
    eat = 0;
    const head = spans.slice(0, j).map((span) => ({ ...span }));
    head.push({ startMs: spans[j]!.startMs, endMs: spans[j]!.startMs + left });
    tail.push(...head);
    break;
  }
  if (eat > 0) return { error: 'That is longer than the song.' };
  removed.sort((a, b) => a - b);
  tail.push({ startMs: newStart, endMs: scene.endMs });
  return { spans: tail, removed, tradedWithPrevious: true };
}

export function imageFileKey(name: string) {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  return base.trim().toLowerCase();
}

export interface ParsedClip {
  name: string;
  images: string[];
  /** Requested MiniMax footage length. This is not the song range. */
  durationSec: number;
  vocal: boolean;
  /** Later clips with context continue the previous shot. */
  context: boolean;
  prompt: string;
  songDetails: string;
  imageDetails: string;
  /** Exact song range, in milliseconds. Null when the plan has no song time. */
  songStartMs: number | null;
  songEndMs: number | null;
  clipId: string | null;
  motionTrackId: string | null;
}

export interface MotionAnchor {
  songMs: number;
  videoMs: number;
}

export interface MotionSourcePlan {
  id: string;
  filename: string;
}

export interface MotionTrackPlan {
  id: string;
  sourceId: string;
  songStartMs: number;
  songEndMs: number;
  anchors: MotionAnchor[];
}

export interface ParsedClipPlan {
  clips: ParsedClip[];
  /** Picture names that appear on every clip. The spelling is the one from the first clip. */
  globalImages: string[];
  motion: { sources: MotionSourcePlan[]; tracks: MotionTrackPlan[] };
}

function clipText(value: unknown, field: string, index: number) {
  if (value == null) return '';
  if (typeof value !== 'string') return { error: `Clip ${String(index + 1).padStart(2, '0')} ${field} must be text.` };
  return value;
}

function clipImages(value: unknown, index: number): string[] | { error: string } {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (!raw) return { error: `Clip ${String(index + 1).padStart(2, '0')} images_attached must be a list of file names, or one comma-separated line.` };
  const images: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') return { error: `Clip ${String(index + 1).padStart(2, '0')} images_attached must be file names.` };
    const name = item.trim();
    if (!name) continue;
    const key = imageFileKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    images.push(name);
  }
  return images;
}

function clipSeconds(value: unknown, index: number): number | { error: string } {
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim().replace(/s$/i, '')) : Number.NaN;
  if (!Number.isFinite(raw) || raw < 1 || raw > 120) return { error: `Clip ${String(index + 1).padStart(2, '0')} needs a duration from 1 to 120 seconds.` };
  return raw;
}

function clipVocal(value: unknown, index: number): boolean | { error: string } {
  if (typeof value === 'boolean') return value;
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (text === 'yes' || text === 'y' || text === 'true' || text === 'vocal') return true;
  if (text === 'no' || text === 'n' || text === 'false' || text === 'broll' || text === 'b-roll') return false;
  return { error: `Clip ${String(index + 1).padStart(2, '0')} vocal must be yes or no.` };
}

function clipContext(value: unknown, index: number): boolean | { error: string } {
  if (value == null) return false;
  if (typeof value === 'boolean') return value;
  return { error: `Clip ${String(index + 1).padStart(2, '0')} context must be true or false.` };
}

const SONG_TIME = /song\s*time:\s*(\d+(?:\.\d+)?)\s*[–\-]\s*(\d+(?:\.\d+)?)/gi;

function songRange(item: Record<string, unknown>, details: string, index: number): { start: number | null; end: number | null } | { error: string } {
  const label = `Clip ${String(index + 1).padStart(2, '0')}`;
  if (item.song_start_ms != null || item.song_end_ms != null) {
    if (typeof item.song_start_ms !== 'number' || typeof item.song_end_ms !== 'number' || !Number.isFinite(item.song_start_ms) || !Number.isFinite(item.song_end_ms)) {
      return { error: `${label} song_start_ms and song_end_ms must both be numbers in milliseconds.` };
    }
    return { start: item.song_start_ms, end: item.song_end_ms };
  }
  const found = [...details.matchAll(SONG_TIME)];
  if (found.length > 1) return { error: `${label} song_details has more than one Song time. Keep one range.` };
  const match = found[0];
  if (!match) return { start: null, end: null };
  return { start: Number(match[1]) * 1000, end: Number(match[2]) * 1000 };
}

function motionRef(item: Record<string, unknown>, index: number, tracks: MotionTrackPlan[]): string | null | { error: string } {
  const raw = item.motion_ref;
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `Clip ${String(index + 1).padStart(2, '0')} motion_ref must be an object.` };
  const trackId = (raw as { track_id?: unknown }).track_id;
  if (typeof trackId !== 'string' || !trackId.trim()) return { error: `Clip ${String(index + 1).padStart(2, '0')} motion_ref needs a track_id.` };
  if (!tracks.some((track) => track.id === trackId)) return { error: `Clip ${String(index + 1).padStart(2, '0')} motion track ${trackId} is not in motion_tracks.` };
  return trackId;
}

function numberField(value: unknown, label: string): number | { error: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { error: `${label} must be a number.` };
  return Math.round(value);
}

function parseMotion(record: Record<string, unknown> | null): { sources: MotionSourcePlan[]; tracks: MotionTrackPlan[] } | { error: string } {
  const sourcesRaw = record?.motion_sources;
  const tracksRaw = record?.motion_tracks;
  if (sourcesRaw == null && tracksRaw == null) return { sources: [], tracks: [] };
  if (!Array.isArray(sourcesRaw) || !Array.isArray(tracksRaw)) return { error: 'motion_sources and motion_tracks must both be lists.' };
  const sources: MotionSourcePlan[] = [];
  const sourceIds = new Set<string>();
  for (const item of sourcesRaw) {
    if (!item || typeof item !== 'object') return { error: 'Each motion source needs an id and a filename.' };
    const row = item as { id?: unknown; filename?: unknown };
    if (typeof row.id !== 'string' || !row.id.trim() || typeof row.filename !== 'string' || !row.filename.trim()) {
      return { error: 'Each motion source needs an id and a filename.' };
    }
    if (sourceIds.has(row.id)) return { error: `Motion source ${row.id} is listed twice.` };
    sourceIds.add(row.id);
    sources.push({ id: row.id.trim(), filename: row.filename.trim() });
  }
  const tracks: MotionTrackPlan[] = [];
  const trackIds = new Set<string>();
  for (const item of tracksRaw) {
    if (!item || typeof item !== 'object') return { error: 'Each motion track needs an id, a source, and anchors.' };
    const row = item as { id?: unknown; source_id?: unknown; song_start_ms?: unknown; song_end_ms?: unknown; anchors?: unknown };
    if (typeof row.id !== 'string' || !row.id.trim()) return { error: 'Each motion track needs an id.' };
    if (trackIds.has(row.id)) return { error: `Motion track ${row.id} is listed twice.` };
    if (typeof row.source_id !== 'string' || !sourceIds.has(row.source_id)) return { error: `Motion track ${String(row.id)} uses a source that is not in motion_sources.` };
    const songStart = numberField(row.song_start_ms, `Motion track ${row.id} song_start_ms`);
    if (typeof songStart !== 'number') return songStart;
    const songEnd = numberField(row.song_end_ms, `Motion track ${row.id} song_end_ms`);
    if (typeof songEnd !== 'number') return songEnd;
    if (songEnd <= songStart) return { error: `Motion track ${row.id} must end after it starts.` };
    if (!Array.isArray(row.anchors) || row.anchors.length < 2) return { error: `Motion track ${row.id} needs at least two anchors.` };
    const anchors: MotionAnchor[] = [];
    for (const anchor of row.anchors) {
      if (!anchor || typeof anchor !== 'object') return { error: `Motion track ${row.id} has an anchor that is not an object.` };
      const pair = anchor as { song_ms?: unknown; video_ms?: unknown };
      const song = numberField(pair.song_ms, `Motion track ${row.id} anchor song_ms`);
      if (typeof song !== 'number') return song;
      const video = numberField(pair.video_ms, `Motion track ${row.id} anchor video_ms`);
      if (typeof video !== 'number') return video;
      const prev = anchors[anchors.length - 1];
      if (prev && (song <= prev.songMs || video <= prev.videoMs)) return { error: `Motion track ${row.id} anchors must move forward in both the song and the video.` };
      anchors.push({ songMs: song, videoMs: video });
    }
    trackIds.add(row.id);
    tracks.push({ id: row.id.trim(), sourceId: row.source_id, songStartMs: songStart, songEndMs: songEnd, anchors });
  }
  return { sources, tracks };
}

/** Read a clip plan. The prompt is the JSON string after parsing, with nothing removed. */
export function parseClipPlan(value: unknown): { plan: ParsedClipPlan } | { error: string } {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const rows = Array.isArray(value) ? value : Array.isArray(record?.clips) ? record.clips : Array.isArray(record?.sections) ? record.sections : null;
  if (!rows) return { error: 'The clip plan must be a JSON list of clips, or an object with a clips list.' };
  if (!rows.length) return { error: 'The clip plan has no clips.' };
  if (rows.length > 80) return { error: 'A long video can hold 80 clips.' };
  const motion = parseMotion(record);
  if ('error' in motion) return motion;
  const clips: ParsedClip[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) return { error: `Clip ${String(i + 1).padStart(2, '0')} must be an object.` };
    const item = row as Record<string, unknown>;
    const name = typeof item.clip_name === 'string' ? item.clip_name.trim() : '';
    if (!name) return { error: `Clip ${String(i + 1).padStart(2, '0')} needs a clip_name.` };
    if (name.length > 160) return { error: `Clip ${String(i + 1).padStart(2, '0')} name can be 160 characters.` };
    const images = clipImages(item.images_attached, i);
    if ('error' in images) return images;
    const durationSec = clipSeconds(item.clip_duration, i);
    if (typeof durationSec !== 'number') return durationSec;
    const vocal = clipVocal(item.vocal, i);
    if (typeof vocal !== 'boolean') return vocal;
    const context = clipContext(item.context, i);
    if (typeof context !== 'boolean') return context;
    const prompt = clipText(item.prompt, 'prompt', i);
    if (typeof prompt !== 'string') return prompt;
    const songDetails = clipText(item.song_details, 'song_details', i);
    if (typeof songDetails !== 'string') return songDetails;
    const imageDetails = clipText(item.image_details, 'image_details', i);
    if (typeof imageDetails !== 'string') return imageDetails;
    const range = songRange(item, songDetails, i);
    if ('error' in range) return range;
    const trackId = motionRef(item, i, motion.tracks);
    if (typeof trackId !== 'string' && trackId !== null) return trackId;
    const clipId = typeof item.clip_id === 'string' && item.clip_id.trim() ? item.clip_id.trim().slice(0, 80) : null;
    clips.push({
      name,
      images,
      durationSec,
      vocal,
      context,
      prompt,
      songDetails,
      imageDetails,
      songStartMs: range.start,
      songEndMs: range.end,
      clipId,
      motionTrackId: trackId,
    });
  }
  const globalImages: string[] = [];
  for (const name of clips[0]?.images ?? []) {
    const key = imageFileKey(name);
    if (globalImages.some((item) => imageFileKey(item) === key)) continue;
    if (clips.every((clip) => clip.images.some((item) => imageFileKey(item) === key))) globalImages.push(name);
  }
  return { plan: { clips, globalImages, motion } };
}

/** Song ranges may end this far from the probed song. Farther than this is a wrong plan, not a rounding gap. */
export const SONG_RANGE_TOLERANCE_MS = 500;

/**
 * Song ownership for a clip plan.
 * Exact song ranges win. clip_duration is ignored for those boundaries.
 * A plan with no song ranges still uses clip_duration, including the existing 15 second leeway.
 */
export function songSpansForClips(
  durationMs: number,
  clips: { durationSec: number; songStartMs: number | null; songEndMs: number | null }[],
): { spans: SceneSpan[]; songDifferenceMs: number; fromSongTime: boolean } | { error: string } {
  const ranged = clips.filter((clip) => clip.songStartMs != null || clip.songEndMs != null);
  if (!ranged.length) {
    const laid = spansFromClipSeconds(durationMs, clips.map((clip) => clip.durationSec));
    if ('error' in laid) return laid;
    return { ...laid, fromSongTime: false };
  }
  if (ranged.length !== clips.length) {
    return { error: 'Every clip needs a song range, or none of them. Add song_start_ms and song_end_ms, or one Song time line in song_details, on each clip.' };
  }
  const total = Math.round(durationMs);
  if (total <= 0) return { error: 'Upload the song before applying a clip plan.' };
  const spans: SceneSpan[] = [];
  for (let i = 0; i < clips.length; i++) {
    const label = `Clip ${String(i + 1).padStart(2, '0')}`;
    const start = Math.round(clips[i]!.songStartMs!);
    const end = Math.round(clips[i]!.songEndMs!);
    if (end - start < 1000) return { error: `${label} song range must be at least 1 second.` };
    if (i === 0 && Math.abs(start) > SONG_RANGE_TOLERANCE_MS) {
      return { error: `${label} must start at 0 seconds of the song. It starts at ${(start / 1000).toFixed(3)} seconds.` };
    }
    const prev = spans[i - 1];
    if (prev && start !== prev.endMs) {
      return { error: `${label} starts at ${(start / 1000).toFixed(3)}s and the previous clip ends at ${(prev.endMs / 1000).toFixed(3)}s. Song ranges must meet with no gap.` };
    }
    spans.push({ startMs: i === 0 ? 0 : start, endMs: end });
  }
  const plannedEnd = spans[spans.length - 1]!.endMs;
  const difference = plannedEnd - total;
  if (Math.abs(difference) > SONG_RANGE_TOLERANCE_MS) {
    return {
      error: `The song ranges end at ${(plannedEnd / 1000).toFixed(3)}s and the uploaded song is ${(total / 1000).toFixed(3)}s. They must match within 0.5 seconds. clip_duration is the render length, not the song time.`,
    };
  }
  const last = spans[spans.length - 1]!;
  spans[spans.length - 1] = { startMs: last.startMs, endMs: total };
  return { spans, songDifferenceMs: 0, fromSongTime: true };
}

/** The H3 render length and the song excerpt are separate. The audio excerpt is never stretched to fill extra video. */
export function h3RequestSeconds(songMs: number, renderMs: number | null): { audioSec: number; renderSec: number; note: string | null } {
  const audioSec = Math.max(0, songMs) / 1000;
  if (audioSec > 15) {
    return { audioSec, renderSec: audioSec, note: 'This song section is over 15 seconds. Split it before generating. The song time is kept.' };
  }
  const asked = renderMs != null ? renderMs / 1000 : audioSec;
  if (asked > 15) {
    return { audioSec, renderSec: asked, note: 'The render length is over 15 seconds. MiniMax H3 on this install stops at 15 seconds. Shorten clip_duration or split the section.' };
  }
  const renderSec = Math.min(15, Math.max(4, Math.ceil(Math.max(audioSec, asked) * 1000) / 1000));
  const note = audioSec > 0 && audioSec < 4 ? 'This slice is under 4 seconds. MiniMax renders 4 seconds and the export trims it back to the song.' : null;
  return { audioSec, renderSec: Math.max(renderSec, Math.min(15, audioSec)), note };
}

function videoAt(anchors: MotionAnchor[], songMs: number): number | null {
  const sorted = [...anchors].sort((a, b) => a.songMs - b.songMs);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || songMs < first.songMs - 1 || songMs > last.songMs + 1) return null;
  for (let i = 0; i < sorted.length - 1; i++) {
    const left = sorted[i]!;
    const right = sorted[i + 1]!;
    if (songMs < left.songMs || songMs > right.songMs) continue;
    const span = right.songMs - left.songMs;
    if (span <= 0) return null;
    return left.videoMs + ((songMs - left.songMs) * (right.videoMs - left.videoMs)) / span;
  }
  return last.videoMs;
}

export type MotionFit = 'ready' | 'outside' | 'short' | 'long' | 'missing';

/** Map a song interval through the original anchors. Repeated resizes do not accumulate a trim offset. */
export function motionVideoRange(
  track: MotionTrackPlan,
  startMs: number,
  endMs: number,
  sourceDurationMs: number | null,
): { videoStartMs: number; videoEndMs: number; status: MotionFit } {
  const start = videoAt(track.anchors, startMs);
  const end = videoAt(track.anchors, endMs);
  if (start == null || end == null || end <= start || startMs < track.songStartMs - 1 || endMs > track.songEndMs + 1) {
    return { videoStartMs: Math.max(0, Math.round(start ?? 0)), videoEndMs: Math.max(0, Math.round(end ?? 0)), status: 'outside' };
  }
  const videoStartMs = Math.max(0, Math.round(start));
  const videoEndMs = Math.round(end);
  if (sourceDurationMs == null) return { videoStartMs, videoEndMs, status: 'missing' };
  if (videoStartMs < 0 || videoEndMs > sourceDurationMs + 50) return { videoStartMs, videoEndMs, status: 'outside' };
  const length = videoEndMs - videoStartMs;
  if (length < 2000) return { videoStartMs, videoEndMs, status: 'short' };
  if (length > 15_000) return { videoStartMs, videoEndMs, status: 'long' };
  return { videoStartMs, videoEndMs, status: 'ready' };
}

/** A section of 5 seconds or less goes to the 3060. Every longer section uses the 3090. */
export function clipPlanCard(durationMs: number): '3060' | '3090' {
  return durationMs <= 5_000 ? '3060' : '3090';
}

/** A clip plan may run this far past the song, or end this far before it. */
export const CLIP_PLAN_SONG_LEEWAY_MS = 15_000;

/** Place each clip at the duration written in the plan. The total may differ from the song by up to 15 seconds. */
export function spansFromClipSeconds(durationMs: number, seconds: number[]): { spans: SceneSpan[]; songDifferenceMs: number } | { error: string } {
  const total = Math.round(durationMs);
  if (total <= 0) return { error: 'Upload the song before applying a clip plan.' };
  if (!seconds.length) return { error: 'The clip plan has no clips.' };
  const spans: SceneSpan[] = [];
  let cursor = 0;
  for (let i = 0; i < seconds.length; i++) {
    const ms = Math.round(seconds[i]! * 1000);
    if (ms < 1000) return { error: `Clip ${String(i + 1).padStart(2, '0')} needs at least 1 second.` };
    spans.push({ startMs: cursor, endMs: cursor + ms });
    cursor += ms;
  }
  const songDifferenceMs = cursor - total;
  const leewaySec = CLIP_PLAN_SONG_LEEWAY_MS / 1000;
  if (songDifferenceMs > CLIP_PLAN_SONG_LEEWAY_MS) {
    return { error: `The clips run ${(songDifferenceMs / 1000).toFixed(1)} seconds past the song. They can run up to ${leewaySec} seconds past it.` };
  }
  if (songDifferenceMs < -CLIP_PLAN_SONG_LEEWAY_MS) {
    return { error: `The clips end ${(Math.abs(songDifferenceMs) / 1000).toFixed(1)} seconds before the song ends. They can end up to ${leewaySec} seconds early.` };
  }
  return { spans, songDifferenceMs };
}

/** Picture order from the plan. Names match by file name, ignoring folders and letter case. */
export function orderByPlanName<T extends { id: string; name: string }>(items: T[], order: string[]): T[] {
  if (!order.length) return items;
  const used = new Set<string>();
  const picked: T[] = [];
  for (const name of order) {
    const key = imageFileKey(name);
    const match = items.find((item) => !used.has(item.id) && imageFileKey(item.name) === key);
    if (!match) continue;
    used.add(match.id);
    picked.push(match);
  }
  for (const item of items) if (!used.has(item.id)) picked.push(item);
  return picked;
}

export function spansCover(durationMs: number, spans: SceneSpan[]): boolean {
  const ordered = [...spans].sort((a, b) => a.startMs - b.startMs);
  let cursor = 0;
  for (const span of ordered) {
    if (span.startMs !== cursor || span.endMs <= span.startMs) return false;
    cursor = span.endMs;
  }
  return cursor === Math.round(durationMs);
}
