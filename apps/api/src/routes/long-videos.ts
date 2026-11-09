import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  addLongVideoFromLibrary,
  addLongVideoRef,
  createLongVideo,
  deleteLongVideoScene,
  badRequest,
  forbidden,
  getLongVideo,
  listLongVideos,
  openLongVideoFile,
  queueLongVideoScene,
  rebalanceLongVideo,
  removeLongVideoRef,
  requestLongVideoExport,
  saveLongVideoAudio,
  setLongVideoBatch,
  splitLongVideoScene,
  unauthorized,
  updateLongVideo,
  updateLongVideoScene,
} from '@creatoros/services';
import { ctxFor, type AppDeps } from '../http';

const idParam = z.object({ id: z.string().uuid() });
const sceneParam = z.object({ id: z.string().uuid(), sceneId: z.string().uuid() });

function editor(req: FastifyRequest) {
  if (!req.session) throw unauthorized();
  if (req.session.role === 'VIEWER') throw forbidden();
  if (req.headers['x-requested-with'] !== 'creatoros') throw forbidden('Cross-site request blocked (CSRF protection).');
}

export function longVideoRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/long-videos', async (req) => {
    if (!req.session) throw unauthorized();
    const rows = await listLongVideos(ctxFor(deps, req));
    return { data: rows, meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/long-videos', async (req) => {
    editor(req);
    const body = z.object({ title: z.string().min(1).max(160), brandId: z.string().uuid().nullable().optional(), aspect: z.string().max(80).optional() }).parse(req.body);
    const row = await createLongVideo(ctxFor(deps, req), body);
    return { data: row, meta: { requestId: req.correlationId }, error: null };
  });

  app.get('/long-videos/:id', async (req) => {
    if (!req.session) throw unauthorized();
    const { id } = idParam.parse(req.params);
    return { data: await getLongVideo(ctxFor(deps, req), id), meta: { requestId: req.correlationId }, error: null };
  });

  app.patch('/long-videos/:id', async (req) => {
    editor(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        title: z.string().min(1).max(160).optional(),
        aspect: z.string().max(80).optional(),
        megapixels: z.union([z.literal(0.5), z.literal(1), z.literal(1.5)]).optional(),
        taskMode: z.enum(['i2v', 'ref', 'v2v', 'l2v']).optional(),
        continuity: z.enum(['shot', 'context', 'context_swap']).optional(),
        refSize: z.enum(['max', 'match']).optional(),
        fps: z.union([z.literal(24), z.literal(30)]).optional(),
        workerId: z.string().uuid().nullable().optional(),
        targetSceneMs: z.number().int().optional(),
      })
      .parse(req.body);
    return { data: await updateLongVideo(ctxFor(deps, req), id, body), meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/long-videos/:id/audio', { bodyLimit: 90 * 1024 * 1024 }, async (req) => {
    editor(req);
    const { id } = idParam.parse(req.params);
    const incoming = await req.file();
    if (!incoming) throw badRequest('Choose a song file.');
    const saved = await saveLongVideoAudio(ctxFor(deps, req), id, { bytes: await incoming.toBuffer(), name: incoming.filename });
    return { data: saved, meta: { requestId: req.correlationId }, error: null };
  });

  app.get('/long-videos/:id/audio', async (req, reply) => {
    if (!req.session) throw unauthorized();
    const { id } = idParam.parse(req.params);
    const file = await openLongVideoFile(ctxFor(deps, req), id, 'audio');
    const info = await stat(file.abs);
    const ext = file.abs.split('.').pop();
    const type = ext === 'wav' ? 'audio/wav' : ext === 'flac' ? 'audio/flac' : ext === 'm4a' || ext === 'aac' ? 'audio/mp4' : 'audio/mpeg';
    reply.header('content-type', type);
    reply.header('accept-ranges', 'bytes');
    const range = req.headers.range;
    const match = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : info.size - 1;
      reply.status(206);
      reply.header('content-range', `bytes ${start}-${end}/${info.size}`);
      reply.header('content-length', String(end - start + 1));
      return reply.send(createReadStream(file.abs, { start, end }));
    }
    reply.header('content-length', String(info.size));
    return reply.send(createReadStream(file.abs));
  });

  app.get('/long-videos/:id/export', async (req, reply) => {
    if (!req.session) throw unauthorized();
    const { id } = idParam.parse(req.params);
    const file = await openLongVideoFile(ctxFor(deps, req), id, 'export');
    reply.header('content-type', 'video/mp4');
    reply.header('content-disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    return reply.send(createReadStream(file.abs));
  });

  app.get('/long-videos/:id/scenes/:sceneId/video', async (req, reply) => {
    if (!req.session) throw unauthorized();
    const params = sceneParam.parse(req.params);
    const which = z.enum(['current', 'prior']).optional().parse((req.query as { take?: string }).take) ?? 'current';
    const file = await openLongVideoFile(ctxFor(deps, req), params.id, which === 'prior' ? 'prior-take' : 'take', params.sceneId);
    reply.header('content-type', 'video/mp4');
    reply.header('accept-ranges', 'bytes');
    return reply.send(createReadStream(file.abs));
  });

  app.get('/long-videos/:id/refs/:refId', async (req, reply) => {
    if (!req.session) throw unauthorized();
    const params = z.object({ id: z.string().uuid(), refId: z.string().uuid() }).parse(req.params);
    const file = await openLongVideoFile(ctxFor(deps, req), params.id, 'ref', params.refId);
    const ext = file.abs.split('.').pop();
    reply.header('content-type', ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
    reply.header('cache-control', 'private, max-age=3600');
    return reply.send(createReadStream(file.abs));
  });

  app.post('/long-videos/:id/rebalance', async (req) => {
    editor(req);
    const { id } = idParam.parse(req.params);
    return { data: await rebalanceLongVideo(ctxFor(deps, req), id), meta: { requestId: req.correlationId }, error: null };
  });

  app.patch('/long-videos/:id/scenes/:sceneId', async (req) => {
    editor(req);
    const params = sceneParam.parse(req.params);
    const body = z.object({ label: z.string().max(80).optional(), prompt: z.string().max(4000).optional(), mode: z.enum(['vocal', 'broll']).optional(), continuity: z.enum(['shot', 'context']).optional(), durationSec: z.number().min(1).max(120).optional() }).parse(req.body);
    return { data: await updateLongVideoScene(ctxFor(deps, req), params.id, params.sceneId, body), meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/long-videos/:id/scenes/:sceneId/split', async (req) => {
    editor(req);
    const params = sceneParam.parse(req.params);
    return { data: await splitLongVideoScene(ctxFor(deps, req), params.id, params.sceneId), meta: { requestId: req.correlationId }, error: null };
  });

  app.delete('/long-videos/:id/scenes/:sceneId', async (req) => {
    editor(req);
    const params = sceneParam.parse(req.params);
    return { data: await deleteLongVideoScene(ctxFor(deps, req), params.id, params.sceneId), meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/long-videos/:id/library', async (req) => {
    editor(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ fileId: z.string().uuid(), sceneId: z.string().uuid().nullable().optional() }).parse(req.body);
    return { data: await addLongVideoFromLibrary(ctxFor(deps, req), id, body.fileId, body.sceneId ?? null), meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/long-videos/:id/refs', { bodyLimit: 25 * 1024 * 1024 }, async (req) => {
    editor(req);
    const { id } = idParam.parse(req.params);
    const sceneId = z.string().uuid().optional().parse((req.query as { sceneId?: string }).sceneId);
    const incoming = await req.file();
    if (!incoming) throw badRequest('Choose a picture.');
    const saved = await addLongVideoRef(ctxFor(deps, req), id, sceneId ?? null, { bytes: await incoming.toBuffer(), name: incoming.filename });
    return { data: saved, meta: { requestId: req.correlationId }, error: null };
  });

  app.delete('/long-videos/:id/refs/:refId', async (req) => {
    editor(req);
    const params = z.object({ id: z.string().uuid(), refId: z.string().uuid() }).parse(req.params);
    await removeLongVideoRef(ctxFor(deps, req), params.id, params.refId);
    return { data: { ok: true }, meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/long-videos/:id/scenes/:sceneId/generate', async (req) => {
    editor(req);
    const params = sceneParam.parse(req.params);
    return { data: await queueLongVideoScene(ctxFor(deps, req), params.id, params.sceneId), meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/long-videos/:id/batch', async (req) => {
    editor(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ state: z.enum(['run', 'pause', 'off']) }).parse(req.body);
    return { data: await setLongVideoBatch(ctxFor(deps, req), id, body.state), meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/long-videos/:id/export', async (req) => {
    editor(req);
    const { id } = idParam.parse(req.params);
    return { data: await requestLongVideoExport(ctxFor(deps, req), id), meta: { requestId: req.correlationId }, error: null };
  });
}
