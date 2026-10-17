/** Time-zone helpers that rely only on Intl (DST safe). All persisted instants are UTC. */

export const DEFAULT_TIMEZONE = 'America/Vancouver';

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `tz` from UTC at the given instant (positive = ahead of UTC). */
export function tzOffsetMs(instant: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}

/** Convert a wall-clock time in `tz` to the matching UTC instant (non-existent DST gaps roll forward). */
export function zonedToUtc(local: LocalParts, tz: string): Date {
  const guess = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour ?? 0,
    local.minute ?? 0,
    local.second ?? 0,
  );
  let utc = guess - tzOffsetMs(guess, tz);
  const off2 = tzOffsetMs(utc, tz);
  utc = guess - off2;
  return new Date(utc);
}

export function utcToZonedParts(date: Date | string, tz: string): Required<LocalParts> & { weekday: number } {
  const d = new Date(date);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const p = Object.fromEntries(dtf.formatToParts(d).map((x) => [x.type, x.value]));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: weekdays.indexOf(String(p.weekday)),
  };
}

/** Parse `YYYY-MM-DDTHH:mm` (no zone) as wall-clock time in `tz`. */
export function parseLocalDateTime(value: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!m) throw new Error(`Invalid local date-time: ${value}`);
  return zonedToUtc(
    {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: Number(m[4] ?? 0),
      minute: Number(m[5] ?? 0),
      second: Number(m[6] ?? 0),
    },
    tz,
  );
}

export function formatInZone(date: Date | string, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...opts,
  }).format(new Date(date));
}

/** Local calendar day (YYYY-MM-DD) of an instant in `tz`. */
export function localDay(date: Date | string, tz: string): string {
  const p = utcToZonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** UTC instant of local midnight at the start of the day containing `date` in `tz`. */
export function startOfLocalDay(date: Date | string, tz: string): Date {
  const p = utcToZonedParts(date, tz);
  return zonedToUtc({ year: p.year, month: p.month, day: p.day }, tz);
}

/** Add whole local calendar days (DST safe: keeps wall-clock time). */
export function addLocalDays(date: Date | string, days: number, tz: string): Date {
  const p = utcToZonedParts(date, tz);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedToUtc(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: p.hour,
      minute: p.minute,
      second: p.second,
    },
    tz,
  );
}

/** True when `date` falls inside a quiet-hours window like "22:00"-"07:00" in the zone. */
export function inQuietHours(date: Date, tz: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const p = utcToZonedParts(date, tz);
  const cur = p.hour * 60 + p.minute;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  if (s === e) return false;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}
