import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, apiIdempotencyKeys, eq, sql, type Db } from '@creatoros/db';
import {
  AppError,
  authenticateSession,
  forbidden,
  requireRole,
  unauthorized,
  type AppConfig,
  type ConnectorOverrides,
  type Ctx,
  type SessionInfo,
} from '@creatoros/services';

export const SESSION_COOKIE = 'cos_session';

export interface AppDeps {
  db: Db;
  config: AppConfig;
  /** Test seam: lets tests inject fake connector HTTP / clocks without touching real providers. */
  overrides?: ConnectorOverrides;
  now?: () => Date;
  /** Optional BullMQ-style enqueue hook (used for "scan now"/sync-now when a worker is attached). */
  enqueue?: (queue: string, name: string, data: Record<string, unknown>) => Promise<void>;
}

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionInfo | null;
    rawBody?: string | Buffer;
    correlationId: string;
  }
}

export const RAW = Symbol('raw-reply');
export class WithMeta<T> {
  constructor(
    public data: T,
    public meta: Record<string, unknown>,
  ) {}
}
export const withMeta = <T>(data: T, meta: Record<string, unknown>) => new WithMeta(data, meta);

const jsonSchemaOf = (s: z.ZodType) => {
  const js = z.toJSONSchema(s, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
  delete js.$schema;
  return js;
};

type Role = 'VIEWER' | 'EDITOR' | 'OWNER' | 'public';

export interface RouteOpts<P, Q, B> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  tag: string;
  summary: string;
  /** Minimum role. Defaults: GET → VIEWER, other methods → EDITOR. 'public' skips auth entirely. */
  role?: Role;
  params?: z.ZodType<P>;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B>;
  status?: number;
  bodyLimit?: number;
  rateLimit?: { max: number; timeWindow: string };
}

export interface RouteCtx<P, Q, B> {
  ctx: Ctx;
  session: SessionInfo;
  params: P;
  query: Q;
  body: B;
  req: FastifyRequest;
  reply: FastifyReply;
}

export function ctxFor(deps: AppDeps, req: FastifyRequest): Ctx {
  const s = req.session!;
  return {
    db: deps.db,
    env: deps.config.env,
    orgId: s.orgId,
    userId: s.userId,
    actor: { type: 'user', id: s.userId },
    now: deps.now ?? (() => new Date()),
    correlationId: req.correlationId,
    ip: req.ip,
  };
}

function originAllowed(req: FastifyRequest, deps: AppDeps): boolean {
  const origin = req.headers.origin;
  if (origin) {
    const o = origin.replace(/\/$/, '');
    if (deps.config.allowedOrigins.includes(o)) return true;
    // same-origin through a proxy or LAN address: Origin host equals the Host header
    try {
      return new URL(o).host === (req.headers['x-forwarded-host'] ?? req.headers.host);
    } catch {
      return false;
    }
  }
  // Non-browser clients (curl, scripts, tests) have no Origin; they must send an explicit header, which a cross-site form cannot.
  return Boolean(req.headers['x-requested-with']);
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Private areas: email/CRM/finance, integrations, devices and the media library. A VIEWER can read the creative
 * pipeline (ideas, projects, publishing, calendar) but not these; reads here need at least EDITOR.
 */
const PRIVATE_GET =
  /^\/(threads|messages|opportunities|deals|organizations|contacts|invoices|fx-rates|finance|todo|integrations|connections|devices|pairing-codes|roots|scan-runs|physical-shares|library|files|suggestions|duplicates|actions|briefing|notifications|socials|workflows)(\/|$)/;

export function makeRouter(app: FastifyInstance, deps: AppDeps) {
  return function route<P = unknown, Q = unknown, B = unknown>(
    opts: RouteOpts<P, Q, B>,
    handler: (c: RouteCtx<P, Q, B>) => Promise<unknown> | unknown,
  ) {
    const role: Role =
      opts.role ?? (opts.method === 'GET' && !PRIVATE_GET.test(opts.url) ? 'VIEWER' : 'EDITOR');
    const schema: Record<string, unknown> = { tags: [opts.tag], summary: opts.summary };
    if (opts.params) schema.params = jsonSchemaOf(opts.params);
    if (opts.query) schema.querystring = jsonSchemaOf(opts.query);
    if (opts.body) schema.body = jsonSchemaOf(opts.body);
    if (role !== 'public') schema.security = [{ cookieAuth: [] }];
    app.route({
      method: opts.method,
      url: opts.url,
      schema,
      bodyLimit: opts.bodyLimit,
      config: opts.rateLimit ? { rateLimit: opts.rateLimit } : undefined,
      handler: async (req, reply) => {
        let session: SessionInfo | null = null;
        // Public state-changing routes (login, bootstrap) also refuse browser requests from foreign origins.
        if (role === 'public' && UNSAFE.has(opts.method) && req.headers.origin && !originAllowed(req, deps))
          throw forbidden('Cross-site request blocked (CSRF protection).');
        if (role !== 'public') {
          session = req.session;
          if (!session) throw unauthorized();
          if (UNSAFE.has(opts.method) && !originAllowed(req, deps))
            throw forbidden('Cross-site request blocked (CSRF protection).');
          requireRole(session, role);
        }
        const params = opts.params ? opts.params.parse(req.params) : (undefined as P);
        const query = opts.query ? opts.query.parse(req.query) : (undefined as Q);
        const body = opts.body ? opts.body.parse(req.body ?? {}) : (undefined as B);
        const ctx = session ? ctxFor(deps, req) : (undefined as unknown as Ctx);

        const run = async () =>
          handler({ ctx, session: session as SessionInfo, params, query, body, req, reply });

        const idemKey = req.headers['idempotency-key'];
        if (
          session &&
          UNSAFE.has(opts.method) &&
          typeof idemKey === 'string' &&
          idemKey.length >= 8 &&
          idemKey.length <= 200
        ) {
          return withIdempotency(
            deps.db,
            session,
            opts.method + ' ' + opts.url,
            idemKey,
            req.body,
            reply,
            run,
            opts.status ?? 200,
            req,
          );
        }
        const out = await run();
        return send(reply, req, out, opts.status ?? 200);
      },
    });
  };
}

function send(reply: FastifyReply, req: FastifyRequest, out: unknown, status: number) {
  if (out === RAW || reply.sent) return reply;
  const meta: Record<string, unknown> = { requestId: req.correlationId };
  let data = out;
  if (out instanceof WithMeta) {
    data = out.data;
    Object.assign(meta, out.meta);
  }
  if (data === undefined) data = null;
  return reply.status(status).send({ data, meta, error: null });
}

async function withIdempotency(
  db: Db,
  session: SessionInfo,
  endpoint: string,
  key: string,
  body: unknown,
  reply: FastifyReply,
  run: () => Promise<unknown>,
  status: number,
  req: FastifyRequest,
) {
  const hash = createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');
  const where = and(
    eq(apiIdempotencyKeys.orgId, session.orgId),
    eq(apiIdempotencyKeys.actorId, session.userId),
    eq(apiIdempotencyKeys.endpoint, endpoint),
    eq(apiIdempotencyKeys.key, key),
  );
  // purge expired entries for this key so a key can be reused after 24h
  await db.delete(apiIdempotencyKeys).where(and(where, sql`${apiIdempotencyKeys.expiresAt} < now()`));
  const inserted = await db
    .insert(apiIdempotencyKeys)
    .values({
      orgId: session.orgId,
      actorId: session.userId,
      key,
      endpoint,
      requestHash: hash,
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    })
    .onConflictDoNothing()
    .returning({ id: apiIdempotencyKeys.id });
  if (!inserted.length) {
    const [ex] = await db.select().from(apiIdempotencyKeys).where(where);
    if (ex) {
      if (ex.requestHash !== hash)
        throw new AppError(
          422,
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used with a different request.',
        );
      if (ex.responseStatus == null)
        throw new AppError(
          409,
          'IDEMPOTENCY_IN_PROGRESS',
          'A request with this Idempotency-Key is still being processed.',
        );
      reply.header('idempotent-replay', 'true');
      return reply.status(ex.responseStatus).send(ex.response);
    }
  }
  try {
    const out = await run();
    if (out === RAW || reply.sent) return reply;
    const meta: Record<string, unknown> = { requestId: req.correlationId };
    let data = out;
    if (out instanceof WithMeta) {
      data = out.data;
      Object.assign(meta, out.meta);
    }
    const envelope = { data: data ?? null, meta, error: null };
    // JSON round trip so the stored copy equals what clients get
    await db
      .update(apiIdempotencyKeys)
      .set({ responseStatus: status, response: JSON.parse(JSON.stringify(envelope)) })
      .where(where);
    return reply.status(status).send(envelope);
  } catch (e) {
    // failed attempts are not cached: the client may retry with the same key
    await db.delete(apiIdempotencyKeys).where(where);
    throw e;
  }
}

export function installCore(app: FastifyInstance, deps: AppDeps) {
  app.decorateRequest('session', null);
  app.decorateRequest('correlationId', '');

  app.addHook('onRequest', async (req, reply) => {
    const incoming = req.headers['x-request-id'];
    req.correlationId =
      typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    reply.header('x-request-id', req.correlationId);
    req.session = null;
    const token = (req as any).cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) req.session = await authenticateSession(deps.db, token, deps.now?.());
  });

  // Keep the raw bytes: agent requests are signed over the exact body.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as any).rawBody = body;
    if (!body) return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON'), undefined);
    }
  });
  app.addContentTypeParser(
    ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
    { parseAs: 'buffer' },
    (req, body, done) => {
      (req as any).rawBody = body;
      done(null, body);
    },
  );

  // Zod validates inside the route wrapper (so role checks run first); schemas here are for OpenAPI only.
  app.setValidatorCompiler(() => (data: unknown) => ({ value: data }));
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      data: null,
      meta: { requestId: req.correlationId },
      error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url.split('?')[0]} not found` },
    });
  });

  app.setErrorHandler((err: any, req, reply) => {
    const meta = { requestId: req.correlationId };
    const out = (status: number, code: string, message: string, details?: unknown) =>
      reply
        .status(status)
        .send({ data: null, meta, error: { code, message, ...(details !== undefined ? { details } : {}) } });
    if (err instanceof AppError) return out(err.status, err.code, err.message, err.details);
    if (err instanceof z.ZodError) {
      return out(
        400,
        'VALIDATION_ERROR',
        'Some fields are invalid.',
        err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const pgCode = err?.code ?? err?.cause?.code;
    if (pgCode === '23505') return out(409, 'CONFLICT', 'That already exists.');
    if (pgCode === '23503')
      return out(409, 'REFERENCED', 'This record is linked to other records and cannot be changed that way.');
    if (pgCode === '23514') return out(422, 'CONSTRAINT_VIOLATION', 'The value is not allowed.');
    if (pgCode === '22P02' || pgCode === '22007' || pgCode === '22003')
      return out(400, 'INVALID_VALUE', 'A value has the wrong format.');
    if (err?.statusCode === 429)
      return out(429, 'RATE_LIMITED', 'Too many requests. Slow down and retry shortly.');
    if (err?.statusCode === 413) return out(413, 'PAYLOAD_TOO_LARGE', 'Request is too large.');
    if (err?.statusCode >= 400 && err.statusCode < 500)
      return out(err.statusCode, err.code ?? 'BAD_REQUEST', err.message);
    req.log.error({ err, correlationId: req.correlationId }, 'unhandled error');
    return out(
      500,
      'INTERNAL',
      'Something went wrong. The incident was logged; quote the request id when reporting it.',
    );
  });
}

export const idParam = z.object({ id: z.uuid() });
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(500).optional(),
});
export const coerceDate = z.coerce.date();
export const emptyBody = z.object({}).optional();
