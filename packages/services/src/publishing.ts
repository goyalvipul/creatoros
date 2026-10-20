import {
  and,
  asc,
  assetMatchSuggestions,
  distributionVariants,
  eq,
  logicalAssets,
  publicationMetricsSnapshots,
  publicationRecords,
  publicationStatusEvents,
  publicationTargets,
  publishingSchedules,
  socialAccounts,
  sql,
  type Executor,
} from '@creatoros/db';
import {
  PUBLISHED_STATES,
  isPublished,
  localDay,
  manualStateFor,
  parseLocalDateTime,
  parsePostUrl,
  validatePublication,
  type Platform,
  type PublicationState,
} from '@creatoros/domain';
import { audit, emit } from './audit';
import { badRequest, conflict, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
type Variant = typeof distributionVariants.$inferInsert;

async function orgTimezone(db: Executor, orgId: string): Promise<string> {
  const r = rowsOf<{ timezone: string }>(
    await db.execute(sql`select timezone from organizations where id = ${orgId}`),
  );
  return r[0]?.timezone ?? 'America/Vancouver';
}

async function requireAccount(db: Executor, orgId: string, id: string) {
  const [a] = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.id, id), eq(socialAccounts.orgId, orgId)));
  if (!a) throw notFound('Social account');
  return a;
}

// ----------------------------------------------------------------- variants

export async function createVariant(
  ctx: Ctx,
  input: Partial<Variant> & { assetId: string; titleMaster: string },
) {
  const [a] = await ctx.db
    .select({ id: logicalAssets.id })
    .from(logicalAssets)
    .where(and(eq(logicalAssets.id, input.assetId), eq(logicalAssets.orgId, ctx.orgId)));
  if (!a) throw notFound('Asset');
  const [v] = await ctx.db
    .insert(distributionVariants)
    .values({ ...input, id: undefined, orgId: ctx.orgId, titleMaster: input.titleMaster.trim() })
    .returning();
  await audit(ctx, 'variant.create', { type: 'variant', id: v!.id });
  return v!;
}

export async function updateVariant(ctx: Ctx, id: string, patch: Partial<Variant>) {
  const { id: _i, orgId: _o, assetId: _a, ...safe } = patch as any;
  const [v] = await ctx.db
    .update(distributionVariants)
    .set({ ...safe, updatedAt: new Date() })
    .where(and(eq(distributionVariants.id, id), eq(distributionVariants.orgId, ctx.orgId)))
    .returning();
  if (!v) throw notFound('Variant');
  return v;
}

/** Removes a plan row. The file stays. A post that already went out stays, no longer tied to this title. */
export async function deleteVariant(ctx: Ctx, id: string) {
  const [v] = await ctx.db
    .delete(distributionVariants)
    .where(and(eq(distributionVariants.id, id), eq(distributionVariants.orgId, ctx.orgId)))
    .returning({ id: distributionVariants.id });
  if (!v) throw notFound('Variant');
  await audit(ctx, 'variant.delete', { type: 'variant', id });
  return { id, removed: true };
}

export async function listVariants(
  ctx: Ctx,
  q: { assetId?: string; readiness?: string; projectId?: string } = {},
) {
  const where = [sql`v.org_id = ${ctx.orgId}`];
  if (q.assetId) where.push(sql`v.asset_id = ${q.assetId}`);
  if (q.readiness) where.push(sql`v.readiness = ${q.readiness}`);
  if (q.projectId) where.push(sql`v.project_id = ${q.projectId}`);
  return rowsOf<any>(
    await ctx.db.execute(
      sql`select v.*, a.title as "assetTitle" from distribution_variants v join logical_assets a on a.id = v.asset_id where ${sql.join(where, sql` and `)} order by v.created_at desc limit 500`,
    ),
  );
}

/** Owner declares per account whether a variant should go there. desired=false is an explicit "not applicable". */
export async function setTarget(
  ctx: Ctx,
  variantId: string,
  socialAccountId: string,
  desired: boolean,
  notes?: string | null,
) {
  const [v] = await ctx.db
    .select({ id: distributionVariants.id })
    .from(distributionVariants)
    .where(and(eq(distributionVariants.id, variantId), eq(distributionVariants.orgId, ctx.orgId)));
  if (!v) throw notFound('Variant');
  await requireAccount(ctx.db, ctx.orgId, socialAccountId);
  const [t] = await ctx.db
    .insert(publicationTargets)
    .values({
      orgId: ctx.orgId,
      variantId,
      socialAccountId,
      desired,
      desiredAt: desired ? new Date() : null,
      notes: notes ?? null,
    })
    .onConflictDoUpdate({
      target: [publicationTargets.variantId, publicationTargets.socialAccountId],
      set: { desired, desiredAt: desired ? new Date() : null, notes: notes ?? null, updatedAt: new Date() },
    })
    .returning();
  return t!;
}

/** Variants x accounts grid. Each cell is the record state, an explicit N/A, or NOT_PLANNED; nothing is inferred as published. */
export async function publishingMatrix(ctx: Ctx, q: { assetId?: string; brandId?: string; projectId?: string } = {}) {
  const accWhere = [sql`sa.org_id = ${ctx.orgId}`, sql`sa.deleted_at is null`, sql`sa.active`];
  if (q.brandId) accWhere.push(sql`c.brand_id = ${q.brandId}`);
  const accounts = rowsOf<any>(
    await ctx.db.execute(
      sql`select sa.id, sa.platform, sa.handle, c.name as "channelName", c.brand_id as "brandId" from social_accounts sa join channels c on c.id = sa.channel_id where ${sql.join(accWhere, sql` and `)} order by sa.platform, sa.handle`,
    ),
  );
  const vWhere = [sql`v.org_id = ${ctx.orgId}`];
  if (q.assetId) vWhere.push(sql`v.asset_id = ${q.assetId}`);
  if (q.projectId) vWhere.push(sql`v.project_id = ${q.projectId}`);
  if (q.brandId)
    vWhere.push(sql`(
      v.brand_id = ${q.brandId}
      or (v.brand_id is null and a.brand_id = ${q.brandId})
      or (v.brand_id is null and exists (
        select 1 from creative_projects p where p.id = v.project_id and p.brand_id = ${q.brandId}
      ))
    )`);
  const variants = rowsOf<any>(
    await ctx.db.execute(
      sql`select v.id, v.title_master as title, v.format, v.readiness, v.asset_id as "assetId", a.title as "assetTitle" from distribution_variants v join logical_assets a on a.id = v.asset_id where ${sql.join(vWhere, sql` and `)} order by v.created_at desc limit 300`,
    ),
  );
  const ids = variants.map((v) => v.id);
  const cells = new Map<string, any>();
  if (ids.length) {
    const idList = sql.join(
      ids.map((i) => sql`${i}::uuid`),
      sql`, `,
    );
    for (const t of rowsOf<any>(
      await ctx.db.execute(
        sql`select variant_id as "variantId", social_account_id as "accountId", desired from publication_targets where variant_id in (${idList})`,
      ),
    ))
      cells.set(`${t.variantId}:${t.accountId}`, {
        state: t.desired ? 'NOT_PLANNED' : 'NOT_APPLICABLE',
        recordId: null,
      });
    for (const r of rowsOf<any>(
      await ctx.db.execute(
        sql`select id, variant_id as "variantId", social_account_id as "accountId", state, state_provenance as provenance, canonical_url as url, published_at as "publishedAt", planned_at as "plannedAt" from publication_records where variant_id in (${idList}) and state <> 'REMOVED' order by created_at`,
      ),
    ))
      cells.set(`${r.variantId}:${r.accountId}`, {
        state: r.state,
        provenance: r.provenance,
        recordId: r.id,
        url: r.url,
        publishedAt: r.publishedAt,
        plannedAt: r.plannedAt,
      });
  }
  const attached = new Map<string, number>();
  const published = new Map<string, number>();
  if (ids.length) {
    const idList = sql.join(
      ids.map((i) => sql`${i}::uuid`),
      sql`, `,
    );
    for (const r of rowsOf<{ variantId: string; n: number }>(
      await ctx.db.execute(
        sql`select variant_id as "variantId", count(*)::int as n from publish_items where variant_id in (${idList}) group by variant_id`,
      ),
    ))
      attached.set(r.variantId, r.n);
    for (const r of rowsOf<{ variantId: string; accountId: string; n: number }>(
      await ctx.db.execute(
        sql`select variant_id as "variantId", social_account_id as "accountId", count(*)::int as n
            from publication_records
            where variant_id in (${idList}) and file_instance_id is not null and state in ('PUBLISHED_VERIFIED','PUBLISHED_MANUAL')
            group by variant_id, social_account_id`,
      ),
    ))
      published.set(`${r.variantId}:${r.accountId}`, r.n);
  }
  return {
    accounts,
    rows: variants.map((v) => ({
      ...v,
      attached: attached.get(v.id) ?? 0,
      cells: accounts.map((a) => ({
        accountId: a.id,
        ...(cells.get(`${v.id}:${a.id}`) ?? { state: 'NOT_PLANNED', recordId: null }),
        published: published.get(`${v.id}:${a.id}`) ?? 0,
      })),
    })),
  };
}

// ------------------------------------------------------------------ records

export interface RecordInput {
  socialAccountId: string;
  variantId?: string | null;
  assetVersionId?: string | null;
  title?: string | null;
  caption?: string | null;
  hashtags?: string[];
  privacy?: (typeof publicationRecords.$inferInsert)['privacy'];
  language?: string | null;
  cta?: string | null;
  isSponsored?: boolean;
  sponsorDisclosure?: boolean;
  deliverableId?: string | null;
  plannedLocal?: string; // YYYY-MM-DDTHH:mm wall clock
  plannedAt?: Date | string | null;
  plannedTimezone?: string;
  state?: PublicationState;
  approvalRequired?: boolean;
  force?: boolean;
}

async function event(
  tx: Executor,
  ctx: Ctx,
  publicationId: string,
  name: string,
  from: PublicationState | null,
  to: PublicationState | null,
  source: string,
  provenance: 'VERIFIED_PLATFORM' | 'USER_ENTERED' | 'ESTIMATED' | 'UNKNOWN',
  evidence?: string | null,
) {
  await tx.insert(publicationStatusEvents).values({
    orgId: ctx.orgId,
    publicationId,
    event: name,
    fromState: from,
    toState: to,
    source,
    provenance,
    evidence: evidence ?? null,
    actorUserId: source === 'user' ? ctx.userId : null,
  });
}

export async function createRecord(ctx: Ctx, input: RecordInput) {
  const acc = await requireAccount(ctx.db, ctx.orgId, input.socialAccountId);
  const tz = input.plannedTimezone ?? (await orgTimezone(ctx.db, ctx.orgId));
  const plannedAt = input.plannedLocal
    ? parseLocalDateTime(input.plannedLocal, tz)
    : input.plannedAt
      ? new Date(input.plannedAt)
      : null;
  const check = validatePublication({
    platform: acc.platform as Platform,
    title: input.title,
    caption: input.caption,
    hashtags: input.hashtags,
    sponsored: input.isSponsored,
    disclosure: input.sponsorDisclosure,
  });
  if (check.errors.length && !input.force)
    throw badRequest('Publication has problems', { errors: check.errors, warnings: check.warnings });
  const requested = input.state ?? (plannedAt ? 'PLANNED' : 'NOT_PLANNED');
  const state = manualStateFor(requested);
  if (isPublished(state))
    throw badRequest('Use the "mark published" action with evidence for published records');
  return ctx.db.transaction(async (tx) => {
    const [r] = await tx
      .insert(publicationRecords)
      .values({
        orgId: ctx.orgId,
        socialAccountId: acc.id,
        variantId: input.variantId ?? null,
        assetVersionId: input.assetVersionId ?? null,
        provider: 'manual',
        title: input.title ?? null,
        caption: input.caption ?? null,
        hashtags: input.hashtags ?? [],
        privacy: input.privacy ?? 'PUBLIC',
        language: input.language ?? null,
        cta: input.cta ?? null,
        isSponsored: input.isSponsored ?? false,
        sponsorDisclosure: input.sponsorDisclosure ?? false,
        deliverableId: input.deliverableId ?? null,
        state,
        stateProvenance: 'USER_ENTERED',
        plannedAt,
        plannedTimezone: tz,
        approvalRequired: input.approvalRequired ?? false,
        createdBy: ctx.userId,
      })
      .returning();
    if (input.variantId)
      await tx
        .insert(publicationTargets)
        .values({
          orgId: ctx.orgId,
          variantId: input.variantId,
          socialAccountId: acc.id,
          desired: true,
          desiredAt: new Date(),
        })
        .onConflictDoNothing();
    if (plannedAt)
      await tx
        .insert(publishingSchedules)
        .values({ orgId: ctx.orgId, publicationId: r!.id, plannedAt, timezone: tz });
    await event(tx, ctx, r!.id, 'created', null, state, 'user', 'USER_ENTERED');
    await audit({ ...ctx, db: tx }, 'publication.create', { type: 'publication', id: r!.id });
    return { record: r!, warnings: check.warnings, errors: check.errors };
  });
}

export async function getRecord(ctx: Ctx, id: string) {
  const [r] = await ctx.db
    .select()
    .from(publicationRecords)
    .where(and(eq(publicationRecords.id, id), eq(publicationRecords.orgId, ctx.orgId)));
  if (!r) throw notFound('Publication');
  const events = await ctx.db
    .select()
    .from(publicationStatusEvents)
    .where(eq(publicationStatusEvents.publicationId, id))
    .orderBy(asc(publicationStatusEvents.at));
  const metrics = await ctx.db
    .select()
    .from(publicationMetricsSnapshots)
    .where(eq(publicationMetricsSnapshots.publicationId, id))
    .orderBy(asc(publicationMetricsSnapshots.snapshotAt));
  return { ...r, events, metrics };
}

const MANUAL_TRANSITIONS: Partial<Record<PublicationState, PublicationState[]>> = {
  NOT_PLANNED: ['PLANNED', 'READY', 'SCHEDULED'],
  PLANNED: ['NOT_PLANNED', 'READY', 'SCHEDULED', 'FAILED', 'REMOVED'],
  READY: ['PLANNED', 'SCHEDULED', 'FAILED', 'REMOVED'],
  SCHEDULED: ['PLANNED', 'READY', 'FAILED', 'REMOVED'],
  SUBMITTED: ['FAILED', 'UNKNOWN'],
  PROCESSING: ['FAILED', 'UNKNOWN'],
  FAILED: ['PLANNED', 'READY', 'SCHEDULED', 'REMOVED'],
  UNKNOWN: ['PLANNED', 'READY', 'REMOVED', 'FAILED'],
  PUBLISHED_MANUAL: ['REMOVED', 'UNKNOWN'],
  PUBLISHED_VERIFIED: ['REMOVED'],
  REMOVED: ['PLANNED'],
};

export async function transitionRecord(
  ctx: Ctx,
  id: string,
  to: PublicationState,
  evidence?: string | null,
  failureReason?: string | null,
) {
  if (isPublished(to) && to !== 'PUBLISHED_MANUAL')
    throw badRequest('Verified publication states can only come from a platform connector or import');
  if (to === 'PUBLISHED_MANUAL')
    throw badRequest('Use the "mark published" action so a URL or evidence is recorded');
  return ctx.db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(publicationRecords)
      .where(and(eq(publicationRecords.id, id), eq(publicationRecords.orgId, ctx.orgId)));
    if (!r) throw notFound('Publication');
    const allowed = MANUAL_TRANSITIONS[r.state as PublicationState] ?? [];
    if (!allowed.includes(to))
      throw conflict(`Cannot move a ${r.state} publication to ${to}.`, { allowed }, 'INVALID_TRANSITION');
    const [after] = await tx
      .update(publicationRecords)
      .set({
        state: to,
        stateProvenance: 'USER_ENTERED',
        stateEvidence: evidence ?? null,
        failureReason: to === 'FAILED' ? (failureReason ?? evidence ?? 'marked failed by owner') : null,
        updatedAt: new Date(),
      })
      .where(eq(publicationRecords.id, id))
      .returning();
    await event(
      tx,
      ctx,
      id,
      'state_changed',
      r.state as PublicationState,
      to,
      'user',
      'USER_ENTERED',
      evidence,
    );
    await emit(tx, ctx.orgId, 'publication.status.updated', { publicationId: id, from: r.state, to });
    return after!;
  });
}

/**
 * Owner confirms they published it themselves. Never VERIFIED: that label is reserved for platform evidence.
 * A pasted URL is parsed (syntax only; nothing is fetched) and must belong to the account's platform.
 */
export async function markPublishedManual(
  ctx: Ctx,
  id: string,
  input: {
    url?: string | null;
    publishedLocal?: string;
    publishedAt?: Date | string;
    evidence?: string | null;
  },
) {
  return ctx.db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(publicationRecords)
      .where(and(eq(publicationRecords.id, id), eq(publicationRecords.orgId, ctx.orgId)));
    if (!r) throw notFound('Publication');
    if (r.state === 'PUBLISHED_VERIFIED') throw conflict('Already verified published by the platform.');
    const acc = await requireAccount(tx, ctx.orgId, r.socialAccountId);
    let externalId: string | null = null;
    let url: string | null = null;
    if (input.url?.trim()) {
      const p = parsePostUrl(input.url);
      if (!p) throw badRequest('That does not look like a valid URL');
      if (p.platform !== 'other' && p.platform !== acc.platform)
        throw badRequest(`URL is for ${p.platform} but the account is ${acc.platform}`);
      externalId = p.externalId;
      url = p.canonicalUrl;
    }
    const tz = r.plannedTimezone;
    const publishedAt = input.publishedLocal
      ? parseLocalDateTime(input.publishedLocal, tz)
      : input.publishedAt
        ? new Date(input.publishedAt)
        : new Date();
    if (externalId) {
      const dup = await tx
        .select({ id: publicationRecords.id })
        .from(publicationRecords)
        .where(
          and(
            eq(publicationRecords.orgId, ctx.orgId),
            eq(publicationRecords.socialAccountId, r.socialAccountId),
            eq(publicationRecords.externalPostId, externalId),
            sql`${publicationRecords.id} <> ${id}`,
          ),
        );
      if (dup.length)
        throw conflict(
          'Another publication already records this post.',
          { existingId: dup[0]!.id },
          'DUPLICATE_PUBLICATION',
        );
    }
    const [after] = await tx
      .update(publicationRecords)
      .set({
        state: 'PUBLISHED_MANUAL',
        stateProvenance: 'USER_ENTERED',
        stateEvidence: input.evidence ?? (url ? `owner pasted URL ${url}` : 'owner confirmed'),
        publishedAt,
        canonicalUrl: url ?? r.canonicalUrl,
        externalPostId: externalId ?? r.externalPostId,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(publicationRecords.id, id))
      .returning();
    await event(
      tx,
      ctx,
      id,
      'marked_published_manual',
      r.state as PublicationState,
      'PUBLISHED_MANUAL',
      'user',
      'USER_ENTERED',
      input.evidence ?? url,
    );
    await emit(tx, ctx.orgId, 'publication.status.updated', {
      publicationId: id,
      from: r.state,
      to: 'PUBLISHED_MANUAL',
    });
    return after!;
  });
}

/** Record something already live (paste a URL). Creates a PUBLISHED_MANUAL record straight away. */
export async function recordExistingPost(
  ctx: Ctx,
  input: {
    socialAccountId: string;
    url: string;
    title?: string | null;
    publishedLocal?: string;
    variantId?: string | null;
  },
) {
  const created = await createRecord(ctx, {
    socialAccountId: input.socialAccountId,
    title: input.title,
    variantId: input.variantId,
    state: 'PLANNED',
    force: true,
  });
  return markPublishedManual(ctx, created.record.id, {
    url: input.url,
    publishedLocal: input.publishedLocal,
    evidence: 'owner pasted URL',
  });
}

export async function reschedule(ctx: Ctx, id: string, plannedLocal: string, timezone?: string) {
  return ctx.db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(publicationRecords)
      .where(and(eq(publicationRecords.id, id), eq(publicationRecords.orgId, ctx.orgId)));
    if (!r) throw notFound('Publication');
    if (isPublished(r.state as PublicationState)) throw conflict('Already published; nothing to reschedule.');
    const tz = timezone ?? r.plannedTimezone;
    const plannedAt = parseLocalDateTime(plannedLocal, tz);
    const [after] = await tx
      .update(publicationRecords)
      .set({
        plannedAt,
        plannedTimezone: tz,
        state: r.state === 'NOT_PLANNED' ? 'PLANNED' : r.state,
        updatedAt: new Date(),
      })
      .where(eq(publicationRecords.id, id))
      .returning();
    await tx
      .update(publishingSchedules)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(and(eq(publishingSchedules.publicationId, id), eq(publishingSchedules.status, 'PENDING')));
    await tx
      .insert(publishingSchedules)
      .values({ orgId: ctx.orgId, publicationId: id, plannedAt, timezone: tz });
    await event(
      tx,
      ctx,
      id,
      'rescheduled',
      r.state as PublicationState,
      after!.state as PublicationState,
      'user',
      'USER_ENTERED',
      `${plannedLocal} ${tz}`,
    );
    return after!;
  });
}

/** Calendar items grouped by the owner's local day (DST safe because plannedAt is stored as a UTC instant + zone name). */
export async function calendar(ctx: Ctx, from: Date, to: Date, tz?: string) {
  const zone = tz ?? (await orgTimezone(ctx.db, ctx.orgId));
  const rows = rowsOf<any>(
    await ctx.db.execute(sql`
      select r.id, r.title, r.state, r.state_provenance as provenance, r.planned_at as "plannedAt", r.published_at as "publishedAt", r.canonical_url as url,
             sa.platform, sa.handle, r.variant_id as "variantId", r.privacy
      from publication_records r join social_accounts sa on sa.id = r.social_account_id
      where r.org_id = ${ctx.orgId} and r.state <> 'REMOVED'
        and coalesce(r.published_at, r.planned_at) >= ${from.toISOString()}::timestamptz and coalesce(r.published_at, r.planned_at) < ${to.toISOString()}::timestamptz
      order by coalesce(r.published_at, r.planned_at)`),
  );
  const days: Record<string, any[]> = {};
  for (const r of rows) {
    const at = r.publishedAt ?? r.plannedAt;
    (days[localDay(at, zone)] ??= []).push(r);
  }
  return { timezone: zone, items: rows, days };
}

export async function recordMetrics(
  ctx: Ctx,
  publicationId: string,
  m: {
    views?: number;
    watchTimeSeconds?: number;
    impressions?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
    followersGained?: number;
    avgViewPct?: number;
    snapshotAt?: Date;
  },
  provenance: 'VERIFIED_PLATFORM' | 'USER_ENTERED' | 'ESTIMATED' | 'UNKNOWN' = 'USER_ENTERED',
) {
  const [r] = await ctx.db
    .select()
    .from(publicationRecords)
    .where(and(eq(publicationRecords.id, publicationId), eq(publicationRecords.orgId, ctx.orgId)));
  if (!r) throw notFound('Publication');
  const snapshotAt = m.snapshotAt ?? new Date();
  const { snapshotAt: _s, ...vals } = m;
  const [s] = await ctx.db
    .insert(publicationMetricsSnapshots)
    .values({ orgId: ctx.orgId, publicationId, snapshotAt, provenance, ...vals })
    .onConflictDoUpdate({
      target: [publicationMetricsSnapshots.publicationId, publicationMetricsSnapshots.snapshotAt],
      set: { ...vals, provenance },
    })
    .returning();
  await ctx.db
    .update(publicationRecords)
    .set({ latestStats: { ...vals, provenance, at: snapshotAt.toISOString() }, updatedAt: new Date() })
    .where(eq(publicationRecords.id, publicationId));
  return s!;
}

// ------------------------------------------------------------------- import

export interface ImportedPost {
  externalPostId: string;
  url: string;
  title?: string | null;
  caption?: string | null;
  publishedAt?: Date | string | null;
  privacy?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE' | 'SCHEDULED';
  stats?: Record<string, number>;
  providerMeta?: Record<string, unknown>;
}

/**
 * Connector import (YouTube uploads, Meta media...). Idempotent per (account, externalPostId). Platform evidence upgrades an earlier
 * manual record for the same post to VERIFIED instead of creating a duplicate. Unlinked posts are flagged for the owner, never auto-linked.
 */
export async function importPublications(
  ctx: Ctx,
  socialAccountId: string,
  provider: (typeof publicationRecords.$inferInsert)['provider'],
  posts: ImportedPost[],
) {
  const acc = await requireAccount(ctx.db, ctx.orgId, socialAccountId);
  let created = 0;
  let updated = 0;
  for (const p of posts) {
    await ctx.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(publicationRecords)
        .where(
          and(
            eq(publicationRecords.orgId, ctx.orgId),
            eq(publicationRecords.socialAccountId, acc.id),
            eq(publicationRecords.externalPostId, p.externalPostId),
          ),
        );
      const publishedAt = p.publishedAt ? new Date(p.publishedAt) : null;
      const verified = (publishedAt ?? new Date()) <= new Date() && p.privacy !== 'SCHEDULED';
      const state: PublicationState = verified ? 'PUBLISHED_VERIFIED' : 'SCHEDULED';
      if (existing) {
        const upgrade = existing.state !== state && existing.state !== 'REMOVED';
        await tx
          .update(publicationRecords)
          .set({
            state: upgrade ? state : existing.state,
            stateProvenance: upgrade ? 'VERIFIED_PLATFORM' : existing.stateProvenance,
            stateEvidence: upgrade ? `confirmed by ${provider} API` : existing.stateEvidence,
            canonicalUrl: p.url,
            title: existing.title ?? p.title ?? null,
            publishedAt: publishedAt ?? existing.publishedAt,
            lastSyncedAt: new Date(),
            providerMeta: p.providerMeta ?? existing.providerMeta,
            updatedAt: new Date(),
          })
          .where(eq(publicationRecords.id, existing.id));
        if (upgrade)
          await event(
            tx,
            ctx,
            existing.id,
            'verified_by_platform',
            existing.state as PublicationState,
            state,
            'platform_api',
            'VERIFIED_PLATFORM',
            p.url,
          );
        updated += 1;
        return;
      }
      // a manual record for the same URL (no external id yet) is upgraded instead of duplicated
      const [manual] = await tx
        .select()
        .from(publicationRecords)
        .where(
          and(
            eq(publicationRecords.orgId, ctx.orgId),
            eq(publicationRecords.socialAccountId, acc.id),
            eq(publicationRecords.canonicalUrl, p.url),
            sql`${publicationRecords.externalPostId} is null`,
          ),
        );
      if (manual) {
        await tx
          .update(publicationRecords)
          .set({
            externalPostId: p.externalPostId,
            state,
            stateProvenance: 'VERIFIED_PLATFORM',
            stateEvidence: `confirmed by ${provider} API`,
            publishedAt: publishedAt ?? manual.publishedAt,
            lastSyncedAt: new Date(),
            provider,
            updatedAt: new Date(),
          })
          .where(eq(publicationRecords.id, manual.id));
        await event(
          tx,
          ctx,
          manual.id,
          'verified_by_platform',
          manual.state as PublicationState,
          state,
          'platform_api',
          'VERIFIED_PLATFORM',
          p.url,
        );
        updated += 1;
        return;
      }
      const [r] = await tx
        .insert(publicationRecords)
        .values({
          orgId: ctx.orgId,
          socialAccountId: acc.id,
          provider,
          externalPostId: p.externalPostId,
          canonicalUrl: p.url,
          title: p.title ?? null,
          caption: p.caption ?? null,
          privacy: p.privacy ?? 'PUBLIC',
          state,
          stateProvenance: 'VERIFIED_PLATFORM',
          stateEvidence: `imported from ${provider} API`,
          publishedAt,
          lastSyncedAt: new Date(),
          unmatchedImport: true,
          providerMeta: p.providerMeta ?? {},
          latestStats: p.stats ?? {},
        })
        .returning();
      await event(tx, ctx, r!.id, 'imported', null, state, 'platform_api', 'VERIFIED_PLATFORM', p.url);
      await emit(tx, ctx.orgId, 'publication.discovered', {
        publicationId: r!.id,
        platform: acc.platform,
        url: p.url,
      });
      if (p.title) {
        const cands = rowsOf<{ id: string; sim: number }>(
          await tx.execute(
            sql`select id, similarity(title, ${p.title})::float8 as sim from logical_assets where org_id = ${ctx.orgId} and is_archived = false and similarity(title, ${p.title}) >= 0.45 order by sim desc limit 3`,
          ),
        );
        for (const c of cands)
          await tx
            .insert(assetMatchSuggestions)
            .values({
              orgId: ctx.orgId,
              sourceType: 'publication',
              sourceId: r!.id,
              candidateAssetId: c.id,
              reasons: [`title similar to "${p.title}"`],
              confidence: Math.min(0.9, c.sim),
            })
            .onConflictDoNothing();
      }
      created += 1;
    });
  }
  return { created, updated };
}

export async function listUnmatchedPublications(ctx: Ctx) {
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select r.id, r.title, r.canonical_url as url, r.published_at as "publishedAt", sa.platform, sa.handle,
        (select coalesce(jsonb_agg(jsonb_build_object('assetId', s.candidate_asset_id, 'title', a.title, 'confidence', s.confidence, 'reasons', s.reasons) order by s.confidence desc), '[]'::jsonb)
         from asset_match_suggestions s join logical_assets a on a.id = s.candidate_asset_id where s.source_type = 'publication' and s.source_id = r.id and s.outcome = 'PENDING') as suggestions
      from publication_records r join social_accounts sa on sa.id = r.social_account_id
      where r.org_id = ${ctx.orgId} and r.unmatched_import and r.variant_id is null and r.state <> 'REMOVED' order by r.published_at desc nulls last limit 200`),
  );
}

/** Owner links an imported post to a variant (confirms the suggestion). */
export async function linkPublicationToVariant(ctx: Ctx, publicationId: string, variantId: string) {
  const [v] = await ctx.db
    .select()
    .from(distributionVariants)
    .where(and(eq(distributionVariants.id, variantId), eq(distributionVariants.orgId, ctx.orgId)));
  if (!v) throw notFound('Variant');
  const [r] = await ctx.db
    .update(publicationRecords)
    .set({ variantId, assetVersionId: v.assetVersionId, unmatchedImport: false, updatedAt: new Date() })
    .where(and(eq(publicationRecords.id, publicationId), eq(publicationRecords.orgId, ctx.orgId)))
    .returning();
  if (!r) throw notFound('Publication');
  await ctx.db
    .insert(publicationTargets)
    .values({
      orgId: ctx.orgId,
      variantId,
      socialAccountId: r.socialAccountId,
      desired: true,
      desiredAt: new Date(),
    })
    .onConflictDoNothing();
  await ctx.db
    .update(assetMatchSuggestions)
    .set({ outcome: 'ACCEPTED', reviewedBy: ctx.userId, reviewedAt: new Date() })
    .where(
      and(
        eq(assetMatchSuggestions.sourceType, 'publication'),
        eq(assetMatchSuggestions.sourceId, publicationId),
        eq(assetMatchSuggestions.candidateAssetId, v.assetId),
      ),
    );
  await audit(ctx, 'publication.link', { type: 'publication', id: publicationId }, undefined, { variantId });
  return r;
}

export const PUBLISHED_STATE_LIST = PUBLISHED_STATES;
