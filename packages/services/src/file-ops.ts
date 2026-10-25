import { sql, type Db } from '@creatoros/db';
import { planFileOperation, canonicalPath, isInsideRoot, type PathOs, FileOpError } from '@creatoros/domain';
import { syncFolderAssets } from './assets';
import { audit } from './audit';
import type { AuthedAgent } from './devices';
import { badRequest, conflict, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

const duplicate = (e: unknown) =>
  (e as { code?: string }).code === '23505' || (e as { cause?: { code?: string } }).cause?.code === '23505';

interface FileRow {
  id: string;
  displayPath: string;
  fileName: string;
  size: number | string;
  deviceId: string;
  deviceName: string;
  archivedAt: Date | null;
  pathOs: string;
}

async function loadFile(ctx: Ctx, id: string) {
  const row = rowsOf<FileRow>(
    await ctx.db.execute(sql`
      select f.id, f.display_path as "displayPath", f.file_name as "fileName", f.size,
             f.device_id as "deviceId", d.display_name as "deviceName", f.archived_at as "archivedAt",
             r.path_os as "pathOs"
      from file_instances f
      join devices d on d.id = f.device_id
      join storage_roots r on r.id = f.root_id
      where f.id = ${id} and f.org_id = ${ctx.orgId}`),
  )[0];
  if (!row) throw notFound('File');
  if (row.archivedAt) throw badRequest('This file is already gone from the library.');
  return row;
}

async function activeRoots(ctx: Ctx, deviceId: string) {
  return rowsOf<{ id: string; displayPath: string; canonicalPath: string }>(
    await ctx.db.execute(sql`
      select id, display_path as "displayPath", canonical_path as "canonicalPath"
      from storage_roots
      where org_id = ${ctx.orgId} and device_id = ${deviceId} and state = 'ACTIVE' and retired_at is null`),
  );
}

export async function listMoveFolders(ctx: Ctx, fileId: string) {
  const file = await loadFile(ctx, fileId);
  const folders = rowsOf<{ folder: string }>(
    await ctx.db.execute(sql`
      select folder from (
        select distinct regexp_replace(replace(display_path, chr(92), '/'), '/[^/]+$', '') as folder
        from file_instances
        where org_id = ${ctx.orgId} and device_id = ${file.deviceId} and archived_at is null
        union
        select regexp_replace(replace(display_path, chr(92), '/'), '/+$', '') as folder
        from storage_roots
        where org_id = ${ctx.orgId} and device_id = ${file.deviceId} and state = 'ACTIVE' and retired_at is null
      ) s
      where folder is not null and folder <> ''
      order by folder
      limit 400`),
  );
  return { deviceName: file.deviceName, folders: folders.map((f) => f.folder) };
}

export async function requestFileOperation(
  ctx: Ctx,
  fileId: string,
  input: { kind: 'RENAME'; name: string } | { kind: 'MOVE'; folder: string } | { kind: 'DELETE' },
) {
  const file = await loadFile(ctx, fileId);
  const roots = await activeRoots(ctx, file.deviceId);
  const os: PathOs = file.pathOs === 'windows' ? 'windows' : 'posix';
  let planned;
  try {
    planned = planFileOperation({
      kind: input.kind,
      displayPath: file.displayPath,
      os,
      roots,
      name: input.kind === 'RENAME' ? input.name : undefined,
      folder: input.kind === 'MOVE' ? input.folder : undefined,
    });
  } catch (e) {
    if (e instanceof FileOpError) throw badRequest(e.message);
    throw e;
  }
  if (planned.toPath) {
    const destKey = canonicalPath(planned.toPath, os);
    const taken = rowsOf<{ id: string }>(
      await ctx.db.execute(sql`
        select id from file_instances
        where org_id = ${ctx.orgId} and root_id = ${planned.rootId} and canonical_path = ${destKey}
          and archived_at is null and id <> ${file.id}
        limit 1`),
    )[0];
    if (taken) throw conflict('A file is already indexed at that path.');
  }
  try {
    const created = rowsOf<{ id: string; status: string; kind: string; fromPath: string; toPath: string | null }>(
      await ctx.db.execute(sql`
        insert into file_operations (org_id, device_id, file_instance_id, kind, from_path, to_path, size_bytes, requested_by)
        values (
          ${ctx.orgId}, ${file.deviceId}, ${file.id}, ${input.kind}::file_operation_kind,
          ${planned.fromPath}, ${planned.toPath}, ${Number(file.size) || 0}, ${ctx.userId}
        )
        returning id, status, kind, from_path as "fromPath", to_path as "toPath"`),
    )[0];
    if (!created) throw badRequest('The change could not be queued.');
    await audit(ctx, 'file.operation.request', { type: 'file_instance', id: file.id }, undefined, {
      kind: input.kind,
      fromPath: planned.fromPath,
      toPath: planned.toPath,
      operationId: created.id,
    });
    return created;
  } catch (e) {
    if (duplicate(e)) throw conflict('This file already has a change waiting on that PC.');
    throw e;
  }
}

export async function cancelFileOperation(ctx: Ctx, fileId: string) {
  const updated = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`
      update file_operations
      set status = 'CANCELLED'::file_operation_status, finished_at = now(), error = 'Cancelled before the PC started.'
      where org_id = ${ctx.orgId} and file_instance_id = ${fileId} and status = 'PENDING'
      returning id`),
  )[0];
  if (!updated) throw badRequest('The PC already started this, or there is nothing waiting.');
  await audit(ctx, 'file.operation.cancel', { type: 'file_instance', id: fileId }, undefined, {
    operationId: updated.id,
  });
  return { ok: true };
}

export async function latestFileOperation(ctx: Ctx, fileId: string) {
  const row = rowsOf<{
    id: string;
    kind: string;
    status: string;
    fromPath: string;
    toPath: string | null;
    error: string | null;
  }>(
    await ctx.db.execute(sql`
      select id, kind, status, from_path as "fromPath", to_path as "toPath", error
      from file_operations
      where org_id = ${ctx.orgId} and file_instance_id = ${fileId}
      order by created_at desc
      limit 1`),
  )[0];
  if (!row || row.status === 'SUCCEEDED' || row.status === 'CANCELLED') return null;
  return row;
}

export async function claimFileOperations(db: Db, agent: AuthedAgent) {
  return db.transaction(async (tx) => {
    const rows = rowsOf<{ id: string; kind: string; fromPath: string; toPath: string | null; size: number | string }>(
      await tx.execute(sql`
        update file_operations o
        set status = 'RUNNING'::file_operation_status, started_at = coalesce(o.started_at, now())
        where o.id in (
          select id from file_operations
          where device_id = ${agent.deviceId} and status in ('PENDING', 'RUNNING')
          order by created_at
          limit 5
          for update skip locked
        )
        returning o.id, o.kind, o.from_path as "fromPath", o.to_path as "toPath", o.size_bytes as size`),
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      fromPath: r.fromPath,
      toPath: r.toPath ?? '',
      size: Number(r.size) || 0,
    }));
  });
}

export async function finishFileOperation(
  db: Db,
  agent: AuthedAgent,
  input: { id: string; ok: boolean; error?: string; toPath?: string },
) {
  const op = rowsOf<{
    id: string;
    kind: 'RENAME' | 'MOVE' | 'DELETE';
    status: string;
    fromPath: string;
    toPath: string | null;
    fileInstanceId: string;
    orgId: string;
    deviceId: string;
  }>(
    await db.execute(sql`
      select o.id, o.kind, o.status, o.from_path as "fromPath", o.to_path as "toPath",
             o.file_instance_id as "fileInstanceId", o.org_id as "orgId", o.device_id as "deviceId"
      from file_operations o
      where o.id = ${input.id} and o.device_id = ${agent.deviceId}`),
  )[0];
  if (!op) throw notFound('File operation');
  if (op.status === 'SUCCEEDED') return { ok: true };
  if (op.status === 'CANCELLED' || op.status === 'FAILED') return { ok: false };
  const actor = {
    db,
    orgId: op.orgId,
    userId: null,
    actor: { type: 'agent' as const, id: agent.deviceId },
  };
  if (!input.ok) {
    const message = (input.error || 'The PC could not change the file.').slice(0, 500);
    await db.execute(sql`
      update file_operations
      set status = 'FAILED'::file_operation_status, error = ${message}, finished_at = now()
      where id = ${op.id} and status in ('PENDING', 'RUNNING')`);
    await audit(actor, 'file.operation.fail', { type: 'file_instance', id: op.fileInstanceId }, undefined, {
      operationId: op.id,
      kind: op.kind,
      error: message,
    });
    return { ok: false };
  }

  await db.transaction(async (tx) => {
    if (op.kind === 'DELETE') {
      await tx.execute(sql`
        update file_instances
        set archived_at = now(), availability = 'CONFIRMED_MISSING', updated_at = now()
        where id = ${op.fileInstanceId} and org_id = ${op.orgId} and device_id = ${op.deviceId} and archived_at is null`);
    } else {
      const file = rowsOf<{ pathOs: string }>(
        await tx.execute(sql`
          select r.path_os as "pathOs"
          from file_instances f join storage_roots r on r.id = f.root_id
          where f.id = ${op.fileInstanceId}`),
      )[0];
      const os: PathOs = file?.pathOs === 'windows' ? 'windows' : 'posix';
      const reported = (input.toPath || op.toPath || '').trim();
      if (!op.toPath || !reported || canonicalPath(reported, os) !== canonicalPath(op.toPath, os))
        throw badRequest('The PC reported a different path from the one that was confirmed.');
      const roots = rowsOf<{ id: string; canonicalPath: string }>(
        await tx.execute(sql`
          select id, canonical_path as "canonicalPath"
          from storage_roots
          where org_id = ${op.orgId} and device_id = ${op.deviceId} and state = 'ACTIVE' and retired_at is null`),
      );
      const key = canonicalPath(op.toPath, os);
      const dest = roots
        .filter((r) => isInsideRoot(r.canonicalPath, key, os))
        .sort((a, b) => b.canonicalPath.length - a.canonicalPath.length)[0];
      if (!dest) throw badRequest('The new path is outside the folders this machine is indexing.');
      await tx.execute(sql`
        update file_instances
        set archived_at = now(), updated_at = now()
        where org_id = ${op.orgId} and root_id = ${dest.id} and canonical_path = ${key}
          and archived_at is null and id <> ${op.fileInstanceId}`);
      const name = op.toPath.split(/[\\/]/).pop() ?? op.toPath;
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
      await tx.execute(sql`
        update file_instances
        set root_id = ${dest.id}, canonical_path = ${key}, display_path = ${op.toPath},
            file_name = ${name}, ext = ${ext}, availability = 'AVAILABLE',
            missing_since = null, missing_checks = 0, updated_at = now()
        where id = ${op.fileInstanceId} and org_id = ${op.orgId} and device_id = ${op.deviceId}`);
    }
    await tx.execute(sql`
      update file_operations
      set status = 'SUCCEEDED'::file_operation_status, error = null, finished_at = now()
      where id = ${op.id} and status in ('PENDING', 'RUNNING')`);
  });
  await syncFolderAssets(db, op.orgId);
  await audit(actor, 'file.operation.done', { type: 'file_instance', id: op.fileInstanceId }, undefined, {
    operationId: op.id,
    kind: op.kind,
    fromPath: op.fromPath,
    toPath: op.toPath,
  });
  return { ok: true };
}
