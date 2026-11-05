import { describe, expect, it } from 'vitest';
import { accurateTrimArgs, fastTrimArgs, planTrimOutput, trimDurationOk, validateTrimRange } from './video-trim';

const roots = [{ id: 'r1', displayPath: 'D:\\Mehak', canonicalPath: 'd:\\mehak' }];

describe('video trim', () => {
  it('rejects a range shorter than one frame and a cut past the end', () => {
    expect(() => validateTrimRange({ startMs: 0, endMs: 10, durationMs: 5000, fps: 24 })).toThrow(/one frame/);
    expect(() => validateTrimRange({ startMs: 0, endMs: 9000, durationMs: 5000, fps: 24 })).toThrow(/past the end/);
    expect(validateTrimRange({ startMs: 1000, endMs: 2500, durationMs: 5000, fps: 24 }).spanMs).toBe(1500);
  });

  it('plans a new mp4 beside the source and never the same path', () => {
    const planned = planTrimOutput({
      displayPath: 'D:\\Mehak\\song.mp4',
      fileName: 'song.mp4',
      os: 'windows',
      roots,
      startMs: 1000,
      endMs: 2500,
      durationMs: 8000,
      fps: 24,
      takenNames: [],
    });
    expect(planned.displayPath).toBe('D:\\Mehak\\song-trim-0001000-0002500.mp4');
    expect(planned.canonicalPath).toBe('d:\\mehak\\song-trim-0001000-0002500.mp4');
    expect(planned.rootId).toBe('r1');
    expect(() =>
      planTrimOutput({
        displayPath: 'C:\\Outside\\song.mp4',
        fileName: 'song.mp4',
        os: 'windows',
        roots,
        startMs: 0,
        endMs: 1000,
        durationMs: 2000,
        fps: 30,
        takenNames: [],
      }),
    ).toThrow(/outside/);
  });

  it('bumps the name when that trim already exists', () => {
    const planned = planTrimOutput({
      displayPath: '/data/mehak/take.mp4',
      fileName: 'take.mp4',
      os: 'posix',
      roots: [{ id: 'r2', displayPath: '/data/mehak', canonicalPath: '/data/mehak' }],
      startMs: 0,
      endMs: 500,
      durationMs: 2000,
      fps: 25,
      takenNames: ['take-trim-0000000-0000500.mp4'],
    });
    expect(planned.fileName).toBe('take-trim-0000000-0000500-2.mp4');
  });

  it('uses the name you typed, and the same name only when replace is on', () => {
    const named = planTrimOutput({
      displayPath: 'D:\\Mehak\\song.mp4',
      fileName: 'song.mp4',
      os: 'windows',
      roots,
      startMs: 0,
      endMs: 1000,
      durationMs: 4000,
      fps: 30,
      takenNames: ['song.mp4'],
      requestedName: 'chorus',
    });
    expect(named.fileName).toBe('chorus.mp4');
    expect(named.displayPath).toBe('D:\\Mehak\\chorus.mp4');
    expect(named.replaceOriginal).toBe(false);
    expect(() =>
      planTrimOutput({
        displayPath: 'D:\\Mehak\\song.mp4',
        fileName: 'song.mp4',
        os: 'windows',
        roots,
        startMs: 0,
        endMs: 1000,
        durationMs: 4000,
        fps: 30,
        takenNames: ['song.mp4'],
        requestedName: 'song.mp4',
      }),
    ).toThrow(/Replace the original/);
    const replaced = planTrimOutput({
      displayPath: 'D:\\Mehak\\song.mp4',
      fileName: 'song.mp4',
      os: 'windows',
      roots,
      startMs: 0,
      endMs: 1000,
      durationMs: 4000,
      fps: 30,
      takenNames: ['song.mp4'],
      requestedName: 'song.mp4',
      replace: true,
    });
    expect(replaced.displayPath).toBe('D:\\Mehak\\song.mp4');
    expect(replaced.replaceOriginal).toBe(true);
  });

  it('puts the accurate cut after the input and the fast cut on a keyframe seek', () => {
    const accurate = accurateTrimArgs({ startMs: 1500, endMs: 3200, rotate: 90 });
    expect(accurate.indexOf('-ss')).toBeGreaterThan(accurate.indexOf('-i'));
    expect(accurate).toContain('libx264');
    expect(accurate).toContain('0:a?');
    expect(accurate).toContain('rotate=90');
    const fast = fastTrimArgs({ startMs: 1500, endMs: 3200 });
    expect(fast.indexOf('-ss')).toBeLessThan(fast.indexOf('-i'));
    expect(fast).toContain('copy');
    expect(trimDurationOk('ACCURATE', 1700, 1710, 24)).toBe(true);
    expect(trimDurationOk('ACCURATE', 1700, 4000, 24)).toBe(false);
    expect(trimDurationOk('FAST', 1700, 2100, 24)).toBe(true);
  });
});
