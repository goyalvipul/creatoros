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
}

const BUSY = new Set(['QUEUED', 'RUNNING']);
const DONE = new Set(['READY']);

/** Groups scenes into MiniMax jobs. Context continues the current group. A finished scene is left out. A group holds at most 8 scenes. */
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
    if (DONE.has(scene.status) || BUSY.has(scene.status)) {
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

/**
 * Move one section's length without opening a gap or an overlap.
 * A shorter section gives the spare song to the start of the next section.
 * A longer section takes that song from the start of the next section.
 * The last section trades with the one before it, so the song still starts at 0 and ends at its full length.
 */
export function resizeSceneSpan(spans: SceneSpan[], index: number, durationMs: number): { spans: SceneSpan[] } | { error: string } {
  const scene = spans[index];
  if (!scene) return { error: 'That section is not on this song.' };
  const want = Math.round(durationMs);
  if (want < 1000) return { error: 'A scene needs at least 1 second.' };
  const next = spans[index + 1];
  const prev = spans[index - 1];
  const partner = next ?? prev;
  if (!partner) return { error: 'This is the only scene, so its length stays the length of the song.' };
  const current = scene.endMs - scene.startMs;
  const delta = want - current;
  if (delta === 0) return { spans };
  if (partner.endMs - partner.startMs - delta < 1000) return { error: 'That would leave the neighbouring scene under 1 second.' };
  const copy = spans.map((span) => ({ ...span }));
  if (next) {
    copy[index] = { startMs: scene.startMs, endMs: scene.endMs + delta };
    copy[index + 1] = { startMs: next.startMs + delta, endMs: next.endMs };
  } else if (prev) {
    copy[index] = { startMs: scene.startMs - delta, endMs: scene.endMs };
    copy[index - 1] = { startMs: prev.startMs, endMs: prev.endMs - delta };
  }
  return { spans: copy };
}

export function imageFileKey(name: string) {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  return base.trim().toLowerCase();
}

export interface ParsedClip {
  name: string;
  images: string[];
  durationSec: number;
  vocal: boolean;
  prompt: string;
  songDetails: string;
  imageDetails: string;
}

export interface ParsedClipPlan {
  clips: ParsedClip[];
  /** Picture names that appear on every clip. The spelling is the one from the first clip. */
  globalImages: string[];
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

/** Read a clip plan. The prompt is the JSON string after parsing, with nothing removed. */
export function parseClipPlan(value: unknown): { plan: ParsedClipPlan } | { error: string } {
  const record = value && typeof value === 'object' ? (value as { clips?: unknown; sections?: unknown }) : null;
  const rows = Array.isArray(value) ? value : Array.isArray(record?.clips) ? record.clips : Array.isArray(record?.sections) ? record.sections : null;
  if (!rows) return { error: 'The clip plan must be a JSON list of clips, or an object with a clips list.' };
  if (!rows.length) return { error: 'The clip plan has no clips.' };
  if (rows.length > 80) return { error: 'A long video can hold 80 clips.' };
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
    const prompt = clipText(item.prompt, 'prompt', i);
    if (typeof prompt !== 'string') return prompt;
    const songDetails = clipText(item.song_details, 'song_details', i);
    if (typeof songDetails !== 'string') return songDetails;
    const imageDetails = clipText(item.image_details, 'image_details', i);
    if (typeof imageDetails !== 'string') return imageDetails;
    clips.push({ name, images, durationSec, vocal, prompt, songDetails, imageDetails });
  }
  const globalImages: string[] = [];
  for (const name of clips[0]?.images ?? []) {
    const key = imageFileKey(name);
    if (globalImages.some((item) => imageFileKey(item) === key)) continue;
    if (clips.every((clip) => clip.images.some((item) => imageFileKey(item) === key))) globalImages.push(name);
  }
  return { plan: { clips, globalImages } };
}

/** A section of 5 seconds or less goes to the 3060. Every longer section uses the 3090. */
export function clipPlanCard(durationMs: number): '3060' | '3090' {
  return durationMs <= 5_000 ? '3060' : '3090';
}

/** A clip plan may run this far past the song, or end this far before it. */
export const CLIP_PLAN_SONG_LEEWAY_MS = 3_000;

/** Place each clip at the duration written in the plan. The total may differ from the song by up to 3 seconds. */
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
  if (songDifferenceMs > CLIP_PLAN_SONG_LEEWAY_MS) {
    return { error: `The clips run ${(songDifferenceMs / 1000).toFixed(1)} seconds past the song. They can run up to 3 seconds past it.` };
  }
  if (songDifferenceMs < -CLIP_PLAN_SONG_LEEWAY_MS) {
    return { error: `The clips end ${(Math.abs(songDifferenceMs) / 1000).toFixed(1)} seconds before the song ends. They can end up to 3 seconds early.` };
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
