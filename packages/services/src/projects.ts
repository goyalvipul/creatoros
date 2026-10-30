import {
  and,
  asc,
  creativeProjects,
  desc,
  eq,
  fileInstances,
  generationJobs,
  generationOutputs,
  ideas,
  isNull,
  inArray,
  productionScenes,
  projectChecklistItems,
  projectChecklistTemplates,
  projectDecisions,
  projectStatusEvents,
  sql,
  devices,
  type Executor,
} from '@creatoros/db';
import {
  BUILT_IN_TEMPLATES,
  PROJECT_STAGE,
  canonicalPath,
  computeProjectProgress,
  osToPathOs,
  richHtmlToText,
  sanitizeRichHtml,
  suggestNextStage,
  workflowManifestSchema,
  type ProjectStage,
} from '@creatoros/domain';
import { audit, emit } from './audit';
import { badRequest, conflict, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
type ProjectInsert = typeof creativeProjects.$inferInsert;

// ------------------------------------------------------------------ ideas

function cleanConcept<T extends { conceptDetail?: string | null; songFileId?: string | null }>(input: T): T {
  if (typeof input.conceptDetail === 'string') {
    const cleaned = sanitizeRichHtml(input.conceptDetail);
    input.conceptDetail = cleaned || null;
  }
  return input;
}

async function assertSongFile(ctx: Ctx, fileId: string | null | undefined) {
  if (!fileId) return;
  const [file] = await ctx.db
    .select({ fileType: fileInstances.fileType })
    .from(fileInstances)
    .where(and(eq(fileInstances.id, fileId), eq(fileInstances.orgId, ctx.orgId)));
  if (!file) throw notFound('File');
  if (file.fileType !== 'AUDIO') throw badRequest('Attach an audio file from the library.');
}

export async function createIdea(ctx: Ctx, input: Partial<typeof ideas.$inferInsert> & { title: string }) {
  if (!input.title?.trim()) throw badRequest('Title is required');
  await assertSongFile(ctx, input.songFileId);
  const clean = cleanConcept({ ...input });
  const [idea] = await ctx.db
    .insert(ideas)
    .values({
      ...clean,
      title: input.title.trim(),
      orgId: ctx.orgId,
      createdBy: ctx.userId,
      id: undefined,
      convertedProjectId: null,
      deletedAt: null,
      archivedFrom: null,
    })
    .returning();
  await audit(ctx, 'idea.create', { type: 'idea', id: idea!.id });
  return idea!;
}

export async function updateIdea(ctx: Ctx, id: string, patch: Partial<typeof ideas.$inferInsert>) {
  const { id: _i, orgId: _o, createdBy: _c, convertedProjectId: _p, archivedFrom: _a, ...safe } = patch as any;
  const [before] = await ctx.db
    .select()
    .from(ideas)
    .where(and(eq(ideas.id, id), eq(ideas.orgId, ctx.orgId), isNull(ideas.deletedAt)));
  if (!before) throw notFound('Idea');
  await assertSongFile(ctx, safe.songFileId);
  const clean = cleanConcept(safe);
  if (clean.status === 'ARCHIVED' && before.status !== 'ARCHIVED') clean.archivedFrom = before.status;
  if (clean.status && clean.status !== 'ARCHIVED' && before.status === 'ARCHIVED') clean.archivedFrom = null;
  const [after] = await ctx.db
    .update(ideas)
    .set({ ...clean, updatedAt: new Date() })
    .where(eq(ideas.id, id))
    .returning();
  await audit(ctx, 'idea.update', { type: 'idea', id }, before, after);
  return after!;
}

/** Hides the idea. A project already created from it is left alone. */
export async function deleteIdea(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .update(ideas)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(ideas.id, id), eq(ideas.orgId, ctx.orgId), isNull(ideas.deletedAt)))
    .returning({ id: ideas.id });
  if (!row) throw notFound('Idea');
  await audit(ctx, 'idea.delete', { type: 'idea', id });
  return { id, removed: true };
}

export async function getIdea(ctx: Ctx, id: string) {
  const [idea] = await ctx.db
    .select()
    .from(ideas)
    .where(and(eq(ideas.id, id), eq(ideas.orgId, ctx.orgId), isNull(ideas.deletedAt)));
  if (!idea) throw notFound('Idea');
  return idea;
}

export async function listIdeas(
  ctx: Ctx,
  q: { status?: string; brandId?: string; q?: string; limit?: number } = {},
) {
  const where = [sql`i.org_id = ${ctx.orgId}`, sql`i.deleted_at is null`];
  if (q.status) where.push(sql`i.status = ${q.status}::idea_status`);
  if (q.brandId) where.push(sql`i.brand_id = ${q.brandId}`);
  if (q.q?.trim())
    where.push(
      sql`(i.title ilike ${'%' + q.q.trim().replace(/[\\%_]/g, (c) => '\\' + c) + '%'} or i.pitch ilike ${'%' + q.q.trim().replace(/[\\%_]/g, (c) => '\\' + c) + '%'} or i.concept_detail ilike ${'%' + q.q.trim().replace(/[\\%_]/g, (c) => '\\' + c) + '%'})`,
    );
  return rowsOf<any>(
    await ctx.db.execute(
      sql`select i.id, i.title, i.pitch, i.status, i.format, i.priority, i.brand_id as "brandId",
            i.created_at as "createdAt", i.converted_project_id as "convertedProjectId", i.is_demo as "isDemo",
            i.song_title as "songTitle", i.song_file_id as "songFileId", i.concept_detail as "conceptDetail",
            i.audience, i.competitor, i.hook, i.narrative, i.distribution_plan as "distributionPlan",
            i.archived_from as "archivedFrom"
          from ideas i where ${sql.join(where, sql` and `)} order by i.created_at desc limit ${Math.min(q.limit ?? 100, 500)}`,
    ),
  );
}

/** Idea -> project. Idempotent: converting twice returns the project created the first time. */
export async function convertIdea(
  ctx: Ctx,
  ideaId: string,
  input: {
    title?: string;
    type?: ProjectInsert['type'];
    brandId?: string | null;
    templateKey?: string;
    dueAt?: Date | null;
  } = {},
) {
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from ideas where id = ${ideaId} for update`);
    const [idea] = await tx
      .select()
      .from(ideas)
      .where(and(eq(ideas.id, ideaId), eq(ideas.orgId, ctx.orgId), isNull(ideas.deletedAt)));
    if (!idea) throw notFound('Idea');
    if (idea.convertedProjectId) {
      const [p] = await tx
        .select()
        .from(creativeProjects)
        .where(eq(creativeProjects.id, idea.convertedProjectId));
      if (p) return { project: p, alreadyConverted: true };
    }
    const conceptText = idea.pitch?.trim() || richHtmlToText(idea.conceptDetail ?? '') || null;
    const project = await createProjectTx(tx, ctx, {
      title: input.title?.trim() || idea.title,
      type: input.type ?? 'OTHER',
      contentFormat: idea.format,
      brandId: input.brandId ?? idea.brandId,
      channelId: idea.channelId,
      sourceIdeaId: idea.id,
      brief: idea.creativeBrief ?? conceptText,
      concept: conceptText,
      songTitle: idea.songTitle,
      songFileId: idea.songFileId,
      conceptDetail: idea.conceptDetail,
      audience: idea.audience,
      competitor: idea.competitor,
      hook: idea.hook,
      narrative: idea.narrative,
      distributionPlan: idea.distributionPlan,
      tags: idea.tags,
      priority: idea.priority,
      dueAt: input.dueAt ?? null,
      templateKey: input.templateKey,
    });
    await tx
      .update(ideas)
      .set({ convertedProjectId: project.id, status: 'APPROVED', updatedAt: new Date() })
      .where(eq(ideas.id, ideaId));
    await audit({ ...ctx, db: tx }, 'idea.convert', { type: 'idea', id: ideaId }, undefined, {
      projectId: project.id,
    });
    return { project, alreadyConverted: false };
  });
}

// --------------------------------------------------------------- projects

export type ProjectInput = Partial<ProjectInsert> & { title: string; templateKey?: string };

async function createProjectTx(tx: Executor, ctx: Ctx, input: ProjectInput) {
  const { templateKey, ...rest } = input;
  const [project] = await tx
    .insert(creativeProjects)
    .values({
      ...rest,
      id: undefined,
      orgId: ctx.orgId,
      title: rest.title.trim(),
      stage: 'DRAFT',
      ownerUserId: rest.ownerUserId ?? ctx.userId,
      completedAt: null,
      deletedAt: null,
    })
    .returning();
  await tx.insert(projectStatusEvents).values({
    orgId: ctx.orgId,
    projectId: project!.id,
    fromStage: null,
    toStage: 'DRAFT',
    source: 'user',
    actorUserId: ctx.userId,
    reason: 'created',
  });
  await applyTemplateTx(tx, ctx.orgId, project!.id, project!.contentFormat, templateKey);
  await audit({ ...ctx, db: tx }, 'project.create', { type: 'project', id: project!.id });
  return project!;
}

export async function createProject(ctx: Ctx, input: ProjectInput) {
  if (!input.title?.trim()) throw badRequest('Title is required');
  return ctx.db.transaction((tx) => createProjectTx(tx, ctx, input));
}

async function applyTemplateTx(tx: Executor, orgId: string, projectId: string, format: string, key?: string) {
  let templates = await tx
    .select()
    .from(projectChecklistTemplates)
    .where(eq(projectChecklistTemplates.orgId, orgId));
  if (!templates.some((t) => t.contentType === 'OTHER')) {
    // installs created before the general template existed get it on demand
    const g = BUILT_IN_TEMPLATES.find((t) => t.key === 'general')!;
    await tx
      .insert(projectChecklistTemplates)
      .values({
        orgId,
        key: g.key,
        name: g.name,
        contentType: g.contentType as any,
        items: g.items,
        variants: g.variants,
        builtIn: true,
      })
      .onConflictDoNothing();
    templates = await tx
      .select()
      .from(projectChecklistTemplates)
      .where(eq(projectChecklistTemplates.orgId, orgId));
  }
  const tpl =
    (key ? templates.find((t) => t.key === key) : undefined) ??
    templates.find((t) => t.contentType === format) ??
    templates.find((t) => t.contentType === 'OTHER');
  if (key && !templates.some((t) => t.key === key)) throw badRequest(`Unknown checklist template: ${key}`);
  if (!tpl || tpl.items.length === 0) return 0;
  const [mx] = await tx
    .select({ n: sql<number>`coalesce(max(${projectChecklistItems.ordinal}),-1)::int` })
    .from(projectChecklistItems)
    .where(eq(projectChecklistItems.projectId, projectId));
  let ord = (mx?.n ?? -1) + 1;
  await tx.insert(projectChecklistItems).values(
    tpl.items.map((i) => ({
      orgId,
      projectId,
      templateId: tpl.id,
      label: i.label,
      required: i.required,
      stage: i.stage ?? null,
      ordinal: ord++,
    })),
  );
  return tpl.items.length;
}

export async function applyTemplate(ctx: Ctx, projectId: string, templateKey: string) {
  const [p] = await ctx.db
    .select()
    .from(creativeProjects)
    .where(and(eq(creativeProjects.id, projectId), eq(creativeProjects.orgId, ctx.orgId)));
  if (!p) throw notFound('Project');
  const added = await ctx.db.transaction((tx) =>
    applyTemplateTx(tx, ctx.orgId, projectId, p.contentFormat, templateKey),
  );
  return { added };
}

export async function updateProject(ctx: Ctx, id: string, patch: Partial<ProjectInsert>) {
  const { id: _i, orgId: _o, stage: _s, completedAt: _c, ...safe } = patch as any;
  if (typeof safe.conceptDetail === 'string') {
    const cleaned = sanitizeRichHtml(safe.conceptDetail);
    safe.conceptDetail = cleaned || null;
  }
  await assertSongFile(ctx, safe.songFileId);
  const [before] = await ctx.db
    .select()
    .from(creativeProjects)
    .where(
      and(
        eq(creativeProjects.id, id),
        eq(creativeProjects.orgId, ctx.orgId),
        isNull(creativeProjects.deletedAt),
      ),
    );
  if (!before) throw notFound('Project');
  const [after] = await ctx.db
    .update(creativeProjects)
    .set({ ...safe, updatedAt: new Date() })
    .where(eq(creativeProjects.id, id))
    .returning();
  await audit(ctx, 'project.update', { type: 'project', id }, before, after);
  return after!;
}

export async function listProjects(
  ctx: Ctx,
  q: { stage?: string; brandId?: string; q?: string; pinned?: boolean; limit?: number } = {},
) {
  const where = [sql`p.org_id = ${ctx.orgId}`, sql`p.deleted_at is null`];
  if (q.stage) where.push(sql`p.stage = ${q.stage}::project_stage`);
  if (q.brandId) where.push(sql`p.brand_id = ${q.brandId}`);
  if (q.pinned !== undefined) where.push(sql`p.pinned = ${q.pinned}`);
  if (q.q?.trim())
    where.push(sql`p.title ilike ${'%' + q.q.trim().replace(/[\\%_]/g, (c) => '\\' + c) + '%'}`);
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select p.id, p.title, p.stage, p.type, p.content_format as "contentFormat", p.brand_id as "brandId", p.due_at as "dueAt", p.pinned, p.priority, p.created_at as "createdAt",
        (select count(*)::int from production_scenes s where s.project_id = p.id) as "sceneTotal",
        (select count(*)::int from production_scenes s where s.project_id = p.id and s.status = 'SELECTED') as "sceneSelected",
        (select count(*)::int from project_checklist_items c where c.project_id = p.id and c.required and c.done_at is null) as "openRequired"
      from creative_projects p where ${sql.join(where, sql` and `)}
      order by p.pinned desc, p.due_at asc nulls last, p.created_at desc limit ${Math.min(q.limit ?? 100, 500)}`),
  );
}

export async function getProject(ctx: Ctx, id: string) {
  const [p] = await ctx.db
    .select()
    .from(creativeProjects)
    .where(
      and(
        eq(creativeProjects.id, id),
        eq(creativeProjects.orgId, ctx.orgId),
        isNull(creativeProjects.deletedAt),
      ),
    );
  if (!p) throw notFound('Project');
  const scenes = await ctx.db
    .select()
    .from(productionScenes)
    .where(eq(productionScenes.projectId, id))
    .orderBy(asc(productionScenes.ordinal));
  const checklist = await ctx.db
    .select()
    .from(projectChecklistItems)
    .where(eq(projectChecklistItems.projectId, id))
    .orderBy(asc(projectChecklistItems.ordinal));
  const decisions = await ctx.db
    .select()
    .from(projectDecisions)
    .where(eq(projectDecisions.projectId, id))
    .orderBy(desc(projectDecisions.version));
  const history = await ctx.db
    .select()
    .from(projectStatusEvents)
    .where(eq(projectStatusEvents.projectId, id))
    .orderBy(desc(projectStatusEvents.at));
  const progress = computeProjectProgress(scenes);
  const approvedFinal =
    rowsOf<{ n: number }>(
      await ctx.db.execute(
        sql`select count(*)::int as n from logical_assets where project_id = ${id} and selected_version_id is not null`,
      ),
    )[0]!.n > 0;
  const variants = rowsOf<{
    id: string;
    titleMaster: string;
    readiness: string;
    format: string;
    assetId: string;
    createdAt: Date;
    fileName: string | null;
  }>(
    await ctx.db.execute(sql`
      select v.id, v.title_master as "titleMaster", v.readiness, v.format::text as format, v.asset_id as "assetId",
             v.created_at as "createdAt",
             (select f.file_name from asset_file_links l
                join file_instances f on f.id = l.file_instance_id
               where l.asset_version_id = v.asset_version_id
               order by l.primary_preference desc, l.created_at desc
               limit 1) as "fileName"
      from distribution_variants v
      where v.org_id = ${ctx.orgId} and v.project_id = ${id}
      order by v.created_at desc
      limit 50`),
  );
  return {
    ...p,
    scenes,
    checklist,
    decisions,
    history,
    variants,
    progress,
    nextStageHint: suggestNextStage(p.stage, progress, approvedFinal),
  };
}

/** Stage changes are always an owner decision. Moving to READY/PUBLISHED needs the required checklist done unless forced (and then the override is recorded). */
export async function changeStage(ctx: Ctx, id: string, to: ProjectStage, reason?: string, force = false) {
  if (!PROJECT_STAGE.includes(to)) throw badRequest(`Unknown stage ${to}`);
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(creativeProjects)
      .where(
        and(
          eq(creativeProjects.id, id),
          eq(creativeProjects.orgId, ctx.orgId),
          isNull(creativeProjects.deletedAt),
        ),
      );
    if (!p) throw notFound('Project');
    if (p.stage === to) return p;
    if (to === 'READY' || to === 'PUBLISHED') {
      const open = await tx
        .select({ label: projectChecklistItems.label })
        .from(projectChecklistItems)
        .where(
          and(
            eq(projectChecklistItems.projectId, id),
            eq(projectChecklistItems.required, true),
            isNull(projectChecklistItems.doneAt),
          ),
        );
      if (open.length && !force)
        throw conflict(
          `${open.length} required checklist item(s) are not done.`,
          { open: open.map((o) => o.label) },
          'CHECKLIST_INCOMPLETE',
        );
    }
    const [after] = await tx
      .update(creativeProjects)
      .set({
        stage: to,
        updatedAt: new Date(),
        completedAt:
          (to === 'PUBLISHED' || to === 'ARCHIVED') && !p.completedAt ? new Date() : p.completedAt,
      })
      .where(eq(creativeProjects.id, id))
      .returning();
    await tx.insert(projectStatusEvents).values({
      orgId: ctx.orgId,
      projectId: id,
      fromStage: p.stage,
      toStage: to,
      source: 'user',
      actorUserId: ctx.userId,
      reason: force ? `${reason ?? ''} (checklist override)`.trim() : (reason ?? null),
    });
    await audit(
      { ...ctx, db: tx },
      'project.stage',
      { type: 'project', id },
      { stage: p.stage },
      { stage: to, force },
    );
    return after!;
  });
}

/** Soft-deletes a production project. Original media and linked publishing records stay. */
export async function deleteProject(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .update(creativeProjects)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(creativeProjects.id, id), eq(creativeProjects.orgId, ctx.orgId), isNull(creativeProjects.deletedAt)),
    )
    .returning({ id: creativeProjects.id });
  if (!row) throw notFound('Project');
  await audit(ctx, 'project.delete', { type: 'project', id });
  return { id, removed: true };
}

// ------------------------------------------------------------- checklist

export async function addChecklistItem(
  ctx: Ctx,
  projectId: string,
  input: { label: string; required?: boolean; stage?: string },
) {
  const [p] = await ctx.db
    .select({ id: creativeProjects.id })
    .from(creativeProjects)
    .where(and(eq(creativeProjects.id, projectId), eq(creativeProjects.orgId, ctx.orgId)));
  if (!p) throw notFound('Project');
  const [mx] = await ctx.db
    .select({ n: sql<number>`coalesce(max(${projectChecklistItems.ordinal}),-1)::int` })
    .from(projectChecklistItems)
    .where(eq(projectChecklistItems.projectId, projectId));
  const [i] = await ctx.db
    .insert(projectChecklistItems)
    .values({
      orgId: ctx.orgId,
      projectId,
      label: input.label.trim(),
      required: input.required ?? true,
      stage: input.stage ?? null,
      ordinal: (mx?.n ?? -1) + 1,
    })
    .returning();
  return i!;
}

export async function setChecklistItem(ctx: Ctx, itemId: string, done: boolean, evidence?: string | null) {
  const [i] = await ctx.db
    .update(projectChecklistItems)
    .set({
      doneAt: done ? new Date() : null,
      doneBy: done ? ctx.userId : null,
      evidence: evidence ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(projectChecklistItems.id, itemId), eq(projectChecklistItems.orgId, ctx.orgId)))
    .returning();
  if (!i) throw notFound('Checklist item');
  return i;
}

// ---------------------------------------------------------------- scenes

export async function upsertScenes(
  ctx: Ctx,
  projectId: string,
  scenes: {
    ordinal: number;
    title?: string;
    narration?: string;
    direction?: string;
    shotPrompt?: string;
    timecodeStartMs?: number;
    timecodeEndMs?: number;
  }[],
) {
  const [p] = await ctx.db
    .select({ id: creativeProjects.id })
    .from(creativeProjects)
    .where(and(eq(creativeProjects.id, projectId), eq(creativeProjects.orgId, ctx.orgId)));
  if (!p) throw notFound('Project');
  const ords = new Set(scenes.map((s) => s.ordinal));
  if (ords.size !== scenes.length) throw badRequest('Duplicate scene ordinals');
  for (const s of scenes) {
    await ctx.db
      .insert(productionScenes)
      .values({
        orgId: ctx.orgId,
        projectId,
        ordinal: s.ordinal,
        title: s.title ?? null,
        narration: s.narration ?? null,
        direction: s.direction ?? null,
        shotPrompt: s.shotPrompt ?? null,
        timecodeStartMs: s.timecodeStartMs ?? null,
        timecodeEndMs: s.timecodeEndMs ?? null,
      })
      .onConflictDoUpdate({
        target: [productionScenes.projectId, productionScenes.ordinal],
        set: {
          title: s.title ?? null,
          narration: s.narration ?? null,
          direction: s.direction ?? null,
          shotPrompt: s.shotPrompt ?? null,
          timecodeStartMs: s.timecodeStartMs ?? null,
          timecodeEndMs: s.timecodeEndMs ?? null,
          updatedAt: new Date(),
        },
      });
  }
  return ctx.db
    .select()
    .from(productionScenes)
    .where(eq(productionScenes.projectId, projectId))
    .orderBy(asc(productionScenes.ordinal));
}

/** SELECTED is the only state that counts toward progress and always an owner action. Rejecting never deletes outputs. */
export async function setSceneStatus(
  ctx: Ctx,
  sceneId: string,
  status: (typeof productionScenes.$inferInsert)['status'],
  opts: { selectedVersionId?: string | null; qaNotes?: string | null } = {},
) {
  return ctx.db.transaction(async (tx) => {
    const [s] = await tx
      .select()
      .from(productionScenes)
      .where(and(eq(productionScenes.id, sceneId), eq(productionScenes.orgId, ctx.orgId)));
    if (!s) throw notFound('Scene');
    const [after] = await tx
      .update(productionScenes)
      .set({
        status,
        selectedVersionId:
          status === 'SELECTED'
            ? (opts.selectedVersionId ?? s.selectedVersionId)
            : status === 'REJECTED'
              ? null
              : s.selectedVersionId,
        approvedAt: status === 'SELECTED' ? new Date() : null,
        qaNotes: opts.qaNotes ?? s.qaNotes,
        updatedAt: new Date(),
      })
      .where(eq(productionScenes.id, sceneId))
      .returning();
    if (status === 'SELECTED' && s.status !== 'SELECTED')
      await emit(tx, ctx.orgId, 'project.scene.completed', {
        projectId: s.projectId,
        sceneId,
        ordinal: s.ordinal,
      });
    await audit(
      { ...ctx, db: tx },
      'scene.status',
      { type: 'scene', id: sceneId },
      { status: s.status },
      { status },
    );
    return after!;
  });
}

export async function recordDecision(
  ctx: Ctx,
  projectId: string,
  input: { title: string; decision: string },
) {
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx
      .select({ id: creativeProjects.id })
      .from(creativeProjects)
      .where(and(eq(creativeProjects.id, projectId), eq(creativeProjects.orgId, ctx.orgId)));
    if (!p) throw notFound('Project');
    const [mx] = await tx
      .select({ n: sql<number>`coalesce(max(${projectDecisions.version}),0)::int` })
      .from(projectDecisions)
      .where(eq(projectDecisions.projectId, projectId));
    await tx
      .update(projectDecisions)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(projectDecisions.projectId, projectId),
          eq(projectDecisions.title, input.title),
          isNull(projectDecisions.supersededAt),
        ),
      );
    const [d] = await tx
      .insert(projectDecisions)
      .values({
        orgId: ctx.orgId,
        projectId,
        version: (mx?.n ?? 0) + 1,
        title: input.title,
        decision: input.decision,
        decidedBy: ctx.userId,
      })
      .returning();
    return d!;
  });
}

// ------------------------------------------------- generation / workflow

const SCENE_ADVANCE_FROM = ['PLANNED', 'QUEUED', 'RUNNING', 'FAILED', 'SUCCEEDED'];

/**
 * ComfyUI/H3 workflow manifest -> exact job-to-output linking. Idempotent on (provider, jobId): replays update the same job
 * and never duplicate outputs. A finished job only ever moves a scene to SUCCEEDED; SELECTED stays an owner decision.
 */
export async function ingestWorkflowManifest(ctx: Ctx, raw: unknown) {
  const m = workflowManifestSchema.parse(raw);
  return ctx.db.transaction(async (tx) => {
    const [job] = await tx
      .insert(generationJobs)
      .values({
        orgId: ctx.orgId,
        projectId: m.projectId ?? null,
        sceneId: m.sceneId ?? null,
        provider: m.provider,
        externalJobId: m.jobId,
        promptId: m.promptId ?? null,
        status: m.status,
        startedAt: m.startedAt ? new Date(m.startedAt) : null,
        finishedAt: m.finishedAt ? new Date(m.finishedAt) : null,
        settings: m.settings ?? {},
        workflow: m.workflow ?? {},
        error: m.error ?? null,
      })
      .onConflictDoUpdate({
        target: [generationJobs.orgId, generationJobs.provider, generationJobs.externalJobId],
        targetWhere: sql`${generationJobs.externalJobId} is not null`,
        set: {
          status: m.status,
          startedAt: m.startedAt ? new Date(m.startedAt) : sql`${generationJobs.startedAt}`,
          finishedAt: m.finishedAt ? new Date(m.finishedAt) : sql`${generationJobs.finishedAt}`,
          settings: m.settings ?? {},
          workflow: m.workflow ?? {},
          error: m.error ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    let linked = 0;
    let pending = 0;
    for (const o of m.outputs) {
      const inst = await findInstanceByPath(tx, ctx.orgId, o.path, o.deviceUuid);
      const [existing] = await tx
        .select()
        .from(generationOutputs)
        .where(and(eq(generationOutputs.jobId, job!.id), eq(generationOutputs.expectedPath, o.path)));
      if (existing) {
        if (!existing.fileInstanceId && inst) {
          await tx
            .update(generationOutputs)
            .set({ fileInstanceId: inst.id })
            .where(eq(generationOutputs.id, existing.id));
          linked += 1;
        }
        continue;
      }
      await tx.insert(generationOutputs).values({
        orgId: ctx.orgId,
        jobId: job!.id,
        expectedPath: o.path,
        fileInstanceId: inst?.id ?? null,
        sha256: o.sha256 ?? null,
        node: o.node ?? null,
        outputRole: o.role,
        startMs: o.startMs ?? null,
        endMs: o.endMs ?? null,
      });
      if (inst) linked += 1;
      else pending += 1;
    }
    if (m.sceneId) {
      const [scene] = await tx
        .select()
        .from(productionScenes)
        .where(and(eq(productionScenes.id, m.sceneId), eq(productionScenes.orgId, ctx.orgId)));
      if (scene && SCENE_ADVANCE_FROM.includes(scene.status)) {
        const next =
          m.status === 'SUCCEEDED'
            ? 'SUCCEEDED'
            : m.status === 'FAILED'
              ? 'FAILED'
              : m.status === 'RUNNING'
                ? 'RUNNING'
                : m.status === 'QUEUED'
                  ? 'QUEUED'
                  : scene.status;
        if (next !== scene.status)
          await tx
            .update(productionScenes)
            .set({ status: next as any, updatedAt: new Date() })
            .where(eq(productionScenes.id, scene.id));
      }
    }
    return { jobId: job!.id, linked, pendingFiles: pending };
  });
}

async function findInstanceByPath(db: Executor, orgId: string, p: string, deviceUuid?: string) {
  let osList: ('windows' | 'posix')[] = ['windows', 'posix'];
  let deviceId: string | undefined;
  if (deviceUuid) {
    const [d] = await db
      .select()
      .from(devices)
      .where(and(eq(devices.orgId, orgId), eq(devices.deviceUuid, deviceUuid)));
    if (d) {
      deviceId = d.id;
      osList = [osToPathOs(d.os, p)];
    }
  }
  const keys = [...new Set(osList.map((os) => canonicalPath(p, os)))];
  const [i] = await db
    .select({ id: fileInstances.id })
    .from(fileInstances)
    .where(
      and(
        eq(fileInstances.orgId, orgId),
        inArray(fileInstances.canonicalPath, keys),
        isNull(fileInstances.archivedAt),
        ...(deviceId ? [eq(fileInstances.deviceId, deviceId)] : []),
      ),
    )
    .limit(1);
  return i;
}

/** Called by the worker after scans: outputs announced before the scanner saw the file get linked once it appears. */
export async function linkPendingGenerationOutputs(db: Ctx['db'], orgId: string) {
  const pend = await db
    .select()
    .from(generationOutputs)
    .where(and(eq(generationOutputs.orgId, orgId), isNull(generationOutputs.fileInstanceId)))
    .limit(500);
  let linked = 0;
  for (const o of pend) {
    if (!o.expectedPath) continue;
    const inst = await findInstanceByPath(db, orgId, o.expectedPath);
    if (inst) {
      await db
        .update(generationOutputs)
        .set({ fileInstanceId: inst.id })
        .where(eq(generationOutputs.id, o.id));
      linked += 1;
    }
  }
  return { linked };
}

export async function listScenes(ctx: Ctx, projectId: string) {
  const [p] = await ctx.db
    .select({ id: creativeProjects.id })
    .from(creativeProjects)
    .where(and(eq(creativeProjects.id, projectId), eq(creativeProjects.orgId, ctx.orgId)));
  if (!p) throw notFound('Project');
  return ctx.db
    .select()
    .from(productionScenes)
    .where(eq(productionScenes.projectId, projectId))
    .orderBy(asc(productionScenes.ordinal));
}
