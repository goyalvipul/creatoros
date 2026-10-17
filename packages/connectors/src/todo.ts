import {
  ConnectorError,
  type Connector,
  type ConnectorCapabilities,
  type ConnectorContext,
  type ConnectResult,
  type Credentials,
  type HealthResult,
  type RateLimitBudget,
  type SyncResult,
} from './types';
import { http } from './http';

/**
 * Generic adapter for the owner's self-hosted Todoist-like PWA. The real API is discovered at setup time, so
 * endpoints and field names are configuration, not code. See docs/TODO_ADAPTER_CONTRACT.md + openapi/todo-adapter.yaml.
 */
export interface TodoConfig {
  baseUrl: string;
  authScheme?: 'bearer' | 'header' | 'none';
  authHeader?: string; // for scheme 'header'
  endpoints?: Partial<Record<'create' | 'get' | 'update' | 'list' | 'findByRef' | 'health', string>>;
  fieldMap?: Partial<Record<keyof RemoteTaskFields, string>>;
  priorityMap?: Record<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT', string | number>;
  /** How completion is represented remotely. */
  completion?: { style: 'boolean' | 'status'; doneValue?: string; openValue?: string };
  projectId?: string;
  defaultTags?: string[];
}

export interface RemoteTaskFields {
  id: string;
  title: string;
  description: string;
  dueAt: string;
  timezone: string;
  priority: string;
  completed: string;
  completedAt: string;
  revision: string;
  externalRef: string;
  project: string;
  tags: string;
  remindAt: string;
}

export interface RemoteTask {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  priority: string | number | null;
  completed: boolean;
  completedAt: string | null;
  revision: string | null;
  externalRef: string | null;
  raw: unknown;
}

export interface TaskDraft {
  title: string;
  description?: string | null;
  dueAt?: string | null;
  timezone?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  completed?: boolean;
  externalRef?: string;
  remindAt?: string | null;
  tags?: string[];
}

export const DEFAULT_ENDPOINTS = {
  create: 'POST /tasks',
  get: 'GET /tasks/{id}',
  update: 'PATCH /tasks/{id}',
  list: 'GET /tasks',
  findByRef: 'GET /tasks?external_ref={ref}',
  health: 'GET /health',
} as const;

export const DEFAULT_FIELDS: RemoteTaskFields = {
  id: 'id',
  title: 'title',
  description: 'description',
  dueAt: 'due_at',
  timezone: 'timezone',
  priority: 'priority',
  completed: 'completed',
  completedAt: 'completed_at',
  revision: 'updated_at',
  externalRef: 'external_ref',
  project: 'project_id',
  tags: 'tags',
  remindAt: 'remind_at',
};

function getPath(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj: any, path: string, value: any) {
  const parts = path.split('.');
  let cur = obj;
  parts.slice(0, -1).forEach((p) => (cur = cur[p] ??= {}));
  cur[parts[parts.length - 1]] = value;
}

export class TodoConnector implements Connector<RemoteTask, any> {
  readonly id = 'todo' as const;

  private cfg(ctx: ConnectorContext): Required<Pick<TodoConfig, 'baseUrl'>> & TodoConfig {
    const c = ctx.config as TodoConfig | undefined;
    if (!c?.baseUrl)
      throw new ConnectorError(
        'NOT_CONFIGURED',
        'Todo API base URL is not configured. Set it in Integrations → Todo.',
      );
    return c as any;
  }
  private fields(ctx: ConnectorContext): RemoteTaskFields {
    return { ...DEFAULT_FIELDS, ...((ctx.config as TodoConfig).fieldMap ?? {}) };
  }
  private endpoint(
    ctx: ConnectorContext,
    key: keyof typeof DEFAULT_ENDPOINTS,
  ): { method: string; path: string } {
    const raw = ((ctx.config as TodoConfig).endpoints?.[key] ?? DEFAULT_ENDPOINTS[key]) as string;
    const [method, ...rest] = raw.split(' ');
    return { method: method.toUpperCase(), path: rest.join(' ') };
  }
  private headers(ctx: ConnectorContext): Record<string, string> {
    const cfg = this.cfg(ctx);
    const token = ctx.credentials.apiKey ?? ctx.credentials.accessToken;
    const h: Record<string, string> = { accept: 'application/json' };
    if (cfg.authScheme === 'none' || !token) return h;
    if (cfg.authScheme === 'header') h[cfg.authHeader ?? 'x-api-key'] = token;
    else h.authorization = `Bearer ${token}`;
    return h;
  }
  private url(ctx: ConnectorContext, path: string, vars: Record<string, string> = {}): string {
    let p = path;
    for (const [k, v] of Object.entries(vars)) p = p.replace(`{${k}}`, encodeURIComponent(v));
    return this.cfg(ctx).baseUrl.replace(/\/+$/, '') + (p.startsWith('/') ? p : `/${p}`);
  }

  normalize(raw: any): RemoteTask {
    const f = this.fields({ config: {} } as any);
    return this.normalizeWith(raw, f, undefined);
  }

  private normalizeWith(raw: any, f: RemoteTaskFields, cfg: TodoConfig | undefined): RemoteTask {
    const completedRaw = getPath(raw, f.completed);
    const doneValue = cfg?.completion?.doneValue ?? 'done';
    const completed =
      cfg?.completion?.style === 'status' ? String(completedRaw) === doneValue : Boolean(completedRaw);
    const rev = getPath(raw, f.revision);
    return {
      id: String(getPath(raw, f.id)),
      title: String(getPath(raw, f.title) ?? ''),
      description: getPath(raw, f.description) ?? null,
      dueAt: getPath(raw, f.dueAt) ?? null,
      priority: getPath(raw, f.priority) ?? null,
      completed,
      completedAt: getPath(raw, f.completedAt) ?? null,
      revision: rev != null ? String(rev) : null,
      externalRef: getPath(raw, f.externalRef) ?? null,
      raw,
    };
  }

  private toRemote(ctx: ConnectorContext, d: Partial<TaskDraft>): Record<string, any> {
    const f = this.fields(ctx);
    const cfg = ctx.config as TodoConfig;
    const body: Record<string, any> = {};
    if (d.title !== undefined) setPath(body, f.title, d.title);
    if (d.description !== undefined) setPath(body, f.description, d.description);
    if (d.dueAt !== undefined) setPath(body, f.dueAt, d.dueAt);
    if (d.timezone !== undefined) setPath(body, f.timezone, d.timezone);
    if (d.remindAt !== undefined) setPath(body, f.remindAt, d.remindAt);
    if (d.externalRef !== undefined) setPath(body, f.externalRef, d.externalRef);
    if (d.priority !== undefined && cfg.priorityMap) setPath(body, f.priority, cfg.priorityMap[d.priority]);
    if (d.tags !== undefined || cfg.defaultTags)
      setPath(body, f.tags, [...(cfg.defaultTags ?? []), ...(d.tags ?? [])]);
    if (cfg.projectId) setPath(body, f.project, cfg.projectId);
    if (d.completed !== undefined) {
      if (cfg.completion?.style === 'status')
        setPath(
          body,
          f.completed,
          d.completed ? (cfg.completion.doneValue ?? 'done') : (cfg.completion.openValue ?? 'open'),
        );
      else setPath(body, f.completed, d.completed);
    }
    return body;
  }

  async createTask(ctx: ConnectorContext, draft: TaskDraft, idempotencyKey: string): Promise<RemoteTask> {
    const ep = this.endpoint(ctx, 'create');
    const { data } = await http<any>(ctx, this.url(ctx, ep.path), {
      method: ep.method,
      headers: { ...this.headers(ctx), 'idempotency-key': idempotencyKey },
      json: this.toRemote(ctx, draft),
      idempotent: true, // protected by Idempotency-Key + findByRef pre-check done by the caller
    });
    return this.normalizeWith(data?.data ?? data, this.fields(ctx), ctx.config as TodoConfig);
  }

  /** Find an already created remote task by our stable external reference (prevents duplicate creation after retries). */
  async findByRef(ctx: ConnectorContext, ref: string): Promise<RemoteTask | null> {
    const ep = this.endpoint(ctx, 'findByRef');
    try {
      const { data } = await http<any>(ctx, this.url(ctx, ep.path, { ref }), {
        method: ep.method,
        headers: this.headers(ctx),
      });
      const list: any[] = Array.isArray(data) ? data : (data?.data ?? data?.items ?? data?.tasks ?? []);
      const f = this.fields(ctx);
      const hit = list.find((t) => getPath(t, f.externalRef) === ref);
      return hit ? this.normalizeWith(hit, f, ctx.config as TodoConfig) : null;
    } catch (e) {
      if (e instanceof ConnectorError && (e.kind === 'NOT_FOUND' || e.kind === 'BAD_REQUEST')) return null;
      throw e;
    }
  }

  async getTask(ctx: ConnectorContext, id: string): Promise<RemoteTask | null> {
    const ep = this.endpoint(ctx, 'get');
    try {
      const { data } = await http<any>(ctx, this.url(ctx, ep.path, { id }), {
        method: ep.method,
        headers: this.headers(ctx),
      });
      return this.normalizeWith(data?.data ?? data, this.fields(ctx), ctx.config as TodoConfig);
    } catch (e) {
      if (e instanceof ConnectorError && e.kind === 'NOT_FOUND') return null;
      throw e;
    }
  }

  /** Update only the provided fields. `revision` is sent as If-Match (ETag) when known; 412 => ConnectorError('CONFLICT'). */
  async updateTask(
    ctx: ConnectorContext,
    id: string,
    patch: Partial<TaskDraft>,
    revision?: string | null,
  ): Promise<RemoteTask> {
    const ep = this.endpoint(ctx, 'update');
    const headers: Record<string, string> = { ...this.headers(ctx) };
    if (revision) headers['if-match'] = revision;
    const { data } = await http<any>(ctx, this.url(ctx, ep.path, { id }), {
      method: ep.method,
      headers,
      json: this.toRemote(ctx, patch),
      idempotent: true,
    });
    return this.normalizeWith(data?.data ?? data, this.fields(ctx), ctx.config as TodoConfig);
  }

  async listTasks(ctx: ConnectorContext, since?: string | null): Promise<RemoteTask[]> {
    const ep = this.endpoint(ctx, 'list');
    const { data } = await http<any>(ctx, this.url(ctx, ep.path), {
      method: ep.method,
      headers: this.headers(ctx),
      query: since ? { updated_since: since } : undefined,
    });
    const list: any[] = Array.isArray(data) ? data : (data?.data ?? data?.items ?? data?.tasks ?? []);
    const f = this.fields(ctx);
    return list.map((t) => this.normalizeWith(t, f, ctx.config as TodoConfig));
  }

  async getCapabilities(ctx: ConnectorContext): Promise<ConnectorCapabilities> {
    const configured = Boolean((ctx.config as TodoConfig | undefined)?.baseUrl);
    return {
      provider: 'todo',
      state: configured ? 'ACTIVE' : 'NOT_CONFIGURED',
      read: configured,
      write: configured,
      incrementalSync: configured,
      flags: { createTask: configured, updateTask: configured, readCompletion: configured, etag: configured },
      blockers: configured ? [] : ['Todo API is not configured.'],
      setupSteps: [
        'Open the Todo PWA, find its API base URL and generate an API token (do not share the database).',
        'Enter the base URL + token in Integrations → Todo. Adjust endpoint paths and field names if they differ from the defaults.',
        'Press "Test connection", then link or create tasks from the Today queue.',
      ],
    };
  }

  async connect(ctx: ConnectorContext): Promise<ConnectResult> {
    const caps = await this.getCapabilities(ctx);
    return caps.state === 'ACTIVE'
      ? { status: 'CONNECTED' }
      : { status: 'NOT_CONFIGURED', steps: caps.setupSteps };
  }
  async disconnect(): Promise<void> {}
  async refreshCredentials(ctx: ConnectorContext): Promise<Credentials> {
    return ctx.credentials;
  }

  async health(ctx: ConnectorContext): Promise<HealthResult> {
    const now = new Date(ctx.now()).toISOString();
    try {
      const ep = this.endpoint(ctx, 'health');
      await http(ctx, this.url(ctx, ep.path), {
        method: ep.method,
        headers: this.headers(ctx),
        maxAttempts: 1,
      });
      return { ok: true, state: 'ACTIVE', checkedAt: now };
    } catch (e) {
      const err = e as ConnectorError;
      if (err.kind === 'NOT_CONFIGURED')
        return { ok: false, state: 'NOT_CONFIGURED', detail: err.message, checkedAt: now };
      // Some apps have no /health. Fall back to listing one page.
      try {
        await this.listTasks(ctx);
        return { ok: true, state: 'ACTIVE', checkedAt: now };
      } catch (e2) {
        const er = e2 as ConnectorError;
        return {
          ok: false,
          state: er.kind === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : 'OFFLINE',
          detail: er.message,
          checkedAt: now,
        };
      }
    }
  }

  async rateLimitBudget(): Promise<RateLimitBudget> {
    return { remaining: null, limit: null, resetsAt: null, estimated: true };
  }

  async getExternalRecord(ctx: ConnectorContext, id: string): Promise<RemoteTask | null> {
    return this.getTask(ctx, id);
  }

  async syncFull(ctx: ConnectorContext): Promise<SyncResult<RemoteTask>> {
    const items = await this.listTasks(ctx);
    return { items, nextCursor: new Date(ctx.now()).toISOString(), hasMore: false };
  }
  async syncIncremental(ctx: ConnectorContext, cursor: string | null): Promise<SyncResult<RemoteTask>> {
    const next = new Date(ctx.now()).toISOString();
    const items = await this.listTasks(ctx, cursor);
    return { items, nextCursor: next, hasMore: false };
  }
}
