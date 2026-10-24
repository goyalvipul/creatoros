import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sql } from '@creatoros/db';
import {
  AGENT_HEADERS,
  agentConfigSchema,
  heartbeatSchema,
  ingestBatchSchema,
  pairRequestSchema,
} from '@creatoros/domain';
import {
  AppError,
  acceptSuggestion,
  agentHeartbeat,
  authenticateAgent,
  createPairingCode,
  createPhysicalShare,
  createRoot,
  deleteRoot,
  forbidden,
  getAgentConfig,
  getDeviceSigningKey,
  getFileDetail,
  getHashRequests,
  getPreviewRequests,
  libraryCounts,
  listDevices,
  listLibrary,
  listPairingCodes,
  listRoots,
  listScanRuns,
  listSuggestions,
  notFound,
  pairDevice,
  processIngest,
  readPreview,
  rejectSuggestion,
  requestScan,
  revokeDevice,
  rotateAgentToken,
  setFileMarks,
  setFileTags,
  setRootState,
  signAgentFetch,
  signMediaToken,
  storePreview,
  suggestMatches,
  unauthorized,
  updateDevice,
  updateRoot,
  verifyMediaToken,
  type AuthedAgent,
} from '@creatoros/services';
import { idParam, makeRouter, type AppDeps } from '../http';

const boolQ = z.enum(['true', 'false']).transform((v) => v === 'true');

export function storageRoutes(app: FastifyInstance, deps: AppDeps) {
  const route = makeRouter(app, deps);
  const { db, config } = deps;
  const env = config.env;

  // ================================================================ agent (device-token + HMAC signed, outbound-only)
  const bearer = (req: FastifyRequest) => {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  };
  async function agentAuth(req: FastifyRequest): Promise<AuthedAgent> {
    const raw = req.rawBody ?? '';
    return authenticateAgent(
      db,
      env,
      {
        token: bearer(req),
        timestamp: req.headers[AGENT_HEADERS.timestamp] as string | undefined,
        signature: req.headers[AGENT_HEADERS.signature] as string | undefined,
        body: raw,
      },
      deps.now?.(),
    );
  }
  function agentRoute<B = unknown>(
    opts: { method: 'GET' | 'POST'; url: string; summary: string; body?: z.ZodType<B>; bodyLimit?: number },
    handler: (c: { agent: AuthedAgent; body: B; req: FastifyRequest }) => Promise<unknown>,
  ) {
    app.route({
      method: opts.method,
      url: opts.url,
      bodyLimit: opts.bodyLimit,
      schema: {
        tags: ['Agent'],
        summary: opts.summary,
        ...(opts.body ? { body: z.toJSONSchema(opts.body, { unrepresentable: 'any', io: 'input' }) } : {}),
      },
      handler: async (req, reply) => {
        const agent = await agentAuth(req);
        const body = opts.body ? opts.body.parse(req.body ?? {}) : (undefined as B);
        const data = await handler({ agent, body, req });
        return reply.send({ data: data ?? null, meta: { requestId: req.correlationId }, error: null });
      },
    });
  }

  route(
    {
      method: 'POST',
      url: '/agents/pair',
      tag: 'Agent',
      summary: 'Redeem a one-time pairing code (returns device token and signing key once)',
      role: 'public',
      body: pairRequestSchema,
      status: 201,
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    async ({ body, req }) => pairDevice(db, env, body, req.ip),
  );
  agentRoute(
    { method: 'POST', url: '/agents/heartbeat', summary: 'Agent heartbeat', body: heartbeatSchema },
    ({ agent, body }) => agentHeartbeat(db, agent, body),
  );
  agentRoute(
    { method: 'GET', url: '/agents/config', summary: 'Scan configuration for this device' },
    async ({ agent }) => agentConfigSchema.parse(await getAgentConfig(db, agent)),
  );
  agentRoute(
    {
      method: 'POST',
      url: '/agents/ingest',
      summary: 'Ingest a batch of scan observations (idempotent)',
      body: ingestBatchSchema,
      bodyLimit: 16 * 1024 * 1024,
    },
    ({ agent, body }) => processIngest(db, env, agent, body),
  );
  agentRoute(
    { method: 'GET', url: '/agents/hash-requests', summary: 'Files the server wants hashed' },
    ({ agent }) => getHashRequests(db, agent),
  );
  agentRoute(
    { method: 'GET', url: '/agents/preview-requests', summary: 'Files the server wants thumbnails for' },
    async ({ agent }) => db.transaction((tx) => getPreviewRequests(tx, agent.deviceId, 100)),
  );
  agentRoute(
    { method: 'POST', url: '/agents/token/rotate', summary: 'Rotate the device token' },
    ({ agent }) => rotateAgentToken(db, env, agent),
  );
  app.route({
    method: 'POST',
    url: '/agents/previews/:id',
    bodyLimit: 6 * 1024 * 1024,
    schema: { tags: ['Agent'], summary: 'Upload a derived thumbnail (image/jpeg)' },
    handler: async (req, reply) => {
      const agent = await agentAuth(req);
      const { id } = idParam.parse(req.params);
      const bytes = req.rawBody;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0)
        throw new AppError(400, 'EMPTY_BODY', 'Send the image bytes as the request body.');
      const ct = String(req.headers['content-type'] ?? 'image/jpeg').split(';')[0]!;
      const out = await storePreview(db, env, agent, id, bytes, ct);
      return reply.status(201).send({ data: out, meta: { requestId: req.correlationId }, error: null });
    },
  });

  // ================================================================ devices & roots (owner UI)
  route(
    { method: 'GET', url: '/devices', tag: 'Storage', summary: 'Paired devices with health' },
    ({ ctx }) => listDevices(ctx),
  );
  route(
    {
      method: 'PATCH',
      url: '/devices/:id',
      tag: 'Storage',
      summary: 'Rename a device / set its hardware label',
      params: idParam,
      body: z.object({
        displayName: z.string().trim().min(1).max(100).optional(),
        hardwareLabel: z.string().max(200).nullable().optional(),
      }),
    },
    ({ ctx, params, body }) => updateDevice(ctx, params.id, body),
  );
  route(
    {
      method: 'POST',
      url: '/devices/:id/revoke',
      tag: 'Storage',
      summary: 'Revoke a device (it can no longer sync)',
      role: 'OWNER',
      params: idParam,
    },
    async ({ ctx, params }) => {
      await revokeDevice(ctx, params.id);
      return { ok: true };
    },
  );
  route(
    {
      method: 'GET',
      url: '/pairing-codes',
      tag: 'Storage',
      summary: 'Recent pairing codes (codes themselves are never shown again)',
      role: 'OWNER',
    },
    ({ ctx }) => listPairingCodes(ctx),
  );
  route(
    {
      method: 'POST',
      url: '/pairing-codes',
      tag: 'Storage',
      summary: 'Create a one-time pairing code for a new scanner agent',
      role: 'OWNER',
      status: 201,
      body: z.object({ label: z.string().max(100).optional() }),
    },
    ({ ctx, body }) => createPairingCode(ctx, body.label),
  );

  route(
    { method: 'GET', url: '/roots', tag: 'Storage', summary: 'Scan roots with counts and state' },
    ({ ctx }) => listRoots(ctx),
  );
  const rootFields = {
    label: z.string().trim().min(1).max(100),
    accessMethod: z.enum(['LOCAL', 'SMB', 'NFS_MOUNT', 'SERVER_MOUNT']).optional(),
    recursive: z.boolean().optional(),
    includeGlobs: z.array(z.string().max(200)).max(50).optional(),
    excludeGlobs: z.array(z.string().max(200)).max(50).optional(),
    extensions: z.array(z.string().max(20)).max(100).optional(),
    scanIntervalMinutes: z.number().int().min(1).max(10080).optional(),
    settleSeconds: z.number().int().min(0).max(3600).optional(),
    hashMode: z.enum(['all', 'candidates', 'off']).optional(),
    followLinks: z.boolean().optional(),
    smbPath: z.string().max(500).nullable().optional(),
    mountPath: z.string().max(500).nullable().optional(),
    physicalShareId: z.uuid().nullable().optional(),
    brandId: z.uuid().nullable().optional(),
    projectId: z.uuid().nullable().optional(),
    autoTagRules: z
      .array(
        z.object({
          pattern: z.string().max(200),
          tags: z.array(z.string().max(60)).optional(),
          brandId: z.uuid().optional(),
          projectId: z.uuid().optional(),
        }),
      )
      .max(50)
      .optional(),
  };
  route(
    {
      method: 'POST',
      url: '/roots',
      tag: 'Storage',
      summary: 'Add a scan root on a device',
      role: 'OWNER',
      status: 201,
      body: z.object({ deviceId: z.uuid(), displayPath: z.string().trim().min(1).max(1000), ...rootFields }),
    },
    ({ ctx, body }) => createRoot(ctx, body),
  );
  route(
    {
      method: 'PATCH',
      url: '/roots/:id',
      tag: 'Storage',
      summary: 'Edit a scan root',
      role: 'OWNER',
      params: idParam,
      body: z.object(rootFields).partial(),
    },
    ({ ctx, params, body }) => updateRoot(ctx, params.id, body),
  );
  route(
    {
      method: 'DELETE',
      url: '/roots/:id',
      tag: 'Storage',
      summary: 'Remove a retired folder and its index records (files on disk are never touched)',
      role: 'OWNER',
      params: idParam,
    },
    ({ ctx, params }) => deleteRoot(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/roots/:id/scan',
      tag: 'Storage',
      summary: 'Ask the agent to scan (or reconcile) now',
      params: idParam,
      body: z.object({ kind: z.enum(['scan', 'reconcile']).optional() }),
      status: 202,
    },
    ({ ctx, params, body }) => requestScan(ctx, params.id, body.kind),
  );
  route(
    {
      method: 'POST',
      url: '/roots/:id/state',
      tag: 'Storage',
      summary: 'Pause, resume or retire a root',
      role: 'OWNER',
      params: idParam,
      body: z.object({ state: z.enum(['ACTIVE', 'PAUSED', 'RETIRED']) }),
    },
    ({ ctx, params, body }) => setRootState(ctx, params.id, body.state),
  );
  route(
    {
      method: 'GET',
      url: '/scan-runs',
      tag: 'Storage',
      summary: 'Recent scan runs',
      query: z.object({ rootId: z.uuid().optional(), limit: z.coerce.number().int().max(200).optional() }),
    },
    ({ ctx, query }) => listScanRuns(ctx, query.rootId, query.limit),
  );
  route(
    {
      method: 'POST',
      url: '/physical-shares',
      tag: 'Storage',
      summary: 'Declare a NAS/SMB share so several machines are recognised as the same storage',
      role: 'OWNER',
      status: 201,
      body: z.object({
        name: z.string().trim().min(1).max(100),
        host: z.string().max(200).optional(),
        shareName: z.string().max(200).optional(),
        uncPath: z.string().max(500).optional(),
        notes: z.string().max(1000).optional(),
      }),
    },
    ({ ctx, body }) => createPhysicalShare(ctx, body),
  );

  // ================================================================ library
  route(
    {
      method: 'GET',
      url: '/library',
      tag: 'Library',
      summary: 'Search and filter every known file across machines (keyset pagination)',
      query: z.object({
        q: z.string().max(200).optional(),
        kind: z.string().max(20).optional(),
        availability: z.string().max(40).optional(),
        rootId: z.uuid().optional(),
        deviceId: z.uuid().optional(),
        tagId: z.uuid().optional(),
        assetId: z.uuid().optional(),
        linked: boolQ.optional(),
        duplicates: boolQ.optional(),
        orientation: z.enum(['landscape', 'portrait', 'square', 'unknown']).optional(),
        pending: z.enum(['youtube', 'instagram', 'tiktok']).optional(),
        extra: z.enum(['exclude', 'include', 'only']).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().max(500).optional(),
      }),
    },
    ({ ctx, query }) => listLibrary(ctx, query),
  );
  route(
    {
      method: 'GET',
      url: '/library/counts',
      tag: 'Library',
      summary: 'Counts with explicit definitions (instances vs exact objects vs logical assets)',
    },
    ({ ctx }) => libraryCounts(ctx),
  );
  route(
    {
      method: 'PUT',
      url: '/library/marks',
      tag: 'Library',
      summary: 'Toggle uploaded/extra marks on a file (idempotent)',
      body: z.object({
        fileInstanceId: z.uuid().optional(),
        mediaObjectId: z.uuid().optional(),
        tag: z.enum(['uploaded:youtube', 'uploaded:instagram', 'uploaded:tiktok', 'extra']),
        on: z.boolean(),
      }),
    },
    ({ ctx, body }) => setFileMarks(ctx, body),
  );
  route(
    {
      method: 'GET',
      url: '/files/:id',
      tag: 'Library',
      summary: 'File detail: copies, availability, paths, links',
      params: idParam,
    },
    ({ ctx, params }) => getFileDetail(ctx, params.id),
  );
  route(
    {
      method: 'PUT',
      url: '/files/:id/tags',
      tag: 'Library',
      summary: 'Replace tags on a file',
      params: idParam,
      body: z.object({ tags: z.array(z.string().trim().min(1).max(60)).max(50) }),
    },
    ({ ctx, params, body }) => setFileTags(ctx, params.id, body.tags),
  );
  route(
    {
      method: 'GET',
      url: '/files/:id/suggestions',
      tag: 'Library',
      summary: 'Suggested asset matches (never auto-linked)',
      params: idParam,
    },
    ({ ctx, params }) => listSuggestions(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/files/:id/suggestions',
      tag: 'Library',
      summary: 'Compute match suggestions for a file',
      params: idParam,
    },
    ({ ctx, params }) => suggestMatches(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/suggestions/:id/accept',
      tag: 'Library',
      summary: 'Accept a suggestion (links the file)',
      params: idParam,
      body: z.object({ versionId: z.uuid().optional() }),
    },
    ({ ctx, params, body }) => acceptSuggestion(ctx, params.id, body.versionId),
  );
  route(
    {
      method: 'POST',
      url: '/suggestions/:id/reject',
      tag: 'Library',
      summary: 'Reject a suggestion',
      params: idParam,
    },
    ({ ctx, params }) => rejectSuggestion(ctx, params.id),
  );

  app.get(
    '/files/:id/preview',
    {
      schema: {
        tags: ['Library'],
        summary: 'Thumbnail (cached, derived; the original is never modified)',
        security: [{ cookieAuth: [] }],
      },
    },
    async (req, reply) => {
      if (!req.session) throw unauthorized();
      const { id } = idParam.parse(req.params);
      const ctx = {
        db,
        env,
        orgId: req.session.orgId,
        userId: req.session.userId,
        actor: { type: 'user' as const, id: req.session.userId },
        now: () => new Date(),
      };
      const p = await readPreview(ctx, id);
      if (!p) throw notFound('Preview');
      return reply
        .header('content-type', p.contentType)
        .header('cache-control', 'private, max-age=3600')
        .send(p.bytes);
    },
  );

  // ---- streaming: API proxies HTTP range requests to the owning agent (agent never exposes itself to the internet)
  route(
    {
      method: 'POST',
      url: '/files/:id/stream-token',
      tag: 'Library',
      summary: 'Short-lived URL for external players',
      params: idParam,
    },
    async ({ ctx, params, session }) => {
      const exp = Date.now() + 15 * 60_000;
      const token = signMediaToken(env.agentPairingSecret, {
        instanceId: params.id,
        userId: session.userId,
        exp,
      });
      void ctx;
      return {
        url: `${env.appBaseUrl}/api/v1/files/${params.id}/stream?token=${encodeURIComponent(token)}`,
        expiresAt: new Date(exp),
      };
    },
  );

  app.get(
    '/files/:id/stream',
    { schema: { tags: ['Library'], summary: 'Stream a file from its machine (supports Range)' } },
    async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const token = (req.query as any)?.token as string | undefined;
      if (!req.session) {
        const ok = token ? verifyMediaToken(env.agentPairingSecret, token) : null;
        if (!ok || ok.instanceId !== id) throw unauthorized();
      }
      const orgFilter = req.session ? sql`and f.org_id = ${req.session.orgId}` : sql``;
      const r = (await db.execute(sql`
      select f.id, f.root_id as "rootId", f.display_path as "displayPath", f.file_name as "fileName", f.mime, f.availability, f.org_id as "orgId",
             d.id as "deviceId", d.state as "deviceState", d.listen_urls as "listenUrls", r.state as "rootState"
      from file_instances f join devices d on d.id = f.device_id join storage_roots r on r.id = f.root_id
      where f.id = ${id} ${orgFilter}`)) as unknown as { rows: any[] };
      const f = r.rows[0];
      if (!f) throw notFound('File');
      if (f.deviceState === 'REVOKED') throw forbidden('This device was revoked.');
      if (f.deviceState !== 'ONLINE')
        throw new AppError(
          503,
          'DEVICE_OFFLINE',
          'The machine that holds this file is offline right now. It is not missing; it will be playable when the machine is back.',
        );
      if (['CONFIRMED_MISSING', 'MISSING_CANDIDATE'].includes(f.availability))
        throw new AppError(
          410,
          'FILE_MISSING',
          'This file was not found on its machine during the last scan.',
        );
      const key = await getDeviceSigningKey(env, f.deviceId, db);
      if (!key) throw new AppError(503, 'NO_KEY', 'Device cannot serve files.');
      const exp = Math.floor(Date.now() / 1000) + 120;
      const sig = signAgentFetch(key, f.rootId, f.displayPath, exp);
      const loopback = deps.config.env.processEnv.AGENT_LOOPBACK_HOST;
      const urls: string[] = (f.listenUrls as string[]).map((u) =>
        loopback ? u.replace(/\/\/(127\.0\.0\.1|localhost)/, `//${loopback}`) : u,
      );
      if (!urls.length)
        throw new AppError(
          503,
          'NO_LISTEN_URL',
          'The agent has not reported an address the server can reach.',
        );
      const range = req.headers.range;
      const ac = new AbortController();
      reply.raw.on('close', () => ac.abort());
      let upstream: Response | null = null;
      let lastErr = '';
      for (const base of urls) {
        try {
          const u = `${base.replace(/\/$/, '')}/v1/stream?root=${encodeURIComponent(f.rootId)}&path=${encodeURIComponent(f.displayPath)}&exp=${exp}&sig=${sig}`;
          const connect = new AbortController();
          const connectTimer = setTimeout(() => connect.abort(), 15_000);
          try {
            upstream = await fetch(u, {
              headers: range ? { range } : {},
              signal: AbortSignal.any([ac.signal, connect.signal]),
            });
          } finally {
            clearTimeout(connectTimer);
          }
          if (upstream.status < 500) break;
          lastErr = `HTTP ${upstream.status}`;
          upstream = null;
        } catch (e) {
          lastErr = String(e);
        }
      }
      if (!upstream)
        throw new AppError(
          503,
          'AGENT_UNREACHABLE',
          `Could not reach the agent (${lastErr}). Check that the PC is on and the agent is running.`,
        );
      if (upstream.status === 404)
        throw new AppError(410, 'FILE_MISSING', 'The agent could not find this file on disk.');
      if (upstream.status >= 400 && upstream.status !== 416)
        throw new AppError(502, 'AGENT_ERROR', `Agent refused the request (${upstream.status}).`);
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified']) {
        const v = upstream.headers.get(h);
        if (v) reply.header(h, v);
      }
      reply
        .header('cache-control', 'private, no-store')
        .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.fileName)}`);
      reply.status(upstream.status);
      if (!upstream.body) return reply.send();
      return reply.send(Readable.fromWeb(upstream.body as any));
    },
  );
}
