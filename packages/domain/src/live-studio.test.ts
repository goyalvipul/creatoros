import { describe, expect, it } from 'vitest';
import {
  broadcastStopAt,
  ingestionSafetyAt,
  isUnderRoot,
  liveDurations,
  notificationDue,
  notifyBody,
  playlistPosition,
  redactStreamSecrets,
  resolveUnderRoot,
  sessionPolicy,
  stopDue,
  tightenDeadline,
  verifiedSendingMs,
  wallClockMs,
} from './live-studio';

const start = new Date('2026-11-12T00:00:00.000Z');
const tenHours = 10 * 60 * 60 * 1000;
const stopDefault = tenHours + 55 * 60 * 1000;

describe('live durations', () => {
  it('accepts the production defaults and refuses a stop past 11 hours', () => {
    expect(liveDurations(600, 655)).toEqual({ notifyAfterMs: tenHours, autoStopMs: stopDefault });
    expect(() => liveDurations(600, 661)).toThrow(/11 hours/);
    expect(() => liveDurations(655, 655)).toThrow(/earlier/);
  });

  it('lets a test stop sooner and skips the 10 hour notice when the stop is first', () => {
    expect(sessionPolicy(tenHours, stopDefault, 10)).toEqual({ notifyAfterMs: null, autoStopMs: 10 * 60_000 });
    expect(() => sessionPolicy(tenHours, stopDefault, 700)).toThrow(/LIVE_AUTO_STOP_MINUTES/);
  });

  it('keeps the original deadline when a restart proposes a later one', () => {
    const original = new Date(start.getTime() + stopDefault);
    const later = new Date(original.getTime() + 60 * 60_000);
    expect(tightenDeadline(original, later).toISOString()).toBe(original.toISOString());
    expect(tightenDeadline(null, original).toISOString()).toBe(original.toISOString());
  });

  it('fires the notice at 10 hours and the stop at 10 hours 55 minutes', () => {
    const notifyAt = new Date(start.getTime() + tenHours);
    const stopAt = new Date(start.getTime() + stopDefault);
    expect(notificationDue(new Date(notifyAt.getTime() - 1000), notifyAt, null)).toBe(false);
    expect(notificationDue(notifyAt, notifyAt, null)).toBe(true);
    expect(notificationDue(new Date(notifyAt.getTime() + 5000), notifyAt, notifyAt)).toBe(false);
    expect(stopDue(new Date(stopAt.getTime() - 1000), stopAt, null)).toBe(false);
    expect(stopDue(stopAt, stopAt, null)).toBe(true);
    expect(notifyBody(tenHours, stopDefault)).toMatch(/10 hours/);
    expect(notifyBody(tenHours, stopDefault)).toMatch(/10h55m/);
  });

  it('stops at the safety cutoff when YouTube start is late', () => {
    const encoder = start;
    const safety = ingestionSafetyAt(encoder, stopDefault);
    expect(safety.getTime() - encoder.getTime()).toBe(11 * 60 * 60 * 1000);
    const lateStart = new Date(encoder.getTime() + 30 * 60_000);
    const stop = broadcastStopAt(lateStart, stopDefault, safety);
    expect(stop.toISOString()).toBe(safety.toISOString());
    expect(stopDue(safety, stop, safety)).toBe(true);
  });
});

describe('live paths and playback', () => {
  it('rejects a path that leaves the approved root', () => {
    expect(isUnderRoot('D:/Media', 'D:/Media/show/a.mp4')).toBe(true);
    expect(isUnderRoot('D:/Media', 'D:/Media/../Secret/a.mp4')).toBe(false);
    expect(resolveUnderRoot('D:/Media', 'show/a.mp4')).toBe('D:/Media/show/a.mp4');
    expect(resolveUnderRoot('D:/Media', '../Secret/a.mp4')).toBeNull();
  });

  it('places the playhead from durations and hides it when a duration is unknown', () => {
    expect(playlistPosition([10_000, 5_000], 12_000)).toEqual({ index: 1, next: 0 });
    expect(playlistPosition([10_000, null], 1_000)).toBeNull();
  });

  it('keeps wall-clock time across a gap and does not add verified time while the heartbeat is stale', () => {
    const now = new Date(start.getTime() + 90 * 60_000);
    expect(wallClockMs(now, start, null)).toBe(90 * 60_000);
    const stale = new Date(now.getTime() - 5 * 60_000);
    expect(verifiedSendingMs(60_000, stale, now, 'LIVE', stale)).toBe(60_000);
    const fresh = new Date(now.getTime() - 10_000);
    expect(verifiedSendingMs(60_000, fresh, now, 'LIVE', fresh)).toBe(70_000);
  });

  it('strips ingest addresses from text', () => {
    const raw = 'ffmpeg rtmps://a.rtmps.youtube.com/live2/secret-key streamName=secret-key';
    expect(redactStreamSecrets(raw)).not.toContain('secret-key');
    expect(redactStreamSecrets(raw)).toContain('rtmps://[redacted]');
  });
});
