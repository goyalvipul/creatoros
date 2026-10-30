import { Readable } from 'node:stream';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, checkGpuWorker, forbidden, generateLtx, getLtxStudio, listWorkerLoras, openLtxVideo, workerQueue, removeGpuWorker, saveGpuWorker, saveLtxDraft, unauthorized, uploadLtxInput, validateLtx } from '@creatoros/services';
import type { AppDeps } from '../http';
import { ctxFor, makeRouter } from '../http';

const uuid = z.uuid();

const form = z.object({
  projectId: uuid.nullable(),
  workerId: uuid.nullable(),
  imageFileId: uuid.nullable(),
  audioFileId: uuid.nullable(),
  audioStartSec: z.number().min(0).max(3600),
  durationSec: z.number().positive().max(120),
  prompt: z.string().max(20000),
  negativePrompt: z.string().max(20000),
  width: z.number().int().min(64).max(2048),
  height: z.number().int().min(64).max(2048),
  fps: z.number().int().min(1).max(60),
  loraName: z.string().min(1).max(180),
  loraStrength: z.number().min(0).max(2),
  upscaleWidth: z.number().int().min(64).max(4096),
  upscaleHeight: z.number().int().min(64).max(4096),
  wantUpscale: z.boolean(),
  imageUploadName: z.string().max(300).nullable(),
  imageUploadWorkerId: uuid.nullable(),
  audioUploadName: z.string().max(300).nullable(),
  audioUploadWorkerId: uuid.nullable(),
});

export async function comfyRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  await app.register(multipart, { limits: { fileSize: 250 * 1024 * 1024, files: 1 } });
  const route = makeRouter(app, deps);
  const idParam = z.object({ id: uuid });

  route(
    { method: 'GET', url: '/comfy/ltx', tag: 'ComfyUI', summary: 'LTX studio: saved graph, machines, draft and jobs', role: 'OWNER' },
    ({ ctx }) => getLtxStudio(ctx),
  );
  route(
    { method: 'PUT', url: '/comfy/ltx/draft', tag: 'ComfyUI', summary: 'Save the LTX form without starting a render', role: 'OWNER', body: form },
    ({ ctx, body }) => saveLtxDraft(ctx, body),
  );
  route(
    { method: 'POST', url: '/comfy/ltx/validate', tag: 'ComfyUI', summary: 'Check the LTX form locally. Does not contact a GPU.', role: 'OWNER', body: form },
    ({ ctx, body }) => validateLtx(ctx, body),
  );
  route(
    {
      method: 'POST',
      url: '/comfy/ltx/generate',
      tag: 'ComfyUI',
      summary: 'Queue an LTX video on the selected PC',
      role: 'OWNER',
      body: form,
    },
    async ({ ctx, body }) => {
      const result = await generateLtx(ctx, body);
      if (deps.enqueue) {
        try {
          await deps.enqueue('requests', 'ltx', { jobId: result.job.id });
        } catch {
          // The scheduler picks up a job that is still queued.
        }
      }
      return result;
    },
  );
  route(
    {
      method: 'POST',
      url: '/comfy/workers',
      tag: 'ComfyUI',
      summary: 'Add a ComfyUI machine by its private address',
      role: 'OWNER',
      body: z.object({
        label: z.string().min(1).max(80),
        baseUrl: z.string().min(1).max(300),
        role: z.enum(['primary', 'secondary']),
        expectedVramGb: z.number().int().min(1).max(128).nullable(),
      }),
    },
    ({ ctx, body }) => saveGpuWorker(ctx, body),
  );
  route(
    { method: 'POST', url: '/comfy/workers/:id/check', tag: 'ComfyUI', summary: 'Ask that ComfyUI for its stats and model list. Does not render.', role: 'OWNER', params: idParam },
    ({ ctx, params }) => checkGpuWorker(ctx, params.id),
  );
  route(
    { method: 'DELETE', url: '/comfy/workers/:id', tag: 'ComfyUI', summary: 'Remove a ComfyUI machine from the list', role: 'OWNER', params: idParam },
    ({ ctx, params }) => removeGpuWorker(ctx, params.id),
  );
  route(
    { method: 'GET', url: '/comfy/workers/:id/loras', tag: 'ComfyUI', summary: 'List LoRA files installed on that PC', role: 'OWNER', params: idParam },
    ({ ctx, params }) => listWorkerLoras(ctx, params.id),
  );
  route(
    { method: 'GET', url: '/comfy/workers/:id/queue', tag: 'ComfyUI', summary: 'Whether that PC is rendering right now. Does not start a job.', role: 'OWNER', params: idParam },
    ({ ctx, params }) => workerQueue(ctx, params.id),
  );

  app.post('/comfy/workers/:id/upload', { bodyLimit: 260 * 1024 * 1024 }, async (req, reply) => {
    if (!req.session) throw unauthorized();
    if (req.session.role !== 'OWNER') throw forbidden();
    if (req.headers['x-requested-with'] !== 'creatoros') throw forbidden('Cross-site request blocked (CSRF protection).');
    const { id } = idParam.parse(req.params);
    const kind = z.enum(['image', 'audio']).parse((req.query as { kind?: string }).kind);
    const incoming = await req.file();
    if (!incoming) throw new AppError(400, 'BAD_REQUEST', 'Choose a file to upload.');
    const bytes = await incoming.toBuffer();
    const saved = await uploadLtxInput(ctxFor(deps, req), id, kind, { bytes, name: incoming.filename, mime: incoming.mimetype });
    return reply.send({ data: saved, meta: { requestId: req.correlationId }, error: null });
  });

  app.get('/comfy/jobs/:id/video', async (req, reply) => {
    if (!req.session) throw unauthorized();
    if (req.session.role !== 'OWNER') throw forbidden();
    const { id } = idParam.parse(req.params);
    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const { upstream, filename } = await openLtxVideo(deps.db, req.session.orgId, id, range);
    if (upstream.status >= 400 && upstream.status !== 416) {
      throw new AppError(502, 'COMFY_VIDEO', 'The video is not ready to play from that PC.');
    }
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) reply.header(h, v);
    }
    reply.header('cache-control', 'private, no-store');
    reply.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    reply.status(upstream.status);
    if (!upstream.body) return reply.send();
    return reply.send(Readable.fromWeb(upstream.body as import('stream/web').ReadableStream));
  });
}
