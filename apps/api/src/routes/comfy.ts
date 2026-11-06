import { Readable } from 'node:stream';
import { attachmentHeaders } from '../attachment';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, checkGpuWorker, forbidden, generateH3, generateLtx, generateQwen, getH3Studio, getLtxStudio, getQwenStudio, listWorkerLoras, openLtxVideo, openQwenAudio, sliceAudioRange, toPlayableAudio, openWorkerInput, workerQueue, removeGpuWorker, saveGpuWorker, saveH3Draft, saveLtxDraft, saveQwenDraft, unauthorized, uploadLtxInput, validateLtx, listWindowsTasks, addWindowsTask, removeWindowsTask, requestWindowsTaskRestart } from '@creatoros/services';
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
  const qwenForm = z.object({
    projectId: uuid.nullable().optional(),
    workerId: uuid.nullable(),
    audioFileId: uuid.nullable(),
    audioUploadName: z.string().max(300).nullable(),
    audioUploadWorkerId: uuid.nullable(),
    useBuiltin: z.boolean(),
    builtinClip: z.enum(['mehakdeepvoice.wav', 'MehakDeep.wav', 'MehakNormal.wav']).default('mehakdeepvoice.wav'),
    referenceText: z.string().max(50000),
    targetText: z.string().max(20000),
  });
  route(
    { method: 'GET', url: '/comfy/audio', tag: 'ComfyUI', summary: 'Voice clone studio: machines, draft and recent jobs', role: 'OWNER' },
    ({ ctx }) => getQwenStudio(ctx),
  );
  route(
    { method: 'PUT', url: '/comfy/audio/draft', tag: 'ComfyUI', summary: 'Save the voice form without starting a job', role: 'OWNER', body: qwenForm },
    ({ ctx, body }) => saveQwenDraft(ctx, body),
  );
  route(
    {
      method: 'POST',
      url: '/comfy/audio/generate',
      tag: 'ComfyUI',
      summary: 'Queue a Qwen3 voice clone on the selected PC',
      role: 'OWNER',
      body: qwenForm,
    },
    async ({ ctx, body }) => {
      const result = await generateQwen(ctx, body);
      if (deps.enqueue) {
        try {
          await deps.enqueue('requests', 'qwen', { jobId: result.job.id });
        } catch {
          // The scheduler picks up a job that is still queued.
        }
      }
      return result;
    },
  );
  const h3Image = z.object({
    fileId: uuid.nullable(),
    uploadName: z.string().max(300).nullable(),
    uploadWorkerId: uuid.nullable(),
    shared: z.boolean(),
  });
  const h3Segment = z.object({
    continuity: z.enum(['shot', 'context', 'context_swap']),
    taskMode: z.enum(['i2v', 'ref', 'v2v', 'l2v']),
    refImageSize: z.enum(['max', 'match']).default('max'),
    prompt: z.string().max(50000),
    audioFileId: uuid.nullable(),
    audioUploadName: z.string().max(300).nullable(),
    audioUploadWorkerId: uuid.nullable(),
    durationSec: z.number().positive().max(20).nullable(),
    images: z.array(h3Image).max(8),
  });
  const h3Form = z.object({
    projectId: uuid.nullable(),
    workerId: uuid.nullable(),
    imageFileId: uuid.nullable(),
    imageUploadName: z.string().max(300).nullable(),
    imageUploadWorkerId: uuid.nullable(),
    prompt: z.string().max(50000),
    aspectRatio: z.enum([
      '9:16 (Portrait Widescreen)',
      '16:9 (Landscape Widescreen)',
      '1:1 (Square)',
      '3:4 (Portrait)',
      '4:3 (Landscape)',
      '2:3 (Portrait)',
      '3:2 (Landscape)',
    ]),
    megapixels: z.union([z.literal(0.5), z.literal(1), z.literal(1.5)]),
    audioLocked: z.boolean(),
    shareAudio: z.boolean(),
    segments: z.array(h3Segment).max(8),
  });
  route(
    { method: 'GET', url: '/comfy/h3', tag: 'ComfyUI', summary: 'MiniMax H3 studio: machines, draft and recent jobs', role: 'OWNER' },
    ({ ctx }) => getH3Studio(ctx),
  );
  route(
    { method: 'PUT', url: '/comfy/h3/draft', tag: 'ComfyUI', summary: 'Save the MiniMax form without starting a render', role: 'OWNER', body: h3Form },
    ({ ctx, body }) => saveH3Draft(ctx, body),
  );
  route(
    {
      method: 'POST',
      url: '/comfy/h3/generate',
      tag: 'ComfyUI',
      summary: 'Queue a MiniMax H3 video on the selected PC',
      role: 'OWNER',
      body: h3Form,
    },
    async ({ ctx, body }) => {
      const result = await generateH3(ctx, body);
      if (deps.enqueue) {
        try {
          await deps.enqueue('requests', 'h3', { jobId: result.job.id });
        } catch {
          // The scheduler picks up a job that is still queued.
        }
      }
      return result;
    },
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
    { method: 'GET', url: '/comfy/windows-tasks', tag: 'ComfyUI', summary: 'Windows scheduled tasks the owner can see and restart', role: 'OWNER' },
    ({ ctx }) => listWindowsTasks(ctx),
  );
  route(
    {
      method: 'POST',
      url: '/comfy/windows-tasks',
      tag: 'ComfyUI',
      summary: 'Remember a Task Scheduler name on a paired PC',
      role: 'OWNER',
      body: z.object({
        deviceId: uuid,
        label: z.string().min(1).max(80),
        taskName: z.string().min(1).max(200),
      }),
    },
    ({ ctx, body }) => addWindowsTask(ctx, body),
  );
  route(
    { method: 'DELETE', url: '/comfy/windows-tasks/:id', tag: 'ComfyUI', summary: 'Stop watching a scheduled task', role: 'OWNER', params: idParam },
    ({ ctx, params }) => removeWindowsTask(ctx, params.id),
  );
  route(
    { method: 'POST', url: '/comfy/windows-tasks/:id/restart', tag: 'ComfyUI', summary: 'Ask that PC to stop and start this scheduled task', role: 'OWNER', params: idParam },
    ({ ctx, params }) => requestWindowsTaskRestart(ctx, params.id),
  );
  route(
    { method: 'GET', url: '/comfy/workers/:id/queue', tag: 'ComfyUI', summary: 'Whether that PC is rendering right now. Does not start a job.', role: 'OWNER', params: idParam },
    ({ ctx, params }) => workerQueue(ctx, params.id),
  );
  app.get('/comfy/workers/:id/input', async (req, reply) => {
    if (!req.session) throw unauthorized();
    if (req.session.role !== 'OWNER') throw forbidden();
    const { id } = idParam.parse(req.params);
    const name = z.string().min(1).max(300).parse((req.query as { name?: string }).name);
    const { upstream, filename } = await openWorkerInput(ctxFor(deps, req), id, name);
    const type = upstream.headers.get('content-type');
    if (type) reply.header('content-type', type);
    reply.header('cache-control', 'private, max-age=3600');
    reply.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    reply.status(upstream.status);
    return reply.send(Readable.fromWeb(upstream.body as import('stream/web').ReadableStream));
  });

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

  app.get('/comfy/jobs/:id/audio', async (req, reply) => {
    if (!req.session) throw unauthorized();
    if (req.session.role !== 'OWNER') throw forbidden();
    const { id } = idParam.parse(req.params);
    const { upstream, filename } = await openQwenAudio(deps.db, req.session.orgId, id);
    if (upstream.status >= 400) {
      throw new AppError(502, 'COMFY_AUDIO', 'The voice is not ready to play from that PC.');
    }
    const raw = Buffer.from(await upstream.arrayBuffer());
    const playable = toPlayableAudio(filename, raw);
    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const sliced = sliceAudioRange(playable.body, range);
    reply.header('content-type', playable.type);
    reply.header('accept-ranges', 'bytes');
    reply.header('cache-control', 'private, max-age=3600');
    if (sliced.contentRange) reply.header('content-range', sliced.contentRange);
    reply.header('content-length', String(sliced.body.length));
    return reply.status(sliced.status).send(sliced.body);
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
    const download = (req.query as { download?: string }).download === '1';
    if (download) {
      for (const [key, value] of Object.entries(attachmentHeaders(filename))) reply.header(key, value);
    } else {
      reply.header('cache-control', 'private, no-store');
      reply.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    }
    reply.status(upstream.status);
    if (!upstream.body) return reply.send();
    return reply.send(Readable.fromWeb(upstream.body as import('stream/web').ReadableStream));
  });
}
