import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConnectorError, type ConnectorContext } from './types';

/** Workspace OS publishes tasks here and accepts changes back. See the contract pasted by the owner. */
export const WORKSPACE_API_PATH = '/api/v1/integrations/creatoros';

export interface WorkspaceTask {
  id: string;
  externalId: string | null;
  title: string;
  description: string | null;
  status: 'open' | 'completed' | 'archived';
  priority: number | null;
  completedAt: string | null;
  dueDate: string | null;
  dueAtUtc: string | null;
  dueTimezone: string | null;
  projectId: string | null;
  projectName: string | null;
  labels: string[];
  deletedAt: string | null;
  version: number;
  raw: unknown;
}

export interface WorkspacePage {
  tasks: WorkspaceTask[];
  nextCursor: string | null;
}

const SKEW_SECONDS = 300;

/** HMAC over `timestamp + "." + rawBody`. Rejects a clock skew over 5 minutes. */
export function verifyWorkspaceSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
  nowMs = Date.now(),
): boolean {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > SKEW_SECONDS) return false;
  const want = `v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  const a = Buffer.from(want);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Origin only. Rejects userinfo and link-local or metadata hosts. */
export function workspaceOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Workspace OS address is not a URL.');
  }
  if (url.username || url.password) throw new Error('The address cannot contain a username or password.');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Use an http or https address.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '169.254.169.254' || host.startsWith('169.254.') || host === 'metadata.google.internal')
    throw new Error('That address is not allowed.');
  return url.origin;
}

export function workspaceApi(baseUrl: string, path: string): string {
  return `${workspaceOrigin(baseUrl)}${WORKSPACE_API_PATH}${path}`;
}

function asTask(raw: any): WorkspaceTask | null {
  const t = raw?.task ?? raw;
  if (!t || typeof t !== 'object' || !t.id) return null;
  const status = t.status === 'completed' || t.status === 'archived' ? t.status : 'open';
  return {
    id: String(t.id),
    externalId: t.externalId ? String(t.externalId) : null,
    title: String(t.title ?? ''),
    description: t.description ?? null,
    status,
    priority: t.priority == null ? null : Number(t.priority),
    completedAt: t.completedAt ?? null,
    dueDate: t.dueDate ?? null,
    dueAtUtc: t.dueAtUtc ?? null,
    dueTimezone: t.dueTimezone ?? null,
    projectId: t.projectId ?? null,
    projectName: t.projectName ?? null,
    labels: Array.isArray(t.labels) ? t.labels.map(String) : [],
    deletedAt: t.deletedAt ?? null,
    version: Number(t.version ?? 0),
    raw: t,
  };
}

async function call(
  ctx: ConnectorContext,
  baseUrl: string,
  path: string,
  init: { method?: string; query?: Record<string, string>; json?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const token = ctx.credentials.apiKey ?? ctx.credentials.accessToken;
  if (!token) throw new ConnectorError('NOT_CONFIGURED', 'Workspace OS access token is not set.');
  const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${token}` };
  let body: string | undefined;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    headers['content-type'] = 'application/json';
  }
  const url = new URL(workspaceApi(baseUrl, path));
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await ctx.fetch(url.toString(), { method: init.method ?? 'GET', headers, body });
  const text = await res.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: { message: text.slice(0, 300) } };
    }
  }
  return { status: res.status, body: parsed };
}

function fail(status: number, body: any): never {
  const code = body?.error?.code ?? '';
  const message = body?.error?.message ?? `Workspace OS returned HTTP ${status}`;
  if (code === 'CREATOROS_DISABLED')
    throw new ConnectorError('CONFLICT', 'Publishing is paused in Workspace OS.', { status });
  if (code === 'VERSION_CONFLICT') {
    const err = new ConnectorError('CONFLICT', message, { status });
    (err as ConnectorError & { current?: WorkspaceTask | null }).current = asTask(body?.error?.current);
    throw err;
  }
  if (status === 401 || status === 403) throw new ConnectorError('AUTH_EXPIRED', message, { status });
  if (status === 404) throw new ConnectorError('NOT_FOUND', message, { status });
  if (status === 429) throw new ConnectorError('RATE_LIMITED', message, { status, retryAfterMs: 5000 });
  if (status >= 500) throw new ConnectorError('SERVER', message, { status });
  throw new ConnectorError('BAD_REQUEST', message, { status });
}

export async function listWorkspaceTasks(
  ctx: ConnectorContext,
  baseUrl: string,
  cursor?: string | null,
): Promise<WorkspacePage> {
  const { status, body } = await call(ctx, baseUrl, '/tasks', {
    query: { limit: '200', ...(cursor ? { cursor } : {}) },
  });
  if (status >= 400) fail(status, body);
  const list = body?.tasks ?? body?.data?.tasks ?? (Array.isArray(body) ? body : []);
  return {
    tasks: (list as unknown[]).map(asTask).filter((t): t is WorkspaceTask => Boolean(t)),
    nextCursor: body?.nextCursor ?? body?.data?.nextCursor ?? null,
  };
}

export async function createWorkspaceTask(
  ctx: ConnectorContext,
  baseUrl: string,
  input: Record<string, unknown>,
): Promise<{ task: WorkspaceTask | null; created: boolean }> {
  const { status, body } = await call(ctx, baseUrl, '/tasks', { method: 'POST', json: input });
  if (status >= 400) fail(status, body);
  const task = asTask(body?.task ?? body);
  return { task, created: body?.created !== false && status === 201 };
}

export async function patchWorkspaceTask(
  ctx: ConnectorContext,
  baseUrl: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<WorkspaceTask> {
  const { status, body } = await call(ctx, baseUrl, `/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    json: patch,
  });
  if (status >= 400) fail(status, body);
  const task = asTask(body?.task ?? body);
  if (!task) throw new ConnectorError('SERVER', 'Workspace OS did not return the task.');
  return task;
}

/** One-page probe used by Test connection. */
export async function probeWorkspace(ctx: ConnectorContext, baseUrl: string): Promise<void> {
  const { status, body } = await call(ctx, baseUrl, '/tasks', { query: { limit: '1' } });
  if (status >= 400) fail(status, body);
}
