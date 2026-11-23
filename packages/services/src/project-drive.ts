import { and, desc, eq, projectDriveSyncs, providerConnections, sql, type Db } from '@creatoros/db';
import { ensureFreshToken, refreshGoogleToken, GOOGLE_SCOPES } from '@creatoros/connectors';
import { connectorContext, loadCredentials } from './integrations';
import { openAgentFile } from './agent-file';
import { audit } from './audit';
import { badRequest, conflict, notFound, type Ctx, type ServiceEnv } from './types';
import { parseSocialMetadata, metadataFileName, metadataTemplate, type SocialMetadata } from './project-drive-metadata';

type DriveItem = {
  id: string;
  name: string;
  mimeType?: string;
  appProperties?: Record<string, string>;
  webViewLink?: string;
};
const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_SCOPE = GOOGLE_SCOPES.driveFile[0];
const DRIVE_FOLDER = 'application/vnd.google-apps.folder';

type SyncVideo = {
  itemId: string;
  fileInstanceId: string;
  fileName: string;
  size: number;
  mime: string | null;
};

type SocialTarget = {
  itemId: string;
  fileInstanceId: string;
  fileName: string;
  accountId: string;
  platform: string;
};

/** A dedicated Drive grant is opt-in and stored encrypted in its own Google Drive connection. */
async function driveToken(db: Db, env: ServiceEnv, orgId: string) {
  const [conn] = await db.select().from(providerConnections)
    .where(and(eq(providerConnections.orgId, orgId), eq(providerConnections.provider, 'google')))
    .orderBy(desc(providerConnections.updatedAt)).limit(1);
  if (!conn) throw badRequest('Connect Google Drive from the Drive Sync panel before syncing.');
  const credentials = loadCredentials(env, conn);
  if (!credentials.scopes?.includes(DRIVE_SCOPE) || !conn.scopes.includes(DRIVE_SCOPE)) {
    throw badRequest('This Google connection does not have Drive access. Press Connect Drive and approve the separate drive.file permission.');
  }
  if (!credentials.accessToken && !credentials.refreshToken) throw badRequest('Reconnect Google Drive; authorization has expired.');
  const cctx = connectorContext(db, env, conn);
  return ensureFreshToken(cctx, refreshGoogleToken);
}

async function driveFetch(db: Db, env: ServiceEnv, orgId: string, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await driveToken(db, env, orgId);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(30 * 60_000) });
  } catch (error) {
    throw badRequest(`Google Drive is unreachable: ${String(error).slice(0, 180)}`);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw badRequest(`Google Drive rejected the request (HTTP ${response.status}). ${detail}`);
  }
  return response;
}

async function jsonDrive<T>(db: Db, env: ServiceEnv, orgId: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await driveFetch(db, env, orgId, url, init);
  return (await response.json()) as T;
}

function quoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function listDriveFiles(db: Db, env: ServiceEnv, orgId: string, query: string): Promise<DriveItem[]> {
  const results: DriveItem[] = [];
  let next: string | undefined;
  do {
    const url = new URL(DRIVE);
    url.searchParams.set('q', query);
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,appProperties,webViewLink)');
    url.searchParams.set('pageSize', '1000');
    if (next) url.searchParams.set('pageToken', next);
    const response = await jsonDrive<{ files?: DriveItem[]; nextPageToken?: string }>(db, env, orgId, url.href);
    results.push(...response.files ?? []);
    next = response.nextPageToken;
    if (results.length > 5000) throw badRequest('Too many files in the Drive folder. Split the project before syncing.');
  } while (next);
  return results;
}

async function driveCreate(db: Db, env: ServiceEnv, orgId: string, body: Record<string, unknown>): Promise<DriveItem> {
  return jsonDrive<DriveItem>(db, env, orgId, DRIVE + '?fields=id,name,mimeType,webViewLink,appProperties', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function folderFor(db: Db, env: ServiceEnv, orgId: string, projectId: string, projectTitle: string) {
  const matches = await listDriveFiles(
    db, env, orgId,
    `mimeType='${DRIVE_FOLDER}' and trashed=false and appProperties has { key='kemokemProjectId' and value='${projectId}' }`,
  );
  if (matches.length > 1) throw conflict('Multiple Kemokem folders have this project ID in Drive. Resolve the duplicates before syncing.');
  if (matches[0]) return matches[0];
  const name = projectTitle.trim().slice(0, 190) || projectId;
  return driveCreate(db, env, orgId, {
    mimeType: DRIVE_FOLDER,
    name,
    appProperties: { kemokemProjectId: projectId, kemokemOrgId: orgId },
  });
}

async function jsonFile(
  db: Db, env: ServiceEnv, orgId: string, folderId: string,
  existing: DriveItem[], name: string, data: unknown,
  appProperties: Record<string, string> = {},
) {
  const payload = JSON.stringify(data, null, 2) + '\n';
  const old = existing.find((file) => file.name === name);
  // Never overwrite a template that ChatGPT or the owner might have updated.
  if (old) return old;
  const item = await driveCreate(db, env, orgId, {
    name,
    mimeType: 'application/json',
    parents: [folderId],
    appProperties,
  });
  const url = new URL(`${DRIVE_UPLOAD}/${encodeURIComponent(item.id)}`);
  url.searchParams.set('uploadType', 'media');
  await driveFetch(db, env, orgId, url.href, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: payload });
  existing.push(item);
  return item;
}

async function updateManifest(
  db: Db, env: ServiceEnv, orgId: string, folderId: string, existing: DriveItem[], data: unknown,
) {
  // Keep an accurate manifest for every subsequent sync, but never overwrite per-social analysis files.
  const bytes = JSON.stringify(data, null, 2) + '\n';
  const old = existing.find((f) => f.name === 'kemokem-manifest.json');
  const file = old ?? await driveCreate(db, env, orgId, {
    name: 'kemokem-manifest.json', mimeType: 'application/json', parents: [folderId],
    appProperties: { kemokemType: 'manifest' },
  });
  const url = old ? `${DRIVE_UPLOAD}/${encodeURIComponent(file.id)}?uploadType=media`
    : `${DRIVE_UPLOAD}/${encodeURIComponent(file.id)}?uploadType=media`;
  await driveFetch(db, env, orgId, url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: bytes });
}

async function uploadVideo(
  db: Db, env: ServiceEnv, orgId: string, folderId: string, video: SyncVideo,
  known: DriveItem[],
) {
  if (known.some((f) => f.appProperties?.kemokemFileInstanceId === video.fileInstanceId)) return;
  const source = await openAgentFile(db, env, orgId, video.fileInstanceId);
  if (!Number.isFinite(source.size) || source.size <= 0) throw badRequest(`Video ${video.fileName} has an unknown size.`);
  const mime = source.mime || 'video/mp4';
  const init = await driveFetch(db, env, orgId, DRIVE_UPLOAD + '?uploadType=resumable&fields=id,name,webViewLink,appProperties', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-upload-content-type': mime, 'x-upload-content-length': String(source.size) },
    body: JSON.stringify({
      name: video.fileName,
      parents: [folderId],
      mimeType: mime,
      appProperties: { kemokemFileInstanceId: video.fileInstanceId, kemokemPublishItemId: video.itemId },
    }),
  });
  const location = init.headers.get('location');
  if (!location || !location.startsWith('https://www.googleapis.com/')) {
    throw badRequest('Google Drive did not issue a valid resumable upload URL.');
  }
  const token = await driveToken(db, env, orgId);
  const response = await fetch(location, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': mime,
      'content-length': String(source.size),
      'content-range': `bytes 0-${source.size - 1}/${source.size}`,
    },
    body: source.body,
    duplex: 'half',
    signal: AbortSignal.timeout(30 * 60_000),
  } as RequestInit & { duplex: 'half' });
  if (!response.ok) {
    throw badRequest(`Google Drive upload failed for ${video.fileName} (HTTP ${response.status}): ${(await response.text()).slice(0, 200)}`);
  }
  const item = await response.json() as DriveItem;
  known.push(item);
}

async function projectVideos(db: Db, orgId: string, projectId: string): Promise<SyncVideo[]> {
  return rowsOf<SyncVideo>(await db.execute(sql`
    select i.id as "itemId", i.file_instance_id as "fileInstanceId", f.file_name as "fileName",
           f.size::float8 as size, f.mime
    from publish_items i
    join distribution_variants v on v.id = i.variant_id
    join file_instances f on f.id = i.file_instance_id
    where v.org_id = ${orgId} and v.project_id = ${projectId}
    order by i.created_at, i.id
  `));
}

/** Video selection does not depend on a connected social account. */
export async function getProjectDriveAssets(ctx: Ctx, projectId: string) {
  const [project] = rowsOf<{ id: string }>(await ctx.db.execute(sql`
    select id from creative_projects where id=${projectId} and org_id=${ctx.orgId} and deleted_at is null
  `));
  if (!project) throw notFound('Project');
  return projectVideos(ctx.db, ctx.orgId, projectId);
}

async function socialTargets(db: Db, orgId: string, projectId: string): Promise<SocialTarget[]> {
  return rowsOf<SocialTarget>(await db.execute(sql`
    select i.id as "itemId", i.file_instance_id as "fileInstanceId", f.file_name as "fileName",
           a.id as "accountId", a.platform::text as platform
    from publish_items i join distribution_variants v on v.id = i.variant_id
    join file_instances f on f.id = i.file_instance_id
    join social_accounts a on a.org_id = v.org_id and a.deleted_at is null and a.active = true
    where v.org_id = ${orgId} and v.project_id = ${projectId}
      and a.platform::text in ('youtube','instagram','facebook','tiktok','threads')
    order by i.created_at, a.platform, a.id
  `));
}

export async function startProjectDriveSync(ctx: Ctx, projectId: string, selectedItemIds: string[]) {
  const project = rowsOf<{ title: string }>(await ctx.db.execute(sql`
    select title from creative_projects where id = ${projectId} and org_id = ${ctx.orgId} and deleted_at is null
  `))[0];
  if (!project) throw notFound('Project');
  await driveToken(ctx.db, ctx.env, ctx.orgId);
  const videos = await projectVideos(ctx.db, ctx.orgId, projectId);
  if (!videos.length) throw badRequest('Link at least one video in the project Assets tab before Drive Sync.');
  const unique = [...new Set(selectedItemIds)];
  if (unique.some((id) => !videos.some((item) => item.itemId === id))) throw badRequest('One selected video does not belong to this project.');
  const chosen = unique.length ? videos.filter((item) => unique.includes(item.itemId)) : videos;
  const active = rowsOf<{ id: string }>(await ctx.db.execute(sql`
    select id from project_drive_syncs
    where org_id = ${ctx.orgId} and project_id = ${projectId} and status in ('QUEUED','RUNNING')
    limit 1
  `))[0];
  if (active) throw conflict('Drive Sync is already processing this project.');
  const [job] = await ctx.db.insert(projectDriveSyncs).values({
    orgId: ctx.orgId, projectId, folderName: project.title,
    selectedItemIds: chosen.map((v) => v.itemId), total: chosen.length,
  }).returning({ id: projectDriveSyncs.id });
  await audit(ctx, 'project.drive.sync.started', { type: 'project', id: projectId }, undefined, { items: chosen.length });
  return { id: job!.id, status: 'QUEUED', total: chosen.length };
}

export async function projectDriveStatus(ctx: Ctx, projectId: string) {
  const [project] = rowsOf<{ id: string }>(await ctx.db.execute(sql`
    select id from creative_projects where id = ${projectId} and org_id = ${ctx.orgId} and deleted_at is null
  `));
  if (!project) throw notFound('Project');
  const [latest] = await ctx.db.select().from(projectDriveSyncs)
    .where(and(eq(projectDriveSyncs.orgId, ctx.orgId), eq(projectDriveSyncs.projectId, projectId)))
    .orderBy(desc(projectDriveSyncs.createdAt)).limit(1);
  return {
    configured: await driveToken(ctx.db, ctx.env, ctx.orgId).then(() => true).catch(() => false),
    job: latest ?? null,
    folderUrl: latest?.folderId ? `https://drive.google.com/drive/folders/${encodeURIComponent(latest.folderId)}` : null,
  };
}

export async function processProjectDriveSync(db: Db, env: ServiceEnv) {
  const [job] = rowsOf<{ id: string; orgId: string; projectId: string; folderName: string; selectedItemIds: string[] }>(await db.execute(sql`
    update project_drive_syncs set status='RUNNING', started_at=now(), updated_at=now(), error=null
    where id = (
      select id from project_drive_syncs where status='QUEUED' order by created_at
      for update skip locked limit 1
    )
    returning id, org_id as "orgId", project_id as "projectId", folder_name as "folderName", selected_item_ids as "selectedItemIds"
  `));
  if (!job) return { processed: 0 };
  try {
    const folder = await folderFor(db, env, job.orgId, job.projectId, job.folderName);
    await db.execute(sql`update project_drive_syncs set folder_id=${folder.id}, updated_at=now() where id=${job.id}`);
    const known = await listDriveFiles(db, env, job.orgId, `'${quoted(folder.id)}' in parents and trashed=false`);
    const videos = (await projectVideos(db, job.orgId, job.projectId)).filter((v) => job.selectedItemIds.includes(v.itemId));
    const targets = (await socialTargets(db, job.orgId, job.projectId)).filter((t) => job.selectedItemIds.includes(t.itemId));
    for (let i = 0; i < videos.length; i++) {
      await uploadVideo(db, env, job.orgId, folder.id, videos[i]!, known);
      await db.execute(sql`update project_drive_syncs set completed=${i + 1}, updated_at=now() where id=${job.id}`);
    }
    await updateManifest(db, env, job.orgId, folder.id, known, {
      schemaVersion: 1, projectId: job.projectId, projectName: job.folderName,
      instructions: 'Edit each meta__*.json placeholder with ready=true and platform-specific metadata. Preserve IDs. Kemokem imports only ready=true.',
      videos: videos.map((v) => ({ publishItemId: v.itemId, fileInstanceId: v.fileInstanceId, fileName: v.fileName })),
      metadataFiles: targets.map((t) => ({ name: metadataFileName(t.itemId, t.accountId), publishItemId: t.itemId, socialAccountId: t.accountId, platform: t.platform })),
    });
    for (const target of targets) {
      await jsonFile(db, env, job.orgId, folder.id, known,
        metadataFileName(target.itemId, target.accountId), metadataTemplate(job.projectId, target),
        { kemokemType: 'socialMetadata', kemokemPublishItemId: target.itemId, kemokemAccountId: target.accountId });
    }
    await db.execute(sql`update project_drive_syncs set status='COMPLETE', finished_at=now(), updated_at=now() where id=${job.id}`);
    return { processed: 1, uploaded: videos.length, metadataTemplates: targets.length };
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 700) : 'Google Drive upload failed.';
    await db.execute(sql`update project_drive_syncs set status='FAILED', error=${error}, finished_at=now(), updated_at=now() where id=${job.id}`);
    return { processed: 1, failed: error };
  }
}

/**
 * Fallback when ChatGPT's Google Drive connector can read files but cannot edit raw JSON:
 * upload ChatGPT-generated JSON files via Kemokem into the exact app-owned placeholders.
 * Each file is matched by two immutable UUIDs and validated before the Drive write.
 */
export async function uploadProjectSocialMetadata(
  ctx: Ctx,
  projectId: string,
  inputs: { name: string; data: unknown }[],
) {
  const status = await projectDriveStatus(ctx, projectId);
  if (!status.job?.folderId || status.job.status !== 'COMPLETE') {
    throw badRequest('Finish Drive Sync before uploading analyzed JSON files.');
  }
  const targets = await socialTargets(ctx.db, ctx.orgId, projectId);
  const lookup = new Map(targets.map((t) => [metadataFileName(t.itemId, t.accountId), t]));
  const files = await listDriveFiles(ctx.db, ctx.env, ctx.orgId, `'${quoted(status.job.folderId)}' in parents and trashed=false`);
  const checked: { driveId: string; meta: SocialMetadata }[] = [];
  for (const input of inputs) {
    const target = lookup.get(input.name);
    const file = files.find((f) => f.name === input.name && f.appProperties?.kemokemType === 'socialMetadata');
    if (!target || !file) throw badRequest(`No owned metadata placeholder for ${input.name}.`);
    const meta = parseSocialMetadata(input.data, {
      projectId, itemId: target.itemId, fileInstanceId: target.fileInstanceId, fileName: target.fileName,
      accountId: target.accountId, platform: target.platform,
    });
    checked.push({ driveId: file.id, meta });
  }
  for (const { driveId, meta } of checked) {
    await driveFetch(ctx.db, ctx.env, ctx.orgId, `${DRIVE_UPLOAD}/${encodeURIComponent(driveId)}?uploadType=media`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(meta, null, 2) + '\n',
    });
  }
  await audit(ctx, 'project.drive.metadata.uploaded', { type: 'project', id: projectId }, undefined, { count: checked.length });
  return { uploaded: checked.length };
}

/** Import metadata only for the exact project + video + account. Never replace scheduled/published drafts. */
export async function prefillProjectSocials(ctx: Ctx, projectId: string) {
  const status = await projectDriveStatus(ctx, projectId);
  if (!status.job?.folderId || status.job.status !== 'COMPLETE') throw badRequest('Complete Drive Sync before importing social metadata.');
  const files = await listDriveFiles(ctx.db, ctx.env, ctx.orgId, `'${quoted(status.job.folderId)}' in parents and trashed=false`);
  const targets = await socialTargets(ctx.db, ctx.orgId, projectId);
  const validTargets = new Map(targets.map((target) => [metadataFileName(target.itemId, target.accountId), target]));
  const result = { imported: 0, skipped: 0, errors: [] as string[] };
  for (const file of files) {
    if (!file.name.startsWith('meta__') || !file.name.endsWith('.json')) continue;
    const target = validTargets.get(file.name);
    if (!target) { result.skipped++; result.errors.push(`${file.name}: no matching item/account in this project`); continue; }
    try {
      const response = await driveFetch(ctx.db, ctx.env, ctx.orgId, `${DRIVE}/${encodeURIComponent(file.id)}?alt=media`);
      const raw = await response.text();
      if (raw.length > 100_000) throw badRequest('Metadata JSON is too large.');
      const meta = parseSocialMetadata(JSON.parse(raw), {
        projectId, itemId: target.itemId, fileInstanceId: target.fileInstanceId,
        fileName: target.fileName, accountId: target.accountId, platform: target.platform,
      });
      if (!meta.ready) { result.skipped++; continue; }
      const existing = rowsOf<{ id: string; uploadState: string }>(await ctx.db.execute(sql`
        select id, upload_state as "uploadState" from publish_drafts
        where org_id=${ctx.orgId} and item_id=${target.itemId} and social_account_id=${target.accountId}
      `))[0];
      if (existing && existing.uploadState !== 'DRAFT' && existing.uploadState !== 'FAILED') {
        result.skipped++; result.errors.push(`${file.name}: already ${existing.uploadState}; not overwritten`); continue;
      }
      const hashtags = meta.hashtags.map((h) => h.replace(/^#/, ''));
      const privacy = meta.privacy ?? (target.platform === 'youtube' ? 'PRIVATE' : null);
      const contentForm = meta.contentForm ?? (target.platform === 'youtube' ? 'SHORT' : target.platform === 'instagram' ? 'REEL' : null);
      const aiUse = meta.aiUse ?? 'YES';
      if (existing) {
        await ctx.db.execute(sql`
          update publish_drafts set title=${meta.title}, caption=${meta.caption}, hashtags=${hashtags},
            privacy=${privacy}, content_form=${contentForm}, playlist_ids=${meta.playlistIds}, ai_use=${aiUse},
            upload_state='DRAFT', error=null, updated_at=now()
          where id=${existing.id} and upload_state in ('DRAFT','FAILED')
        `);
      } else {
        await ctx.db.execute(sql`
          insert into publish_drafts (org_id, item_id, social_account_id, title, caption, hashtags, privacy, content_form, playlist_ids, ai_use, upload_state)
          values (${ctx.orgId}, ${target.itemId}, ${target.accountId}, ${meta.title}, ${meta.caption},
            ${hashtags}, ${privacy}, ${contentForm}, ${meta.playlistIds}, ${aiUse}, 'DRAFT')
          on conflict (item_id, social_account_id) do nothing
        `);
      }
      result.imported++;
    } catch (e) {
      result.errors.push(`${file.name}: ${e instanceof Error ? e.message : 'Invalid metadata'}`);
    }
  }
  await audit(ctx, 'project.drive.metadata.prefilled', { type: 'project', id: projectId }, undefined, { imported: result.imported, skipped: result.skipped, errors: result.errors.length });
  return result;
}

export async function getProjectScheduleRows(ctx: Ctx, projectId: string) {
  const [project] = rowsOf<{ id: string }>(await ctx.db.execute(sql`
    select id from creative_projects where id=${projectId} and org_id=${ctx.orgId} and deleted_at is null
  `));
  if (!project) throw notFound('Project');
  return rowsOf<{
    itemId: string; fileInstanceId: string; fileName: string; accountId: string; platform: string; handle: string;
    title: string | null; caption: string | null; hashtags: string[]; privacy: string | null;
    contentForm: string | null; playlistIds: string[]; aiUse: string | null; uploadState: string;
  }>(await ctx.db.execute(sql`
    select i.id as "itemId", f.id as "fileInstanceId", f.file_name as "fileName",
           a.id as "accountId", a.platform::text as platform, a.handle, d.title, d.caption,
           coalesce(d.hashtags,'{}'::text[]) as hashtags, d.privacy, d.content_form as "contentForm",
           coalesce(d.playlist_ids,'{}'::text[]) as "playlistIds", d.ai_use as "aiUse", coalesce(d.upload_state,'MISSING') as "uploadState"
    from publish_items i join distribution_variants v on v.id=i.variant_id
    join file_instances f on f.id=i.file_instance_id
    join social_accounts a on a.org_id=v.org_id and a.active=true and a.deleted_at is null
    left join publish_drafts d on d.item_id=i.id and d.social_account_id=a.id
    where v.org_id=${ctx.orgId} and v.project_id=${projectId}
      and a.platform::text in ('youtube','instagram','facebook','tiktok','threads')
    order by i.created_at, a.platform, a.id
  `));
}
