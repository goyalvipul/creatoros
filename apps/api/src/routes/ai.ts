import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  aiStatus,
  attachAiAsset,
  createMetadataDraft,
  createScenePrompt,
  forbidden,
  getAiProfile,
  listAiAssets,
  listAiJobs,
  listPromptVersions,
  markPromptApplied,
  openAiAsset,
  queueMissingSceneImages,
  queueSceneImage,
  queueVideoAnalysis,
  saveAiProfile,
  testAiProvider,
  unauthorized,
  updateAiSettings,
} from '@creatoros/services';
import { ctxFor, type AppDeps } from '../http';

function signed(req: FastifyRequest) {
  if (!req.session) throw unauthorized();
}
function editor(req: FastifyRequest) {
  signed(req);
  if (req.session!.role === 'VIEWER') throw forbidden();
  if (req.headers['x-requested-with'] !== 'creatoros') throw forbidden('Cross-site request blocked (CSRF protection).');
}
function owner(req: FastifyRequest) {
  editor(req);
  if (req.session!.role !== 'OWNER') throw forbidden('Only the owner can change AI settings.');
}

const sceneContext = z.object({
  brandId: z.string().uuid().nullable().optional(),
  projectTitle: z.string().max(160).optional(),
  songTitle: z.string().max(160).optional(),
  sceneNumber: z.number().int().optional(),
  timeRange: z.string().max(40).optional(),
  mode: z.enum(['vocal', 'broll']).optional(),
  idea: z.string().max(4000).optional(),
  lyrics: z.string().max(4000).optional(),
  style: z.string().max(500).optional(),
  camera: z.string().max(500).optional(),
  motion: z.string().max(500).optional(),
  instructions: z.string().max(1000).optional(),
  currentPrompt: z.string().max(4000).optional(),
  characterName: z.string().max(120).optional(),
}).optional();

export function aiRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/ai/status', async (req) => {
    signed(req);
    return { data: await aiStatus(ctxFor(deps, req)), meta: { requestId: req.correlationId }, error: null };
  });

  app.patch('/ai/settings', async (req) => {
    owner(req);
    const row = await updateAiSettings(ctxFor(deps, req), (req.body ?? {}) as Record<string, unknown>);
    return { data: row, meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/ai/providers/test', async (req) => {
    owner(req);
    const body = z.object({ provider: z.enum(['openai', 'gemini']) }).parse(req.body);
    return { data: await testAiProvider(ctxFor(deps, req), body.provider), meta: { requestId: req.correlationId }, error: null };
  });

  app.get('/ai/profile', async (req) => {
    signed(req);
    const brandId = z.string().uuid().optional().parse((req.query as { brandId?: string }).brandId) ?? null;
    return { data: await getAiProfile(ctxFor(deps, req), brandId), meta: { requestId: req.correlationId }, error: null };
  });

  app.put('/ai/profile', async (req) => {
    owner(req);
    const body = z.object({
      brandId: z.string().uuid().nullable().optional(),
      name: z.string().max(120).optional(),
      niche: z.string().max(1000).optional(),
      languages: z.string().max(200).optional(),
      tone: z.string().max(1000).optional(),
      voice: z.string().max(1000).optional(),
      themes: z.string().max(1000).optional(),
      visualNotes: z.string().max(1000).optional(),
      avoid: z.string().max(1000).optional(),
      hashtags: z.string().max(1000).optional(),
      links: z.string().max(1000).optional(),
      disclosure: z.string().max(1000).optional(),
      characterName: z.string().max(120).optional(),
      characterNotes: z.string().max(1000).optional(),
      referenceFileIds: z.array(z.string().uuid()).max(8).optional(),
    }).parse(req.body);
    return { data: await saveAiProfile(ctxFor(deps, req), body), meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/ai/prompts', async (req) => {
    editor(req);
    const body = z.object({
      task: z.enum(['scene_prompt_generate', 'scene_prompt_improve', 'scene_prompt_variations']),
      targetType: z.enum(['long_scene', 'h3']),
      targetId: z.string().min(1).max(80),
      acceptBillable: z.literal(true),
      idempotencyKey: z.string().max(80).optional(),
      scene: sceneContext,
    }).parse(req.body);
    return { data: await createScenePrompt(ctxFor(deps, req), body), meta: { requestId: req.correlationId }, error: null };
  });

  app.get('/ai/prompts', async (req) => {
    signed(req);
    const query = z.object({ targetType: z.string().max(40), targetId: z.string().max(80) }).parse(req.query);
    return { data: await listPromptVersions(ctxFor(deps, req), query.targetType, query.targetId), meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/ai/prompts/:id/apply', async (req) => {
    editor(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return { data: await markPromptApplied(ctxFor(deps, req), id), meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/ai/images', async (req) => {
    editor(req);
    const body = z.object({
      projectId: z.string().uuid(),
      sceneId: z.string().uuid(),
      mode: z.enum(['generate', 'edit', 'variation']),
      prompt: z.string().max(4000),
      instruction: z.string().max(1000).optional(),
      sourceAssetId: z.string().uuid().nullable().optional(),
      acceptBillable: z.literal(true),
      idempotencyKey: z.string().max(80).optional(),
    }).parse(req.body);
    return { data: await queueSceneImage(ctxFor(deps, req), body), meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/ai/images/missing', async (req) => {
    editor(req);
    const body = z.object({ projectId: z.string().uuid(), acceptBillable: z.literal(true) }).parse(req.body);
    return { data: await queueMissingSceneImages(ctxFor(deps, req), body.projectId, true), meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/ai/analyze', async (req) => {
    editor(req);
    const body = z.object({
      fileId: z.string().uuid().nullable().optional(),
      projectId: z.string().uuid().nullable().optional(),
      acceptBillable: z.literal(true),
      idempotencyKey: z.string().max(80).optional(),
    }).parse(req.body);
    return { data: await queueVideoAnalysis(ctxFor(deps, req), body), meta: { requestId: req.correlationId }, error: null };
  });

  app.post('/ai/metadata', async (req) => {
    editor(req);
    const body = z.object({
      fileId: z.string().uuid(),
      platform: z.string().max(40),
      notes: z.string().max(1000).optional(),
      acceptBillable: z.literal(true),
    }).parse(req.body);
    return { data: await createMetadataDraft(ctxFor(deps, req), body), meta: { requestId: req.correlationId }, error: null };
  });

  app.get('/ai/jobs', async (req) => {
    signed(req);
    const query = z.object({ targetType: z.string().max(40).optional(), targetId: z.string().max(80).optional(), sceneId: z.string().uuid().optional() }).parse(req.query);
    return { data: await listAiJobs(ctxFor(deps, req), query), meta: { requestId: req.correlationId }, error: null };
  });

  app.get('/ai/assets', async (req) => {
    signed(req);
    const query = z.object({ sceneId: z.string().uuid() }).parse(req.query);
    return { data: await listAiAssets(ctxFor(deps, req), query.sceneId), meta: { requestId: req.correlationId }, error: null };
  });

  app.get('/ai/assets/:id/file', async (req, reply) => {
    signed(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const file = await openAiAsset(ctxFor(deps, req), id);
    const info = await stat(file.abs);
    reply.header('content-type', file.mime);
    reply.header('content-length', String(info.size));
    reply.header('cache-control', 'private, max-age=3600');
    return reply.send(createReadStream(file.abs));
  });

  app.post('/ai/assets/:id/attach', async (req) => {
    editor(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return { data: await attachAiAsset(ctxFor(deps, req), id), meta: { requestId: req.correlationId }, error: null };
  });
}
