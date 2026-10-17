import {
  and,
  assetFileLinks,
  assetMatchSuggestions,
  assetVersions,
  desc,
  duplicateCandidates,
  eq,
  fileInstances,
  logicalAssets,
  mediaObjects,
  sql,
  type Executor,
} from '@creatoros/db';
import { audit } from './audit';
import { EFFECTIVE_AVAILABILITY, copyPathsFor } from './library';
import { badRequest, conflict, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface AssetInput {
  title: string;
  kind?: (typeof logicalAssets.$inferInsert)['kind'];
  description?: string | null;
  brandId?: string | null;
  projectId?: string | null;
  fileInstanceId?: string;
}

async function requireInstance(db: Executor, orgId: string, id: string) {
  const [i] = await db
    .select()
    .from(fileInstances)
    .where(and(eq(fileInstances.id, id), eq(fileInstances.orgId, orgId)));
  if (!i) throw notFound('File');
  return i;
}

export async function createAsset(ctx: Ctx, input: AssetInput) {
  const title = input.title.trim();
  if (!title) throw badRequest('Title is required');
  return ctx.db.transaction(async (tx) => {
    const inst = input.fileInstanceId ? await requireInstance(tx, ctx.orgId, input.fileInstanceId) : null;
    const kind =
      input.kind ??
      (inst && ['VIDEO', 'AUDIO', 'IMAGE', 'DOCUMENT'].includes(inst.fileType)
        ? (inst.fileType as any)
        : 'VIDEO');
    const [asset] = await tx
      .insert(logicalAssets)
      .values({
        orgId: ctx.orgId,
        title,
        kind,
        description: input.description ?? null,
        brandId: input.brandId ?? null,
        projectId: input.projectId ?? null,
        source: inst ? 'library' : 'manual',
      })
      .returning();
    const [v] = await tx
      .insert(assetVersions)
      .values({
        orgId: ctx.orgId,
        assetId: asset!.id,
        label: 'v1',
        number: 1,
        mediaObjectId: inst?.mediaObjectId ?? null,
        isMaster: true,
        createdBy: ctx.userId,
      })
      .returning();
    if (inst) {
      await tx.insert(assetFileLinks).values({
        orgId: ctx.orgId,
        assetVersionId: v!.id,
        fileInstanceId: inst.id,
        linkReason: 'manual',
        confirmedBy: ctx.userId,
        primaryPreference: true,
      });
    }
    await audit({ ...ctx, db: tx }, 'asset.create', { type: 'asset', id: asset!.id }, undefined, {
      title,
      kind,
    });
    return { ...asset!, versions: [v!] };
  });
}

export async function updateAsset(
  ctx: Ctx,
  id: string,
  patch: Partial<Pick<AssetInput, 'title' | 'description' | 'brandId' | 'projectId' | 'kind'>> & {
    creativeState?: any;
    isArchived?: boolean;
  },
) {
  const [before] = await ctx.db
    .select()
    .from(logicalAssets)
    .where(and(eq(logicalAssets.id, id), eq(logicalAssets.orgId, ctx.orgId)));
  if (!before) throw notFound('Asset');
  const [after] = await ctx.db
    .update(logicalAssets)
    .set({
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.brandId !== undefined ? { brandId: patch.brandId } : {}),
      ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.creativeState !== undefined ? { creativeState: patch.creativeState } : {}),
      ...(patch.isArchived !== undefined ? { isArchived: patch.isArchived } : {}),
      updatedAt: new Date(),
    })
    .where(eq(logicalAssets.id, id))
    .returning();
  await audit(ctx, 'asset.update', { type: 'asset', id }, before, after);
  return after!;
}

export async function listAssets(
  ctx: Ctx,
  q: {
    q?: string;
    kind?: string;
    projectId?: string;
    brandId?: string;
    includeArchived?: boolean;
    limit?: number;
    cursor?: string;
  },
) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const where = [sql`a.org_id = ${ctx.orgId}`];
  if (!q.includeArchived) where.push(sql`a.is_archived = false`);
  if (q.q?.trim()) where.push(sql`a.title ilike ${'%' + esc(q.q.trim()) + '%'}`);
  if (q.kind) where.push(sql`a.kind = ${q.kind}::asset_kind`);
  if (q.projectId) where.push(sql`a.project_id = ${q.projectId}`);
  if (q.brandId) where.push(sql`a.brand_id = ${q.brandId}`);
  if (q.cursor) {
    const [t, id] = Buffer.from(q.cursor, 'base64url').toString('utf8').split('|');
    if (!t || !id) throw badRequest('Invalid cursor');
    where.push(sql`(a.created_at, a.id) < (${t}::timestamptz, ${id}::uuid)`);
  }
  const rows = rowsOf<any>(
    await ctx.db.execute(sql`
      select a.id, a.title, a.kind, a.creative_state as "creativeState", a.brand_id as "brandId", a.project_id as "projectId",
             a.selected_version_id as "selectedVersionId", a.created_at as "createdAt",
             (select count(*)::int from asset_versions v where v.asset_id = a.id) as "versionCount",
             (select count(*)::int from asset_versions v join asset_file_links l on l.asset_version_id = v.id where v.asset_id = a.id) as "fileCount"
      from logical_assets a where ${sql.join(where, sql` and `)}
      order by a.created_at desc, a.id desc limit ${limit + 1}`),
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(`${new Date(last.createdAt).toISOString()}|${last.id}`).toString('base64url')
        : null,
  };
}

export async function getAsset(ctx: Ctx, id: string) {
  const [asset] = await ctx.db
    .select()
    .from(logicalAssets)
    .where(and(eq(logicalAssets.id, id), eq(logicalAssets.orgId, ctx.orgId)));
  if (!asset) throw notFound('Asset');
  const versions = await ctx.db
    .select()
    .from(assetVersions)
    .where(eq(assetVersions.assetId, id))
    .orderBy(assetVersions.number);
  const files = rowsOf<any>(
    await ctx.db.execute(sql`
      select l.asset_version_id as "versionId", l.link_reason as "linkReason", l.primary_preference as "primary",
             f.id, f.file_name as "fileName", f.display_path as "displayPath", f.size, f.file_type as "fileType",
             ${EFFECTIVE_AVAILABILITY} as "effectiveAvailability", d.display_name as "deviceName",
             r.display_path as "rootPath", r.smb_path as "rootSmb", r.mount_path as "rootMount", r.path_os as "rootOs"
      from asset_file_links l
      join asset_versions v on v.id = l.asset_version_id
      join file_instances f on f.id = l.file_instance_id
      join storage_roots r on r.id = f.root_id join devices d on d.id = f.device_id
      where v.asset_id = ${id}`),
  ).map((f) => ({
    ...f,
    copyPaths: copyPathsFor(f, {
      displayPath: f.rootPath,
      smbPath: f.rootSmb,
      mountPath: f.rootMount,
      pathOs: f.rootOs,
    }),
  }));
  const tags = rowsOf<any>(
    await ctx.db.execute(
      sql`select t.id, t.name, t.color from asset_tag_links l join media_tags t on t.id = l.tag_id where l.asset_id = ${id}`,
    ),
  );
  return {
    ...asset,
    tags,
    versions: versions.map((v) => ({ ...v, files: files.filter((f) => f.versionId === v.id) })),
  };
}

export async function addVersion(
  ctx: Ctx,
  assetId: string,
  input: {
    label?: string;
    variantType?: (typeof assetVersions.$inferInsert)['variantType'];
    parentVersionId?: string | null;
    fileInstanceId?: string;
    notes?: string | null;
    resolution?: string | null;
    intendedUse?: string | null;
  },
) {
  return ctx.db.transaction(async (tx) => {
    const [asset] = await tx
      .select()
      .from(logicalAssets)
      .where(and(eq(logicalAssets.id, assetId), eq(logicalAssets.orgId, ctx.orgId)));
    if (!asset) throw notFound('Asset');
    if (input.parentVersionId) {
      const [p] = await tx
        .select()
        .from(assetVersions)
        .where(and(eq(assetVersions.id, input.parentVersionId), eq(assetVersions.assetId, assetId)));
      if (!p) throw badRequest('Parent version belongs to another asset');
    }
    const inst = input.fileInstanceId ? await requireInstance(tx, ctx.orgId, input.fileInstanceId) : null;
    const [mx] = await tx
      .select({ n: sql<number>`coalesce(max(${assetVersions.number}),0)::int` })
      .from(assetVersions)
      .where(eq(assetVersions.assetId, assetId));
    const number = (mx?.n ?? 0) + 1;
    const [v] = await tx
      .insert(assetVersions)
      .values({
        orgId: ctx.orgId,
        assetId,
        number,
        label: input.label?.trim() || `v${number}`,
        variantType: input.variantType ?? 'MASTER',
        parentVersionId: input.parentVersionId ?? null,
        mediaObjectId: inst?.mediaObjectId ?? null,
        notes: input.notes ?? null,
        resolution: input.resolution ?? null,
        intendedUse: input.intendedUse ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    if (inst)
      await tx.insert(assetFileLinks).values({
        orgId: ctx.orgId,
        assetVersionId: v!.id,
        fileInstanceId: inst.id,
        linkReason: 'manual',
        confirmedBy: ctx.userId,
        primaryPreference: true,
      });
    await audit({ ...ctx, db: tx }, 'asset.version.create', { type: 'asset_version', id: v!.id });
    return v!;
  });
}

/**
 * Link a physical file to an asset version. One version = one set of bytes; linking a file with different content
 * is refused so versions can never silently point at different media.
 */
export async function linkFile(
  ctx: Ctx,
  versionId: string,
  fileInstanceId: string,
  reason = 'manual',
  confidence?: number,
) {
  return ctx.db.transaction(async (tx) => {
    const [v] = await tx
      .select()
      .from(assetVersions)
      .where(and(eq(assetVersions.id, versionId), eq(assetVersions.orgId, ctx.orgId)));
    if (!v) throw notFound('Version');
    const inst = await requireInstance(tx, ctx.orgId, fileInstanceId);
    if (v.mediaObjectId && inst.mediaObjectId && v.mediaObjectId !== inst.mediaObjectId) {
      throw conflict(
        'This file has different content than the version it is being linked to. Create a new version instead.',
        undefined,
        'VERSION_CONTENT_MISMATCH',
      );
    }
    await tx
      .insert(assetFileLinks)
      .values({
        orgId: ctx.orgId,
        assetVersionId: versionId,
        fileInstanceId,
        linkReason: reason,
        confidence: confidence ?? null,
        confirmedBy: ctx.userId,
      })
      .onConflictDoNothing();
    if (!v.mediaObjectId && inst.mediaObjectId)
      await tx
        .update(assetVersions)
        .set({ mediaObjectId: inst.mediaObjectId })
        .where(eq(assetVersions.id, versionId));
    await audit({ ...ctx, db: tx }, 'asset.file.link', { type: 'asset_version', id: versionId }, undefined, {
      fileInstanceId,
      reason,
    });
    return { versionId, fileInstanceId };
  });
}

export async function unlinkFile(ctx: Ctx, versionId: string, fileInstanceId: string) {
  const r = await ctx.db
    .delete(assetFileLinks)
    .where(
      and(
        eq(assetFileLinks.orgId, ctx.orgId),
        eq(assetFileLinks.assetVersionId, versionId),
        eq(assetFileLinks.fileInstanceId, fileInstanceId),
      ),
    )
    .returning({ id: assetFileLinks.id });
  if (!r.length) throw notFound('Link');
  await audit(ctx, 'asset.file.unlink', { type: 'asset_version', id: versionId }, { fileInstanceId });
  return { removed: true };
}

/** Owner explicitly picks the final version. This is the only thing that counts as "selected/completed" for progress. */
export async function selectVersion(ctx: Ctx, assetId: string, versionId: string) {
  return ctx.db.transaction(async (tx) => {
    const [v] = await tx
      .select()
      .from(assetVersions)
      .where(
        and(
          eq(assetVersions.id, versionId),
          eq(assetVersions.assetId, assetId),
          eq(assetVersions.orgId, ctx.orgId),
        ),
      );
    if (!v) throw notFound('Version');
    await tx
      .update(logicalAssets)
      .set({ selectedVersionId: versionId, creativeState: 'APPROVED', updatedAt: new Date() })
      .where(eq(logicalAssets.id, assetId));
    await tx
      .update(assetVersions)
      .set({ approvalState: 'APPROVED', updatedAt: new Date() })
      .where(eq(assetVersions.id, versionId));
    await audit({ ...ctx, db: tx }, 'asset.version.select', { type: 'asset', id: assetId }, undefined, {
      versionId,
    });
    return { assetId, selectedVersionId: versionId };
  });
}

export async function setVersionApproval(
  ctx: Ctx,
  versionId: string,
  state: (typeof assetVersions.$inferInsert)['approvalState'],
) {
  const [v] = await ctx.db
    .update(assetVersions)
    .set({ approvalState: state, updatedAt: new Date() })
    .where(and(eq(assetVersions.id, versionId), eq(assetVersions.orgId, ctx.orgId)))
    .returning();
  if (!v) throw notFound('Version');
  await audit(ctx, 'asset.version.approval', { type: 'asset_version', id: versionId }, undefined, { state });
  return v;
}

export async function listTags(ctx: Ctx) {
  return rowsOf<any>(
    await ctx.db.execute(
      sql`select t.id, t.name, t.color, (select count(*)::int from asset_tag_links l where l.tag_id = t.id) as "assetCount", (select count(*)::int from file_tag_links l where l.tag_id = t.id) as "fileCount" from media_tags t where t.org_id = ${ctx.orgId} order by lower(t.name)`,
    ),
  );
}

export async function setAssetTags(ctx: Ctx, assetId: string, tagNames: string[]) {
  const [a] = await ctx.db
    .select({ id: logicalAssets.id })
    .from(logicalAssets)
    .where(and(eq(logicalAssets.id, assetId), eq(logicalAssets.orgId, ctx.orgId)));
  if (!a) throw notFound('Asset');
  const names = [...new Set(tagNames.map((t) => t.trim()).filter(Boolean))].slice(0, 30);
  await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`delete from asset_tag_links where asset_id = ${assetId}`);
    for (const name of names) {
      await tx.execute(
        sql`insert into media_tags (org_id, name) values (${ctx.orgId}, ${name}) on conflict (org_id, lower(name)) do nothing`,
      );
      await tx.execute(
        sql`insert into asset_tag_links (org_id, asset_id, tag_id) select ${ctx.orgId}, ${assetId}, id from media_tags where org_id = ${ctx.orgId} and lower(name) = lower(${name}) on conflict do nothing`,
      );
    }
  });
  return { tags: names };
}

// --------------------------------------------------------------- duplicates

/** Exact duplicates = identical content hash found in more than one place. Never merged or deleted automatically. */
export async function listExactDuplicateGroups(ctx: Ctx, limit = 100) {
  const groups = rowsOf<any>(
    await ctx.db.execute(sql`
      select f.media_object_id as "mediaObjectId", count(*)::int as copies, max(f.size)::float8 as size,
             (max(f.size) * (count(*) - 1))::float8 as "wastedBytes"
      from file_instances f
      where f.org_id = ${ctx.orgId} and f.archived_at is null and f.media_object_id is not null
      group by f.media_object_id having count(*) > 1
      order by (max(f.size) * (count(*) - 1)) desc limit ${limit}`),
  );
  const out = [];
  for (const g of groups) {
    const files = rowsOf<any>(
      await ctx.db.execute(sql`
        select f.id, f.file_name as "fileName", f.display_path as "displayPath", f.size, d.display_name as "deviceName", ${EFFECTIVE_AVAILABILITY} as "effectiveAvailability"
        from file_instances f join storage_roots r on r.id = f.root_id join devices d on d.id = f.device_id
        where f.media_object_id = ${g.mediaObjectId} and f.archived_at is null order by f.first_seen_at`),
    );
    out.push({ ...g, files });
  }
  return out;
}

/**
 * Near duplicates are only SUGGESTIONS, scored from metadata (never visual identity claims):
 *  - NEAR_DURATION_NAME: same media kind, duration within 1s, same resolution, similar names
 *  - NEAR_NAME_SIZE: very similar names and sizes within 2% but different bytes
 */
export async function detectNearDuplicates(ctx: Ctx, limit = 500) {
  const inserted = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`
      with m as (
        select mo.id, mo.kind, mo.size, (mo.tech->>'durationMs')::float8 as dur, mo.tech->>'width' as w, mo.tech->>'height' as h,
               (select f.file_name from file_instances f where f.media_object_id = mo.id and f.archived_at is null order by f.first_seen_at limit 1) as name
        from media_objects mo where mo.org_id = ${ctx.orgId} and mo.verification_state = 'VERIFIED'
      )
      insert into duplicate_candidates (org_id, media_a_id, media_b_id, method, score, reasons)
      select ${ctx.orgId}, a.id, b.id,
        case when a.dur is not null and b.dur is not null then 'NEAR_DURATION_NAME'::duplicate_method else 'NEAR_NAME_SIZE'::duplicate_method end,
        round(similarity(a.name, b.name)::numeric, 3)::float8,
        case when a.dur is not null and b.dur is not null
          then jsonb_build_array('duration within 1s', 'same resolution', 'similar file names')
          else jsonb_build_array('very similar file names', 'sizes within 2%') end
      from m a join m b on a.id < b.id and a.kind = b.kind
      where a.name is not null and b.name is not null and similarity(a.name, b.name) >= 0.55
        and (
          (a.dur is not null and b.dur is not null and abs(a.dur - b.dur) <= 1000 and a.w is not distinct from b.w and a.h is not distinct from b.h)
          or (a.dur is null and b.dur is null and similarity(a.name, b.name) >= 0.8 and abs(a.size - b.size) <= greatest(a.size, b.size) * 0.02)
        )
      order by a.id, b.id
      limit ${limit}
      on conflict do nothing
      returning id`),
  ).length;
  return { suggested: inserted };
}

export async function listDuplicateCandidates(
  ctx: Ctx,
  state: 'SUGGESTED' | 'CONFIRMED' | 'DISMISSED' = 'SUGGESTED',
  limit = 100,
) {
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select c.id, c.method, c.score, c.reasons, c.state,
        (select jsonb_agg(jsonb_build_object('id', f.id, 'path', f.display_path, 'size', f.size)) from file_instances f where f.media_object_id = c.media_a_id and f.archived_at is null) as "a",
        (select jsonb_agg(jsonb_build_object('id', f.id, 'path', f.display_path, 'size', f.size)) from file_instances f where f.media_object_id = c.media_b_id and f.archived_at is null) as "b"
      from duplicate_candidates c where c.org_id = ${ctx.orgId} and c.state = ${state}::duplicate_state order by c.score desc limit ${limit}`),
  );
}

export async function reviewDuplicate(ctx: Ctx, id: string, state: 'CONFIRMED' | 'DISMISSED') {
  const [c] = await ctx.db
    .update(duplicateCandidates)
    .set({ state, reviewedBy: ctx.userId, reviewedAt: new Date() })
    .where(and(eq(duplicateCandidates.id, id), eq(duplicateCandidates.orgId, ctx.orgId)))
    .returning();
  if (!c) throw notFound('Duplicate candidate');
  await audit(ctx, 'duplicate.review', { type: 'duplicate_candidate', id }, undefined, { state });
  return c; // nothing is deleted or merged: files stay exactly where they are
}

// ------------------------------------------------------ asset match suggestions

const stem = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\b(v|ver|version)\s*\d+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Suggests assets for an unlinked file by identical content, project context and name similarity. Owner always confirms. */
export async function suggestMatches(ctx: Ctx, fileInstanceId: string) {
  const inst = await requireInstance(ctx.db, ctx.orgId, fileInstanceId);
  const found = new Map<string, { reasons: string[]; confidence: number }>();
  const add = (assetId: string, reason: string, confidence: number) => {
    const cur = found.get(assetId) ?? { reasons: [], confidence: 0 };
    cur.reasons.push(reason);
    cur.confidence = Math.min(1, Math.max(cur.confidence, confidence) + (cur.reasons.length > 1 ? 0.1 : 0));
    found.set(assetId, cur);
  };
  if (inst.mediaObjectId) {
    for (const r of rowsOf<{ assetId: string }>(
      await ctx.db.execute(
        sql`select v.asset_id as "assetId" from asset_versions v where v.org_id = ${ctx.orgId} and v.media_object_id = ${inst.mediaObjectId}`,
      ),
    ))
      add(r.assetId, 'identical content (hash match)', 1);
  }
  const nameStem = stem(inst.fileName);
  if (nameStem.length >= 3) {
    for (const r of rowsOf<{ id: string; sim: number }>(
      await ctx.db.execute(
        sql`select id, similarity(title, ${nameStem})::float8 as sim from logical_assets where org_id = ${ctx.orgId} and is_archived = false and similarity(title, ${nameStem}) >= 0.35 order by sim desc limit 5`,
      ),
    ))
      add(r.id, `name similar to "${nameStem}"`, Math.min(0.9, r.sim));
  }
  const [rt] = await ctx.db
    .execute(sql`select project_id as "projectId" from storage_roots where id = ${inst.rootId}`)
    .then((r) => rowsOf<{ projectId: string | null }>(r));
  if (rt?.projectId) {
    for (const r of rowsOf<{ id: string }>(
      await ctx.db.execute(
        sql`select id from logical_assets where org_id = ${ctx.orgId} and project_id = ${rt.projectId} and is_archived = false limit 20`,
      ),
    ))
      add(r.id, 'scan root is assigned to the same project', 0.3);
  }
  for (const [assetId, s] of found) {
    await ctx.db
      .insert(assetMatchSuggestions)
      .values({
        orgId: ctx.orgId,
        sourceType: 'file_instance',
        sourceId: fileInstanceId,
        candidateAssetId: assetId,
        reasons: s.reasons,
        confidence: s.confidence,
      })
      .onConflictDoNothing();
  }
  return listSuggestions(ctx, fileInstanceId);
}

export async function listSuggestions(ctx: Ctx, fileInstanceId: string) {
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select s.id, s.candidate_asset_id as "assetId", a.title, a.kind, s.reasons, s.confidence, s.outcome
      from asset_match_suggestions s join logical_assets a on a.id = s.candidate_asset_id
      where s.org_id = ${ctx.orgId} and s.source_type = 'file_instance' and s.source_id = ${fileInstanceId}
      order by s.confidence desc`),
  );
}

export async function acceptSuggestion(ctx: Ctx, suggestionId: string, versionId?: string) {
  const [s] = await ctx.db
    .select()
    .from(assetMatchSuggestions)
    .where(and(eq(assetMatchSuggestions.id, suggestionId), eq(assetMatchSuggestions.orgId, ctx.orgId)));
  if (!s) throw notFound('Suggestion');
  let vid = versionId;
  if (!vid) {
    const [latest] = await ctx.db
      .select()
      .from(assetVersions)
      .where(eq(assetVersions.assetId, s.candidateAssetId))
      .orderBy(desc(assetVersions.number))
      .limit(1);
    vid = latest?.id;
  }
  if (!vid) throw badRequest('The asset has no version to link to');
  await linkFile(ctx, vid, s.sourceId, 'suggestion', s.confidence);
  await ctx.db
    .update(assetMatchSuggestions)
    .set({ outcome: 'ACCEPTED', reviewedBy: ctx.userId, reviewedAt: new Date() })
    .where(eq(assetMatchSuggestions.id, suggestionId));
  return { linked: true, versionId: vid };
}

export async function rejectSuggestion(ctx: Ctx, suggestionId: string) {
  const [s] = await ctx.db
    .update(assetMatchSuggestions)
    .set({ outcome: 'REJECTED', reviewedBy: ctx.userId, reviewedAt: new Date() })
    .where(and(eq(assetMatchSuggestions.id, suggestionId), eq(assetMatchSuggestions.orgId, ctx.orgId)))
    .returning();
  if (!s) throw notFound('Suggestion');
  return s;
}

void mediaObjects;
