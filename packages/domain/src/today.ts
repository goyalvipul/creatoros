/** Local calendar day and focus-timer math. The timer is timestamps, not a running interval. */

export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** 09:00 on a YYYY-MM-DD in the named timezone, as a UTC instant. */
export function localMorning(day: string, timeZone: string, hour = 9): Date {
  const [year, month, date] = day.split('-').map(Number);
  const want = Date.UTC(year!, (month ?? 1) - 1, date ?? 1, hour, 0);
  let guess = want;
  for (let i = 0; i < 3; i += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(guess));
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
    const seen = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
    guess += want - seen;
  }
  return new Date(guess);
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function capacityStatus(capacityMinutes: number, plannedMinutes: number) {
  const capacity = Math.max(0, capacityMinutes);
  const planned = Math.max(0, plannedMinutes);
  const remaining = capacity - planned;
  return { capacityMinutes: capacity, plannedMinutes: planned, remainingMinutes: remaining, over: remaining < 0 };
}

export type FocusClock = {
  state: 'running' | 'paused' | 'done';
  durationMs: number;
  accumulatedMs: number;
  startedAt: string | null;
};

/** Remaining milliseconds. A paused or backgrounded clock does not keep counting. */
export function focusRemaining(clock: FocusClock, nowMs: number): number {
  if (clock.state === 'done') return 0;
  const live = clock.state === 'running' && clock.startedAt ? Math.max(0, nowMs - Date.parse(clock.startedAt)) : 0;
  return Math.max(0, clock.durationMs - clock.accumulatedMs - live);
}

export function pauseFocus(clock: FocusClock, nowMs: number): FocusClock {
  if (clock.state !== 'running' || !clock.startedAt) return { ...clock, state: 'paused', startedAt: null };
  return {
    ...clock,
    state: 'paused',
    startedAt: null,
    accumulatedMs: clock.accumulatedMs + Math.max(0, nowMs - Date.parse(clock.startedAt)),
  };
}
