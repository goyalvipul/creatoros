import { organizations, eq, sql } from '@creatoros/db';
import { addVersion, createAsset } from './assets';
import { createBrand, createChannel, createSocialAccount } from './catalog';
import { convertOpportunityToDeal, addDeliverable, createInvoice, issueInvoice, manualIntake } from './crm';
import { createAction } from './actions';
import { createGoal } from './insights';
import { convertIdea, createIdea, createProject, setSceneStatus, upsertScenes } from './projects';
import { createRecord, createVariant, markPublishedManual, recordMetrics, setTarget } from './publishing';
import { conflict, type Ctx } from './types';
import { audit } from './audit';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const DAY = 86400_000;

interface DemoRegistry {
  brandIds: string[];
  channelIds: string[];
  accountIds: string[];
  goalIds: string[];
  createdAt: string;
}

async function registry(ctx: Ctx): Promise<DemoRegistry | null> {
  const [o] = await ctx.db.select({ s: organizations.settings }).from(organizations).where(eq(organizations.id, ctx.orgId));
  return ((o?.s ?? {}) as any).demo ?? null;
}

export async function demoStatus(ctx: Ctx) {
  const reg = await registry(ctx);
  return { seeded: !!reg, createdAt: reg?.createdAt ?? null };
}

/**
 * Seeds clearly labelled DEMO records (never mixed with real data, never fake file inventory or fake platform metrics
 * presented as verified). Everything is flagged so `clearDemo` can remove exactly what was created.
 */
export async function seedDemo(ctx: Ctx) {
  if (await registry(ctx)) throw conflict('Demo data is already loaded. Clear it first.', undefined, 'DEMO_EXISTS');
  return ctx.db.transaction(async (tx) => {
    const c: Ctx = { ...ctx, db: tx };
    const now = ctx.now();
    const brand = await createBrand(c, { name: 'DEMO Studio', description: 'Sample brand created by the demo loader', contentPillars: ['music', 'travel'] });
    const channel = await createChannel(c, { brandId: brand.id, name: 'DEMO Music Channel', purpose: 'Sample channel' });
    const yt = await createSocialAccount(c, { channelId: channel.id, platform: 'youtube', handle: '@demo_music', profileUrl: 'https://www.youtube.com/@demo_music' });
    const ig = await createSocialAccount(c, { channelId: channel.id, platform: 'instagram', handle: '@demo_music', profileUrl: 'https://www.instagram.com/demo_music' });

    // ---- ideas & projects
    const idea1 = await createIdea(c, { title: 'DEMO Idea: acoustic rooftop session', brandId: brand.id, channelId: channel.id, format: 'PERFORMANCE_REEL', pitch: 'Sample idea', origin: 'demo' });
    await createIdea(c, { title: 'DEMO Idea: three-city travel diary', brandId: brand.id, format: 'TRAVEL_VLOG', origin: 'demo' });
    await createIdea(c, { title: 'DEMO Idea: songwriting process short', brandId: brand.id, format: 'SHORTS', origin: 'demo' });
    const conv = await convertIdea(c, idea1.id, { type: 'SHORT_FORM' });
    const projB = (conv as any).project ?? conv;

    const projA = await createProject(c, { title: 'DEMO Lyric video: Midnight Train', type: 'MUSIC_VIDEO', contentFormat: 'LYRIC_VIDEO', brandId: brand.id, channelId: channel.id, dueAt: new Date(now.getTime() + 6 * DAY), brief: 'Sample project with scenes' });
    await upsertScenes(c, projA.id, [1, 2, 3, 4].map((n) => ({ ordinal: n, title: `DEMO scene ${n}`, narration: `Sample line ${n}`, shotPrompt: `Sample prompt ${n}` })));
    const scenes = rowsOf<{ id: string; ordinal: number }>(await tx.execute(sql`select id, ordinal from production_scenes where project_id = ${projA.id} order by ordinal`));
    await setSceneStatus(c, scenes[0]!.id, 'SELECTED');
    await setSceneStatus(c, scenes[1]!.id, 'SELECTED');
    await setSceneStatus(c, scenes[2]!.id, 'SUCCEEDED');

    // ---- assets, versions, variants, publications
    const asset = await createAsset(c, { title: 'DEMO Midnight Train (lyric video)', kind: 'VIDEO', brandId: brand.id, projectId: projA.id });
    await addVersion(c, asset.id, { label: 'DEMO final export', variantType: 'LONG_FORM', intendedUse: 'YouTube' });
    const variant = await createVariant(c, { assetId: asset.id, titleMaster: 'DEMO Midnight Train - Lyric Video', type: 'LONG_FORM' } as any);
    await setTarget(c, variant.id, yt.id, true);
    await setTarget(c, variant.id, ig.id, false, 'Not suitable for Instagram');
    await createRecord(c, { socialAccountId: yt.id, variantId: variant.id, title: 'DEMO Midnight Train', plannedAt: new Date(now.getTime() + 2 * DAY), state: 'PLANNED' });
    const published = await createRecord(c, { socialAccountId: yt.id, title: 'DEMO Earlier upload (entered by hand)', plannedAt: new Date(now.getTime() - 5 * DAY), state: 'PLANNED' });
    // honest provenance: manual entries are USER_ENTERED and can never be VERIFIED
    const manual = await markPublishedManual(c, published.record.id, { url: 'https://www.youtube.com/watch?v=DEMOvideo01', publishedAt: new Date(now.getTime() - 5 * DAY), evidence: 'DEMO' });
    await recordMetrics(c, manual.id, { views: 1200, likes: 90, comments: 12 });

    // ---- collaboration: inquiry -> deal -> deliverable -> invoice
    const intake = await manualIntake(c, { brand: 'DEMO Brand Co', contactName: 'Demo Contact', contactEmail: 'demo.contact@example.invalid', subject: 'DEMO Collaboration: 1 reel + 1 story', notes: 'Sample inquiry. Budget 1500 CAD.', offerType: 'FLAT_FEE', valueMinor: 150000, currency: 'CAD' });
    const { deal } = await convertOpportunityToDeal(c, intake.opportunity.id, { stage: 'IN_PRODUCTION', contractedValueMinor: 150000, currency: 'CAD', paymentTermsDays: 30 });
    await addDeliverable(c, deal.id, { title: 'DEMO Instagram reel', dueAt: new Date(now.getTime() + 4 * DAY) } as any);
    const inv = await createInvoice(c, { dealId: deal.id, amountMinor: 150000, currency: 'CAD', draft: true });
    await issueInvoice(c, inv.id, new Date(now.getTime() + 10 * DAY));

    await createAction(c, { title: 'DEMO Review the lyric video export', priority: 'HIGH', dueAt: new Date(now.getTime() + DAY), sourceType: 'project', sourceId: projA.id });
    const goal = await createGoal(c, { name: 'DEMO Publish 4 videos this month', period: 'MONTH', metric: 'VIDEOS_PUBLISHED', targetValue: 4 });

    const reg: DemoRegistry = { brandIds: [brand.id], channelIds: [channel.id], accountIds: [yt.id, ig.id], goalIds: [goal.id], createdAt: now.toISOString() };
    await tx.execute(sql`update organizations set settings = jsonb_set(settings, '{demo}', ${JSON.stringify(reg)}::jsonb) where id = ${ctx.orgId}`);

    // flag exactly the rows this loader made (titles are all prefixed DEMO, so real rows can never be matched)
    const o = ctx.orgId;
    await tx.execute(sql`update ideas set is_demo = true where org_id = ${o} and title like 'DEMO%'`);
    await tx.execute(sql`update creative_projects set is_demo = true where org_id = ${o} and (title like 'DEMO%' or source_idea_id in (select id from ideas where org_id = ${o} and is_demo))`);
    await tx.execute(sql`update logical_assets set is_demo = true where org_id = ${o} and title like 'DEMO%'`);
    await tx.execute(sql`update publication_records set is_demo = true where org_id = ${o} and social_account_id = any(${sql.raw(`ARRAY['${yt.id}','${ig.id}']::uuid[]`)})`);
    await tx.execute(sql`update conversation_threads set is_demo = true where org_id = ${o} and subject like 'DEMO%'`);
    await tx.execute(sql`update opportunities set is_demo = true where org_id = ${o} and title like 'DEMO%'`);
    await tx.execute(sql`update deals set is_demo = true where org_id = ${o} and title like 'DEMO%'`);
    await tx.execute(sql`update invoices set is_demo = true where org_id = ${o} and deal_id in (select id from deals where org_id = ${o} and is_demo)`);
    await tx.execute(sql`update internal_actions set is_demo = true where org_id = ${o} and title like 'DEMO%'`);
    await audit(c, 'demo.seed', { type: 'organization', id: o });
    void projB;
    return { brandId: brand.id, projectId: projA.id, dealId: deal.id, assetId: asset.id };
  });
}

/** FK-aware delete: removes rows plus everything that references them through NO ACTION / RESTRICT keys (SET NULL / CASCADE are left to Postgres). */
async function deleteWithDependents(tx: Ctx['db'], table: string, ids: string[], seen = new Set<string>()): Promise<void> {
  if (!ids.length) return;
  const key = `${table}:${ids.join(',')}`;
  if (seen.has(key)) return;
  seen.add(key);
  const fks = rowsOf<{ child: string; col: string }>(
    await tx.execute(sql`
      select c.conrelid::regclass::text as child, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = ${table}::regclass and array_length(c.conkey, 1) = 1 and c.confdeltype in ('a', 'r')`),
  );
  const idArr = sql`${sql.raw(`ARRAY[${ids.map((i) => `'${i.replace(/[^0-9a-f-]/gi, '')}'`).join(',')}]::uuid[]`)}`;
  for (const fk of fks) {
    if (fk.child === table) continue;
    const children = rowsOf<{ id: string }>(await tx.execute(sql`select id from ${sql.raw(fk.child)} where ${sql.raw(`"${fk.col}"`)} = any(${idArr})`));
    await deleteWithDependents(tx, fk.child.replace(/"/g, ''), children.map((x) => x.id), seen);
  }
  await tx.execute(sql`delete from ${sql.raw(table)} where id = any(${idArr})`);
}

/** Removes only what the demo loader created. Real brands, files, publications, deals and so on are never touched. */
export async function clearDemo(ctx: Ctx) {
  const reg = await registry(ctx);
  if (!reg) return { cleared: false };
  await ctx.db.transaction(async (tx) => {
    const o = ctx.orgId;
    const ids = async (q: ReturnType<typeof sql>) => rowsOf<{ id: string }>(await tx.execute(q)).map((r) => r.id);
    const threadIds = await ids(sql`select id from conversation_threads where org_id = ${o} and is_demo`);
    const dealIds = await ids(sql`select id from deals where org_id = ${o} and is_demo`);
    const projectIds = await ids(sql`select id from creative_projects where org_id = ${o} and is_demo`);
    const invoiceIds = await ids(sql`select id from invoices where org_id = ${o} and is_demo`);
    const pubIds = await ids(sql`select id from publication_records where org_id = ${o} and is_demo`);
    const sourceIds = [...threadIds, ...dealIds, ...projectIds, ...invoiceIds, ...pubIds];
    if (sourceIds.length) {
      const arr = sql.raw(`ARRAY[${sourceIds.map((i) => `'${i}'`).join(',')}]::uuid[]`);
      await tx.execute(sql`delete from internal_actions where org_id = ${o} and source_id = any(${arr})`);
      await tx.execute(sql`delete from notifications where org_id = ${o} and source_id = any(${arr})`);
    }
    const order: [string, string][] = [
      ['invoices', 'invoice'],
      ['deals', 'deal'],
      ['opportunities', 'opp'],
      ['conversation_threads', 'thread'],
      ['publication_records', 'pub'],
      ['logical_assets', 'asset'],
      ['creative_projects', 'project'],
      ['ideas', 'idea'],
      ['internal_actions', 'action'],
    ];
    for (const [table] of order) await deleteWithDependents(tx, table, await ids(sql`select id from ${sql.raw(table)} where org_id = ${o} and is_demo`));
    // organisations / contacts created for the demo inquiry
    const ext = await ids(sql`select id from external_organizations where org_id = ${o} and name like 'DEMO%'`);
    if (ext.length) {
      await deleteWithDependents(tx, 'contacts', await ids(sql`select id from contacts where org_id = ${o} and external_org_id = any(${sql.raw(`ARRAY[${ext.map((i) => `'${i}'`).join(',')}]::uuid[]`)})`));
      await deleteWithDependents(tx, 'external_organizations', ext);
    }
    await deleteWithDependents(tx, 'goals', reg.goalIds);
    await deleteWithDependents(tx, 'social_accounts', reg.accountIds);
    await deleteWithDependents(tx, 'channels', reg.channelIds);
    await deleteWithDependents(tx, 'brands', reg.brandIds);
    await tx.execute(sql`update organizations set settings = settings - 'demo' where id = ${o}`);
    await audit({ ...ctx, db: tx }, 'demo.clear', { type: 'organization', id: o });
  });
  return { cleared: true };
}
