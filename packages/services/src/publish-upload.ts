import { Readable } from 'node:stream';
import { fileInstances, sql } from '@creatoros/db';
import { FileOpError, planPublishUpload, type PathOs } from '@creatoros/domain';
import { syncFolderAssets } from './assets';
import { audit } from './audit';
import { getDeviceSigningKey, signAgentFetch } from './devices';
import { linkPublishFile } from './publish-run';
import { AppError, badRequest, conflict, notFound, type Ctx } from './types';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;
const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
};

/**
 * Copy one video from the browser onto a folder a paired PC already indexes, then attach it to the title.
 * Bytes are not recompressed. An existing file is left untouched.
 */
export async function uploadPublishVideo(
  ctx: Ctx,
  variantId: string,
  input: { rootId: string; fileName: string; size: number; body: Readable },
  fetchImpl: typeof fetch = fetch,
) {
  if (!Number.isFinite(input.size) || input.size < 1 || input.size > MAX_UPLOAD_BYTES) {
    throw badRequest('The file is empty or larger than 4 GB.');
  }
  const root = rowsOf<{
    id: string;
    deviceId: string;
    displayPath: string;
    pathOs: string;
    state: string;
    deviceName: string;
    deviceState: string;
    listenUrls: string[];
  }>(
    await ctx.db.execute(sql`
      select r.id, r.device_id as "deviceId", r.display_path as "displayPath", r.path_os as "pathOs", r.state,
             d.display_name as "deviceName", d.state as "deviceState", d.listen_urls as "listenUrls"
      from storage_roots r
      join devices d on d.id = r.device_id
      where r.id = ${input.rootId} and r.org_id = ${ctx.orgId} and r.retired_at is null`),
  )[0];
  if (!root) throw notFound('Folder');
  if (root.state !== 'ACTIVE') throw badRequest('That folder is not being scanned.');
  if (root.deviceState !== 'ONLINE') {
    throw new AppError(503, 'DEVICE_OFFLINE', `${root.deviceName} is off. Turn it on and try the upload again.`);
  }
  const os: PathOs = root.pathOs === 'windows' ? 'windows' : 'posix';
  let planned;
  try {
    planned = planPublishUpload({ fileName: input.fileName, rootDisplayPath: root.displayPath, os });
  } catch (e) {
    if (e instanceof FileOpError) throw badRequest(e.message);
    throw e;
  }
  const existing = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`
      select id from file_instances
      where root_id = ${root.id} and canonical_path = ${planned.canonicalPath} and archived_at is null
      limit 1`),
  )[0];
  if (existing) throw conflict('A file with this name is already in that folder. The file on the PC was not changed.');

  const key = await getDeviceSigningKey(ctx.env, root.deviceId, ctx.db);
  if (!key) throw new AppError(503, 'NO_KEY', 'This PC cannot receive a file until its scanner is paired.');
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  const sig = signAgentFetch(key, root.id, planned.displayPath, exp);
  const loopback = ctx.env.processEnv.AGENT_LOOPBACK_HOST;
  const urls = (root.listenUrls ?? []).map((u) =>
    loopback ? u.replace(/\/\/(127\.0\.0\.1|localhost)/, `//${loopback}`) : u,
  );
  if (!urls.length) throw new AppError(503, 'NO_LISTEN_URL', 'The scanner has not reported an address the server can reach.');

  let saved: { size: number } | null = null;
  let lastErr = '';
  for (const base of urls) {
    const u = `${base.replace(/\/$/, '')}/v1/upload?root=${encodeURIComponent(root.id)}&path=${encodeURIComponent(planned.displayPath)}&exp=${exp}&sig=${sig}`;
    try {
      const upstream = await fetchImpl(u, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'content-length': String(input.size) },
        body: input.body as unknown as BodyInit,
        duplex: 'half',
      } as RequestInit);
      const text = await upstream.text();
      if (upstream.status === 404) {
        throw new AppError(
          503,
          'AGENT_TOO_OLD',
          `${root.deviceName} is running an older scanner. Copy the new agent onto that PC and restart the service, then upload again. Do not re-pair.`,
        );
      }
      if (upstream.status === 409) throw conflict(text.trim() || 'A file with this name is already in that folder.');
      if (upstream.status === 413) throw badRequest('The file is larger than 4 GB.');
      if (!upstream.ok) {
        lastErr = text.trim() || `HTTP ${upstream.status}`;
        continue;
      }
      let parsed: { size?: number } = {};
      try {
        parsed = text ? (JSON.parse(text) as { size?: number }) : {};
      } catch {
        throw new AppError(
          502,
          'AGENT_ERROR',
          `The file may already be in that folder on ${root.deviceName}. Check before uploading again.`,
        );
      }
      saved = { size: Number(parsed.size ?? input.size) };
      break;
    } catch (e) {
      if (e instanceof AppError) throw e;
      lastErr = (e as Error).message;
    }
  }
  if (!saved) {
    throw new AppError(503, 'AGENT_UNREACHABLE', `Could not copy the file onto ${root.deviceName} (${lastErr}).`);
  }

  const [row] = await ctx.db
    .insert(fileInstances)
    .values({
      orgId: ctx.orgId,
      rootId: root.id,
      deviceId: root.deviceId,
      canonicalPath: planned.canonicalPath,
      displayPath: planned.displayPath,
      fileName: planned.fileName,
      ext: planned.ext,
      size: saved.size,
      mtime: ctx.now(),
      availability: 'AVAILABLE',
      fileType: 'VIDEO',
      mime: MIME[planned.ext] ?? 'video/mp4',
      probeState: 'PENDING',
      stableObservations: 2,
    })
    .returning({ id: fileInstances.id });
  if (!row) throw conflict('A file with this name is already in that folder.');
  const linked = await linkPublishFile(ctx, variantId, row.id);
  await syncFolderAssets(ctx.db, ctx.orgId).catch(() => undefined);
  await audit(ctx, 'publish.file.upload', { type: 'file_instance', id: row.id }, undefined, {
    variantId,
    displayPath: planned.displayPath,
    size: saved.size,
  });
  return {
    fileInstanceId: row.id,
    itemId: linked?.id ?? null,
    fileName: planned.fileName,
    displayPath: planned.displayPath,
    deviceName: root.deviceName,
  };
}
