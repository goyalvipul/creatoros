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
import { parseLocalDateTime } from '@creatoros/domain';
import {
  refreshGoogleToken,
  UploadOutcome,
  uploadFacebookVideo,
  uploadInstagramReel,
  uploadYoutubeVideo,
  youtubeUploadText,
  type UploadBytes,
} from '@creatoros/connectors';
import { audit } from './audit';
import { signMediaToken } from './crypto';
import { openAgentFile } from './agent-file';
import { connectorContext, loadCredentials } from './integrations';
import { AppError, badRequest, conflict, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const YT_UPLOAD = 'https://www.googleapis.com/auth/youtube.upload';
const FB_VIDEO = 'pages_manage_posts';
const IG_PUBLISH = 'instagram_business_content_publish';

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
             d.content_form as "contentForm", d.scheduled_at as "scheduledAt",
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
    if (a.platform === 'tiktok') reason = 'TikTok direct posting needs an approved video.publish permission. It is not available.';
    else if (!a.connectionId || a.connectionState === 'PAUSED' || a.connectionState === 'DISABLED')
      reason = 'Connect this account in Integrations first.';
    else if (a.platform === 'instagram') {
      canPublish = scopes.includes(IG_PUBLISH);
      reason = canPublish ? '' : 'Instagram publish permission is missing. Reconnect and allow content publishing.';
    } else if (a.platform === 'youtube') {
      canPublish = scopes.includes(YT_UPLOAD);
      reason = canPublish ? '' : 'YouTube uploads need an extra permission. Integrations → Enable uploads.';
    } else if (a.platform === 'facebook') {
      canPublish = scopes.includes(FB_VIDEO);
      reason = canPublish ? '' : 'Page video posting needs pages_manage_posts. Integrations → Enable Page videos.';
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
  privacy?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE' | 'SCHEDULED' | null;
  contentForm?: 'VIDEO' | 'SHORT' | null;
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

  const values = {
    title: input.title?.trim() || null,
    caption: input.caption?.trim() || null,
    hashtags: (input.hashtags ?? []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean).slice(0, 30),
    privacy: input.privacy ?? null,
    contentForm: input.contentForm ?? null,
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
    hashtags: (input.hashtags ?? []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean).slice(0, 30),
    privacy: (input.privacy ?? 'PUBLIC') as 'PUBLIC',
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
    const values = {
      ...text,
      contentForm: input.contentForm ?? null,
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
    } else return fail('FAILED', 'Publishing is not available for this platform.');

    const publishedFields = {
      provider: account.platform as 'youtube',
      externalPostId: result.externalId,
      canonicalUrl: result.url,
      title: claimed.title?.trim() || claimed.caption?.trim().split('\n')[0]?.slice(0, 300) || null,
      caption: claimed.caption,
      hashtags: claimed.hashtags ?? [],
      privacy: (claimed.privacy as 'PUBLIC') || 'PUBLIC',
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
      .set({ uploadState: 'PUBLISHED', publicationId: rec!.id, error: null, updatedAt: new Date() })
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
