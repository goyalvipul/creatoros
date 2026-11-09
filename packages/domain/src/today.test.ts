import { describe, expect, it } from 'vitest';
import { capacityStatus, focusRemaining, localDate, localMorning, pauseFocus } from './today';

describe('today plan', () => {
  it('uses the local calendar day', () => {
    expect(localDate(new Date('2026-11-07T15:00:00Z'), 'America/Vancouver')).toBe('2026-11-07');
    expect(localDate(new Date('2026-11-08T03:00:00Z'), 'America/Vancouver')).toBe('2026-11-07');
  });

  it('warns when planned work passes the capacity', () => {
    expect(capacityStatus(180, 55).over).toBe(false);
    expect(capacityStatus(60, 90)).toMatchObject({ remainingMinutes: -30, over: true });
  });

  it('stops the focus clock while paused and after the app was suspended', () => {
    const start = Date.parse('2026-11-07T16:00:00Z');
    const running = { state: 'running' as const, durationMs: 25 * 60_000, accumulatedMs: 0, startedAt: new Date(start).toISOString() };
    expect(focusRemaining(running, start + 5 * 60_000)).toBe(20 * 60_000);
    const paused = pauseFocus(running, start + 5 * 60_000);
    expect(focusRemaining(paused, start + 40 * 60_000)).toBe(20 * 60_000);
  });

  it('places tomorrow morning in the workspace timezone', () => {
    const at = localMorning('2026-11-08', 'America/Vancouver', 9);
    expect(localDate(at, 'America/Vancouver')).toBe('2026-11-08');
    expect(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', hour: 'numeric', hourCycle: 'h23' }).format(at)).toBe('09');
  });
});
