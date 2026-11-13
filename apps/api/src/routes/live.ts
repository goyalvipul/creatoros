import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  streamHeartbeat,
  agentJob,
  agentReport,
  browseStreamMachine,
  createLiveSession,
  createStreamMachine,
  startLiveSession,
  duplicateLiveSession,
  forbidden,
  getLiveSession,
  listLiveAccounts,
  listLivePlaylists,
  listLiveSessions,
  listStreamMachines,
  liveState,
  liveUploadPath,
  openLiveUpload,
  recordLiveUpload,
  requireRole,
  deleteStreamMachine,
  revokeStreamMachine,
  saveLivePlaylist,
  stopLiveSession,
  unauthorized,
  updateStreamRoots,
} from '@creatoros/services';
import { YOUTUBE_LIVE_UNSUPPORTED } from '@creatoros/domain';
import type { AppDeps } from '../http';
import { ctxFor, makeRouter } from '../http';

const uuid = z.uuid();
const item = z.object({
  source: z.enum(['library', 'upload', 'agent']),
  name: z.string().max(300).optional(),
  fileInstanceId: uuid.optional(),
  uploadId: uuid.optional(),
  agentRelative: z.string().max(500).optional(),
});
const settings = z.object({
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().max(100)).max(30).optional(),
  categoryId: z.string().max(10).optional(),
  language: z.string().max(16).optional(),
  privacy: z.enum(['public', 'unlisted', 'private']).optional(),
  madeForKids: z.boolean().optional(),
  synthetic: z.boolean().nullable().optional(),
  ageRestricted: z.boolean().optional(),
  paidPromotion: z.boolean().nullable().optional(),
  ads: z.enum(['unset', 'on', 'off']).optional(),
  captions: z.enum(['off', 'embedded']).optional(),
  license: z.enum(['youtube', 'creativeCommon']).optional(),
  enableDvr: z.boolean().optional(),
  enableEmbed: z.boolean().optional(),
  recordFromStart: z.boolean().optional(),
  enableAutoStart: z.boolean().optional(),
  enableAutoStop: z.boolean().optional(),
  latency: z.enum(['normal', 'low', 'ultraLow']).optional(),
  loop: z.boolean().optional(),
  resolution: z.enum(['720p', '1080p']).optional(),
  mode: z.enum(['youtube', 'manual']).optional(),
  scheduledStart: z.string().datetime().nullable().optional(),
  thumbnailFileId: uuid.nullable().optional(),
});

function bearer(header: string | undefined) {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? '';
}

export async function liveRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const route = makeRouter(app, deps);
  const env = deps.config.env;

  route({ method: 'GET', url: '/live/state', tag: 'Live', summary: 'Active livestream and the configured time limits' }, ({ ctx }) =>
    liveState(ctx),
  );
  route(
    { method: 'GET', url: '/live/limits', tag: 'Live', summary: 'Fields YouTube Studio still has to confirm' },
    () => ({ unsupported: YOUTUBE_LIVE_UNSUPPORTED }),
  );
  route({ method: 'GET', url: '/live/accounts', tag: 'Live', summary: 'YouTube channels and livestream permission' }, ({ ctx }) =>
    listLiveAccounts(ctx),
  );
  route({ method: 'GET', url: '/live/machines', tag: 'Live', summary: 'Streaming computers' }, ({ ctx }) => listStreamMachines(ctx));
  route(
    {
      method: 'POST',
      url: '/live/machines',
      role: 'OWNER',
      tag: 'Live',
      summary: 'Pair a streaming computer. The token is returned once.',
      body: z.object({ displayName: z.string().min(1).max(80), os: z.enum(['windows', 'linux', 'mac']) }),
    },
    ({ ctx, body }) => createStreamMachine(ctx, body),
  );
  route(
    {
      method: 'PATCH',
      url: '/live/machines/:id',
      role: 'OWNER',
      tag: 'Live',
      summary: 'Approved media folders for one streaming computer',
      params: z.object({ id: uuid }),
      body: z.object({ roots: z.array(z.string().min(1).max(500)).max(50) }),
    },
    ({ ctx, params, body }) => updateStreamRoots(ctx, params.id, body.roots),
  );
  route(
    {
      method: 'POST',
      url: '/live/machines/:id/browse',
      tag: 'Live',
      summary: 'Ask the streaming computer to list one approved folder',
      params: z.object({ id: uuid }),
      body: z.object({ path: z.string().min(1).max(500) }),
    },
    ({ ctx, params, body }) => browseStreamMachine(ctx, params.id, body.path),
  );
  route(
    {
      method: 'POST',
      url: '/live/machines/:id/revoke',
      role: 'OWNER',
      tag: 'Live',
      summary: 'Revoke a streaming computer',
      params: z.object({ id: uuid }),
    },
    ({ ctx, params }) => revokeStreamMachine(ctx, params.id),
  );
  route(
    {
      method: 'DELETE',
      url: '/live/machines/:id',
      role: 'OWNER',
      tag: 'Live',
      summary: 'Remove a streaming computer. Past livestreams stay. Files on that computer stay.',
      params: z.object({ id: uuid }),
    },
    ({ ctx, params }) => deleteStreamMachine(ctx, params.id),
  );
  route({ method: 'GET', url: '/live/playlists', tag: 'Live', summary: 'Saved livestream playlists' }, ({ ctx }) =>
    listLivePlaylists(ctx),
  );
  route(
    {
      method: 'POST',
      url: '/live/playlists',
      tag: 'Live',
      summary: 'Save a playlist. Saving does not change a livestream that already started.',
      body: z.object({ id: uuid.nullable().optional(), name: z.string().min(1).max(120), items: z.array(item).max(200) }),
    },
    ({ ctx, body }) => saveLivePlaylist(ctx, body),
  );
  route(
    {
      method: 'GET',
      url: '/live/sessions',
      tag: 'Live',
      summary: 'Livestream history or the open job',
      query: z.object({ history: z.enum(['0', '1']).optional() }),
    },
    ({ ctx, query }) => listLiveSessions(ctx, query.history === '1'),
  );
  route(
    {
      method: 'POST',
      url: '/live/sessions',
      tag: 'Live',
      summary: 'Prepare a livestream and hand it to the selected computer',
      body: z.object({
        machineId: uuid,
        socialAccountId: uuid.nullable().optional(),
        playlistId: uuid.nullable().optional(),
        playlistName: z.string().max(120).nullable().optional(),
        title: z.string().max(100).optional(),
        items: z.array(item).min(1).max(200),
        settings,
        stopMinutes: z.number().int().min(1).max(660).optional(),
        rtmpUrl: z.string().max(300).nullable().optional(),
        streamKey: z.string().max(200).nullable().optional(),
      }),
    },
    ({ ctx, body }) => createLiveSession(ctx, { ...body, title: body.title ?? '' }),
  );
  route(
    {
      method: 'POST',
      url: '/live/sessions/:id/start',
      tag: 'Live',
      summary: 'Open the YouTube broadcast and send the saved video',
      params: z.object({ id: uuid }),
      body: z.object({
        socialAccountId: uuid.nullable().optional(),
        title: z.string().min(1).max(100),
        settings,
        stopMinutes: z.number().int().min(1).max(660).optional(),
        rtmpUrl: z.string().max(300).nullable().optional(),
        streamKey: z.string().max(200).nullable().optional(),
      }),
    },
    ({ ctx, params, body }) => startLiveSession(ctx, params.id, body),
  );
  route(
    { method: 'GET', url: '/live/sessions/:id', tag: 'Live', summary: 'One livestream', params: z.object({ id: uuid }) },
    ({ ctx, params }) => getLiveSession(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/live/sessions/:id/stop',
      tag: 'Live',
      summary: 'Stop a livestream. Force stop is owner only.',
      params: z.object({ id: uuid }),
      body: z.object({ force: z.boolean().optional() }),
    },
    ({ ctx, session, params, body }) => {
      if (body.force && session.role !== 'OWNER') throw forbidden('Force stop is limited to the owner.');
      return stopLiveSession(ctx, params.id, body.force === true);
    },
  );
  route(
    {
      method: 'POST',
      url: '/live/sessions/:id/duplicate',
      tag: 'Live',
      summary: 'Copy a finished livestream into a new draft. It does not reuse the YouTube broadcast.',
      params: z.object({ id: uuid }),
    },
    ({ ctx, params }) => duplicateLiveSession(ctx, params.id),
  );

  app.post('/live/agent/heartbeat', async (req) => {
    const data = await streamHeartbeat(deps.db, bearer(req.headers.authorization), (req.body ?? {}) as never);
    if (!data) throw unauthorized();
    return { data, meta: { requestId: req.correlationId }, error: null };
  });
  app.get('/live/agent/job', async (req) => {
    const data = await agentJob(deps.db, env, bearer(req.headers.authorization));
    if (!data) throw unauthorized();
    return { data, meta: { requestId: req.correlationId }, error: null };
  });
  app.post('/live/agent/report', async (req) => {
    const data = await agentReport(
      deps.db,
      env,
      bearer(req.headers.authorization),
      (req.body ?? {}) as never,
      (deps.overrides?.fetch as typeof fetch | undefined) ?? fetch,
    );
    if (!data) throw unauthorized();
    return { data, meta: { requestId: req.correlationId }, error: null };
  });
  app.get('/live/agent/file/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const opened = await openLiveUpload(deps.db, env, bearer(req.headers.authorization), id);
    if (!opened) throw unauthorized();
    if (opened.sha256) reply.header('x-content-sha256', opened.sha256);
    reply.header('content-disposition', 'attachment');
    return reply.send(createReadStream(opened.path));
  });

  app.post('/live/uploads', async (req) => {
      if (!req.session) throw unauthorized();
      requireRole(req.session, 'EDITOR');
      if (req.headers['x-requested-with'] !== 'creatoros') throw forbidden('Cross-site request blocked.');
      const ctx = ctxFor(deps, req);
      const saved = [];
      const parts = req.files();
      for await (const part of parts) {
        const name = path.basename(part.filename || 'video').slice(0, 300);
        const id = randomUUID();
        const full = liveUploadPath(env, ctx.orgId, id);
        await mkdir(path.dirname(full), { recursive: true });
        const hash = createHash('sha256');
        let size = 0;
        const hasher = new Transform({
          transform(chunk, _enc, cb) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buf.length;
            hash.update(buf);
            cb(null, buf);
          },
        });
        try {
          await pipeline(part.file, hasher, createWriteStream(full));
          if (!size) {
            await rm(full, { force: true });
            continue;
          }
          saved.push(
            await recordLiveUpload(ctx, {
              id,
              name,
              relativePath: null,
              byteSize: size,
              sha256: hash.digest('hex'),
              mime: part.mimetype || 'application/octet-stream',
            }),
          );
        } catch (e) {
          await rm(full, { force: true });
          throw e;
        }
      }
      return { data: saved, meta: { requestId: req.correlationId }, error: null };
    });
}
