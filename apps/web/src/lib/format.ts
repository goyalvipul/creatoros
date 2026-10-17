const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : Number(n));

export function bytes(n: unknown): string {
  const v = num(n);
  if (!Number.isFinite(v)) return '—';
  if (v < 1024) return `${v} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2)} ${units[i]}`;
}

export function money(minor: unknown, currency = 'CAD'): string {
  const v = num(minor);
  if (!Number.isFinite(v)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(v / 100);
  } catch {
    return `${(v / 100).toFixed(2)} ${currency}`;
  }
}

/** Accepts ISO strings and raw Postgres timestamps ("2026-10-18 03:47:23.879+00"). */
export function parseDate(value: unknown): Date {
  if (value instanceof Date) return value;
  let s = String(value).trim().replace(' ', 'T');
  s = s.replace(/([+-]\d{2})$/, '$1:00'); // "+00" -> "+00:00"
  return new Date(s);
}

export function when(value: unknown, tz?: string, withTime = true): string {
  if (!value) return '—';
  const d = parseDate(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  }).format(d);
}

export function ago(value: unknown): string {
  if (!value) return 'never';
  const d = parseDate(value).getTime();
  if (Number.isNaN(d)) return String(value);
  const s = Math.round((Date.now() - d) / 1000);
  const abs = Math.abs(s);
  const fmt = (n: number, u: string) => `${n}${u}`;
  const t =
    abs < 60
      ? fmt(abs, 's')
      : abs < 3600
        ? fmt(Math.round(abs / 60), 'm')
        : abs < 86400
          ? fmt(Math.round(abs / 3600), 'h')
          : fmt(Math.round(abs / 86400), 'd');
  return s >= 0 ? `${t} ago` : `in ${t}`;
}

export function title(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function duration(ms: unknown): string {
  const v = num(ms);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const s = Math.round(v / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h
    ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** yyyy-mm-dd for <input type="date"> */
export function dateInput(value?: unknown): string {
  const d = value ? parseDate(value) : new Date();
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export function copy(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

/** Parse a user-typed amount like "1,500.50" into minor units (cents). Returns null when it is not a valid non-negative number. */
export function toMinor(input: string): number | null {
  const n = Number(String(input).replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
