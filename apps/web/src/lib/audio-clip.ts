/** The part of a file the LTX form is using. Length is at least a fifth of a second. */
export function clipBounds(startSec: number, lengthSec: number): { start: number; end: number } {
  const start = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
  const length = Math.max(0.2, Number.isFinite(lengthSec) ? lengthSec : 0.2);
  return { start, end: start + length };
}

/**
 * What the player should do at this position.
 * `seek` jumps into the trim. `wait` stays paused until the file can skip ahead.
 * `restart` is the end of the trim. `ok` is inside it.
 */
export function clipPlayback(
  current: number,
  start: number,
  end: number,
  seekableEnd: number | null,
): 'ok' | 'seek' | 'wait' | 'restart' {
  if (!Number.isFinite(current)) return 'wait';
  if (current >= end - 0.03 && current > start + 0.05) return 'restart';
  if (current < start - 0.15) {
    if (seekableEnd != null && seekableEnd >= start - 0.05) return 'seek';
    return 'wait';
  }
  return 'ok';
}
