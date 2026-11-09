import { describe, expect, it } from 'vitest';
import { nextLocalHour } from './notifications';

describe('nextLocalHour', () => {
  it('lands on the requested hour in America/Vancouver', () => {
    const now = new Date('2026-03-08T09:30:00.000Z');
    const at = nextLocalHour(now, 'America/Vancouver', 8);
    expect(at.getTime()).toBeGreaterThan(now.getTime());
    const hour = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Vancouver',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(at);
    expect(hour).toBe('08');
  });
});
