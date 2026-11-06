import {
  and,
  distributionVariants,
  eq,
  fileInstances,
  providerConnections,
  publicationRecords,
  publicationStatusEvents,
  publishDrafts,
  publishItems,
  socialAccounts,
  sql,
} from '@creatoros/db';
import {
  parseLocalDateTime,
  threadsPostError,
  tiktokCaption,
  tiktokInteractionForm,
  tiktokInteractions,
  tiktokPostError,
} from '@creatoros/domain';
import {
  queryTikTokCreator,
  refreshGoogleToken,
  refreshThreadsToken,
  tiktokConnector,
  UploadOutcome,
  uploadFacebookVideo,
  uploadInstagramReel,
  uploadThreadsPost,
  uploadTikTokVideo,
  uploadYoutubeVideo,
  youtubeUploadText,
  type UploadBytes,
} from '@creatoros/connectors';
import { audit } from './audit';
import { signMediaToken } from './crypto';
import { openAgentFile } from './agent-file';
import { placeVideoOnPlaylists } from './youtube-playlists';
import { connectorContext, loadCredentials } from './integrations';
import { AppError, badRequest, conflict, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const YT_UPLOAD = 'https://www.googleapis.com/auth/youtube.upload';
const FB_VIDEO = 'pages_manage_posts';
const IG_PUBLISH = 'instagram_business_content_publish';
const THREADS_PUBLISH = 'threads_content_publish';
const TIKTOK_PUBLISH = 'video.publish';

export async function linkPublishFile(ctx: Ctx, variantId: string, fileInstanceId: string) {
  const [v] = await ctx.db
    .select({ id: distributionVariants.id })
    .from(distributionVariants)
    .where(and(eq(distributionVariants.id, variantId), eq(distributionVariants.orgId, ctx.orgId)));
  if (!v) throw notFound('Title');
  const [f] = await ctx.db
    .select({ id: fileInstances.id, fileType: fileInstances.fileType })
    .from(fileInstances)
    .where(and(eq(fileInstances.id, fileInstanceId), eq(fileInstances.orgId, ctx.orgId)));
  if (!f) throw notFound('File');
  if (f.fileType !== 'VIDEO') throw badRequest('Only video files can be published from here.');
  const [row] = await ctx.db
    .insert(publishItems)
    .values({ orgId: ctx.orgId, variantId, fileInstanceId })
    .onConflictDoNothing()
    .returning();
  if (row) {
    await audit(ctx, 'publish.file.link', { type: 'variant', id: variantId }, undefined, { fileInstanceId });
    return row;
  }
  const [existing] = await ctx.db
    .select()
    .from(publishItems)
    .where(and(eq(publishItems.variantId, variantId), eq(publishItems.fileInstanceId, fileInstanceId)));
  return existing!;
}

export async function unlinkPublishFile(ctx: Ctx, variantId: string, itemId: string) {
  const [item] = await ctx.db
    .select()
    .from(publishItems)
    .where(and(eq(publishItems.id, itemId), eq(publishItems.variantId, variantId), eq(publishItems.orgId, ctx.orgId)));
  if (!item) throw notFound('Attached file');
  await ctx.db.delete(publishItems).where(eq(publishItems.id, itemId));
  await audit(ctx, 'publish.file.unlink', { type: 'variant', id: variantId }, undefined, {
    fileInstanceId: item.fileInstanceId,
  });
  return { id: itemId, removed: true };
}

export async function getPublishTitle(ctx: Ctx, variantId: string) {
  const [v] = rowsOf<any>(
    await ctx.db.execute(sql`
      select v.id, v.title_master as title, v.project_id as "projectId", v.asset_id as "assetId", a.title as "assetTitle"
      from distribution_variants v join logical_assets a on a.id = v.asset_id
      where v.id = ${variantId} and v.org_id = ${ctx.orgId}`),
  );
  if (!v) throw notFound('Title');
  const items = rowsOf<any>(
    await ctx.db.execute(sql`
      select i.id, i.file_instance_id as "fileInstanceId", f.file_name as "fileName", f.display_path as "displayPath",
             f.size::float8 as size, d.display_name as "deviceName", d.state as "deviceState",
             nullif(f.tech->>'width', '')::int as width,
             nullif(f.tech->>'height', '')::int as height,
             nullif(f.tech->>'durationMs', '')::float8 as "durationMs"
      from publish_items i
      join file_instances f on f.id = i.file_instance_id
      join devices d on d.id = f.device_id
      where i.variant_id = ${variantId}
      order by i.created_at`),
  );
  const drafts = rowsOf<any>(
    await ctx.db.execute(sql`
      select d.id, d.item_id as "itemId", d.social_account_id as "accountId", d.title, d.caption, d.hashtags, d.privacy,
             d.content_form as "contentForm", d.playlist_ids as "playlistIds", d.ai_use as "aiUse",
             d.scheduled_at as "scheduledAt",
             d.upload_state as "uploadState", d.error, d.publication_id as "publicationId",
             r.canonical_url as url, r.state as "recordState"
      from publish_drafts d
      left join publication_records r on r.id = d.publication_id
      where d.item_id in (select id from publish_items where variant_id = ${variantId})`),
  );
  const accounts = await publishAccounts(ctx);
  return { ...v, items, drafts, accounts };
}

async function publishAccounts(ctx: Ctx) {
  const rows = rowsOf<any>(
    await ctx.db.execute(sql`
      select sa.id, sa.platform, sa.handle, sa.provider_connection_id as "connectionId",
             pc.scopes, pc.state as "connectionState", pc.provider
      from social_accounts sa
      left join provider_connections pc on pc.id = sa.provider_connection_id
      where sa.org_id = ${ctx.orgId} and sa.deleted_at is null and sa.active
      order by sa.platform, sa.handle`),
  );
  return rows.map((a) => {
    const scopes: string[] = a.scopes ?? [];
    let canPublish = false;
    let reason = 'This account is not connected.';
    if (!a.connectionId || a.connectionState === 'PAUSED' || a.connectionState === 'DISABLED')
      reason = 'Connect this account in Integrations first.';
    else if (a.platform === 'tiktok') {
      canPublish = scopes.includes(TIKTOK_PUBLISH);
      reason = canPublish ? '' : 'Reconnect TikTok and check Publish. This login only has the permissions it asked for.';
    } else if (a.platform === 'instagram') {
      canPublish = scopes.includes(IG_PUBLISH);
      reason = canPublish ? '' : 'Instagram publish permission is missing. Reconnect and allow content publishing.';
    } else if (a.platform === 'youtube') {
      canPublish = scopes.includes(YT_UPLOAD);
      reason = canPublish ? '' : 'YouTube uploads need an extra permission. Integrations → Enable uploads.';
    }     else if (a.platform === 'facebook') {
      canPublish = scopes.includes(FB_VIDEO);
      reason = canPublish ? '' : 'Page video posting needs pages_manage_posts. Integrations → Enable Page videos.';
    } else if (a.platform === 'threads') {
      canPublish = scopes.includes(THREADS_PUBLISH);
      reason = canPublish ? '' : 'Reconnect Threads and check Publish.';
    } else if (a.platform === 'snapchat') {
      reason = 'This Snapchat profile is connected. Sending a Story from Kemokem is not available yet.';
    } else reason = 'Publishing is not available for this platform.';
    return {
      id: a.id,
      platform: a.platform,
      handle: a.handle,
      canPublish,
      reason,
    };
  });
}

export interface PublishRequest {
  itemId: string;
  socialAccountId: string;
  requestId: string;
  title?: string | null;
  caption?: string | null;
  hashtags?: string[];
  privacy?: string | null;
  contentForm?: string | null;
  playlistIds?: string[];
  aiUse?: 'YES' | 'NO' | null;
}

function cleanPlaylistIds(ids: string[]): string[] {
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id) continue;
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw badRequest('That playlist is not a YouTube playlist.');
    if (!out.includes(id)) out.push(id);
    if (out.length > 20) throw badRequest('Choose at most 20 playlists.');
  }
  return out;
}

function youtubeChoices(
  platform: string,
  input: { playlistIds?: string[]; aiUse?: 'YES' | 'NO' | null },
  existing?: { playlistIds: string[] | null; aiUse: string | null } | null,
) {
  if (platform === 'threads') {
    const ai = input.aiUse === undefined ? existing?.aiUse ?? null : input.aiUse;
    if (ai !== 'YES' && ai !== 'NO') throw badRequest('Choose whether this post should show the Threads AI label.');
    return { playlistIds: [] as string[], aiUse: ai };
  }
  if (platform !== 'youtube') return { playlistIds: [] as string[], aiUse: null as 'YES' | 'NO' | null };
  const playlistIds =
    input.playlistIds === undefined ? (existing?.playlistIds ?? []) : cleanPlaylistIds(input.playlistIds);
  const ai = input.aiUse === undefined ? existing?.aiUse ?? null : input.aiUse;
  if (ai !== 'YES' && ai !== 'NO') throw badRequest('Choose whether this video uses AI.');
  return { playlistIds, aiUse: ai };
}

function recordPrivacy(platform: string, privacy: string | null | undefined): 'PUBLIC' | 'UNLISTED' | 'PRIVATE' {
  if (platform === 'threads') return 'PUBLIC';
  if (platform === 'tiktok') return privacy === 'PUBLIC_TO_EVERYONE' ? 'PUBLIC' : 'PRIVATE';
  if (privacy === 'PRIVATE' || privacy === 'UNLISTED' || privacy === 'PUBLIC') return privacy;
  return 'PUBLIC';
}

function tiktokDraft(input: PublishRequest) {
  const hashtags = (input.hashtags ?? []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean).slice(0, 30);
  const err = tiktokPostError({ caption: input.caption, hashtags, privacy: input.privacy });
  if (err) throw badRequest(err);
  const form = (input.contentForm ?? '').trim();
  if (form && form !== 'VIDEO' && form !== 'SHORT') {
    const parts = form.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.some((part) => part !== 'comments' && part !== 'duet' && part !== 'stitch'))
      throw badRequest('Choose comments, duet, and stitch only.');
  }
  return { hashtags, contentForm: tiktokInteractionForm(tiktokInteractions(form)) };
}

function threadsDraft(input: PublishRequest) {
  const tags = (input.hashtags ?? []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
  if (tags.length > 1) throw badRequest('Threads allows one topic.');
  const reply = (input.privacy || 'everyone').toLowerCase();
  const ai = input.aiUse ?? '';
  const err = threadsPostError({ text: input.caption?.trim() ?? '', topic: tags[0] ?? '', reply, ai });
  if (err) throw badRequest(err);
  return { hashtags: tags.slice(0, 1), reply };
}

function threadsKind(mime: string, name: string): 'IMAGE' | 'VIDEO' {
  const type = mime.toLowerCase();
  const file = name.toLowerCase();
  const image = type.startsWith('image/') || /\.(jpe?g|png)$/.test(file);
  if (image) {
    if (type.includes('png') || file.endsWith('.png') || type.includes('jpeg') || type.includes('jpg') || /\.jpe?g$/.test(file))
      return 'IMAGE';
    throw new UploadOutcome('Threads images must be JPEG or PNG.', false);
  }
  if (type.startsWith('video/') || /\.(mp4|mov)$/.test(file)) return 'VIDEO';
  throw new UploadOutcome('Threads can take a JPEG, PNG, or an MP4 or MOV video from this screen.', false);
}

/**
 * Stores the per-platform text and queues one upload. The same requestId never uploads twice.
 * A file already published, uploading, or uncertain is not sent again.
 */
export async function requestPublish(
  ctx: Ctx,
  input: PublishRequest,
  opts: {
    enqueue?: (queue: string, name: string, data: Record<string, unknown>) => Promise<void>;
    runNow?: boolean;
    fetch?: typeof fetch;
    loadFile?: (
      db: Ctx['db'],
      env: Ctx['env'],
      orgId: string,
      fileInstanceId: string,
      fetchImpl: typeof fetch,
    ) => Promise<UploadBytes>;
  } = {},
) {
  const [item] = await ctx.db
    .select()
    .from(publishItems)
    .where(and(eq(publishItems.id, input.itemId), eq(publishItems.orgId, ctx.orgId)));
  if (!item) throw notFound('Attached file');
  const accounts = await publishAccounts(ctx);
  const account = accounts.find((a) => a.id === input.socialAccountId);
  if (!account) throw notFound('Account');
  if (!account.canPublish) throw conflict(account.reason, undefined, 'CANNOT_PUBLISH');
  if (account.platform === 'youtube' && !input.privacy)
    throw badRequest('Choose a privacy setting. Nothing is published as public unless you pick Public.');
  if (account.platform === 'youtube' && !input.title?.trim()) throw badRequest('A YouTube title is required.');
  if (account.platform === 'youtube' && input.contentForm !== 'VIDEO' && input.contentForm !== 'SHORT')
    throw badRequest('Choose Video or Short.');
  if (
    account.platform === 'youtube' &&
    input.privacy !== 'PUBLIC' &&
    input.privacy !== 'UNLISTED' &&
    input.privacy !== 'PRIVATE'
  )
    throw badRequest('Choose Public, Unlisted, or Private.');
  const threads = account.platform === 'threads' ? threadsDraft(input) : null;
  const tiktok = account.platform === 'tiktok' ? tiktokDraft(input) : null;

  const [existing] = await ctx.db
    .select()
    .from(publishDrafts)
    .where(and(eq(publishDrafts.itemId, item.id), eq(publishDrafts.socialAccountId, input.socialAccountId)));
  if (existing?.requestId === input.requestId) return draftView(existing);
  if (existing && (existing.uploadState === 'QUEUED' || existing.uploadState === 'UPLOADING' || existing.uploadState === 'PUBLISHED'))
    throw conflict(
      existing.uploadState === 'PUBLISHED'
        ? 'This file is already published to that account.'
        : 'This upload is already in progress.',
      undefined,
      'ALREADY_PUBLISHING',
    );

  const extra = youtubeChoices(account.platform, input, existing);
  const values = {
    title: input.title?.trim() || null,
    caption: input.caption?.trim() || null,
    hashtags: threads ? threads.hashtags : tiktok ? tiktok.hashtags : (input.hashtags ?? []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean).slice(0, 30),
    privacy: threads ? threads.reply : (input.privacy ?? null),
    contentForm: tiktok ? tiktok.contentForm : (input.contentForm ?? null),
    playlistIds: extra.playlistIds,
    aiUse: extra.aiUse,
    requestId: input.requestId,
    uploadState: 'QUEUED',
    error: null,
    updatedAt: new Date(),
  };
  let draft = existing;
  if (existing) {
    const [u] = await ctx.db.update(publishDrafts).set(values).where(eq(publishDrafts.id, existing.id)).returning();
    draft = u!;
  } else {
    const [c] = await ctx.db
      .insert(publishDrafts)
      .values({ orgId: ctx.orgId, itemId: item.id, socialAccountId: input.socialAccountId, ...values })
      .returning();
    draft = c!;
  }
  await audit(ctx, 'publish.requested', { type: 'publish_draft', id: draft!.id }, undefined, {
    platform: account.platform,
  });
  if (opts.runNow) return executePublish(ctx, draft!.id, opts);
  if (!opts.enqueue)
    throw new AppError(503, 'QUEUE_UNAVAILABLE', 'The background worker is not available, so the video was not sent.');
  try {
    await opts.enqueue('publish', 'publish', { draftId: draft!.id });
  } catch (e) {
    await ctx.db
      .update(publishDrafts)
      .set({ uploadState: 'FAILED', error: (e as Error).message.slice(0, 300), updatedAt: new Date() })
      .where(eq(publishDrafts.id, draft!.id));
    throw e;
  }
  return draftView(draft!);
}

function draftView(d: typeof publishDrafts.$inferSelect) {
  return {
    id: d.id,
    itemId: d.itemId,
    accountId: d.socialAccountId,
    uploadState: d.uploadState,
    error: d.error,
    publicationId: d.publicationId,
    scheduledAt: d.scheduledAt,
    duplicate: false,
  };
}

export interface ScheduleRequest extends PublishRequest {
  plannedLocal: string;
  timezone?: string;
}

/**
 * Saves the same per-platform text as Publish, and posts when scheduledAt arrives.
 * The worker claims SCHEDULED rows; nothing is sent at save time.
 */
export async function schedulePublish(ctx: Ctx, input: ScheduleRequest) {
  const [item] = await ctx.db
    .select()
    .from(publishItems)
    .where(and(eq(publishItems.id, input.itemId), eq(publishItems.orgId, ctx.orgId)));
  if (!item) throw notFound('Attached file');
  const accounts = await publishAccounts(ctx);
  const account = accounts.find((a) => a.id === input.socialAccountId);
  if (!account) throw notFound('Account');
  if (!account.canPublish) throw conflict(account.reason, undefined, 'CANNOT_PUBLISH');
  if (account.platform === 'youtube' && !input.privacy)
    throw badRequest('Choose a privacy setting. Nothing is published as public unless you pick Public.');
  if (account.platform === 'youtube' && !input.title?.trim()) throw badRequest('A YouTube title is required.');
  if (account.platform === 'youtube' && input.contentForm !== 'VIDEO' && input.contentForm !== 'SHORT')
    throw badRequest('Choose Video or Short.');
  if (
    account.platform === 'youtube' &&
    input.privacy !== 'PUBLIC' &&
    input.privacy !== 'UNLISTED' &&
    input.privacy !== 'PRIVATE'
  )
    throw badRequest('Choose Public, Unlisted, or Private.');
  const threads = account.platform === 'threads' ? threadsDraft(input) : null;
  const tiktok = account.platform === 'tiktok' ? tiktokDraft(input) : null;
  const tzRows = rowsOf<{ timezone: string }>(
    await ctx.db.execute(sql`select timezone from organizations where id = ${ctx.orgId}`),
  );
  const tz = input.timezone || tzRows[0]?.timezone || 'America/Vancouver';
  let scheduledAt: Date;
  try {
    scheduledAt = parseLocalDateTime(input.plannedLocal, tz);
  } catch {
    throw badRequest('Enter a date and time.');
  }
  if (Number.isNaN(scheduledAt.getTime())) throw badRequest('Enter a date and time.');
  if (scheduledAt.getTime() < Date.now() - 60_000) throw badRequest('Pick a time that has not already passed.');

  const [existing] = await ctx.db
    .select()
    .from(publishDrafts)
    .where(and(eq(publishDrafts.itemId, item.id), eq(publishDrafts.socialAccountId, input.socialAccountId)));
  if (
    existing &&
    (existing.uploadState === 'QUEUED' ||
      existing.uploadState === 'UPLOADING' ||
      existing.uploadState === 'PUBLISHED' ||
      existing.uploadState === 'UNCERTAIN')
  )
    throw conflict(
      existing.uploadState === 'PUBLISHED'
        ? 'This file is already published to that account.'
        : 'This upload is already in progress.',
      undefined,
      'ALREADY_PUBLISHING',
    );

  const text = {
    title: input.title?.trim() || null,
    caption: input.caption?.trim() || null,
    hashtags: threads ? threads.hashtags : tiktok ? tiktok.hashtags : (input.hashtags ?? []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean).slice(0, 30),
    privacy: recordPrivacy(account.platform, input.privacy),
  };
  return ctx.db.transaction(async (tx) => {
    let publicationId = existing?.publicationId ?? null;
    if (publicationId) {
      const [cur] = await tx
        .select({ state: publicationRecords.state })
        .from(publicationRecords)
        .where(eq(publicationRecords.id, publicationId));
      if (cur && cur.state !== 'PUBLISHED_VERIFIED' && cur.state !== 'PUBLISHED_MANUAL') {
        await tx
          .update(publicationRecords)
          .set({
            title: text.title,
            caption: text.caption,
            hashtags: text.hashtags,
            privacy: text.privacy,
            state: 'SCHEDULED',
            plannedAt: scheduledAt,
            plannedTimezone: tz,
            fileInstanceId: item.fileInstanceId,
            failureReason: null,
            updatedAt: new Date(),
          })
          .where(eq(publicationRecords.id, publicationId));
      } else publicationId = null;
    }
    if (!publicationId) {
      const [rec] = await tx
        .insert(publicationRecords)
        .values({
          orgId: ctx.orgId,
          variantId: item.variantId,
          fileInstanceId: item.fileInstanceId,
          socialAccountId: account.id,
          provider: account.platform as 'youtube',
          title: text.title,
          caption: text.caption,
          hashtags: text.hashtags,
          privacy: text.privacy,
          state: 'SCHEDULED',
          stateProvenance: 'USER_ENTERED',
          stateEvidence: 'Scheduled to publish from Creator OS',
          plannedAt: scheduledAt,
          plannedTimezone: tz,
          createdBy: ctx.userId,
        })
        .returning();
      publicationId = rec!.id;
      await tx.insert(publicationStatusEvents).values({
        orgId: ctx.orgId,
        publicationId,
        event: 'scheduled',
        toState: 'SCHEDULED',
        source: 'user',
        provenance: 'USER_ENTERED',
        actorUserId: ctx.userId,
      });
    }
    const extra = youtubeChoices(account.platform, input, existing);
    const values = {
      ...text,
      privacy: threads ? threads.reply : (input.privacy ?? 'PUBLIC'),
      contentForm: tiktok ? tiktok.contentForm : (input.contentForm ?? null),
      playlistIds: extra.playlistIds,
      aiUse: extra.aiUse,
      requestId: input.requestId,
      uploadState: 'SCHEDULED',
      scheduledAt,
      publicationId,
      error: null,
      updatedAt: new Date(),
    };
    let draft = existing;
    if (existing) {
      const [u] = await tx.update(publishDrafts).set(values).where(eq(publishDrafts.id, existing.id)).returning();
      draft = u!;
    } else {
      const [c] = await tx
        .insert(publishDrafts)
        .values({ orgId: ctx.orgId, itemId: item.id, socialAccountId: input.socialAccountId, ...values })
        .returning();
      draft = c!;
    }
    await audit({ ...ctx, db: tx }, 'publish.scheduled', { type: 'publish_draft', id: draft!.id }, undefined, {
      platform: account.platform,
      scheduledAt: scheduledAt.toISOString(),
    });
    return { ...draftView(draft!), scheduledAt };
  });
}

/** Claims due schedules and returns their ids. The worker then runs the same upload as Publish. */
export async function claimDuePublishes(db: Ctx['db'], limit = 5) {
  return rowsOf<{ id: string; orgId: string }>(
    await db.execute(sql`
      with due as (
        select id from publish_drafts
        where upload_state = 'SCHEDULED' and scheduled_at is not null and scheduled_at <= now()
        order by scheduled_at
        limit ${limit}
        for update skip locked
      )
      update publish_drafts d
      set upload_state = 'QUEUED', updated_at = now()
      from due
      where d.id = due.id
      returning d.id, d.org_id as "orgId"
    `),
  );
}

/** Runs one queued upload. A row that is not QUEUED is left alone, so a retry cannot send the file twice. */
export async function executePublish(
  ctx: Ctx,
  draftId: string,
  opts: {
    fetch?: typeof fetch;
    loadFile?: (
      db: Ctx['db'],
      env: Ctx['env'],
      orgId: string,
      fileInstanceId: string,
      fetchImpl: typeof fetch,
    ) => Promise<UploadBytes>;
  } = {},
) {
  const [claimed] = await ctx.db
    .update(publishDrafts)
    .set({ uploadState: 'UPLOADING', updatedAt: new Date() })
    .where(and(eq(publishDrafts.id, draftId), eq(publishDrafts.orgId, ctx.orgId), eq(publishDrafts.uploadState, 'QUEUED')))
    .returning();
  if (!claimed) {
    const [cur] = await ctx.db
      .select()
      .from(publishDrafts)
      .where(and(eq(publishDrafts.id, draftId), eq(publishDrafts.orgId, ctx.orgId)));
    if (!cur) throw notFound('Upload');
    return { ...draftView(cur), duplicate: true };
  }
  const fail = async (state: 'FAILED' | 'UNCERTAIN', error: string) => {
    await ctx.db
      .update(publishDrafts)
      .set({ uploadState: state, error: error.slice(0, 500), updatedAt: new Date() })
      .where(eq(publishDrafts.id, claimed.id));
    if (claimed.publicationId) {
      await ctx.db
        .update(publicationRecords)
        .set({ state: 'FAILED', failureReason: error.slice(0, 500), updatedAt: new Date() })
        .where(
          and(
            eq(publicationRecords.id, claimed.publicationId),
            sql`${publicationRecords.state} in ('SCHEDULED','PLANNED','READY','SUBMITTED','PROCESSING')`,
          ),
        );
    }
    return { ...draftView(claimed), uploadState: state, error };
  };
  try {
    const [item] = await ctx.db.select().from(publishItems).where(eq(publishItems.id, claimed.itemId));
    if (!item) return fail('FAILED', 'The attached file was removed before upload.');
    const [account] = await ctx.db
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, claimed.socialAccountId));
    if (!account?.providerConnectionId) return fail('FAILED', 'This account is not connected.');
    const [conn] = await ctx.db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, account.providerConnectionId));
    if (!conn) return fail('FAILED', 'This account is not connected.');
    const fetchImpl = opts.fetch ?? fetch;
    let file;
    try {
      file = await (opts.loadFile ?? openAgentFile)(ctx.db, ctx.env, ctx.orgId, item.fileInstanceId, fetchImpl);
    } catch (e) {
      return fail('FAILED', (e as Error).message);
    }
    const creds = loadCredentials(ctx.env, conn);
    const cctx = connectorContext(ctx.db, ctx.env, conn, { fetch: fetchImpl });
    let token = creds.accessToken ?? '';
    if (account.platform === 'youtube') {
      const fresh = await refreshGoogleToken(cctx).catch(() => creds);
      token = fresh.accessToken ?? token;
    } else if (account.platform === 'threads') {
      const fresh = await refreshThreadsToken(cctx).catch(() => creds);
      token = fresh.accessToken ?? token;
    } else if (account.platform === 'tiktok' && creds.refreshToken && (!creds.expiresAt || creds.expiresAt - 120_000 <= Date.now())) {
      const fresh = await tiktokConnector.refreshCredentials(cctx).catch(() => creds);
      token = fresh.accessToken ?? token;
      if (fresh.accessToken && fresh.accessToken !== creds.accessToken) await cctx.onCredentials?.(fresh);
    }
    const caption = [claimed.caption, ...(claimed.hashtags ?? []).map((h) => `#${h}`)].filter(Boolean).join('\n');
    const youtube =
      account.platform === 'youtube'
        ? youtubeUploadText({
            title: claimed.title || 'Untitled',
            description: claimed.caption ?? '',
            tags: claimed.hashtags ?? [],
            form: claimed.contentForm === 'SHORT' ? 'SHORT' : 'VIDEO',
          })
        : null;
    let result: { externalId: string; url: string | null };
    if (account.platform === 'instagram') {
      const base = ctx.env.appBaseUrl.replace(/\/$/, '');
      if (!base.startsWith('https://'))
        return fail('FAILED', 'Instagram downloads the video from this site. APP_BASE_URL must be the public https address.');
      const exp = Date.now() + 30 * 60_000;
      const mediaToken = signMediaToken(ctx.env.agentPairingSecret, {
        instanceId: item.fileInstanceId,
        userId: ctx.userId ?? 'publish',
        exp,
      });
      const videoUrl = `${base}/api/v1/files/${item.fileInstanceId}/stream?token=${encodeURIComponent(mediaToken)}`;
      if (typeof (file.body as ReadableStream).cancel === 'function')
        await (file.body as ReadableStream).cancel().catch(() => undefined);
      result = await uploadInstagramReel(fetchImpl, {
        version: 'v23.0',
        igUserId: conn.principalHint ?? '',
        accessToken: token,
        caption,
        videoUrl,
      });
    } else if (account.platform === 'youtube') {
      const privacy = claimed.privacy === 'PUBLIC' ? 'public' : claimed.privacy === 'PRIVATE' ? 'private' : 'unlisted';
      result = await uploadYoutubeVideo(fetchImpl, {
        accessToken: token,
        title: youtube!.title,
        description: youtube!.description,
        tags: youtube!.tags,
        privacy,
        containsSyntheticMedia: claimed.aiUse === 'YES' ? true : claimed.aiUse === 'NO' ? false : undefined,
        file,
      });
    } else if (account.platform === 'facebook') {
      result = await uploadFacebookVideo(fetchImpl, {
        version: 'v23.0',
        pageId: conn.principalHint ?? '',
        accessToken: token,
        title: claimed.title || '',
        description: caption,
        file,
      });
    } else if (account.platform === 'threads') {
      const base = ctx.env.appBaseUrl.replace(/\/$/, '');
      if (!base.startsWith('https://'))
        return fail('FAILED', 'Threads downloads the file from this site. APP_BASE_URL must be the public https address.');
      if (!conn.principalHint) return fail('FAILED', 'Reconnect Threads. The account id was not saved.');
      const kind = threadsKind(file.mime, file.name);
      const exp = Date.now() + 30 * 60_000;
      const mediaToken = signMediaToken(ctx.env.agentPairingSecret, {
        instanceId: item.fileInstanceId,
        userId: ctx.userId ?? 'publish',
        exp,
      });
      const mediaUrl = `${base}/api/v1/files/${item.fileInstanceId}/stream?token=${encodeURIComponent(mediaToken)}`;
      if (typeof (file.body as ReadableStream).cancel === 'function')
        await (file.body as ReadableStream).cancel().catch(() => undefined);
      const reply = claimed.privacy && claimed.privacy !== 'PUBLIC' ? claimed.privacy : 'everyone';
      result = await uploadThreadsPost(fetchImpl, {
        userId: conn.principalHint,
        accessToken: token,
        mediaType: kind,
        mediaUrl,
        text: claimed.caption?.trim() ?? '',
        topicTag: claimed.hashtags?.[0] ?? null,
        replyControl: reply,
        madeWithAi: claimed.aiUse === 'YES',
      });
    } else if (account.platform === 'tiktok') {
      const video = file.mime.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name);
      if (!video) return fail('FAILED', 'TikTok posts a video from this screen. Use an MP4 or MOV.');
      let info;
      try {
        info = await queryTikTokCreator(fetchImpl, token);
      } catch (e) {
        return fail('FAILED', (e as Error).message);
      }
      if (info.privacyOptions.length && claimed.privacy && !info.privacyOptions.includes(claimed.privacy))
        return fail(
          'FAILED',
          'TikTok does not allow that audience for this app. Choose one of the options in Who can watch. An unaudited app is often limited to Only me.',
        );
      const flags = tiktokInteractions(claimed.contentForm);
      const title = tiktokCaption(claimed.caption, claimed.hashtags ?? []) || file.name.replace(/\.[^.]+$/, '') || 'Video';
      result = await uploadTikTokVideo(fetchImpl, {
        accessToken: token,
        file,
        title: title.slice(0, 2200),
        privacyLevel: claimed.privacy || 'SELF_ONLY',
        disableComment: info.commentDisabled || !flags.comments,
        disableDuet: info.duetDisabled || !flags.duet,
        disableStitch: info.stitchDisabled || !flags.stitch,
        username: info.username,
      });
    } else return fail('FAILED', 'Publishing is not available for this platform.');

    let playlistNote: string | null = null;
    if (account.platform === 'youtube' && claimed.playlistIds.length) {
      try {
        const missed = await placeVideoOnPlaylists(token, result.externalId, claimed.playlistIds);
        if (missed.length)
          playlistNote = `The video is on YouTube. It was not added to every playlist. ${missed.join(' ')}`.slice(0, 500);
      } catch (e) {
        playlistNote = `The video is on YouTube. The playlists were not updated. ${(e as Error).message}`.slice(0, 500);
      }
    }

    const publishedFields = {
      provider: account.platform as 'youtube',
      externalPostId: result.externalId,
      canonicalUrl: result.url,
      title: claimed.title?.trim() || claimed.caption?.trim().split('\n')[0]?.slice(0, 300) || null,
      caption: claimed.caption,
      hashtags: claimed.hashtags ?? [],
      privacy: recordPrivacy(account.platform, claimed.privacy),
      state: 'PUBLISHED_VERIFIED' as const,
      stateProvenance: 'VERIFIED_PLATFORM' as const,
      stateEvidence: claimed.scheduledAt
        ? 'Uploaded by Creator OS at the scheduled time'
        : 'Uploaded by Creator OS when you pressed Publish',
      publishedAt: new Date(),
      fileInstanceId: item.fileInstanceId,
      updatedAt: new Date(),
    };
    let recId = claimed.publicationId;
    if (recId) {
      const [updated] = await ctx.db
        .update(publicationRecords)
        .set(publishedFields)
        .where(eq(publicationRecords.id, recId))
        .returning();
      if (!updated) recId = null;
    }
    if (!recId) {
      const [rec] = await ctx.db
        .insert(publicationRecords)
        .values({
          orgId: ctx.orgId,
          variantId: item.variantId,
          socialAccountId: account.id,
          createdBy: ctx.userId,
          ...publishedFields,
        })
        .returning();
      recId = rec!.id;
    }
    const rec = { id: recId };
    await ctx.db.insert(publicationStatusEvents).values({
      orgId: ctx.orgId,
      publicationId: rec!.id,
      event: 'published',
      fromState: null,
      toState: 'PUBLISHED_VERIFIED',
      source: 'publish',
      provenance: 'VERIFIED_PLATFORM',
      actorUserId: ctx.userId,
    });
    await ctx.db
      .update(publishDrafts)
      .set({ uploadState: 'PUBLISHED', publicationId: rec!.id, error: playlistNote, updatedAt: new Date() })
      .where(eq(publishDrafts.id, claimed.id));
    await audit(ctx, 'publish.uploaded', { type: 'publication', id: rec!.id }, undefined, {
      platform: account.platform,
      externalId: result.externalId,
    });
    return { ...draftView({ ...claimed, uploadState: 'PUBLISHED', publicationId: rec!.id, error: null }), url: result.url };
  } catch (e) {
    const sent = e instanceof UploadOutcome && e.sent;
    return fail(sent ? 'UNCERTAIN' : 'FAILED', (e as Error).message);
  }
}
