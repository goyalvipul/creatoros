/** Start times typed as seconds, or as m:ss. Duplicates collapse. Order is earliest first. */
export function parseAutogenTimestamps(text: string): number[] {
  const tokens = text.split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean);
  const values: number[] = [];
  for (const token of tokens) {
    const clock = /^(\d+):(\d{1,2})(?:\.(\d+))?$/.exec(token);
    const seconds = clock
      ? Number(clock[1]) * 60 + Number(clock[2]) + (clock[3] ? Number(`0.${clock[3]}`) : 0)
      : Number(token);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) continue;
    values.push(Math.round(seconds * 10) / 10);
  }
  return [...new Set(values)].sort((a, b) => a - b).slice(0, 40);
}

/** The 12GB PC renders 20 seconds. The 24GB PC renders 30. A start near the end of the song is shorter. */
export function autogenClipSeconds(
  worker: { expectedVramGb: number | null; label: string },
  startSec: number,
  audioLengthSec: number | null,
): number | null {
  const twelve = (worker.expectedVramGb != null && worker.expectedVramGb <= 16) || /3060|12\s*gb/i.test(worker.label);
  const wanted = twelve ? 20 : 30;
  if (audioLengthSec == null || !Number.isFinite(audioLengthSec)) return wanted;
  const left = audioLengthSec - startSec;
  if (left < 1) return null;
  return Math.round(Math.min(wanted, left) * 10) / 10;
}
