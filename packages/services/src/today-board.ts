import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from '@creatoros/db';
import { addDays, capacityStatus, focusRemaining, localDate, localMorning, pauseFocus, type FocusClock } from '@creatoros/domain';
import { briefing } from './actions';
import { badRequest, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const MINUTES = [15, 25, 50] as const;

function requireUser(ctx: Ctx) {
  if (!ctx.userId) throw badRequest('Sign in before planning the day.');
  return ctx.userId;
}

async function zone(ctx: Ctx) {
  const row = rowsOf<{ timezone: string }>(
    await ctx.db.execute(sql`select timezone from organizations where id = ${ctx.orgId}`),
  )[0];
  return row?.timezone || 'America/Vancouver';
}

async function ensurePlan(ctx: Ctx, day: string) {
  const userId = requireUser(ctx);
  const existing = rowsOf<{ id: string; capacityMinutes: number }>(
    await ctx.db.execute(sql`
      select id, capacity_minutes as "capacityMinutes"
      from daily_plans where org_id = ${ctx.orgId} and user_id = ${userId} and local_date = ${day}`),
  )[0];
  if (existing) return existing;
  const created = rowsOf<{ id: string; capacityMinutes: number }>(
    await ctx.db.execute(sql`
      insert into daily_plans (org_id, user_id, local_date)
      values (${ctx.orgId}, ${userId}, ${day})
      on conflict (org_id, user_id, local_date) do update set updated_at = now()
      returning id, capacity_minutes as "capacityMinutes"`),
  )[0];
  return created!;
}

export async function getTodayBoard(ctx: Ctx, now = new Date(), brandId?: string) {
  const userId = requireUser(ctx);
  const tz = await zone(ctx);
  const day = localDate(now, tz);
  const plan = await ensurePlan(ctx, day);
  const brief = await briefing(ctx, now);
  const outcomes = rowsOf<{
    id: string;
    actionId: string;
    title: string;
    state: string;
    priority: string;
    dueAt: string | null;
    deepLink: string | null;
    effortMinutes: number | null;
    nextAction: string | null;
    blockAt: string | null;
  }>(
    await ctx.db.execute(sql`
      select i.id, i.action_id as "actionId", a.title, a.state, a.priority,
             a.due_at as "dueAt", a.deep_link as "deepLink",
             i.effort_minutes as "effortMinutes", i.next_action as "nextAction", i.block_at as "blockAt"
      from daily_plan_items i
      join internal_actions a on a.id = i.action_id and a.org_id = i.org_id
      where i.plan_id = ${plan.id}
      order by i.ordinal, i.created_at`),
  );
  const queue = rowsOf<{
    id: string;
    title: string;
    state: string;
    priority: string;
    dueAt: string | null;
    deepLink: string | null;
    reason: string | null;
  }>(
    await ctx.db.execute(sql`
      select id, title, state, priority, due_at as "dueAt", deep_link as "deepLink", reason
      from internal_actions
      where org_id = ${ctx.orgId} and state in ('OPEN','SNOOZED','DONE')
        and (snoozed_until is null or snoozed_until <= now() or state <> 'OPEN')
      order by case state when 'OPEN' then 0 when 'SNOOZED' then 1 else 2 end,
               case priority when 'URGENT' then 0 when 'HIGH' then 1 when 'NORMAL' then 2 else 3 end,
               due_at nulls last
      limit 40`),
  );
  const decisions = rowsOf<{ id: string; title: string; detail: string | null; href: string }>(
    await ctx.db.execute(sql`
      select id, title, coalesce(reason, description) as detail, coalesce(deep_link, '/today?action=' || id) as href
      from internal_actions
      where org_id = ${ctx.orgId} and state = 'OPEN' and priority in ('URGENT','HIGH')
        and (snoozed_until is null or snoozed_until <= now())
      order by case priority when 'URGENT' then 0 else 1 end, due_at nulls last
      limit 5`),
  );
  const failedPosts = rowsOf<{ id: string; title: string; detail: string | null }>(
    await ctx.db.execute(sql`
      select r.id::text as id, coalesce(r.title, 'A scheduled post failed') as title, r.failure_reason as detail
      from publication_records r
      where r.org_id = ${ctx.orgId} and r.state = 'FAILED' and r.updated_at > now() - interval '7 days'
      ${brandId ? publicationBrand(brandId) : sql``}
      order by r.updated_at desc limit 3`),
  );
  const expired = rowsOf<{ id: string; provider: string }>(
    await ctx.db.execute(sql`
      select id::text as id, provider from provider_connections
      where org_id = ${ctx.orgId} and state = 'AUTH_EXPIRED'
      limit 3`),
  );
  const projects = rowsOf<{
    id: string;
    title: string;
    stage: string;
    type: string;
    updatedAt: string;
    tags: string[] | null;
    scenes: number;
    done: number;
  }>(
    await ctx.db.execute(sql`
      select p.id, p.title, p.stage, p.type, p.updated_at as "updatedAt", p.tags,
             (select count(*)::int from production_scenes s where s.project_id = p.id) as scenes,
             (select count(*)::int from production_scenes s where s.project_id = p.id and s.status = 'SELECTED') as done
      from creative_projects p
      where p.org_id = ${ctx.orgId} and p.deleted_at is null and p.stage not in ('ARCHIVED')
      ${brandId ? sql`and p.brand_id = ${brandId}` : sql``}
      order by p.updated_at desc limit 8`),
  );
  const posts = rowsOf<{ id: string; title: string | null; state: string; plannedAt: string | null; provider: string; handle: string | null }>(
    await ctx.db.execute(sql`
      select r.id, r.title, r.state, r.planned_at as "plannedAt", r.provider::text as provider, a.handle
      from publication_records r
      left join social_accounts a on a.id = r.social_account_id
      where r.org_id = ${ctx.orgId} and r.state in ('PLANNED','READY','SCHEDULED','FAILED')
      ${brandId ? publicationBrand(brandId) : sql``}
      order by r.planned_at nulls last
      limit 5`),
  );
  const invoices = rowsOf<{ id: string; invoiceNo: string; currency: string; amountMinor: string; dueAt: string | null }>(
    await ctx.db.execute(sql`
      select id, invoice_no as "invoiceNo", currency, amount_minor::text as "amountMinor", due_at as "dueAt"
      from invoices
      where org_id = ${ctx.orgId} and status = 'OVERDUE'
      ${brandId ? sql`and (
        invoices.deal_id is null
        or exists (select 1 from deals d where d.id = invoices.deal_id and (d.brand_id = ${brandId} or d.brand_id is null))
      )` : sql``}
      order by due_at nulls last
      limit 3`),
  );
  const leads = rowsOf<{ id: string; subject: string | null }>(
    await ctx.db.execute(sql`
      select distinct t.id, t.subject
      from conversation_threads t
      join messages m on m.thread_id = t.id
      join inbound_classifications c on c.message_id = m.id
      where t.org_id = ${ctx.orgId} and t.triage_state = 'POSSIBLE' and t.opportunity_id is null and c.category = 'COLLABORATION'
      ${brandId ? sql`and (t.brand_id = ${brandId} or t.brand_id is null)` : sql``}
      limit 3`),
  );
  const machines = rowsOf<{ name: string; state: string; seenAt: string | null; kind: string }>(
    await ctx.db.execute(sql`
      select display_name as name, state::text as state, last_seen_at as "seenAt", 'agent' as kind
      from devices where org_id = ${ctx.orgId} and revoked_at is null
      union all
      select label as name,
             case when last_ok is true then 'ONLINE' when last_ok is false then 'OFFLINE' else 'UNKNOWN' end,
             last_checked_at as "seenAt",
             'comfy' as kind
      from gpu_workers where org_id = ${ctx.orgId} and enabled`),
  );
  const metrics = rowsOf<{ platform: string; metric: string; value: string | null; collectedAt: string }>(
    await ctx.db.execute(sql`
      select distinct on (platform, metric) platform, metric, value::text as value, collected_at as "collectedAt"
      from account_metric_snapshots
      where org_id = ${ctx.orgId} and value is not null
      ${brandId ? sql`and social_account_id in (
        select sa.id from social_accounts sa
        join channels c on c.id = sa.channel_id
        where c.brand_id = ${brandId} and sa.org_id = ${ctx.orgId}
      )` : sql``}
      order by platform, metric, collected_at desc`),
  );
  const focus = rowsOf<FocusClock & { id: string; actionId: string | null; actionTitle: string | null; resumeNote: string | null }>(
    await ctx.db.execute(sql`
      select s.id, s.state, s.duration_ms as "durationMs", s.accumulated_ms as "accumulatedMs",
             s.started_at as "startedAt", s.resume_note as "resumeNote", s.action_id as "actionId", a.title as "actionTitle"
      from focus_sessions s
      left join internal_actions a on a.id = s.action_id
      where s.org_id = ${ctx.orgId} and s.user_id = ${userId} and s.state in ('running','paused')
      limit 1`),
  )[0] ?? null;
  const review = rowsOf<{ notes: string; checks: Record<string, boolean> }>(
    await ctx.db.execute(sql`
      select notes, checks from daily_reviews
      where org_id = ${ctx.orgId} and user_id = ${userId} and local_date = ${day}`),
  )[0] ?? { notes: '', checks: {} };
  const cover = brandId
    ? rowsOf<{ coverPath: string | null }>(
        await ctx.db.execute(sql`
          select cover_path as "coverPath" from brands
          where id = ${brandId} and org_id = ${ctx.orgId} and deleted_at is null`),
      )[0]
    : rowsOf<{ coverPath: string | null }>(
        await ctx.db.execute(sql`select cover_path as "coverPath" from organizations where id = ${ctx.orgId}`),
      )[0];
  if (brandId) {
    const start = localMorning(day, tz, 0);
    const end = localMorning(addDays(day, 1), tz, 0);
    const scheduled = rowsOf<{ n: number }>(
      await ctx.db.execute(sql`
        select count(*)::int as n
        from publication_records r
        where r.org_id = ${ctx.orgId} and r.state <> 'REMOVED'
          and r.planned_at >= ${start.toISOString()}::timestamptz
          and r.planned_at < ${end.toISOString()}::timestamptz
          and r.state in ('PLANNED','READY','SCHEDULED')
          ${publicationBrand(brandId)}`),
    )[0]?.n ?? 0;
    brief.counts.scheduledToday = scheduled;
  }
  const backup = rowsOf<{ state: string; finishedAt: string | null }>(
    await ctx.db.execute(sql`
      select state, finished_at as "finishedAt" from backup_runs
      order by started_at desc limit 1`),
  )[0];
  const offlineDevices = rowsOf<{ n: number }>(
    await ctx.db.execute(sql`select count(*)::int as n from devices where org_id = ${ctx.orgId} and state = 'OFFLINE' and revoked_at is null`),
  )[0]?.n ?? 0;
  const workersDown = rowsOf<{ n: number }>(
    await ctx.db.execute(sql`select count(*)::int as n from gpu_workers where org_id = ${ctx.orgId} and enabled and last_ok is false`),
  )[0]?.n ?? 0;
  const plannedMinutes = outcomes.filter((item) => item.state !== 'DONE').reduce((sum, item) => sum + (item.effortMinutes ?? 25), 0);
  const capacity = capacityStatus(plan.capacityMinutes, plannedMinutes);
  const blocks = outcomes
    .filter((item) => item.blockAt)
    .map((item) => ({ at: item.blockAt, title: item.title, minutes: item.effortMinutes ?? 25 }));
  return {
    generatedAt: now.toISOString(),
    timezone: tz,
    today: day,
    counts: brief.counts,
    outcomes,
    overPlan: outcomes.filter((item) => item.state !== 'DONE').length > 3,
    capacity,
    blocks,
    calendarConnected: false,
    decisions: [
      ...decisions,
      ...failedPosts.map((row) => ({ id: row.id, title: row.title, detail: row.detail, href: '/publishing' })),
      ...expired.map((row) => ({
        id: row.id,
        title: `${row.provider} needs reconnecting`,
        detail: 'The saved login expired.',
        href: '/integrations',
      })),
    ],
    projects,
    posts,
    invoices,
    leads,
    machines,
    metrics,
    queue,
    focus: focus
      ? { ...focus, remainingMs: focusRemaining(focus, now.getTime()) }
      : null,
    review,
    health: {
      backup: backup ? { state: backup.state, finishedAt: backup.finishedAt } : null,
      offlineDevices,
      workersDown,
      authExpired: expired.length,
    },
    hasCover: Boolean(allowedCoverPath(cover?.coverPath ?? null, brandId, ctx.orgId)),
  };
}

export async function addPlanItem(ctx: Ctx, actionId: string) {
  const userId = requireUser(ctx);
  const day = localDate(ctx.now(), await zone(ctx));
  const plan = await ensurePlan(ctx, day);
  const action = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`select id from internal_actions where id = ${actionId} and org_id = ${ctx.orgId}`),
  )[0];
  if (!action) throw notFound('Action');
  await ctx.db.execute(sql`
    insert into daily_plan_items (org_id, plan_id, action_id, ordinal)
    values (${ctx.orgId}, ${plan.id}, ${actionId},
      (select coalesce(max(ordinal), 0) + 1 from daily_plan_items where plan_id = ${plan.id}))
    on conflict (plan_id, action_id) do nothing`);
  void userId;
  return getTodayBoard(ctx);
}

export async function removePlanItem(ctx: Ctx, actionId: string) {
  const day = localDate(ctx.now(), await zone(ctx));
  const plan = await ensurePlan(ctx, day);
  await ctx.db.execute(sql`delete from daily_plan_items where plan_id = ${plan.id} and action_id = ${actionId} and org_id = ${ctx.orgId}`);
  return getTodayBoard(ctx);
}

export async function updatePlanItem(
  ctx: Ctx,
  actionId: string,
  patch: { effortMinutes?: number | null; nextAction?: string | null; blockAt?: string | null },
) {
  const day = localDate(ctx.now(), await zone(ctx));
  const plan = await ensurePlan(ctx, day);
  if (patch.effortMinutes != null && (patch.effortMinutes < 5 || patch.effortMinutes > 480)) {
    throw badRequest('Effort has to be between 5 and 480 minutes.');
  }
  const sets = [sql`updated_at = now()`];
  if (patch.effortMinutes !== undefined) sets.push(sql`effort_minutes = ${patch.effortMinutes}`);
  if (patch.nextAction !== undefined) sets.push(sql`next_action = ${patch.nextAction}`);
  if (patch.blockAt !== undefined) sets.push(sql`block_at = ${patch.blockAt}::timestamptz`);
  await ctx.db.execute(sql`
    update daily_plan_items
    set ${sql.join(sets, sql`, `)}
    where plan_id = ${plan.id} and action_id = ${actionId} and org_id = ${ctx.orgId}`);
  return getTodayBoard(ctx);
}

export async function setCapacity(ctx: Ctx, minutes: number) {
  if (minutes < 30 || minutes > 720) throw badRequest('Capacity has to be between 30 and 720 minutes.');
  const day = localDate(ctx.now(), await zone(ctx));
  const plan = await ensurePlan(ctx, day);
  await ctx.db.execute(sql`update daily_plans set capacity_minutes = ${minutes}, updated_at = now() where id = ${plan.id}`);
  return getTodayBoard(ctx);
}

async function activeFocus(ctx: Ctx, userId: string) {
  return rowsOf<FocusClock & { id: string }>(
    await ctx.db.execute(sql`
      select id, state, duration_ms as "durationMs", accumulated_ms as "accumulatedMs", started_at as "startedAt"
      from focus_sessions
      where org_id = ${ctx.orgId} and user_id = ${userId} and state in ('running','paused')
      limit 1`),
  )[0];
}

export async function startFocus(ctx: Ctx, actionId: string, minutes: number) {
  const userId = requireUser(ctx);
  if (!MINUTES.includes(minutes as (typeof MINUTES)[number])) throw badRequest('Choose 15, 25, or 50 minutes.');
  const action = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`select id from internal_actions where id = ${actionId} and org_id = ${ctx.orgId}`),
  )[0];
  if (!action) throw notFound('Action');
  const now = ctx.now();
  const current = await activeFocus(ctx, userId);
  if (current) {
    await ctx.db.execute(sql`
      update focus_sessions set state = 'done', updated_at = now() where id = ${current.id}`);
  }
  await ctx.db.execute(sql`
    insert into focus_sessions (org_id, user_id, action_id, state, duration_ms, accumulated_ms, started_at)
    values (${ctx.orgId}, ${userId}, ${actionId}, 'running', ${minutes * 60_000}, 0, ${now.toISOString()}::timestamptz)`);
  return getTodayBoard(ctx, now);
}

export async function pauseFocusSession(ctx: Ctx) {
  const userId = requireUser(ctx);
  const now = ctx.now();
  const current = await activeFocus(ctx, userId);
  if (!current) throw notFound('Focus session');
  const next = pauseFocus(current, now.getTime());
  await ctx.db.execute(sql`
    update focus_sessions
    set state = 'paused', accumulated_ms = ${next.accumulatedMs}, started_at = null, updated_at = now()
    where id = ${current.id}`);
  return getTodayBoard(ctx, now);
}

export async function resumeFocusSession(ctx: Ctx) {
  const userId = requireUser(ctx);
  const now = ctx.now();
  const current = await activeFocus(ctx, userId);
  if (!current || current.state !== 'paused') throw badRequest('There is no paused session to resume.');
  await ctx.db.execute(sql`
    update focus_sessions set state = 'running', started_at = ${now.toISOString()}::timestamptz, updated_at = now()
    where id = ${current.id}`);
  return getTodayBoard(ctx, now);
}

export async function resetFocusSession(ctx: Ctx) {
  const userId = requireUser(ctx);
  await ctx.db.execute(sql`
    update focus_sessions set state = 'done', updated_at = now()
    where org_id = ${ctx.orgId} and user_id = ${userId} and state in ('running','paused')`);
  return getTodayBoard(ctx);
}

export async function saveFocusNote(ctx: Ctx, note: string) {
  const userId = requireUser(ctx);
  const current = await activeFocus(ctx, userId);
  if (!current) throw notFound('Focus session');
  await ctx.db.execute(sql`update focus_sessions set resume_note = ${note.slice(0, 2000)}, updated_at = now() where id = ${current.id}`);
  return getTodayBoard(ctx);
}

export async function saveReview(ctx: Ctx, notes: string, checks: Record<string, boolean>) {
  const userId = requireUser(ctx);
  const day = localDate(ctx.now(), await zone(ctx));
  await ctx.db.execute(sql`
    insert into daily_reviews (org_id, user_id, local_date, notes, checks)
    values (${ctx.orgId}, ${userId}, ${day}, ${notes.slice(0, 8000)}, ${JSON.stringify(checks)}::jsonb)
    on conflict (org_id, user_id, local_date)
    do update set notes = excluded.notes, checks = excluded.checks, updated_at = now()`);
  return getTodayBoard(ctx);
}

export async function carryForward(ctx: Ctx, actionIds: string[]) {
  const tz = await zone(ctx);
  const tomorrow = addDays(localDate(ctx.now(), tz), 1);
  const due = localMorning(tomorrow, tz, 9);
  for (const id of actionIds.slice(0, 20)) {
    await ctx.db.execute(sql`
      update internal_actions
      set due_at = ${due.toISOString()}::timestamptz, state = 'OPEN', snoozed_until = null, updated_at = now()
      where id = ${id} and org_id = ${ctx.orgId} and state <> 'DISMISSED'`);
  }
  return getTodayBoard(ctx);
}

function publicationBrand(brandId: string) {
  return sql`and (
    exists (
      select 1 from social_accounts sa
      join channels c on c.id = sa.channel_id
      where sa.id = r.social_account_id and c.brand_id = ${brandId}
    )
    or exists (
      select 1 from distribution_variants v
      left join creative_projects cp on cp.id = v.project_id
      where v.id = r.variant_id and (v.brand_id = ${brandId} or cp.brand_id = ${brandId})
    )
  )`;
}

const COVER_MAX_BYTES = 12_000_000;

function coverKind(bytes: Buffer): 'jpg' | 'png' | 'webp' | 'heic' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('ascii').toLowerCase();
    if (brand.startsWith('hei') || brand.startsWith('mif')) return 'heic';
  }
  return null;
}

function decodeCover(data: string) {
  const raw = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
  const bytes = Buffer.from(raw, 'base64');
  if (!bytes.length || bytes.length > COVER_MAX_BYTES) throw badRequest('The photo has to be under 12 MB.');
  const kind = coverKind(bytes);
  if (kind === 'heic') throw badRequest('This photo is HEIC. Export it as JPEG and upload that.');
  if (!kind) throw badRequest('Use a JPEG, PNG, or WebP photo.');
  return { bytes, kind };
}

function allowedCoverPath(path: string | null, brandId: string | undefined, orgId: string) {
  if (!path || path.includes('..') || !path.startsWith('covers/')) return null;
  if (brandId) {
    if (path.startsWith(`covers/b-${brandId}.`) || path.startsWith(`covers/${orgId}.`)) return path;
    return null;
  }
  return path.startsWith(`covers/${orgId}.`) ? path : null;
}

async function brandCoverPath(ctx: Ctx, brandId: string) {
  const row = rowsOf<{ coverPath: string | null }>(
    await ctx.db.execute(sql`
      select cover_path as "coverPath" from brands
      where id = ${brandId} and org_id = ${ctx.orgId} and deleted_at is null`),
  )[0];
  if (!row) throw notFound('Brand');
  return allowedCoverPath(row.coverPath, brandId, ctx.orgId);
}

export async function saveWorkspaceCover(ctx: Ctx, _mime: string, data: string, source?: string, brandId?: string) {
  const banner = decodeCover(data);
  const dir = join(ctx.env.mediaPreviewDir, 'covers');
  await mkdir(dir, { recursive: true });
  const stem = brandId ? `b-${brandId}` : ctx.orgId;
  if (brandId) await brandCoverPath(ctx, brandId);
  if (source) {
    const original = decodeCover(source);
    await writeFile(join(dir, `${stem}.source.${original.kind}`), original.bytes);
  }
  const rel = `covers/${stem}.${banner.kind}`;
  await writeFile(join(ctx.env.mediaPreviewDir, rel), banner.bytes);
  if (brandId) {
    await ctx.db.execute(sql`
      update brands set cover_path = ${rel}, updated_at = now()
      where id = ${brandId} and org_id = ${ctx.orgId} and deleted_at is null`);
  } else {
    await ctx.db.execute(sql`update organizations set cover_path = ${rel}, updated_at = now() where id = ${ctx.orgId}`);
  }
  return { hasCover: true };
}

export async function clearWorkspaceCover(ctx: Ctx, brandId?: string) {
  const dir = join(ctx.env.mediaPreviewDir, 'covers');
  if (brandId) {
    const current = await brandCoverPath(ctx, brandId);
    await ctx.db.execute(sql`
      update brands set cover_path = null, updated_at = now()
      where id = ${brandId} and org_id = ${ctx.orgId} and deleted_at is null`);
    if (current?.startsWith(`covers/b-${brandId}.`)) {
      for (const name of ['jpg', 'png', 'webp'].flatMap((ext) => [`b-${brandId}.${ext}`, `b-${brandId}.source.${ext}`])) {
        await rm(join(dir, name), { force: true });
      }
    }
    return { hasCover: false };
  }
  await ctx.db.execute(sql`update organizations set cover_path = null, updated_at = now() where id = ${ctx.orgId}`);
  for (const name of ['jpg', 'png', 'webp'].flatMap((ext) => [`${ctx.orgId}.${ext}`, `${ctx.orgId}.source.${ext}`])) {
    await rm(join(dir, name), { force: true });
  }
  return { hasCover: false };
}

async function readNamedCover(ctx: Ctx, stem: string) {
  const dir = join(ctx.env.mediaPreviewDir, 'covers');
  for (const ext of ['jpg', 'png', 'webp'] as const) {
    try {
      const bytes = await readFile(join(dir, `${stem}.source.${ext}`));
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return { mime, bytes };
    } catch {
      /* the original is optional */
    }
  }
  return null;
}

export async function readWorkspaceCoverSource(ctx: Ctx, brandId?: string) {
  const path = brandId
    ? await brandCoverPath(ctx, brandId)
    : allowedCoverPath(
        rowsOf<{ coverPath: string | null }>(
          await ctx.db.execute(sql`select cover_path as "coverPath" from organizations where id = ${ctx.orgId}`),
        )[0]?.coverPath ?? null,
        undefined,
        ctx.orgId,
      );
  if (brandId && path?.startsWith(`covers/b-${brandId}.`)) {
    return (await readNamedCover(ctx, `b-${brandId}`)) ?? readCoverFile(ctx, path);
  }
  return (await readNamedCover(ctx, ctx.orgId)) ?? (path ? readCoverFile(ctx, path) : null);
}

export async function readWorkspaceCover(ctx: Ctx, brandId?: string) {
  const path = brandId
    ? await brandCoverPath(ctx, brandId)
    : allowedCoverPath(
        rowsOf<{ coverPath: string | null }>(
          await ctx.db.execute(sql`select cover_path as "coverPath" from organizations where id = ${ctx.orgId}`),
        )[0]?.coverPath ?? null,
        undefined,
        ctx.orgId,
      );
  if (!path) return null;
  return readCoverFile(ctx, path);
}

async function readCoverFile(ctx: Ctx, path: string) {
  const ext = path.split('.').pop();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  try {
    const bytes = await readFile(join(ctx.env.mediaPreviewDir, path));
    return { mime, bytes };
  } catch {
    return null;
  }
}
