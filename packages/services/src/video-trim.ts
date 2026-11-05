import { fileInstances, sql, type Db } from '@creatoros/db';
import { planTrimOutput, trimDurationOk, TrimError, type PathOs } from '@creatoros/domain';
import { syncFolderAssets } from './assets';
import { audit } from './audit';
import type { AuthedAgent } from './devices';
import { badRequest, conflict, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const duplicate = (e: unknown) =>
  (e as { code?: string }).code === '23505' || (e as { cause?: { code?: string } }).cause?.code === '23505';

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function probeOf(tech: Record<string, unknown> | null | undefined) {
  const durationMs = num(tech?.durationMs);
  const fps = num(tech?.fps);
  const width = num(tech?.width);
  const height = num(tech?.height);
  return {
    durationMs,
    fps,
    width,
    height,
    codec: typeof tech?.codec === 'string' ? tech.codec : null,
    audioCodec: typeof tech?.audioCodec === 'string' ? tech.audioCodec : null,
    hasAudio: typeof tech?.hasAudio === 'boolean' ? tech.hasAudio : null,
    rotation: num(tech?.rotation),
    formatName: typeof tech?.formatName === 'string' ? tech.formatName : null,
  };
}

async function loadVideo(ctx: Ctx, id: string) {
  const row = rowsOf<{
    id: string;
    displayPath: string;
    fileName: string;
    fileType: string;
    size: number | string;
    deviceId: string;
    deviceName: string;
    deviceState: string;
    rootId: string;
    pathOs: string;
    archivedAt: Date | null;
    availability: string;
    tech: Record<string, unknown>;
    projectId: string | null;
  }>(
    await ctx.db.execute(sql`
      select f.id, f.display_path as "displayPath", f.file_name as "fileName", f.file_type as "fileType", f.size,
             f.device_id as "deviceId", d.display_name as "deviceName", d.state as "deviceState",
             f.root_id as "rootId", r.path_os as "pathOs", f.archived_at as "archivedAt",
             f.availability, f.tech, a.project_id as "projectId"
      from file_instances f
      join devices d on d.id = f.device_id
      join storage_roots r on r.id = f.root_id
      left join lateral (
        select ast.project_id
        from asset_file_links l
        join asset_versions v on v.id = l.asset_version_id
        join logical_assets ast on ast.id = v.asset_id
        where l.file_instance_id = f.id and ast.project_id is not null
        limit 1
      ) a on true
      where f.id = ${id} and f.org_id = ${ctx.orgId}`),
  )[0];
  if (!row) throw notFound('File');
  if (row.archivedAt) throw badRequest('This file is already gone from the library.');
  if (row.fileType !== 'VIDEO') throw badRequest('Only a video can be trimmed.');
  if (row.availability !== 'AVAILABLE') throw badRequest('This video is not on that PC right now.');
  return row;
}

export async function listVideoEdits(ctx: Ctx, fileId: string) {
  await loadVideo(ctx, fileId);
  const edits = rowsOf<{
    id: string;
    status: string;
    mode: string;
    startMs: number;
    endMs: number;
    progressPct: number;
    error: string | null;
    outputFileId: string | null;
    outputName: string | null;
    createdAt: string;
  }>(
    await ctx.db.execute(sql`
      select e.id, e.status, e.mode, e.start_ms as "startMs", e.end_ms as "endMs",
             e.progress_pct as "progressPct", e.error,
             e.output_file_instance_id as "outputFileId",
             f.file_name as "outputName",
             e.created_at as "createdAt"
      from video_edits e
      left join file_instances f on f.id = e.output_file_instance_id
      where e.org_id = ${ctx.orgId} and e.source_file_instance_id = ${fileId}
      order by e.created_at desc
      limit 8`),
  );
  return { edits };
}

export async function requestVideoTrim(
  ctx: Ctx,
  fileId: string,
  input: { startMs: number; endMs: number; mode?: 'ACCURATE' | 'FAST'; projectId?: string | null; variantId?: string | null },
) {
  const file = await loadVideo(ctx, fileId);
  const probe = probeOf(file.tech);
  const os: PathOs = file.pathOs === 'windows' ? 'windows' : 'posix';
  const roots = rowsOf<{ id: string; displayPath: string; canonicalPath: string }>(
    await ctx.db.execute(sql`
      select id, display_path as "displayPath", canonical_path as "canonicalPath"
      from storage_roots
      where org_id = ${ctx.orgId} and device_id = ${file.deviceId} and state = 'ACTIVE' and retired_at is null`),
  );
  const taken = rowsOf<{ name: string }>(
    await ctx.db.execute(sql`
      select file_name as name from file_instances
      where org_id = ${ctx.orgId} and device_id = ${file.deviceId} and archived_at is null
      union
      select regexp_replace(output_display_path, '^.*[\\\\/]', '') as name from video_edits
      where org_id = ${ctx.orgId} and device_id = ${file.deviceId} and status in ('PENDING', 'RUNNING')`),
  );
  let planned;
  try {
    planned = planTrimOutput({
      displayPath: file.displayPath,
      fileName: file.fileName,
      os,
      roots,
      startMs: input.startMs,
      endMs: input.endMs,
      durationMs: probe.durationMs,
      fps: probe.fps,
      takenNames: taken.map((row) => row.name),
    });
  } catch (e) {
    if (e instanceof TrimError) throw badRequest(e.message);
    throw e;
  }
  const projectId = input.projectId || file.projectId || null;
  if (projectId) {
    const project = rowsOf<{ id: string }>(
      await ctx.db.execute(sql`
        select id from creative_projects where id = ${projectId} and org_id = ${ctx.orgId} and deleted_at is null`),
    )[0];
    if (!project) throw badRequest('That project is not in this workspace.');
  }
  if (input.variantId) {
    const variant = rowsOf<{ id: string }>(
      await ctx.db.execute(sql`
        select id from distribution_variants where id = ${input.variantId} and org_id = ${ctx.orgId}`),
    )[0];
    if (!variant) throw badRequest('That publishing title is not in this workspace.');
  }
  const open = rowsOf<{ n: number }>(
    await ctx.db.execute(sql`
      select count(*)::int as n from video_edits
      where device_id = ${file.deviceId} and status in ('PENDING', 'RUNNING')`),
  )[0];
  if ((open?.n ?? 0) >= 2) throw conflict('That PC already has two trims waiting. Let one finish first.');
  try {
    const created = rowsOf<{ id: string; status: string }>(
      await ctx.db.execute(sql`
        insert into video_edits (
          org_id, device_id, source_file_instance_id, project_id, variant_id, mode,
          start_ms, end_ms, output_display_path, output_canonical_path, output_root_id,
          source_probe, requested_by
        ) values (
          ${ctx.orgId}, ${file.deviceId}, ${file.id}, ${projectId}, ${input.variantId ?? null},
          ${input.mode ?? 'ACCURATE'}::video_edit_mode,
          ${planned.startMs}, ${planned.endMs}, ${planned.displayPath}, ${planned.canonicalPath}, ${planned.rootId},
          ${JSON.stringify(probe)}::jsonb, ${ctx.userId}
        )
        returning id, status`),
    )[0];
    if (!created) throw badRequest('The trim could not be saved.');
    await audit(ctx, 'video.trim.request', { type: 'file_instance', id: file.id }, undefined, {
      editId: created.id,
      startMs: planned.startMs,
      endMs: planned.endMs,
      mode: input.mode ?? 'ACCURATE',
      outputPath: planned.displayPath,
    });
    return {
      id: created.id,
      status: created.status,
      fileName: planned.fileName,
      displayPath: planned.displayPath,
      deviceName: file.deviceName,
      deviceState: file.deviceState,
    };
  } catch (e) {
    if (duplicate(e)) throw conflict('A trim to that same new file is already waiting.');
    throw e;
  }
}

export async function cancelVideoTrim(ctx: Ctx, editId: string) {
  const updated = rowsOf<{ id: string; fileId: string }>(
    await ctx.db.execute(sql`
      update video_edits
      set status = 'CANCELLED'::video_edit_status, finished_at = now(), updated_at = now(),
          error = 'Cancelled before the PC started.'
      where org_id = ${ctx.orgId} and id = ${editId} and status = 'PENDING'
      returning id, source_file_instance_id as "fileId"`),
  )[0];
  if (!updated) throw badRequest('The PC already started this trim, or there is nothing waiting.');
  await audit(ctx, 'video.trim.cancel', { type: 'file_instance', id: updated.fileId }, undefined, { editId: updated.id });
  return { ok: true };
}

/** One encode per PC. A second save stays pending until this one reports back. */
export async function claimVideoEdits(db: Db, agent: AuthedAgent) {
  return db.transaction(async (tx) => {
    const rows = rowsOf<{
      id: string;
      mode: string;
      fromPath: string;
      toPath: string;
      startMs: number;
      endMs: number;
      size: number | string;
      rotate: number | null;
    }>(
      await tx.execute(sql`
        update video_edits e
        set status = 'RUNNING'::video_edit_status, started_at = coalesce(e.started_at, now()), updated_at = now()
        where e.id = (
          select id from video_edits
          where device_id = ${agent.deviceId} and status = 'PENDING'
            and not exists (
              select 1 from video_edits r
              where r.device_id = ${agent.deviceId} and r.status = 'RUNNING'
            )
          order by created_at
          limit 1
          for update skip locked
        )
        returning e.id, e.mode, e.start_ms as "startMs", e.end_ms as "endMs",
          (select f.display_path from file_instances f where f.id = e.source_file_instance_id) as "fromPath",
          e.output_display_path as "toPath",
          (select f.size from file_instances f where f.id = e.source_file_instance_id) as size,
          nullif(e.source_probe->>'rotation', '')::float as rotate`),
    );
    return rows.map((row) => ({
      id: row.id,
      mode: row.mode,
      fromPath: row.fromPath,
      toPath: row.toPath,
      startMs: row.startMs,
      endMs: row.endMs,
      size: Number(row.size) || 0,
      rotate: row.rotate ?? 0,
    }));
  });
}

export async function progressVideoEdit(db: Db, agent: AuthedAgent, input: { id: string; progressPct: number }) {
  const pct = Math.max(0, Math.min(99, Math.round(input.progressPct)));
  await db.execute(sql`
    update video_edits
    set progress_pct = ${pct}, updated_at = now()
    where id = ${input.id} and device_id = ${agent.deviceId} and status = 'RUNNING'`);
  return { ok: true };
}

export async function finishVideoEdit(
  db: Db,
  agent: AuthedAgent,
  input: {
    id: string;
    ok: boolean;
    error?: string;
    toPath?: string;
    size?: number;
    probe?: Record<string, unknown>;
  },
) {
  const edit = rowsOf<{
    id: string;
    status: string;
    mode: 'ACCURATE' | 'FAST';
    orgId: string;
    deviceId: string;
    sourceId: string;
    projectId: string | null;
    variantId: string | null;
    startMs: number;
    endMs: number;
    toPath: string;
    canonical: string;
    rootId: string;
    fps: number | null;
  }>(
    await db.execute(sql`
      select e.id, e.status, e.mode, e.org_id as "orgId", e.device_id as "deviceId",
             e.source_file_instance_id as "sourceId", e.project_id as "projectId", e.variant_id as "variantId",
             e.start_ms as "startMs", e.end_ms as "endMs", e.output_display_path as "toPath",
             e.output_canonical_path as canonical, e.output_root_id as "rootId",
             nullif(e.source_probe->>'fps', '')::float as fps
      from video_edits e
      where e.id = ${input.id} and e.device_id = ${agent.deviceId}`),
  )[0];
  if (!edit) throw notFound('Trim');
  if (edit.status === 'SUCCEEDED') return { ok: true };
  if (edit.status === 'CANCELLED' || edit.status === 'FAILED') return { ok: false };
  const actor = { db, orgId: edit.orgId, userId: null, actor: { type: 'agent' as const, id: agent.deviceId } };
  const fail = async (message: string) => {
    await db.execute(sql`
      update video_edits
      set status = 'FAILED'::video_edit_status, error = ${message.slice(0, 500)}, finished_at = now(), updated_at = now()
      where id = ${edit.id} and status = 'RUNNING'`);
    await audit(actor, 'video.trim.fail', { type: 'file_instance', id: edit.sourceId }, undefined, {
      editId: edit.id,
      error: message.slice(0, 500),
    });
    return { ok: false };
  };
  if (!input.ok) return fail(input.error || 'The PC could not trim this video.');
  const reported = (input.toPath || '').trim();
  if (!reported || reported !== edit.toPath) return fail('The PC reported a different output path.');
  const probe = input.probe ?? {};
  const actualMs = num(probe.durationMs);
  if (actualMs == null || !trimDurationOk(edit.mode, edit.endMs - edit.startMs, actualMs, edit.fps)) {
    return fail('The new clip did not match the selected length, so it was not added.');
  }
  const size = Number(input.size);
  if (!Number.isFinite(size) || size < 1000) return fail('The new clip was empty.');
  const fileName = edit.toPath.split(/[/\\]/).pop() || 'clip.mp4';
  const [row] = await db
    .insert(fileInstances)
    .values({
      orgId: edit.orgId,
      rootId: edit.rootId,
      deviceId: edit.deviceId,
      canonicalPath: edit.canonical,
      displayPath: edit.toPath,
      fileName,
      ext: 'mp4',
      size,
      mtime: new Date(),
      availability: 'AVAILABLE',
      fileType: 'VIDEO',
      mime: 'video/mp4',
      probeState: 'INDEXED',
      tech: { ...probe, trimOf: edit.sourceId, trimStartMs: edit.startMs, trimEndMs: edit.endMs },
      stableObservations: 2,
      previousInstanceId: edit.sourceId,
    })
    .onConflictDoNothing()
    .returning({ id: fileInstances.id });
  if (!row) return fail('A file is already indexed at the new clip path.');
  await db.execute(sql`
    insert into asset_file_links (org_id, asset_version_id, file_instance_id, link_reason, primary_preference)
    select l.org_id, l.asset_version_id, ${row.id}, 'trim', false
    from asset_file_links l
    where l.org_id = ${edit.orgId} and l.file_instance_id = ${edit.sourceId}
    on conflict (asset_version_id, file_instance_id) do nothing`);
  await db.execute(sql`
    insert into publish_items (org_id, variant_id, file_instance_id)
    select p.org_id, p.variant_id, ${row.id}
    from publish_items p
    where p.org_id = ${edit.orgId} and p.file_instance_id = ${edit.sourceId}
    on conflict (variant_id, file_instance_id) do nothing`);
  if (edit.variantId) {
    await db.execute(sql`
      insert into publish_items (org_id, variant_id, file_instance_id)
      select ${edit.orgId}, v.id, ${row.id}
      from distribution_variants v
      where v.id = ${edit.variantId} and v.org_id = ${edit.orgId}
      on conflict (variant_id, file_instance_id) do nothing`);
  }
  if (edit.projectId) {
    await db.execute(sql`
      insert into publish_items (org_id, variant_id, file_instance_id)
      select ${edit.orgId}, v.id, ${row.id}
      from distribution_variants v
      where v.org_id = ${edit.orgId} and v.project_id = ${edit.projectId}
      order by v.created_at asc
      limit 1
      on conflict (variant_id, file_instance_id) do nothing`);
    await db.execute(sql`
      insert into asset_file_links (org_id, asset_version_id, file_instance_id, link_reason, primary_preference)
      select ${edit.orgId}, v.asset_version_id, ${row.id}, 'trim', false
      from distribution_variants v
      where v.org_id = ${edit.orgId} and v.project_id = ${edit.projectId} and v.asset_version_id is not null
      order by v.created_at asc
      limit 1
      on conflict (asset_version_id, file_instance_id) do nothing`);
  }
  await db.execute(sql`
    update video_edits
    set status = 'SUCCEEDED'::video_edit_status, progress_pct = 100, output_file_instance_id = ${row.id},
        output_probe = ${JSON.stringify(probe)}::jsonb, error = null, finished_at = now(), updated_at = now()
    where id = ${edit.id}`);
  await syncFolderAssets(db, edit.orgId).catch(() => undefined);
  await audit(actor, 'video.trim.finish', { type: 'file_instance', id: row.id }, undefined, {
    editId: edit.id,
    sourceId: edit.sourceId,
    displayPath: edit.toPath,
  });
  return { ok: true, fileInstanceId: row.id };
}

/** A PC that stops reporting is failed so the next trim can start. The original file is untouched. */
export async function expireStaleVideoEdits(db: Db) {
  const rows = rowsOf<{ id: string }>(
    await db.execute(sql`
      update video_edits
      set status = 'FAILED'::video_edit_status,
          error = 'That PC stopped reporting this trim. The original video was not changed.',
          finished_at = now(), updated_at = now()
      where status = 'RUNNING' and updated_at < now() - interval '20 minutes'
      returning id`),
  );
  return rows.length;
}
