/** Live Studio timing, path checks, and YouTube fields the Data API does not write. */

export const LIVE_MAX_MINUTES = 11 * 60;
const HOUR = 60 * 60 * 1000;

export const YOUTUBE_LIVE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
export const YOUTUBE_FULL_SCOPE = 'https://www.googleapis.com/auth/youtube';

export const YOUTUBE_LIVE_UNSUPPORTED = [
  { field: 'Age restriction beyond Made for Kids', href: 'https://studio.youtube.com/' },
  { field: 'Paid promotion disclosure', href: 'https://studio.youtube.com/' },
  { field: 'Monetization and ads', href: 'https://studio.youtube.com/' },
  { field: 'Live chat moderation', href: 'https://studio.youtube.com/' },
  { field: 'Closed captions for the live stream', href: 'https://studio.youtube.com/' },
] as const;

const ACTIVE = new Set([
  'PREPARING',
  'CREATING',
  'CONNECTING',
  'LIVE',
  'INTERRUPTED',
  'STOPPING',
]);

export function liveSessionActive(status: string): boolean {
  return ACTIVE.has(status);
}

export function youtubeLivePermitted(scopes: string[] | null | undefined): boolean {
  return (scopes ?? []).some((s) => s === YOUTUBE_FULL_SCOPE || s === YOUTUBE_LIVE_SCOPE);
}

/** Defaults from `.env`. The stop cannot pass 11 hours, and the notice has to come first. */
export function liveDurations(notifyMinutes: number, stopMinutes: number): { notifyAfterMs: number; autoStopMs: number } {
  if (!Number.isFinite(notifyMinutes) || notifyMinutes < 1)
    throw new Error('LIVE_NOTIFY_AFTER_MINUTES must be at least 1.');
  if (!Number.isFinite(stopMinutes) || stopMinutes < 1)
    throw new Error('LIVE_AUTO_STOP_MINUTES must be at least 1.');
  if (stopMinutes > LIVE_MAX_MINUTES)
    throw new Error(`LIVE_AUTO_STOP_MINUTES cannot be more than ${LIVE_MAX_MINUTES} minutes (11 hours).`);
  if (notifyMinutes >= stopMinutes)
    throw new Error('LIVE_NOTIFY_AFTER_MINUTES must be earlier than LIVE_AUTO_STOP_MINUTES.');
  return { notifyAfterMs: Math.round(notifyMinutes * 60_000), autoStopMs: Math.round(stopMinutes * 60_000) };
}

/**
 * A launch may stop sooner than the env default (a short test). It cannot stop later.
 * The 10-hour notice is omitted when the chosen stop is earlier than that notice.
 */
export function sessionPolicy(
  envNotifyMs: number,
  envStopMs: number,
  chosenStopMinutes?: number | null,
): { notifyAfterMs: number | null; autoStopMs: number } {
  const chosen = chosenStopMinutes == null ? envStopMs : Math.round(chosenStopMinutes * 60_000);
  if (chosen < 60_000) throw new Error('The automatic stop has to be at least 1 minute.');
  if (chosen > envStopMs) throw new Error('The automatic stop cannot be later than LIVE_AUTO_STOP_MINUTES.');
  if (chosen > LIVE_MAX_MINUTES * 60_000) throw new Error('The automatic stop cannot pass 11 hours.');
  return { notifyAfterMs: envNotifyMs < chosen ? envNotifyMs : null, autoStopMs: chosen };
}

/** Encoder safety cutoff. Never later than 11 hours after the encoder starts, and never moved later. */
export function ingestionSafetyAt(encoderStartedAt: Date, autoStopMs: number): Date {
  const cap = encoderStartedAt.getTime() + LIVE_MAX_MINUTES * 60_000;
  const proposed = encoderStartedAt.getTime() + autoStopMs + 15 * 60_000;
  return new Date(Math.min(cap, proposed));
}

export function broadcastStopAt(actualStart: Date, autoStopMs: number, safetyAt: Date | null): Date {
  const proposed = actualStart.getTime() + autoStopMs;
  const capped = safetyAt ? Math.min(proposed, safetyAt.getTime()) : proposed;
  return new Date(capped);
}

/** A restart or a late YouTube reply must not push an existing deadline later. */
export function tightenDeadline(existing: Date | null, proposed: Date): Date {
  if (!existing) return proposed;
  return existing.getTime() <= proposed.getTime() ? existing : proposed;
}

export function notificationDue(now: Date, notifyAt: Date | null, sentAt: Date | null): boolean {
  return notifyAt != null && sentAt == null && now.getTime() >= notifyAt.getTime();
}

export function stopDue(now: Date, stopAt: Date | null, safetyAt: Date | null): boolean {
  const times = [stopAt, safetyAt].filter((d): d is Date => d != null).map((d) => d.getTime());
  if (!times.length) return false;
  return now.getTime() >= Math.min(...times);
}

export function machineReady(
  machine: { revokedAt: Date | null; lastSeenAt: Date | null; ffmpeg: string | null; freeBytes: number | null },
  now: Date,
  offlineAfterMs: number,
): { ok: boolean; reason: string } {
  if (machine.revokedAt) return { ok: false, reason: 'Revoked' };
  if (!machine.lastSeenAt || now.getTime() - machine.lastSeenAt.getTime() > offlineAfterMs)
    return { ok: false, reason: 'Offline' };
  if (!machine.ffmpeg) return { ok: false, reason: 'FFmpeg was not found on that computer' };
  if (machine.freeBytes == null) return { ok: false, reason: 'Disk space has not been reported yet' };
  if (machine.freeBytes < 1024 ** 3) return { ok: false, reason: 'Less than 1 GB free' };
  return { ok: true, reason: 'Ready' };
}

export function isUnderRoot(root: string, candidate: string): boolean {
  const parts = candidate.split(/[/\\]/);
  if (parts.some((p) => p === '..')) return false;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = norm(root);
  const c = norm(candidate);
  if (!r || !c) return false;
  return c === r || c.startsWith(r + '/');
}

export function resolveUnderRoot(root: string, relative: string): string | null {
  if (!relative || relative.includes('\0')) return null;
  const parts = relative.split(/[/\\]/).filter(Boolean);
  if (!parts.length || parts.some((p) => p === '..' || p === '.')) return null;
  const joined = root.replace(/[/\\]+$/, '') + '/' + parts.join('/');
  return isUnderRoot(root, joined) ? joined : null;
}

export function redactStreamSecrets(text: string): string {
  return text
    .replace(/rtmps?:\/\/\S+/gi, 'rtmps://[redacted]')
    .replace(/(stream[_ ]?key|streamName|ingestionAddress)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1$2[redacted]');
}

export function playlistPosition(
  durationsMs: Array<number | null | undefined>,
  outMs: number,
): { index: number; next: number } | null {
  if (!durationsMs.length || durationsMs.some((d) => d == null || d <= 0)) return null;
  const durations = durationsMs as number[];
  const total = durations.reduce((sum, d) => sum + d, 0);
  if (total <= 0 || outMs < 0) return null;
  let t = outMs % total;
  for (let i = 0; i < durations.length; i++) {
    if (t < durations[i]!) return { index: i, next: (i + 1) % durations.length };
    t -= durations[i]!;
  }
  return { index: 0, next: durations.length > 1 ? 1 : 0 };
}

export function wallClockMs(now: Date, actualStart: Date | null, actualEnd: Date | null): number {
  if (!actualStart) return 0;
  const end = actualEnd && actualEnd.getTime() < now.getTime() ? actualEnd.getTime() : now.getTime();
  return Math.max(0, end - actualStart.getTime());
}

export function verifiedSendingMs(
  storedMs: number,
  verifiedAt: Date | null,
  now: Date,
  status: string,
  lastHeartbeatAt: Date | null,
): number {
  const base = Math.max(0, storedMs);
  if (status !== 'LIVE' || !verifiedAt || !lastHeartbeatAt) return base;
  if (now.getTime() - lastHeartbeatAt.getTime() > 90_000) return base;
  return base + Math.max(0, Math.min(now.getTime() - verifiedAt.getTime(), 90_000));
}

export const LIVE_NOTIFY_TEXT =
  'Your YouTube livestream has reached 10 hours. Kemokem will automatically stop it at 10h55m.';
export const LIVE_ENDED_TEXT = 'Your livestream has ended. YouTube is processing the replay.';
export const LIVE_REPLAY_TEXT = 'Your livestream replay is public on YouTube.';

export function studioLink(videoId: string | null | undefined): string {
  return videoId ? `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/edit` : 'https://studio.youtube.com/';
}

export function watchLink(videoId: string | null | undefined): string | null {
  return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : null;
}

/** Hours shown in the default notice. A shorter test run does not claim it was 10 hours. */
export function notifyBody(notifyAfterMs: number | null, stopAfterMs: number): string {
  if (notifyAfterMs == null) return LIVE_ENDED_TEXT;
  if (notifyAfterMs === 10 * HOUR && stopAfterMs === 10 * HOUR + 55 * 60_000) return LIVE_NOTIFY_TEXT;
  const h = Math.floor(notifyAfterMs / HOUR);
  const m = Math.round((notifyAfterMs % HOUR) / 60_000);
  const sh = Math.floor(stopAfterMs / HOUR);
  const sm = Math.round((stopAfterMs % HOUR) / 60_000);
  const left = m ? `${h}h${m}m` : `${h} hours`;
  const stop = sm ? `${sh}h${sm}m` : `${sh} hours`;
  return `Your YouTube livestream has reached ${left}. Kemokem will automatically stop it at ${stop}.`;
}
