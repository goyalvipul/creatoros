import { sql } from '@creatoros/db';
import { buildPublicProjection, classifyMetric, ruleRecommendations, type PublicKit } from '@creatoros/domain';
import { createAction } from './actions';
import { badRequest, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

export interface MediaKitInput {
  slug?: string;
  artistName?: string;
  positioning?: string;
  bio?: string;
  photos?: { url: string; alt: string }[];
  showFollowers?: boolean;
  showTopContent?: boolean;
  collaborations?: { name: string; note: string }[];
  contactEmail?: string | null;
}

async function kitRow(ctx: Ctx) {
  return rowsOf<{ id: string; slug: string; draft: MediaKitInput; published: PublicKit | null; publishedAt: string | null }>(
    await ctx.db.execute(sql`
      select id, slug, draft, published, published_at as "publishedAt"
      from media_kits where org_id = ${ctx.orgId}`),
  )[0];
}

async function projection(ctx: Ctx, input: MediaKitInput): Promise<PublicKit> {
  const brand = rowsOf<{ name: string }>(
    await ctx.db.execute(sql`select name from brands where org_id = ${ctx.orgId} and deleted_at is null order by created_at limit 1`),
  )[0];
  const accounts = rowsOf<{
    platform: string;
    handle: string;
    url: string | null;
    value: number | null;
    state: string | null;
    endpoint: string | null;
    collectedAt: string | null;
  }>(
    await ctx.db.execute(sql`
      select a.platform::text as platform, a.handle, a.profile_url as url,
             s.value, s.state, s.endpoint, s.collected_at as "collectedAt"
      from social_accounts a
      left join lateral (
        select value, state, endpoint, collected_at from account_metric_snapshots
        where social_account_id = a.id and metric = 'followers'
        order by collected_at desc limit 1
      ) s on true
      where a.org_id = ${ctx.orgId} and a.deleted_at is null`),
  );
  const top = rowsOf<{ title: string | null; platform: string; url: string | null; views: number; provenance: string }>(
    await ctx.db.execute(sql`
      select r.title, sa.platform::text as platform, r.canonical_url as url,
             (m.views)::float8 as views, m.provenance::text as provenance
      from publication_metrics_snapshots m
      join publication_records r on r.id = m.publication_id
      join social_accounts sa on sa.id = r.social_account_id
      where m.org_id = ${ctx.orgId} and m.provenance = 'VERIFIED_PLATFORM' and m.views is not null
      order by m.views desc limit 6`),
  );
  return buildPublicProjection({
    artistName: (input.artistName || brand?.name || 'Artist').slice(0, 120),
    positioning: (input.positioning ?? '').slice(0, 280),
    bio: (input.bio ?? '').slice(0, 4000),
    photos: input.photos ?? [],
    showFollowers: input.showFollowers === true,
    showTopContent: input.showTopContent === true,
    platforms: accounts.map((a) => ({
      platform: a.platform,
      handle: a.handle,
      url: a.url,
      followers: a.state === 'ZERO' || a.state === 'VALUE' ? classifyMetric(a.value, true) : classifyMetric(null, false),
      source: a.endpoint,
      updatedAt: a.collectedAt,
    })),
    topContent: top,
    collaborations: input.collaborations ?? [],
    contactEmail: input.contactEmail ?? null,
    periodLabel: 'Latest verified sync',
    updatedAt: new Date().toISOString(),
  });
}

export async function getMediaKit(ctx: Ctx) {
  const row = await kitRow(ctx);
  if (!row) return { slug: 'mehak', draft: null, published: false };
  return { id: row.id, slug: row.slug, draft: row.draft, published: Boolean(row.publishedAt), publishedAt: row.publishedAt };
}

export async function saveMediaKit(ctx: Ctx, input: MediaKitInput) {
  const slug = (input.slug || 'mehak').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'mehak';
  const draft = await projection(ctx, input);
  const copy = { ...input, slug };
  const existing = await kitRow(ctx);
  if (!existing) {
    await ctx.db.execute(sql`
      insert into media_kits (org_id, slug, draft) values (${ctx.orgId}, ${slug}, ${JSON.stringify(copy)}::jsonb)`);
  } else {
    await ctx.db.execute(sql`
      update media_kits set slug = ${slug}, draft = ${JSON.stringify(copy)}::jsonb, updated_at = now()
      where org_id = ${ctx.orgId}`);
  }
  return { slug, preview: draft };
}

export async function setMediaKitPublished(ctx: Ctx, published: boolean) {
  const row = await kitRow(ctx);
  if (!row) throw notFound('Media kit');
  if (!published) {
    await ctx.db.execute(sql`update media_kits set published = null, published_at = null, updated_at = now() where id = ${row.id}`);
    return { published: false };
  }
  const preview = await projection(ctx, row.draft ?? {});
  await ctx.db.execute(sql`
    update media_kits set published = ${JSON.stringify(preview)}::jsonb, published_at = now(), updated_at = now()
    where id = ${row.id}`);
  return { published: true, preview };
}

export async function publicMediaKit(db: Ctx['db'], slug: string): Promise<PublicKit | null> {
  const row = rowsOf<{ published: PublicKit }>(
    await db.execute(sql`select published from media_kits where slug = ${slug} and published_at is not null`),
  )[0];
  return row?.published ?? null;
}

export async function addMediaKitInquiry(
  base: Pick<Ctx, 'db' | 'env' | 'now'>,
  slug: string,
  input: { name: string; email: string; message: string },
) {
  if (!input.name.trim() || !input.email.includes('@') || input.message.trim().length < 8)
    throw badRequest('Name, a real email, and a short message are required');
  const row = rowsOf<{ id: string; orgId: string }>(
    await base.db.execute(sql`select id, org_id as "orgId" from media_kits where slug = ${slug} and published_at is not null`),
  )[0];
  if (!row) throw notFound('Media kit');
  await base.db.execute(sql`
    insert into media_kit_inquiries (org_id, kit_id, name, email, message)
    values (${row.orgId}, ${row.id}, ${input.name.slice(0, 120)}, ${input.email.slice(0, 200)}, ${input.message.slice(0, 4000)})`);
  await createAction(
    { db: base.db, env: base.env, now: base.now, orgId: row.orgId, userId: null, actor: { type: 'system' } },
    {
      title: `Media kit inquiry from ${input.name.slice(0, 80)}`,
      description: input.message.slice(0, 500),
      sourceType: 'media_kit',
      sourceId: row.id,
    },
  );
  return { ok: true };
}

export async function listRecommendations(ctx: Ctx) {
  return rowsOf(
    await ctx.db.execute(sql`
      select id, algorithm, body, created_at as "createdAt"
      from analytics_recommendations where org_id = ${ctx.orgId}
      order by created_at desc limit 20`),
  );
}

export async function generateRecommendations(ctx: Ctx) {
  const posts = rowsOf<{ id: string; title: string | null; platform: string; views: number | null; publishedAt: string | null }>(
    await ctx.db.execute(sql`
      select r.id, r.title, sa.platform::text as platform,
             coalesce((m.views)::float8, (r.latest_stats->>'views')::float8) as views,
             r.published_at as "publishedAt"
      from publication_records r
      join social_accounts sa on sa.id = r.social_account_id
      left join lateral (
        select views from publication_metrics_snapshots where publication_id = r.id order by snapshot_at desc limit 1
      ) m on true
      where r.org_id = ${ctx.orgId} and r.state in ('PUBLISHED_VERIFIED','PUBLISHED_MANUAL')
        and r.published_at > now() - interval '90 days'`),
  );
  const period = { from: new Date(Date.now() - 90 * 86400_000).toISOString(), to: ctx.now().toISOString() };
  const body = ruleRecommendations(posts, period, ctx.now());
  const ai = await optionalModel(ctx, body);
  const algorithm = ai ? 'model' : 'rules';
  const stored = (ai ?? body) as { title?: string }[];
  if (stored.length === 0) return { algorithm, recommendations: [] };
  for (const rec of stored) {
    await ctx.db.execute(sql`
      insert into analytics_recommendations (org_id, algorithm, body)
      values (${ctx.orgId}, ${algorithm}, ${JSON.stringify(rec)}::jsonb)`);
  }
  return { algorithm, recommendations: stored, note: ai ? undefined : 'No analytics model is configured. These notes are calculated from stored view counts.' };
}

async function optionalModel(ctx: Ctx, evidence: unknown): Promise<unknown[] | null> {
  const base = ctx.env.processEnv.ANALYTICS_AI_BASE_URL;
  const key = ctx.env.processEnv.ANALYTICS_AI_API_KEY;
  if (!base || !key) return null;
  const res = await fetch(base, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: ctx.env.processEnv.ANALYTICS_AI_MODEL || 'default',
      messages: [
        {
          role: 'system',
          content:
            'Use only the JSON evidence. Separate observation from hypothesis. Do not invent metrics. Return a JSON array of recommendations with observed, hypothesis, action, metric, uncertainty. Set proven to false.',
        },
        { role: 'user', content: JSON.stringify(evidence) },
      ],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { recommendations?: unknown[] };
  return Array.isArray(json.recommendations) ? json.recommendations : null;
}

export async function startExperiment(ctx: Ctx, recommendationId: string) {
  const row = rowsOf<{ body: { title?: string; action?: string; metric?: string; reviewOn?: string; evidence?: { views: number }[] } }>(
    await ctx.db.execute(sql`select body from analytics_recommendations where id = ${recommendationId} and org_id = ${ctx.orgId}`),
  )[0];
  if (!row) throw notFound('Recommendation');
  const rec = row.body;
  if (!rec?.action && !rec?.title) throw badRequest('That recommendation has no action');
  const action = await createAction(ctx, {
    title: rec.title || 'Analytics experiment',
    description: rec.action,
    dueAt: rec.reviewOn ? new Date(rec.reviewOn) : null,
    sourceType: 'analytics_recommendation',
    sourceId: recommendationId,
  });
  const baseline = rec.evidence?.[0]?.views ?? null;
  const [exp] = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`
      insert into content_experiments (org_id, recommendation_id, action_id, metric, baseline, review_on)
      values (${ctx.orgId}, ${recommendationId}, ${action.id}, ${rec.metric ?? 'views'}, ${baseline}, ${rec.reviewOn ?? null}::date)
      returning id`),
  );
  return { experimentId: exp!.id, actionId: action.id };
}
