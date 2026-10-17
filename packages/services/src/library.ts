import fs from 'node:fs/promises';
import path from 'node:path';
import { and, derivedPreviews, eq, fileInstances, sql, type Db, type SQL } from '@creatoros/db';
import { mapToSmbPath, type PathOs } from '@creatoros/domain';
import { audit } from './audit';
import type { AuthedAgent } from './devices';
import { badRequest, forbidden, notFound, type Ctx, type ServiceEnv } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface LibraryQuery {
  q?: string;
  kind?: string;
  /** Filter on the *effective* availability (what the owner can actually open right now). */
  availability?: string;
  rootId?: string;
  deviceId?: string;
  tagId?: string;
  linked?: boolean;
  duplicates?: boolean;
  limit?: number;
  cursor?: string;
}

/** Stored availability combined with device/root reachability: offline devices are "temporarily unavailable", never "missing". */
export const EFFECTIVE_AVAILABILITY = sql`case
  when d.state = 'REVOKED' then 'DEVICE_REVOKED'
  when f.availability in ('CONFIRMED_MISSING','MISSING_CANDIDATE','PERMISSION_DENIED','INCOMPLETE') then f.availability::text
  when r.state = 'UNREACHABLE' then 'ROOT_UNREACHABLE'
  when d.state in ('OFFLINE','PENDING') then 'DEVICE_OFFLINE'
  else f.availability::text end`;

export interface CopyPaths {
  local: string;
  smb: string | null;
  mount: string | null;
}

/** All the ways to reach a file: original local path, SMB/UNC path and server mount path (T35). */
export function copyPathsFor(
  file: { displayPath: string },
  root: { displayPath: string; smbPath: string | null; mountPath: string | null; pathOs: string },
): CopyPaths {
  const os = (root.pathOs as PathOs) ?? 'windows';
  const smb = root.smbPath
    ? mapToSmbPath(file.displayPath, { localRoot: root.displayPath, smbRoot: root.smbPath }, os)
    : null;
  let mount: string | null = null;
  if (root.mountPath) {
    const base = root.displayPath.replace(/[\\/]+$/, '');
    const rest = file.displayPath
      .slice(base.length)
      .replace(/^[\\/]+/, '')
      .replace(/\\/g, '/');
    mount = `${root.mountPath.replace(/\/+$/, '')}/${rest}`;
  }
  return { local: file.displayPath, smb, mount };
}

const encodeCursor = (t: string, id: string) => Buffer.from(JSON.stringify({ t, id })).toString('base64url');
function decodeCursor(c: string): { t: string; id: string } {
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    if (typeof v.t === 'string' && typeof v.id === 'string') return v;
  } catch {}
  throw badRequest('Invalid cursor');
}

const FILE_SELECT = sql`
  f.id, f.file_name as "fileName", f.display_path as "displayPath", f.ext, f.size, f.mtime,
  f.file_type as "fileType", f.mime, f.tech, f.probe_state as "probeState", f.availability,
  ${EFFECTIVE_AVAILABILITY} as "effectiveAvailability",
  f.root_id as "rootId", r.label as "rootLabel", f.device_id as "deviceId", d.display_name as "deviceName", d.state as "deviceState",
  f.media_object_id as "mediaObjectId", f.full_hash as "fullHash", f.first_seen_at as "firstSeenAt", f.last_seen_at as "lastSeenAt",
  r.display_path as "rootPath", r.smb_path as "rootSmb", r.mount_path as "rootMount", r.path_os as "rootOs",
  exists(select 1 from derived_previews p where p.file_instance_id = f.id and p.status = 'READY') as "hasPreview",
  (select count(*)::int from file_instances c where c.media_object_id = f.media_object_id and f.media_object_id is not null and c.id <> f.id and c.archived_at is null) as "otherCopies",
  (select count(*)::int from asset_file_links l where l.file_instance_id = f.id) as "assetLinks"`;

function shapeFile(r: any) {
  const copy = copyPathsFor(r, {
    displayPath: r.rootPath,
    smbPath: r.rootSmb,
    mountPath: r.rootMount,
    pathOs: r.rootOs,
  });
  const { rootPath, rootSmb, rootMount, rootOs, ...rest } = r;
  void rootPath;
  void rootSmb;
  void rootMount;
  void rootOs;
  return { ...rest, copyPaths: copy };
}

export async function listLibrary(ctx: Ctx, q: LibraryQuery) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const where: SQL[] = [sql`f.org_id = ${ctx.orgId}`, sql`f.archived_at is null`];
  if (q.q?.trim()) {
    for (const term of q.q.trim().split(/\s+/).slice(0, 6)) {
      const like = `%${esc(term)}%`;
      where.push(sql`(f.file_name ilike ${like} or f.display_path ilike ${like})`);
    }
  }
  if (q.kind) where.push(sql`f.file_type = ${q.kind}::file_kind`);
  if (q.rootId) where.push(sql`f.root_id = ${q.rootId}`);
  if (q.deviceId) where.push(sql`f.device_id = ${q.deviceId}`);
  if (q.availability) where.push(sql`(${EFFECTIVE_AVAILABILITY}) = ${q.availability}`);
  if (q.tagId)
    where.push(
      sql`exists(select 1 from file_tag_links t where t.file_instance_id = f.id and t.tag_id = ${q.tagId})`,
    );
  if (q.linked === true)
    where.push(sql`exists(select 1 from asset_file_links l where l.file_instance_id = f.id)`);
  if (q.linked === false)
    where.push(sql`not exists(select 1 from asset_file_links l where l.file_instance_id = f.id)`);
  if (q.duplicates)
    where.push(
      sql`f.media_object_id is not null and exists(select 1 from file_instances c where c.media_object_id = f.media_object_id and c.id <> f.id and c.archived_at is null)`,
    );
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    where.push(sql`(f.first_seen_at, f.id) < (${c.t}::timestamptz, ${c.id}::uuid)`);
  }
  const res = await ctx.db.execute(sql`
    select ${FILE_SELECT}
    from file_instances f
    join storage_roots r on r.id = f.root_id
    join devices d on d.id = f.device_id
    where ${sql.join(where, sql` and `)}
    order by f.first_seen_at desc, f.id desc
    limit ${limit + 1}`);
  const rows = rowsOf<any>(res);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(shapeFile),
    nextCursor:
      rows.length > limit && last ? encodeCursor(new Date(last.firstSeenAt).toISOString(), last.id) : null,
  };
}

export async function libraryCounts(ctx: Ctx) {
  const res = await ctx.db.execute(sql`
    select ${EFFECTIVE_AVAILABILITY} as availability, f.file_type as kind, count(*)::int as n
    from file_instances f join storage_roots r on r.id = f.root_id join devices d on d.id = f.device_id
    where f.org_id = ${ctx.orgId} and f.archived_at is null
    group by 1, 2`);
  const rows = rowsOf<{ availability: string; kind: string; n: number }>(res);
  const byAvailability: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byAvailability[r.availability] = (byAvailability[r.availability] ?? 0) + r.n;
    byKind[r.kind] = (byKind[r.kind] ?? 0) + r.n;
    total += r.n;
  }
  const dup =
    rowsOf<{ n: number }>(
      await ctx.db.execute(
        sql`select count(*)::int as n from (select media_object_id from file_instances where org_id = ${ctx.orgId} and archived_at is null and media_object_id is not null group by 1 having count(*) > 1) x`,
      ),
    )[0]?.n ?? 0;
  const unlinked =
    rowsOf<{ n: number }>(
      await ctx.db.execute(
        sql`select count(*)::int as n from file_instances f where f.org_id = ${ctx.orgId} and f.archived_at is null and f.file_type in ('VIDEO','AUDIO','IMAGE') and not exists (select 1 from asset_file_links l where l.file_instance_id = f.id)`,
      ),
    )[0]?.n ?? 0;
  return { total, byAvailability, byKind, duplicateGroups: dup, unlinkedMedia: unlinked };
}

export async function getFileDetail(ctx: Ctx, id: string) {
  const res = await ctx.db.execute(sql`
    select ${FILE_SELECT}
    from file_instances f join storage_roots r on r.id = f.root_id join devices d on d.id = f.device_id
    where f.id = ${id} and f.org_id = ${ctx.orgId}`);
  const row = rowsOf<any>(res)[0];
  if (!row) throw notFound('File');
  const file = shapeFile(row);
  const copies = row.mediaObjectId
    ? rowsOf<any>(
        await ctx.db.execute(sql`
          select f.id, f.display_path as "displayPath", d.display_name as "deviceName", ${EFFECTIVE_AVAILABILITY} as "effectiveAvailability",
                 r.display_path as "rootPath", r.smb_path as "rootSmb", r.mount_path as "rootMount", r.path_os as "rootOs"
          from file_instances f join storage_roots r on r.id = f.root_id join devices d on d.id = f.device_id
          where f.org_id = ${ctx.orgId} and f.media_object_id = ${row.mediaObjectId} and f.id <> ${id} and f.archived_at is null`),
      ).map((c) => ({
        id: c.id,
        displayPath: c.displayPath,
        deviceName: c.deviceName,
        effectiveAvailability: c.effectiveAvailability,
        copyPaths: copyPathsFor(c, {
          displayPath: c.rootPath,
          smbPath: c.rootSmb,
          mountPath: c.rootMount,
          pathOs: c.rootOs,
        }),
      }))
    : [];
  const links = rowsOf<any>(
    await ctx.db.execute(sql`
      select a.id as "assetId", a.title, a.kind, v.id as "versionId", v.label as "versionLabel", l.link_reason as "linkReason"
      from asset_file_links l join asset_versions v on v.id = l.asset_version_id join logical_assets a on a.id = v.asset_id
      where l.file_instance_id = ${id} and l.org_id = ${ctx.orgId}`),
  );
  const tags = rowsOf<any>(
    await ctx.db.execute(
      sql`select t.id, t.name, t.color from file_tag_links l join media_tags t on t.id = l.tag_id where l.file_instance_id = ${id}`,
    ),
  );
  return { ...file, copies, assets: links, tags };
}

// ---------------------------------------------------------------- previews

export function previewRelPath(orgId: string, instanceId: string, variant = 'thumb') {
  return path.join(orgId, instanceId.slice(0, 2), `${instanceId}-${variant}.jpg`);
}

/** The agent uploads a thumbnail it generated from the original; originals are never touched on the server. */
export async function storePreview(
  db: Db,
  env: ServiceEnv,
  agent: AuthedAgent,
  instanceId: string,
  bytes: Buffer,
  contentType = 'image/jpeg',
  variant = 'thumb',
) {
  if (bytes.length === 0 || bytes.length > 2_000_000)
    throw badRequest('Preview must be between 1 byte and 2 MB');
  const [inst] = await db
    .select()
    .from(fileInstances)
    .where(and(eq(fileInstances.id, instanceId), eq(fileInstances.orgId, agent.orgId)));
  if (!inst) throw notFound('File');
  if (inst.deviceId !== agent.deviceId) throw forbidden('This device does not own that file');
  const rel = previewRelPath(agent.orgId, instanceId, variant);
  const abs = path.join(env.mediaPreviewDir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, bytes);
  await db
    .insert(derivedPreviews)
    .values({
      orgId: agent.orgId,
      fileInstanceId: instanceId,
      mediaObjectId: inst.mediaObjectId,
      variantKey: variant,
      relativeCachePath: rel,
      contentType,
      sizeBytes: bytes.length,
      status: 'READY',
    })
    .onConflictDoUpdate({
      target: [derivedPreviews.fileInstanceId, derivedPreviews.variantKey],
      set: {
        relativeCachePath: rel,
        contentType,
        sizeBytes: bytes.length,
        status: 'READY',
        generatedAt: new Date(),
        lastAccessedAt: new Date(),
      },
    });
  return { instanceId, bytes: bytes.length };
}

export async function readPreview(
  ctx: Ctx,
  instanceId: string,
  variant = 'thumb',
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const [p] = await ctx.db
    .select()
    .from(derivedPreviews)
    .where(
      and(
        eq(derivedPreviews.fileInstanceId, instanceId),
        eq(derivedPreviews.orgId, ctx.orgId),
        eq(derivedPreviews.variantKey, variant),
      ),
    );
  if (!p || p.status !== 'READY') return null;
  const abs = path.join(ctx.env.mediaPreviewDir, p.relativeCachePath);
  try {
    const bytes = await fs.readFile(abs);
    await ctx.db
      .update(derivedPreviews)
      .set({ lastAccessedAt: new Date() })
      .where(eq(derivedPreviews.id, p.id));
    return { bytes, contentType: p.contentType };
  } catch {
    // cache file was evicted/removed: forget it so the agent regenerates it
    await ctx.db.delete(derivedPreviews).where(eq(derivedPreviews.id, p.id));
    return null;
  }
}

/** Preview cache is disposable: evict least-recently-used files beyond the size cap. Never touches originals. */
export async function evictPreviews(
  db: Db,
  env: ServiceEnv,
): Promise<{ removed: number; freedBytes: number }> {
  const cap = Math.floor(env.mediaPreviewMaxGb * 1024 ** 3);
  const rows = rowsOf<{ id: string; rel: string; size: number }>(
    await db.execute(
      sql`select id, relative_cache_path as rel, size_bytes::bigint::float8 as size from derived_previews order by last_accessed_at asc`,
    ),
  );
  let total = rows.reduce((a, r) => a + Number(r.size), 0);
  let removed = 0;
  let freed = 0;
  for (const r of rows) {
    if (total <= cap) break;
    try {
      await fs.rm(path.join(env.mediaPreviewDir, r.rel), { force: true });
    } catch {}
    await db.delete(derivedPreviews).where(eq(derivedPreviews.id, r.id));
    total -= Number(r.size);
    freed += Number(r.size);
    removed += 1;
  }
  return { removed, freedBytes: freed };
}

export async function setFileTags(ctx: Ctx, fileInstanceId: string, tagNames: string[]) {
  const [inst] = await ctx.db
    .select({ id: fileInstances.id })
    .from(fileInstances)
    .where(and(eq(fileInstances.id, fileInstanceId), eq(fileInstances.orgId, ctx.orgId)));
  if (!inst) throw notFound('File');
  const names = [...new Set(tagNames.map((t) => t.trim()).filter(Boolean))].slice(0, 30);
  await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`delete from file_tag_links where file_instance_id = ${fileInstanceId}`);
    for (const name of names) {
      await tx.execute(
        sql`insert into media_tags (org_id, name) values (${ctx.orgId}, ${name}) on conflict (org_id, lower(name)) do nothing`,
      );
      await tx.execute(
        sql`insert into file_tag_links (org_id, file_instance_id, tag_id) select ${ctx.orgId}, ${fileInstanceId}, id from media_tags where org_id = ${ctx.orgId} and lower(name) = lower(${name}) on conflict do nothing`,
      );
    }
  });
  await audit(ctx, 'file.tags.set', { type: 'file_instance', id: fileInstanceId }, undefined, {
    tags: names,
  });
  return { tags: names };
}
