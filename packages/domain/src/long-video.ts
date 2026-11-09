/** Timeline math for a long video. Times are integer milliseconds so scenes do not drift. */

export interface SceneSpan {
  startMs: number;
  endMs: number;
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

export function spansCover(durationMs: number, spans: SceneSpan[]): boolean {
  const ordered = [...spans].sort((a, b) => a.startMs - b.startMs);
  let cursor = 0;
  for (const span of ordered) {
    if (span.startMs !== cursor || span.endMs <= span.startMs) return false;
    cursor = span.endMs;
  }
  return cursor === Math.round(durationMs);
}
