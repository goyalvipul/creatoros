import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { organizations, asc } from '@creatoros/db';
import {
  ASSET_KIND,
  CLIP_STATE,
  CONTENT_FORMAT,
  CREATIVE_STATE,
  APPROVAL_STATE,
  IDEA_STATUS,
  PLATFORM,
  PRIORITY,
  PRIVACY,
  PROJECT_STAGE,
  PROJECT_TYPE,
  PUBLICATION_STATE,
  VARIANT_TYPE,
} from '@creatoros/domain';
import {
  AppError,
  addChecklistItem,
  addVersion,
  applyTemplate,
  archiveBrand,
  archiveChannel,
  archiveSocialAccount,
  calendar,
  changeStage,
  convertIdea,
  createAsset,
  createBrand,
  createChannel,
  createIdea,
  deleteIdea,
  deleteProject,
  getIdea,
  createProject,
  createRecord,
  createSocialAccount,
  createVariant,
  deleteVariant,
  getPublishTitle,
  linkPublishFile,
  detectNearDuplicates,
  getAsset,
  getProject,
  getRecord,
  hmacHex,
  ingestWorkflowManifest,
  linkFile,
  linkPublicationToVariant,
  listAssetMachines,
  listAssets,
  syncFolderAssets,
  listCatalog,
  listDuplicateCandidates,
  listExactDuplicateGroups,
  listIdeas,
  listProjects,
  listTags,
  listLinkablePublications,
  listUnmatchedPublications,
  listVariants,
  requestPublish,
  schedulePublish,
  unlinkPublishFile,
  markPublishedManual,
  publishingMatrix,
  recordDecision,
  recordExistingPost,
  recordMetrics,
  reschedule,
  reviewDuplicate,
  safeEqualHex,
  selectVersion,
  setAssetTags,
  setChecklistItem,
  setSceneStatus,
  setTarget,
  setVersionApproval,
  systemCtx,
  transitionRecord,
  unauthorized,
  unlinkFile,
  updateAsset,
  updateBrand,
  updateChannel,
  updateIdea,
  updateProject,
  updateSocialAccount,
  updateVariant,
  upsertScenes,
  listScenes,
} from '@creatoros/services';
import { idParam, makeRouter, withMeta, type AppDeps } from '../http';

const date = z.coerce.date();
const uuid = z.uuid();
const strArr = z.array(z.string().trim().min(1).max(200)).max(100);

export function contentRoutes(app: FastifyInstance, deps: AppDeps) {
  const route = makeRouter(app, deps);
  const { db, config } = deps;

  // ================================================================ catalog (brands / channels / accounts)
  route(
    { method: 'GET', url: '/catalog', tag: 'Channels', summary: 'Brands → channels → social accounts' },
    ({ ctx }) => listCatalog(ctx),
  );
  route(
    {
      method: 'POST',
      url: '/brands',
      tag: 'Channels',
      summary: 'Create a brand',
      status: 201,
      body: z.object({
        name: z.string().trim().min(1).max(100),
        type: z.string().max(40).optional(),
        description: z.string().max(2000).nullable().optional(),
        contentPillars: strArr.optional(),
      }),
    },
    ({ ctx, body }) => createBrand(ctx, body),
  );
  route(
    {
      method: 'PATCH',
      url: '/brands/:id',
      tag: 'Channels',
      summary: 'Edit a brand',
      params: idParam,
      body: z
        .object({
          name: z.string().trim().min(1).max(100),
          type: z.string().max(40),
          description: z.string().max(2000).nullable(),
          contentPillars: strArr,
          active: z.boolean(),
        })
        .partial(),
    },
    ({ ctx, params, body }) => updateBrand(ctx, params.id, body),
  );
  route(
    {
      method: 'DELETE',
      url: '/brands/:id',
      tag: 'Channels',
      summary: 'Delete a brand: archives it with its channels and accounts (history is kept)',
      params: idParam,
      role: 'OWNER',
    },
    async ({ ctx, params }) => {
      await archiveBrand(ctx, params.id);
      return { ok: true };
    },
  );
  route(
    {
      method: 'POST',
      url: '/channels',
      tag: 'Channels',
      summary: 'Create a channel',
      status: 201,
      body: z.object({
        brandId: uuid,
        name: z.string().trim().min(1).max(100),
        purpose: z.string().max(500).nullable().optional(),
        language: z.string().max(10).optional(),
        goals: z.string().max(1000).nullable().optional(),
      }),
    },
    ({ ctx, body }) => createChannel(ctx, body),
  );
  route(
    {
      method: 'PATCH',
      url: '/channels/:id',
      tag: 'Channels',
      summary: 'Edit a channel',
      params: idParam,
      body: z
        .object({
          name: z.string().trim().min(1).max(100),
          purpose: z.string().max(500).nullable(),
          language: z.string().max(10),
          goals: z.string().max(1000).nullable(),
          active: z.boolean(),
        })
        .partial(),
    },
    ({ ctx, params, body }) => updateChannel(ctx, params.id, body),
  );
  route(
    {
      method: 'DELETE',
      url: '/channels/:id',
      tag: 'Channels',
      summary: 'Delete a channel: archives it with its accounts (history is kept)',
      params: idParam,
      role: 'OWNER',
    },
    async ({ ctx, params }) => {
      await archiveChannel(ctx, params.id);
      return { ok: true };
    },
  );
  route(
    {
      method: 'POST',
      url: '/social-accounts',
      tag: 'Channels',
      summary: 'Add a social account to a channel',
      status: 201,
      body: z.object({
        channelId: uuid,
        platform: z.enum(PLATFORM),
        handle: z.string().trim().min(1).max(100),
        profileUrl: z.url().max(500).nullable().optional(),
        externalAccountId: z.string().max(200).nullable().optional(),
        accountType: z.string().max(40).optional(),
      }),
    },
    ({ ctx, body }) => createSocialAccount(ctx, body),
  );
  route(
    {
      method: 'PATCH',
      url: '/social-accounts/:id',
      tag: 'Channels',
      summary: 'Edit a social account',
      params: idParam,
      body: z
        .object({
          handle: z.string().trim().min(1).max(100),
          profileUrl: z.url().max(500).nullable(),
          externalAccountId: z.string().max(200).nullable(),
          accountType: z.string().max(40),
          active: z.boolean(),
        })
        .partial(),
    },
    ({ ctx, params, body }) => updateSocialAccount(ctx, params.id, body),
  );
  route(
    {
      method: 'DELETE',
      url: '/social-accounts/:id',
      tag: 'Channels',
      summary: 'Delete a social account (posts already recorded for it are kept)',
      params: idParam,
      role: 'OWNER',
    },
    async ({ ctx, params }) => {
      await archiveSocialAccount(ctx, params.id);
      return { ok: true };
    },
  );
  // ================================================================ ideas
  const ideaFields = {
    title: z.string().trim().min(1).max(200),
    pitch: z.string().max(5000).nullable(),
    creativeBrief: z.string().max(20000).nullable(),
    notes: z.string().max(20000).nullable(),
    genre: z.string().max(100).nullable(),
    contentPillars: strArr,
    referenceLinks: z.array(z.url().max(1000)).max(50),
    language: z.string().max(10),
    format: z.enum(CONTENT_FORMAT),
    audience: z.string().max(20000).nullable(),
    songTitle: z.string().max(300).nullable(),
    songFileId: uuid.nullable(),
    conceptDetail: z.string().max(50000).nullable(),
    competitor: z.string().max(20000).nullable(),
    hook: z.string().max(20000).nullable(),
    narrative: z.string().max(50000).nullable(),
    distributionPlan: z.string().max(20000).nullable(),
    score: z.number().int().min(0).max(100).nullable(),
    effortHours: z.number().int().min(0).max(10000).nullable(),
    priority: z.enum(PRIORITY),
    status: z.enum(IDEA_STATUS),
    storyboard: z.string().max(50000).nullable(),
    lyricsDraft: z.string().max(50000).nullable(),
    tags: strArr,
    brandId: uuid.nullable(),
    channelId: uuid.nullable(),
  };
  route(
    {
      method: 'GET',
      url: '/ideas',
      tag: 'Content',
      summary: 'Idea backlog',
      query: z.object({
        status: z.enum(IDEA_STATUS).optional(),
        brandId: uuid.optional(),
        q: z.string().max(200).optional(),
        limit: z.coerce.number().int().max(500).optional(),
      }),
    },
    ({ ctx, query }) => listIdeas(ctx, query),
  );
  route(
    {
      method: 'POST',
      url: '/ideas',
      tag: 'Content',
      summary: 'Capture an idea',
      status: 201,
      body: z.object({ ...ideaFields, title: ideaFields.title }).partial({
        pitch: true,
        creativeBrief: true,
        notes: true,
        genre: true,
        contentPillars: true,
        referenceLinks: true,
        language: true,
        format: true,
        audience: true,
        songTitle: true,
        songFileId: true,
        conceptDetail: true,
        competitor: true,
        hook: true,
        narrative: true,
        distributionPlan: true,
        score: true,
        effortHours: true,
        priority: true,
        status: true,
        storyboard: true,
        lyricsDraft: true,
        tags: true,
        brandId: true,
        channelId: true,
      }),
    },
    ({ ctx, body }) => createIdea(ctx, body as any),
  );
  route(
    {
      method: 'GET',
      url: '/ideas/:id',
      tag: 'Content',
      summary: 'One idea',
      params: idParam,
    },
    ({ ctx, params }) => getIdea(ctx, params.id),
  );
  route(
    {
      method: 'PATCH',
      url: '/ideas/:id',
      tag: 'Content',
      summary: 'Edit an idea',
      params: idParam,
      body: z.object(ideaFields).partial(),
    },
    ({ ctx, params, body }) => updateIdea(ctx, params.id, body as any),
  );
  route(
    {
      method: 'DELETE',
      url: '/ideas/:id',
      tag: 'Content',
      summary: 'Delete an idea. A project already created from it stays.',
      params: idParam,
    },
    ({ ctx, params }) => deleteIdea(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/ideas/:id/convert',
      tag: 'Content',
      summary: 'Turn an idea into a project (idempotent)',
      params: idParam,
      body: z.object({
        title: z.string().max(200).optional(),
        type: z.enum(PROJECT_TYPE).optional(),
        brandId: uuid.nullable().optional(),
        templateKey: z.string().max(60).optional(),
        dueAt: date.nullable().optional(),
      }),
      status: 201,
    },
    ({ ctx, params, body }) => convertIdea(ctx, params.id, body as any),
  );

  // ================================================================ projects
  const projectFields = {
    title: z.string().trim().min(1).max(200),
    type: z.enum(PROJECT_TYPE),
    contentFormat: z.enum(CONTENT_FORMAT),
    brandId: uuid.nullable(),
    channelId: uuid.nullable(),
    seriesId: uuid.nullable(),
    dueAt: date.nullable(),
    brief: z.string().max(20000).nullable(),
    concept: z.string().max(20000).nullable(),
    approvedDirection: z.string().max(20000).nullable(),
    audience: z.string().max(20000).nullable(),
    songTitle: z.string().max(300).nullable(),
    songFileId: uuid.nullable(),
    conceptDetail: z.string().max(50000).nullable(),
    competitor: z.string().max(20000).nullable(),
    hook: z.string().max(20000).nullable(),
    narrative: z.string().max(50000).nullable(),
    distributionPlan: z.string().max(20000).nullable(),
    tags: strArr,
    pinned: z.boolean(),
    priority: z.enum(PRIORITY),
  };
  route(
    {
      method: 'GET',
      url: '/projects',
      tag: 'Production',
      summary: 'Projects',
      query: z.object({
        stage: z.enum(PROJECT_STAGE).optional(),
        brandId: uuid.optional(),
        q: z.string().max(200).optional(),
        pinned: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
        limit: z.coerce.number().int().max(500).optional(),
      }),
    },
    ({ ctx, query }) => listProjects(ctx, query),
  );
  route(
    {
      method: 'POST',
      url: '/projects',
      tag: 'Production',
      summary: 'Create a project (a checklist template is applied)',
      status: 201,
      body: z
        .object(projectFields)
        .partial()
        .extend({ title: projectFields.title, templateKey: z.string().max(60).optional() }),
    },
    ({ ctx, body }) => createProject(ctx, body as any),
  );
  route(
    {
      method: 'GET',
      url: '/projects/:id',
      tag: 'Production',
      summary: 'Project with scenes, checklist, progress and next-stage hint',
      params: idParam,
    },
    ({ ctx, params }) => getProject(ctx, params.id),
  );
  route(
    {
      method: 'PATCH',
      url: '/projects/:id',
      tag: 'Production',
      summary: 'Edit a project',
      params: idParam,
      body: z.object(projectFields).partial(),
    },
    ({ ctx, params, body }) => updateProject(ctx, params.id, body as any),
  );
  route(
    {
      method: 'DELETE',
      url: '/projects/:id',
      tag: 'Production',
      summary: 'Delete a production project (owner). Soft-delete; media and posts stay.',
      params: idParam,
      role: 'OWNER',
    },
    ({ ctx, params }) => deleteProject(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/projects/:id/stage',
      tag: 'Production',
      summary: 'Move a project to another stage (checklist gates READY/PUBLISHED)',
      params: idParam,
      body: z.object({
        to: z.enum(PROJECT_STAGE),
        reason: z.string().max(500).optional(),
        force: z.boolean().optional(),
      }),
    },
    ({ ctx, params, body }) => changeStage(ctx, params.id, body.to, body.reason, body.force),
  );
  route(
    {
      method: 'POST',
      url: '/projects/:id/template',
      tag: 'Production',
      summary: 'Apply a checklist template',
      params: idParam,
      body: z.object({ templateKey: z.string().max(60) }),
    },
    ({ ctx, params, body }) => applyTemplate(ctx, params.id, body.templateKey),
  );
  route(
    {
      method: 'POST',
      url: '/projects/:id/checklist',
      tag: 'Production',
      summary: 'Add a checklist item',
      params: idParam,
      status: 201,
      body: z.object({
        label: z.string().trim().min(1).max(300),
        required: z.boolean().optional(),
        stage: z.string().max(40).optional(),
      }),
    },
    ({ ctx, params, body }) => addChecklistItem(ctx, params.id, body),
  );
  route(
    {
      method: 'PATCH',
      url: '/checklist-items/:id',
      tag: 'Production',
      summary: 'Tick or untick a checklist item',
      params: idParam,
      body: z.object({ done: z.boolean(), evidence: z.string().max(1000).nullable().optional() }),
    },
    ({ ctx, params, body }) => setChecklistItem(ctx, params.id, body.done, body.evidence),
  );
  route(
    {
      method: 'GET',
      url: '/projects/:id/scenes',
      tag: 'Production',
      summary: 'Scenes (clips)',
      params: idParam,
    },
    ({ ctx, params }) => listScenes(ctx, params.id),
  );
  route(
    {
      method: 'PUT',
      url: '/projects/:id/scenes',
      tag: 'Production',
      summary: 'Create or update scenes by ordinal',
      params: idParam,
      body: z.object({
        scenes: z
          .array(
            z.object({
              ordinal: z.number().int().min(0).max(10000),
              title: z.string().max(200).optional(),
              narration: z.string().max(5000).optional(),
              direction: z.string().max(5000).optional(),
              shotPrompt: z.string().max(5000).optional(),
              timecodeStartMs: z.number().int().min(0).optional(),
              timecodeEndMs: z.number().int().min(0).optional(),
            }),
          )
          .max(500),
      }),
    },
    ({ ctx, params, body }) => upsertScenes(ctx, params.id, body.scenes),
  );
  route(
    {
      method: 'PATCH',
      url: '/scenes/:id',
      tag: 'Production',
      summary: 'Set a scene state (progress counts only SELECTED scenes)',
      params: idParam,
      body: z.object({
        status: z.enum(CLIP_STATE),
        selectedVersionId: uuid.nullable().optional(),
        qaNotes: z.string().max(2000).nullable().optional(),
      }),
    },
    ({ ctx, params, body }) =>
      setSceneStatus(ctx, params.id, body.status, {
        selectedVersionId: body.selectedVersionId,
        qaNotes: body.qaNotes,
      }),
  );
  route(
    {
      method: 'POST',
      url: '/projects/:id/decisions',
      tag: 'Production',
      summary: 'Record a creative decision',
      params: idParam,
      status: 201,
      body: z.object({
        title: z.string().trim().min(1).max(200),
        decision: z.string().trim().min(1).max(5000),
      }),
    },
    ({ ctx, params, body }) => recordDecision(ctx, params.id, body),
  );

  // Signed webhook from the local generation workflow (ComfyUI or similar). HMAC over the raw body.
  app.post(
    '/webhooks/workflow',
    {
      bodyLimit: 2 * 1024 * 1024,
      schema: { tags: ['Production'], summary: 'Signed workflow manifest webhook (idempotent)' },
    },
    async (req, reply) => {
      const secret = config.workflowWebhookSecret;
      if (!secret)
        throw new AppError(
          503,
          'WEBHOOK_UNCONFIGURED',
          'WORKFLOW_WEBHOOK_SECRET is not set, so workflow webhooks are disabled.',
        );
      const sig = String(req.headers['x-creatoros-signature'] ?? '');
      const raw = typeof req.rawBody === 'string' ? req.rawBody : '';
      if (!sig || !safeEqualHex(hmacHex(secret, raw), sig)) throw unauthorized('Bad webhook signature');
      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .orderBy(asc(organizations.createdAt))
        .limit(1);
      if (!org) throw new AppError(409, 'NOT_INITIALIZED', 'Finish first-run setup first.');
      const out = await ingestWorkflowManifest(systemCtx({ db, env: config.env }, org.id), req.body);
      return reply.send({ data: out, meta: { requestId: req.correlationId }, error: null });
    },
  );

  // ================================================================ assets
  route(
    {
      method: 'GET',
      url: '/assets',
      tag: 'Library',
      summary: 'Logical assets (an intended piece of content, independent of copies)',
      query: z.object({
        q: z.string().max(200).optional(),
        kind: z.enum(ASSET_KIND).optional(),
        projectId: uuid.optional(),
        brandId: uuid.optional(),
        deviceId: uuid.optional(),
        includeArchived: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
        limit: z.coerce.number().int().max(200).optional(),
        cursor: z.string().max(500).optional(),
      }),
    },
    async ({ ctx, query }) => {
      await syncFolderAssets(ctx.db, ctx.orgId);
      const r = await listAssets(ctx, query);
      return withMeta(r.items, { nextCursor: r.nextCursor });
    },
  );
  route(
    {
      method: 'GET',
      url: '/assets/machines',
      tag: 'Library',
      summary: 'Machines that can filter folder assets',
    },
    ({ ctx }) => listAssetMachines(ctx),
  );
  route(
    {
      method: 'POST',
      url: '/assets',
      tag: 'Library',
      summary: 'Create an asset (optionally from a file)',
      status: 201,
      body: z.object({
        title: z.string().trim().min(1).max(200),
        kind: z.enum(ASSET_KIND).optional(),
        description: z.string().max(5000).nullable().optional(),
        brandId: uuid.nullable().optional(),
        projectId: uuid.nullable().optional(),
        fileInstanceId: uuid.optional(),
      }),
    },
    ({ ctx, body }) => createAsset(ctx, body),
  );
  route(
    {
      method: 'GET',
      url: '/assets/:id',
      tag: 'Library',
      summary: 'Asset with versions, copies and publications',
      params: idParam,
    },
    async ({ ctx, params, session }) => {
      const asset = await getAsset(ctx, params.id);
      // Viewers see the creative record but never where the private files live (paths, devices, shares).
      if (session.role === 'VIEWER')
        return { ...asset, versions: asset.versions.map((v) => ({ ...v, files: [] })) };
      return asset;
    },
  );
  route(
    {
      method: 'PATCH',
      url: '/assets/:id',
      tag: 'Library',
      summary: 'Edit an asset',
      params: idParam,
      body: z
        .object({
          title: z.string().trim().min(1).max(200),
          description: z.string().max(5000).nullable(),
          brandId: uuid.nullable(),
          projectId: uuid.nullable(),
          kind: z.enum(ASSET_KIND),
          creativeState: z.enum(CREATIVE_STATE),
          isArchived: z.boolean(),
        })
        .partial(),
    },
    ({ ctx, params, body }) => updateAsset(ctx, params.id, body as any),
  );
  route(
    {
      method: 'POST',
      url: '/assets/:id/versions',
      tag: 'Library',
      summary: 'Add a version',
      params: idParam,
      status: 201,
      body: z.object({
        label: z.string().max(100).optional(),
        variantType: z.enum(VARIANT_TYPE).optional(),
        parentVersionId: uuid.nullable().optional(),
        fileInstanceId: uuid.optional(),
        notes: z.string().max(2000).nullable().optional(),
        resolution: z.string().max(40).nullable().optional(),
        intendedUse: z.string().max(200).nullable().optional(),
      }),
    },
    ({ ctx, params, body }) => addVersion(ctx, params.id, body as any),
  );
  route(
    {
      method: 'POST',
      url: '/assets/:id/select-version',
      tag: 'Library',
      summary: 'Choose the selected/final version',
      params: idParam,
      body: z.object({ versionId: uuid }),
    },
    ({ ctx, params, body }) => selectVersion(ctx, params.id, body.versionId),
  );
  route(
    {
      method: 'PUT',
      url: '/assets/:id/tags',
      tag: 'Library',
      summary: 'Replace tags',
      params: idParam,
      body: z.object({ tags: strArr }),
    },
    ({ ctx, params, body }) => setAssetTags(ctx, params.id, body.tags),
  );
  route(
    {
      method: 'POST',
      url: '/versions/:id/files',
      tag: 'Library',
      summary: 'Link a file copy to a version (content must match)',
      params: idParam,
      body: z.object({ fileInstanceId: uuid, reason: z.string().max(100).optional() }),
      status: 201,
    },
    ({ ctx, params, body }) => linkFile(ctx, params.id, body.fileInstanceId, body.reason),
  );
  route(
    {
      method: 'DELETE',
      url: '/versions/:id/files/:fileId',
      tag: 'Library',
      summary: 'Unlink a file copy from a version',
      params: z.object({ id: uuid, fileId: uuid }),
    },
    async ({ ctx, params }) => {
      await unlinkFile(ctx, params.id, params.fileId);
      return { ok: true };
    },
  );
  route(
    {
      method: 'POST',
      url: '/versions/:id/approval',
      tag: 'Library',
      summary: 'Set approval state',
      params: idParam,
      body: z.object({ state: z.enum(APPROVAL_STATE) }),
    },
    ({ ctx, params, body }) => setVersionApproval(ctx, params.id, body.state),
  );
  route({ method: 'GET', url: '/tags', tag: 'Library', summary: 'All tags' }, ({ ctx }) => listTags(ctx));
  route(
    {
      method: 'GET',
      url: '/duplicates/exact',
      tag: 'Library',
      summary: 'Exact duplicate groups (same verified hash)',
    },
    ({ ctx }) => listExactDuplicateGroups(ctx),
  );
  route(
    {
      method: 'POST',
      url: '/duplicates/detect',
      tag: 'Library',
      summary: 'Find near-duplicate candidates (never deletes or merges)',
      status: 202,
    },
    ({ ctx }) => detectNearDuplicates(ctx),
  );
  route(
    {
      method: 'GET',
      url: '/duplicates/candidates',
      tag: 'Library',
      summary: 'Near-duplicate candidates',
      query: z.object({ state: z.enum(['SUGGESTED', 'CONFIRMED', 'DISMISSED']).optional() }),
    },
    ({ ctx, query }) => listDuplicateCandidates(ctx, query.state),
  );
  route(
    {
      method: 'POST',
      url: '/duplicates/candidates/:id/review',
      tag: 'Library',
      summary: 'Confirm or dismiss a candidate (nothing is deleted)',
      params: idParam,
      body: z.object({ state: z.enum(['CONFIRMED', 'DISMISSED']) }),
    },
    ({ ctx, params, body }) => reviewDuplicate(ctx, params.id, body.state),
  );

  // ================================================================ publishing
  const variantFields = {
    titleMaster: z.string().trim().min(1).max(300),
    type: z.enum(VARIANT_TYPE),
    descriptionMaster: z.string().max(10000).nullable(),
    hashtags: z.array(z.string().max(100)).max(60),
    language: z.string().max(10).nullable(),
    cta: z.string().max(500).nullable(),
    notes: z.string().max(2000).nullable(),
  };
  route(
    {
      method: 'GET',
      url: '/variants',
      tag: 'Publishing',
      summary: 'Distribution variants',
      query: z.object({
        assetId: uuid.optional(),
        projectId: uuid.optional(),
        readiness: z.string().max(40).optional(),
      }),
    },
    ({ ctx, query }) => listVariants(ctx, query),
  );
  route(
    {
      method: 'POST',
      url: '/variants',
      tag: 'Publishing',
      summary: 'Create a distribution variant',
      status: 201,
      body: z
        .object(variantFields)
        .partial()
        .extend({
          assetId: uuid,
          titleMaster: variantFields.titleMaster,
          projectId: uuid.nullable().optional(),
          brandId: uuid.nullable().optional(),
        }),
    },
    ({ ctx, body }) => createVariant(ctx, body as any),
  );
  route(
    {
      method: 'PATCH',
      url: '/variants/:id',
      tag: 'Publishing',
      summary: 'Edit a variant',
      params: idParam,
      body: z.object(variantFields).partial(),
    },
    ({ ctx, params, body }) => updateVariant(ctx, params.id, body as any),
  );
  route(
    {
      method: 'DELETE',
      url: '/variants/:id',
      tag: 'Publishing',
      summary: 'Remove a title from the plan. Files and posts that already went out stay.',
      params: idParam,
    },
    ({ ctx, params }) => deleteVariant(ctx, params.id),
  );
  route(
    {
      method: 'PUT',
      url: '/variants/:id/targets/:accountId',
      tag: 'Publishing',
      summary: 'Mark an account as target (desired=false means explicitly not applicable)',
      params: z.object({ id: uuid, accountId: uuid }),
      body: z.object({ desired: z.boolean(), notes: z.string().max(500).nullable().optional() }),
    },
    ({ ctx, params, body }) => setTarget(ctx, params.id, params.accountId, body.desired, body.notes),
  );
  route(
    {
      method: 'GET',
      url: '/publishing/matrix',
      tag: 'Publishing',
      summary: 'Asset × account matrix (published / planned / not applicable / missing)',
      query: z.object({
        assetId: uuid.optional(),
        brandId: uuid.optional(),
        projectId: uuid.optional(),
      }),
    },
    ({ ctx, query }) => publishingMatrix(ctx, query),
  );
  route(
    {
      method: 'GET',
      url: '/variants/:id/publish',
      tag: 'Publishing',
      summary: 'A title, its attached videos, and each account publish button',
      params: idParam,
    },
    ({ ctx, params }) => getPublishTitle(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/variants/:id/files',
      tag: 'Publishing',
      summary: 'Attach a library video to a title',
      status: 201,
      params: idParam,
      body: z.object({ fileInstanceId: uuid }),
    },
    ({ ctx, params, body }) => linkPublishFile(ctx, params.id, body.fileInstanceId),
  );
  route(
    {
      method: 'DELETE',
      url: '/variants/:id/files/:itemId',
      tag: 'Publishing',
      summary: 'Unlink a video from a title (the file and any post already sent stay)',
      params: z.object({ id: uuid, itemId: uuid }),
    },
    ({ ctx, params }) => unlinkPublishFile(ctx, params.id, params.itemId),
  );
  route(
    {
      method: 'POST',
      url: '/publishing/publish',
      tag: 'Publishing',
      summary: 'Publish one attached video to one account. Nothing is sent until this is called.',
      status: 201,
      body: z.object({
        itemId: uuid,
        socialAccountId: uuid,
        requestId: uuid,
        title: z.string().max(300).nullable().optional(),
        caption: z.string().max(5000).nullable().optional(),
        hashtags: z.array(z.string().max(100)).max(30).optional(),
        privacy: z.enum(PRIVACY).nullable().optional(),
        contentForm: z.enum(['VIDEO', 'SHORT']).nullable().optional(),
      }),
    },
    ({ ctx, body }) => requestPublish(ctx, body, { enqueue: deps.enqueue }),
  );
  route(
    {
      method: 'POST',
      url: '/publishing/schedule',
      tag: 'Publishing',
      summary: 'Save publish details and post at the given local time. Nothing is sent until then.',
      status: 201,
      body: z.object({
        itemId: uuid,
        socialAccountId: uuid,
        requestId: uuid,
        title: z.string().max(300).nullable().optional(),
        caption: z.string().max(5000).nullable().optional(),
        hashtags: z.array(z.string().max(100)).max(30).optional(),
        privacy: z.enum(PRIVACY).nullable().optional(),
        contentForm: z.enum(['VIDEO', 'SHORT']).nullable().optional(),
        plannedLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/),
        timezone: z.string().max(64).optional(),
      }),
    },
    ({ ctx, body }) =>
      schedulePublish(ctx, {
        ...body,
        plannedLocal: body.plannedLocal.slice(0, 16),
      }),
  );

  const recordBody = z.object({
    socialAccountId: uuid,
    variantId: uuid.nullable().optional(),
    assetVersionId: uuid.nullable().optional(),
    title: z.string().max(300).nullable().optional(),
    caption: z.string().max(10000).nullable().optional(),
    hashtags: z.array(z.string().max(100)).max(60).optional(),
    privacy: z.enum(PRIVACY).optional(),
    language: z.string().max(10).nullable().optional(),
    cta: z.string().max(500).nullable().optional(),
    isSponsored: z.boolean().optional(),
    sponsorDisclosure: z.boolean().optional(),
    deliverableId: uuid.nullable().optional(),
    plannedLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .optional(),
    plannedAt: date.nullable().optional(),
    plannedTimezone: z.string().max(64).optional(),
    state: z.enum(['NOT_PLANNED', 'PLANNED', 'READY']).optional(),
    approvalRequired: z.boolean().optional(),
    force: z.boolean().optional(),
  });
  route(
    {
      method: 'POST',
      url: '/publications',
      tag: 'Publishing',
      summary: 'Plan a publication (nothing is ever posted automatically)',
      status: 201,
      body: recordBody,
    },
    ({ ctx, body }) => createRecord(ctx, body as any),
  );
  route(
    {
      method: 'GET',
      url: '/publications',
      tag: 'Publishing',
      summary: 'Publication records that can be linked to a deliverable (not removed, not used elsewhere)',
      query: z.object({ deliverableId: z.string().uuid().optional() }),
    },
    ({ ctx, query }) => listLinkablePublications(ctx, query.deliverableId),
  );
  route(
    {
      method: 'GET',
      url: '/publications/unmatched',
      tag: 'Publishing',
      summary: 'Posts found on a platform that are not linked to any variant',
    },
    ({ ctx }) => listUnmatchedPublications(ctx),
  );
  route(
    {
      method: 'GET',
      url: '/publications/:id',
      tag: 'Publishing',
      summary: 'Publication with status events and metrics',
      params: idParam,
    },
    ({ ctx, params }) => getRecord(ctx, params.id),
  );
  route(
    {
      method: 'POST',
      url: '/publications/:id/transition',
      tag: 'Publishing',
      summary: 'Move a planned publication between planning states',
      params: idParam,
      body: z.object({
        to: z.enum(PUBLICATION_STATE),
        evidence: z.string().max(1000).nullable().optional(),
        failureReason: z.string().max(1000).nullable().optional(),
      }),
    },
    ({ ctx, params, body }) => transitionRecord(ctx, params.id, body.to, body.evidence, body.failureReason),
  );
  route(
    {
      method: 'POST',
      url: '/publications/:id/mark-published',
      tag: 'Publishing',
      summary: 'Mark as published by hand (provenance USER_ENTERED, never VERIFIED)',
      params: idParam,
      body: z.object({
        url: z.string().url().max(1000).nullable().optional(),
        publishedLocal: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
          .optional(),
        publishedAt: date.optional(),
        evidence: z.string().max(1000).nullable().optional(),
      }),
    },
    ({ ctx, params, body }) => markPublishedManual(ctx, params.id, body),
  );
  route(
    {
      method: 'POST',
      url: '/publications/:id/reschedule',
      tag: 'Publishing',
      summary: 'Change the planned time (wall clock in a time zone)',
      params: idParam,
      body: z.object({
        plannedLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
        timezone: z.string().max(64).optional(),
      }),
    },
    ({ ctx, params, body }) => reschedule(ctx, params.id, body.plannedLocal, body.timezone),
  );
  route(
    {
      method: 'POST',
      url: '/publications/:id/metrics',
      tag: 'Publishing',
      summary: 'Record metrics by hand (stored as USER_ENTERED)',
      params: idParam,
      status: 201,
      body: z.object({
        views: z.number().int().min(0).optional(),
        watchTimeSeconds: z.number().min(0).optional(),
        impressions: z.number().int().min(0).optional(),
        likes: z.number().int().min(0).optional(),
        comments: z.number().int().min(0).optional(),
        shares: z.number().int().min(0).optional(),
        saves: z.number().int().min(0).optional(),
        followersGained: z.number().int().optional(),
        avgViewPct: z.number().min(0).max(100).optional(),
        snapshotAt: date.optional(),
      }),
    },
    ({ ctx, params, body }) => recordMetrics(ctx, params.id, body, 'USER_ENTERED'),
  );
  route(
    {
      method: 'POST',
      url: '/publications/:id/link-variant',
      tag: 'Publishing',
      summary: 'Link a found post to a variant',
      params: idParam,
      body: z.object({ variantId: uuid }),
    },
    ({ ctx, params, body }) => linkPublicationToVariant(ctx, params.id, body.variantId),
  );
  route(
    {
      method: 'POST',
      url: '/publications/existing',
      tag: 'Publishing',
      summary: 'Record a post that already exists on a platform (by URL)',
      status: 201,
      body: z.object({
        socialAccountId: uuid,
        url: z.string().url().max(1000),
        title: z.string().max(300).nullable().optional(),
        publishedLocal: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
          .optional(),
        variantId: uuid.nullable().optional(),
      }),
    },
    ({ ctx, body }) => recordExistingPost(ctx, body),
  );
  route(
    {
      method: 'GET',
      url: '/calendar',
      tag: 'Publishing',
      summary: 'Planned and published items grouped by local day',
      query: z.object({ from: date, to: date, tz: z.string().max(64).optional() }),
    },
    ({ ctx, query }) => calendar(ctx, query.from, query.to, query.tz),
  );
}
