import { ConnectorError, type ConnectorContext } from './types';

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  query?: Record<string, string | number | boolean | undefined | null>;
  json?: unknown;
  form?: Record<string, string>;
  maxAttempts?: number;
  /** Request timeout in ms (default 30s). */
  timeoutMs?: number;
  /** Do not retry non-idempotent requests unless caller supplies an Idempotency-Key. */
  idempotent?: boolean;
}

export function jitter(baseMs: number, attempt: number, capMs = 30_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(exp / 2 + Math.random() * (exp / 2));
}

export function parseRetryAfter(h: string | null, now: number): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (!Number.isNaN(s)) return Math.max(0, s * 1000);
  const d = Date.parse(h);
  return Number.isNaN(d) ? undefined : Math.max(0, d - now);
}

export function classifyHttpError(status: number, body: string, headers: Headers, now: number): ConnectorError {
  const retryAfterMs = parseRetryAfter(headers.get('retry-after'), now);
  const snippet = body.slice(0, 300);
  if (status === 401) return new ConnectorError('AUTH_EXPIRED', `Unauthorized: ${snippet}`, { status });
  if (status === 403) {
    if (/quota|rateLimit|dailyLimit/i.test(body)) return new ConnectorError('QUOTA_EXCEEDED', `Quota exceeded: ${snippet}`, { status, retryAfterMs });
    return new ConnectorError('PERMISSION_DENIED', `Forbidden: ${snippet}`, { status });
  }
  if (status === 404) return new ConnectorError('NOT_FOUND', `Not found: ${snippet}`, { status });
  if (status === 409 || status === 412) return new ConnectorError('CONFLICT', `Conflict: ${snippet}`, { status });
  if (status === 429) return new ConnectorError('RATE_LIMITED', `Rate limited: ${snippet}`, { status, retryAfterMs: retryAfterMs ?? 5000 });
  if (status >= 500) return new ConnectorError('SERVER', `Server error ${status}: ${snippet}`, { status });
  return new ConnectorError('BAD_REQUEST', `HTTP ${status}: ${snippet}`, { status });
}

function buildUrl(url: string, query?: RequestOptions['query']): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}

/**
 * HTTP wrapper with timeout, structured errors and exponential backoff with jitter for 429/5xx/network
 * errors. Non-idempotent requests (POST without idempotency key) are never retried automatically.
 */
export async function http<T = unknown>(ctx: ConnectorContext, url: string, opts: RequestOptions = {}): Promise<{ data: T; headers: Headers; status: number }> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const method = (opts.method ?? 'GET').toUpperCase();
  const retryable = method === 'GET' || method === 'HEAD' || method === 'PUT' || method === 'DELETE' || opts.idempotent === true;
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const headers = new Headers(opts.headers);
    let body: string | undefined;
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    } else if (opts.form) {
      body = new URLSearchParams(opts.form).toString();
      headers.set('content-type', 'application/x-www-form-urlencoded');
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 30_000);
    try {
      const res = await ctx.fetch(buildUrl(url, opts.query), { ...opts, method, headers, body, signal: ac.signal });
      clearTimeout(timer);
      const text = await res.text();
      if (!res.ok) {
        const err = classifyHttpError(res.status, text, res.headers, ctx.now());
        if (err.retryable && retryable && attempt < maxAttempts - 1) {
          await sleep(err.retryAfterMs ?? jitter(500, attempt));
          lastErr = err;
          continue;
        }
        throw err;
      }
      let data: unknown = text;
      const ct = res.headers.get('content-type') ?? '';
      if (text && (ct.includes('json') || /^[\[{]/.test(text.trim()))) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      } else if (!text) data = null;
      return { data: data as T, headers: res.headers, status: res.status };
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof ConnectorError) throw e;
      const err = new ConnectorError('NETWORK', `Network error: ${String((e as Error)?.message ?? e)}`, { cause: e });
      if (retryable && attempt < maxAttempts - 1) {
        await sleep(jitter(500, attempt));
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new ConnectorError('NETWORK', 'request failed');
}

/** Ensure the access token is valid (skew tolerant). Refreshes via the provider callback when needed. */
export async function ensureFreshToken(
  ctx: ConnectorContext,
  refresh: (ctx: ConnectorContext) => Promise<import('./types').Credentials>,
  skewMs = 120_000,
): Promise<string> {
  const c = ctx.credentials;
  if (!c.accessToken && !c.refreshToken) throw new ConnectorError('NOT_CONFIGURED', 'No credentials stored. Connect the account first.');
  if (c.accessToken && (!c.expiresAt || c.expiresAt - skewMs > ctx.now())) return c.accessToken;
  if (!c.refreshToken) throw new ConnectorError('AUTH_EXPIRED', 'Access token expired and no refresh token is available. Reconnect the account.');
  const next = await refresh(ctx);
  ctx.credentials = next;
  await ctx.onCredentials?.(next);
  return next.accessToken!;
}
