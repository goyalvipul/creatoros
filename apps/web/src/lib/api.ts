'use client';

import useSWR, { mutate as globalMutate, type SWRConfiguration } from 'swr';

export type Row = Record<string, any>;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const camelKey = (k: string) => (k.includes('_') ? k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()) : k);

/** Some list endpoints return raw SQL rows (snake_case). The UI always works with camelCase. */
export function camelize<T = any>(v: any): T {
  if (Array.isArray(v)) return v.map(camelize) as T;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Row = {};
    for (const [k, x] of Object.entries(v)) out[camelKey(k)] = camelize(x);
    return out as T;
  }
  return v;
}

export function qs(params?: Record<string, unknown>): string {
  if (!params) return '';
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export interface CallOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, unknown>;
  idempotencyKey?: string;
  silent401?: boolean;
}

export async function api<T = any>(path: string, opts: CallOpts = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { 'x-requested-with': 'creatoros', accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}${qs(opts.query)}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check that Creator OS is running and you are online.');
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    if (res.status === 401 && !opts.silent401) onUnauthorized?.();
    throw new ApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? `Request failed (${res.status})`, json?.error?.details);
  }
  return camelize<T>(json?.data ?? null);
}

const fetcher = (key: string) => api(key);

export function useApi<T = any>(path: string | null, config?: SWRConfiguration & { query?: Record<string, unknown> }) {
  const key = path ? `${path}${qs(config?.query)}` : null;
  return useSWR<T, ApiError>(key, fetcher, { revalidateOnFocus: true, shouldRetryOnError: false, keepPreviousData: true, ...config });
}

/** Re-fetch every cached GET whose key starts with one of the prefixes (or all when none given). */
export function refresh(...prefixes: string[]) {
  return globalMutate((key) => typeof key === 'string' && (prefixes.length === 0 || prefixes.some((p) => key.startsWith(p))));
}

export const post = <T = any>(path: string, body?: unknown, o: Omit<CallOpts, 'method' | 'body'> = {}) => api<T>(path, { ...o, method: 'POST', body: body ?? {} });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });
