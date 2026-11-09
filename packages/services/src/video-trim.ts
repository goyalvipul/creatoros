import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { fileInstances, sql, type Db } from '@creatoros/db';
import { accurateTrimArgs, canonicalPath, fastTrimArgs, trimDurationOk, TrimError, planTrimOutput, type PathOs } from '@creatoros/domain';
import { openAgentFile } from './agent-file';
import { syncFolderAssets } from './assets';
import { audit } from './audit';
import { getDeviceSigningKey, signAgentFetch, type AuthedAgent } from './devices';
import { badRequest, conflict, notFound, type Ctx, type ServiceEnv } from './types';

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
  input: {
    startMs: number;
    endMs: number;
    mode?: 'ACCURATE' | 'FAST';
    projectId?: string | null;
    variantId?: string | null;
    fileName?: string | null;
    replaceOriginal?: boolean;
  },
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
      requestedName: input.fileName,
      replace: input.replaceOriginal,
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
          start_ms, end_ms, replace_original, output_display_path, output_canonical_path, output_root_id,
          source_probe, requested_by
        ) values (
          ${ctx.orgId}, ${file.deviceId}, ${file.id}, ${projectId}, ${input.variantId ?? null},
          ${input.mode ?? 'ACCURATE'}::video_edit_mode,
          ${planned.startMs}, ${planned.endMs}, ${planned.replaceOriginal},
          ${planned.displayPath}, ${planned.canonicalPath}, ${planned.rootId},
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
      replaceOriginal: planned.replaceOriginal,
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

/** One encode per PC, on that PC. A second save stays pending until this one reports back. */
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
      replaceOriginal: boolean;
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
          e.replace_original as "replaceOriginal",
          (select f.display_path from file_instances f where f.id = e.source_file_instance_id) as "fromPath",
          e.output_display_path as "toPath",
          (select f.size from file_instances f where f.id = e.source_file_instance_id) as size,
          nullif(e.source_probe->>'rotation', '')::float as rotate`),
    );
    return rows.map((row) => {
      const sameFile = row.replaceOriginal && sameTrimPath(row.toPath, row.fromPath);
      return {
        id: row.id,
        mode: row.mode,
        fromPath: row.fromPath,
        toPath: sameFile ? siblingPath(row.fromPath, `cos-trim-${row.id.slice(0, 8)}.mp4`) : row.toPath,
        startMs: row.startMs,
        endMs: row.endMs,
        size: Number(row.size) || 0,
        rotate: row.rotate ?? 0,
      };
    });
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
    replaceOriginal: boolean;
    sourcePath: string;
    sourceSize: number;
  }>(
    await db.execute(sql`
      select e.id, e.status, e.mode, e.org_id as "orgId", e.device_id as "deviceId",
             e.source_file_instance_id as "sourceId", e.project_id as "projectId", e.variant_id as "variantId",
             e.start_ms as "startMs", e.end_ms as "endMs", e.output_display_path as "toPath",
             e.output_canonical_path as canonical, e.output_root_id as "rootId",
             e.replace_original as "replaceOriginal",
             nullif(e.source_probe->>'fps', '')::float as fps,
             (select f.display_path from file_instances f where f.id = e.source_file_instance_id) as "sourcePath",
             (select f.size::float8 from file_instances f where f.id = e.source_file_instance_id) as "sourceSize"
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
  const staged = siblingPath(edit.sourcePath || edit.toPath, `cos-trim-${edit.id.slice(0, 8)}.mp4`);
  const replacing = Boolean(
    edit.replaceOriginal && edit.sourcePath && sameTrimPath(edit.toPath, edit.sourcePath) && sameTrimPath(reported, staged),
  );
  if (!reported || (!replacing && reported !== edit.toPath)) return fail('The PC reported a different output path.');
  const savedPath = replacing ? staged : edit.toPath;
  const savedKey = replacing ? canonicalPath(staged, edit.sourcePath.includes('\\') ? 'windows' : 'posix') : edit.canonical;
  const probe = input.probe ?? {};
  const actualMs = num(probe.durationMs);
  if (actualMs == null || !trimDurationOk(edit.mode, edit.endMs - edit.startMs, actualMs, edit.fps)) {
    return fail('The new clip did not match the selected length, so it was not added.');
  }
  const size = Number(input.size);
  if (!Number.isFinite(size) || size < 1000) return fail('The new clip was empty.');
  const fileName = savedPath.split(/[/\\]/).pop() || 'clip.mp4';
  const [row] = await db
    .insert(fileInstances)
    .values({
      orgId: edit.orgId,
      rootId: edit.rootId,
      deviceId: edit.deviceId,
      canonicalPath: savedKey,
      displayPath: savedPath,
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
  if (replacing) {
    await replaceOriginalWithClip(
      db,
      edit,
      { displayPath: edit.sourcePath, size: Number(edit.sourceSize) || 0 },
      row.id,
      size,
      staged,
      edit.sourcePath.includes('\\') ? 'windows' : 'posix',
    );
    return { ok: true, fileInstanceId: row.id };
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

function fraction(rate: unknown): number | null {
  const text = String(rate ?? '');
  const [a, b] = text.split('/');
  const n = Number(a);
  const d = b == null ? 1 : Number(b);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  const value = n / d;
  return value > 0 && value < 240 ? value : null;
}

function probeFromFfprobe(raw: string): Record<string, unknown> {
  const body = JSON.parse(raw) as {
    streams?: {
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      duration?: string;
      disposition?: { attached_pic?: number };
      tags?: { rotate?: string };
      side_data_list?: { rotation?: number }[];
    }[];
    format?: { duration?: string; format_name?: string };
  };
  const video = (body.streams ?? []).find((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1);
  const audio = (body.streams ?? []).find((stream) => stream.codec_type === 'audio');
  const duration = Number(body.format?.duration ?? video?.duration);
  let rotation = 0;
  for (const side of video?.side_data_list ?? []) {
    if (side.rotation) rotation = Number(side.rotation);
  }
  if (!rotation && video?.tags?.rotate) rotation = Number(video.tags.rotate) || 0;
  return {
    durationMs: Number.isFinite(duration) ? duration * 1000 : null,
    fps: fraction(video?.avg_frame_rate) ?? fraction(video?.r_frame_rate),
    width: video?.width ?? null,
    height: video?.height ?? null,
    codec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    hasAudio: Boolean(audio),
    rotation,
    formatName: body.format?.format_name ?? null,
  };
}

function runProcess(bin: string, args: string[], onLine?: (line: string) => void): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let pending = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) onLine?.(line);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-800);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

/**
 * Cuts one saved trim on this machine, then uploads the new file into the same folder.
 * The scanner is not asked to run ffmpeg. The original is only read.
 */
export async function runServerVideoTrims(db: Db, env: ServiceEnv): Promise<number> {
  const claimed = rowsOf<{
    id: string;
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
    rotate: number | null;
    replaceOriginal: boolean;
  }>(
    await db.execute(sql`
      update video_edits e
      set status = 'RUNNING'::video_edit_status, error = null, progress_pct = 0,
          started_at = coalesce(e.started_at, now()), updated_at = now()
      where e.id = (
        select id from video_edits
        where status = 'FAILED' and error ilike '%ffmpeg is not installed%'
          and not exists (select 1 from video_edits r where r.status = 'RUNNING')
        order by created_at
        limit 1
        for update skip locked
      )
      returning e.id, e.mode, e.org_id as "orgId", e.device_id as "deviceId",
        e.source_file_instance_id as "sourceId", e.project_id as "projectId", e.variant_id as "variantId",
        e.start_ms as "startMs", e.end_ms as "endMs", e.output_display_path as "toPath",
        e.output_canonical_path as canonical, e.output_root_id as "rootId",
        e.replace_original as "replaceOriginal",
        nullif(e.source_probe->>'fps', '')::float as fps,
        nullif(e.source_probe->>'rotation', '')::float as rotate`),
  );
  const edit = claimed[0];
  if (!edit) return 0;
  const actor = { db, orgId: edit.orgId, userId: null, actor: { type: 'system' as const, id: 'worker' } };
  const fail = async (message: string) => {
    await db.execute(sql`
      update video_edits
      set status = 'FAILED'::video_edit_status, error = ${message.slice(0, 500)}, finished_at = now(), updated_at = now()
      where id = ${edit.id} and status = 'RUNNING'`);
    await audit(actor, 'video.trim.fail', { type: 'file_instance', id: edit.sourceId }, undefined, {
      editId: edit.id,
      error: message.slice(0, 500),
    });
  };
  const dir = await mkdtemp(join(tmpdir(), 'creatoros-trim-'));
  const sourcePath = join(dir, 'source');
  const outputPath = join(dir, 'clip.mp4');
  try {
    const opened = await openAgentFile(db, env, edit.orgId, edit.sourceId);
    await pipeline(Readable.fromWeb(opened.body as import('node:stream/web').ReadableStream), createWriteStream(sourcePath));
    const args = (edit.mode === 'FAST' ? fastTrimArgs({ startMs: edit.startMs, endMs: edit.endMs }) : accurateTrimArgs({ startMs: edit.startMs, endMs: edit.endMs, rotate: edit.rotate })).map(
      (arg) => (arg === 'INPUT' ? sourcePath : arg === 'OUTPUT' ? outputPath : arg),
    );
    const span = (edit.endMs - edit.startMs) / 1000;
    let lastPct = -1;
    const encoded = await runProcess('ffmpeg', args, (line) => {
      if (!line.startsWith('out_time_ms=') || span <= 0) return;
      const usec = Number(line.slice('out_time_ms='.length));
      if (!Number.isFinite(usec)) return;
      const pct = Math.max(0, Math.min(99, Math.round(usec / 1_000_000 / span * 100)));
      if (pct === lastPct) return;
      lastPct = pct;
      void db.execute(sql`
        update video_edits set progress_pct = ${pct}, updated_at = now()
        where id = ${edit.id} and status = 'RUNNING'`);
    });
    if (encoded.code !== 0) {
      const detail = encoded.stderr.trim().split('\n').pop() || 'ffmpeg failed';
      await fail(`The cut failed. The original was not changed. ${detail}`.slice(0, 500));
      return 1;
    }
    const probeJson = await new Promise<string>((resolve, reject) => {
      const child = spawn('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', outputPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error('The new clip could not be checked.'))));
    });
    const checked = probeFromFfprobe(probeJson);
    const actualMs = num(checked.durationMs);
    if (actualMs == null || !trimDurationOk(edit.mode, edit.endMs - edit.startMs, actualMs, edit.fps ?? num(checked.fps))) {
      await fail('The new clip did not match the selected length, so it was not added.');
      return 1;
    }
    const info = await stat(outputPath);
    if (info.size < 1000) {
      await fail('The new clip was empty. The original was not changed.');
      return 1;
    }
    const source = rowsOf<{ displayPath: string; size: number; pathOs: string }>(
      await db.execute(sql`
        select f.display_path as "displayPath", f.size::float8 as size, r.path_os as "pathOs"
        from file_instances f join storage_roots r on r.id = f.root_id
        where f.id = ${edit.sourceId}`),
    )[0];
    const os: PathOs = source?.pathOs === 'windows' ? 'windows' : 'posix';
    const inPlace = Boolean(source && edit.replaceOriginal && sameTrimPath(edit.toPath, source.displayPath));
    const uploadPath = inPlace ? siblingPath(source!.displayPath, `cos-trim-${edit.id.slice(0, 8)}.mp4`) : edit.toPath;
    const uploadCanonical = inPlace ? canonicalPath(uploadPath, os) : edit.canonical;
    await uploadTrim(db, env, { ...edit, toPath: uploadPath }, info.size, outputPath);
    const savedId = await storeTrimResult(
      db,
      { ...edit, toPath: uploadPath, canonical: uploadCanonical },
      info.size,
      checked,
      actor,
      { complete: !edit.replaceOriginal },
    );
    if (edit.replaceOriginal && source) {
      await replaceOriginalWithClip(db, edit, source, savedId, info.size, inPlace ? uploadPath : edit.toPath, os);
    }
    return 1;
  } catch (e) {
    await fail((e as Error).message || 'The cut could not be saved.');
    return 1;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function uploadTrim(
  db: Db,
  env: ServiceEnv,
  edit: { orgId: string; deviceId: string; rootId: string; toPath: string },
  size: number,
  outputPath: string,
) {
  const root = rowsOf<{ listenUrls: string[]; deviceName: string }>(
    await db.execute(sql`
      select d.listen_urls as "listenUrls", d.display_name as "deviceName"
      from storage_roots r join devices d on d.id = r.device_id
      where r.id = ${edit.rootId} and r.org_id = ${edit.orgId}`),
  )[0];
  if (!root) throw new Error('The folder for this clip is no longer indexed.');
  const key = await getDeviceSigningKey(env, edit.deviceId, db);
  if (!key) throw new Error('This PC cannot receive a file until its scanner is paired.');
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  const sig = signAgentFetch(key, edit.rootId, edit.toPath, exp);
  const loopback = env.processEnv.AGENT_LOOPBACK_HOST;
  const urls = (root.listenUrls ?? []).map((u) => (loopback ? u.replace(/\/\/(127\.0\.0\.1|localhost)/, `//${loopback}`) : u));
  if (!urls.length) throw new Error('The scanner has not reported an address the server can reach.');
  let lastErr = '';
  for (const base of urls) {
    const u = `${base.replace(/\/$/, '')}/v1/upload?root=${encodeURIComponent(edit.rootId)}&path=${encodeURIComponent(edit.toPath)}&exp=${exp}&sig=${sig}`;
    try {
      const upstream = await fetch(u, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'content-length': String(size) },
        body: createReadStream(outputPath) as unknown as BodyInit,
        duplex: 'half',
      } as RequestInit);
      const text = await upstream.text();
      if (upstream.status === 409) throw new Error('A file with this name is already in that folder. The original was not changed.');
      if (!upstream.ok) {
        lastErr = text.trim() || `HTTP ${upstream.status}`;
        continue;
      }
      return;
    } catch (e) {
      if ((e as Error).message.includes('already in that folder')) throw e;
      lastErr = (e as Error).message;
    }
  }
  throw new Error(`Could not copy the new clip onto ${root.deviceName} (${lastErr}). The original was not changed.`);
}

async function storeTrimResult(
  db: Db,
  edit: {
    id: string;
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
  },
  size: number,
  probe: Record<string, unknown>,
  actor: { db: Db; orgId: string; userId: null; actor: { type: 'system'; id: string } },
  opts: { complete?: boolean } = {},
) {
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
  if (!row) throw new Error('A file is already indexed at the new clip path.');
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
    set status = ${opts.complete === false ? 'RUNNING' : 'SUCCEEDED'}::video_edit_status,
        progress_pct = ${opts.complete === false ? 90 : 100},
        output_file_instance_id = ${row.id},
        output_probe = ${JSON.stringify(probe)}::jsonb,
        error = null,
        finished_at = case when ${opts.complete === false} then null else now() end,
        updated_at = now()
    where id = ${edit.id}`);
  if (opts.complete !== false) await syncFolderAssets(db, edit.orgId).catch(() => undefined);
  await audit(actor, opts.complete === false ? 'video.trim.staged' : 'video.trim.finish', { type: 'file_instance', id: row.id }, undefined, {
    editId: edit.id,
    sourceId: edit.sourceId,
    displayPath: edit.toPath,
  });
  return row.id;
}

function sameTrimPath(a: string, b: string) {
  const key = (value: string) => value.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
  return key(a) === key(b);
}

function siblingPath(displayPath: string, fileName: string) {
  const slash = Math.max(displayPath.lastIndexOf('/'), displayPath.lastIndexOf('\\'));
  const sep = displayPath.includes('\\') ? '\\' : '/';
  const dir = slash >= 0 ? displayPath.slice(0, slash) : '';
  return dir ? `${dir}${sep}${fileName}` : fileName;
}

async function queueFileChange(
  db: Db,
  edit: { orgId: string; deviceId: string },
  fileId: string,
  kind: 'RENAME' | 'DELETE',
  fromPath: string,
  toPath: string | null,
  size: number,
) {
  const created = rowsOf<{ id: string }>(
    await db.execute(sql`
      insert into file_operations (org_id, device_id, file_instance_id, kind, from_path, to_path, size_bytes)
      values (
        ${edit.orgId}, ${edit.deviceId}, ${fileId}, ${kind}::file_operation_kind,
        ${fromPath}, ${toPath}, ${Math.max(0, Math.round(size))}
      )
      returning id`),
  )[0];
  if (!created) throw new Error('The PC could not be asked to change the file.');
  return created.id;
}

async function waitFileChange(db: Db, editId: string, opId: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const row = rowsOf<{ status: string; error: string | null }>(
      await db.execute(sql`select status::text as status, error from file_operations where id = ${opId}`),
    )[0];
    if (row?.status === 'SUCCEEDED') return;
    if (row?.status === 'FAILED' || row?.status === 'CANCELLED') {
      throw new Error(row.error || 'The PC could not change the file.');
    }
    await db.execute(sql`update video_edits set updated_at = now() where id = ${editId} and status = 'RUNNING'`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('The PC did not finish changing the file.');
}

async function dropReplacedLinks(db: Db, orgId: string, sourceId: string) {
  await db.execute(sql`delete from publish_items where org_id = ${orgId} and file_instance_id = ${sourceId}`);
  await db.execute(sql`delete from asset_file_links where org_id = ${orgId} and file_instance_id = ${sourceId}`);
}

async function finishReplacedTrim(
  db: Db,
  edit: { id: string; orgId: string; toPath: string; canonical: string },
  savedId: string,
  note: string | null,
) {
  await db.execute(sql`
    update video_edits
    set status = 'SUCCEEDED'::video_edit_status, progress_pct = 100, output_file_instance_id = ${savedId},
        output_display_path = ${edit.toPath}, output_canonical_path = ${edit.canonical},
        error = ${note}, finished_at = now(), updated_at = now()
    where id = ${edit.id}`);
  await syncFolderAssets(db, edit.orgId).catch(() => undefined);
}

/**
 * The scanner cannot overwrite a file in place. The new clip is uploaded beside it, then the PC
 * renames the original aside, moves the clip onto the original path, and deletes the aside.
 * A different name is uploaded directly and the original is deleted after that.
 */
async function replaceOriginalWithClip(
  db: Db,
  edit: { id: string; orgId: string; deviceId: string; sourceId: string; toPath: string; canonical: string },
  source: { displayPath: string; size: number },
  savedId: string,
  newSize: number,
  stagedPath: string,
  os: PathOs,
) {
  const inPlace = sameTrimPath(edit.toPath, source.displayPath);
  if (inPlace) {
    const bak = siblingPath(source.displayPath, `cosbak-${edit.id.slice(0, 8)}.mp4`);
    const aside = await queueFileChange(db, edit, edit.sourceId, 'RENAME', source.displayPath, bak, source.size);
    try {
      await waitFileChange(db, edit.id, aside);
    } catch (e) {
      throw new Error(`The new clip is next to the original, and the original was not replaced. ${(e as Error).message}`);
    }
    try {
      const onto = await queueFileChange(db, edit, savedId, 'RENAME', stagedPath, source.displayPath, newSize);
      await waitFileChange(db, edit.id, onto);
    } catch (e) {
      const back = await queueFileChange(db, edit, edit.sourceId, 'RENAME', bak, source.displayPath, source.size).catch(() => '');
      if (back) await waitFileChange(db, edit.id, back).catch(() => undefined);
      throw new Error(`The original was not replaced. ${(e as Error).message}`);
    }
    try {
      const removed = await queueFileChange(db, edit, edit.sourceId, 'DELETE', bak, null, source.size);
      await waitFileChange(db, edit.id, removed);
      await dropReplacedLinks(db, edit.orgId, edit.sourceId);
      await finishReplacedTrim(db, edit, savedId, null);
    } catch (e) {
      await finishReplacedTrim(
        db,
        edit,
        savedId,
        `The cut is in place of the original. The previous video is still on that PC as ${bak.split(/[/\\]/).pop()}. ${(e as Error).message}`.slice(0, 500),
      );
    }
    return;
  }
  try {
    const removed = await queueFileChange(db, edit, edit.sourceId, 'DELETE', source.displayPath, null, source.size);
    await waitFileChange(db, edit.id, removed);
    await dropReplacedLinks(db, edit.orgId, edit.sourceId);
    await finishReplacedTrim(db, edit, savedId, null);
  } catch (e) {
    await finishReplacedTrim(
      db,
      { ...edit, toPath: stagedPath, canonical: canonicalPath(stagedPath, os) },
      savedId,
      `The new clip was saved. The original is still there. ${(e as Error).message}`.slice(0, 500),
    );
  }
}
