import { and, conversationThreads, eq, internalActions, opportunities, sql } from '@creatoros/db';
import { audit } from './audit';
import { triageThread } from './crm';
import { badRequest, notFound, type Ctx } from './types';
import { SOCIAL_SOURCES } from './social';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

async function loadThread(ctx: Ctx, id: string) {
  const [t] = await ctx.db
    .select()
    .from(conversationThreads)
    .where(and(eq(conversationThreads.id, id), eq(conversationThreads.orgId, ctx.orgId)));
  if (!t || !SOCIAL_SOURCES.includes(t.source as never)) throw notFound('Conversation');
  return t;
}

/**
 * CreatorOS-only organisation of a conversation. Nothing here is sent to Instagram or any other platform:
 * "archive" hides the conversation in CreatorOS only.
 */
export async function updateThreadLocal(
  ctx: Ctx,
  id: string,
  input: {
    starred?: boolean;
    archivedLocal?: boolean;
    labels?: string[];
    priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    internalNotes?: string | null;
  },
) {
  const t = await loadThread(ctx, id);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.starred !== undefined) set.starred = input.starred;
  if (input.archivedLocal !== undefined) set.archivedLocal = input.archivedLocal;
  if (input.labels)
    set.labels = [...new Set(input.labels.map((l) => l.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
  if (input.priority) set.priority = input.priority;
  if (input.internalNotes !== undefined) set.internalNotes = input.internalNotes?.slice(0, 4000) ?? null;
  await ctx.db.update(conversationThreads).set(set).where(eq(conversationThreads.id, id));
  await audit(
    ctx,
    'social.thread.local',
    { type: 'thread', id },
    undefined,
    Object.keys(set).filter((k) => k !== 'updatedAt'),
  );
  return { id: t.id, ...set, localOnly: true };
}

const deepLink = (id: string) => `/socials/inbox?thread=${id}`;

/** One open follow-up action per conversation: asking again moves its date instead of creating a second task. */
export async function followUpThread(
  ctx: Ctx,
  id: string,
  input: { preset: 'tomorrow' | 'next_week' | 'custom' | 'clear'; at?: Date },
) {
  const t = await loadThread(ctx, id);
  const dedupeKey = `social-followup:${id}`;
  if (input.preset === 'clear') {
    await ctx.db.update(conversationThreads).set({ followUpAt: null }).where(eq(conversationThreads.id, id));
    await ctx.db.execute(
      sql`update internal_actions set state = 'DONE', completed_at = now(), completion_evidence = 'Follow-up cleared' where org_id = ${ctx.orgId} and dedupe_key = ${dedupeKey} and state in ('OPEN','SNOOZED')`,
    );
    return { followUpAt: null };
  }
  const now = ctx.now();
  let due: Date;
  if (input.preset === 'custom') {
    if (!input.at || Number.isNaN(input.at.getTime()) || input.at.getTime() < now.getTime() - 60_000)
      throw badRequest('Choose a follow-up time in the future.');
    due = input.at;
  } else {
    due = new Date(now.getTime() + (input.preset === 'tomorrow' ? 1 : 7) * 86_400_000);
    due.setUTCHours(16, 0, 0, 0); // mid-morning in Vancouver; the exact time can be edited in Actions
  }
  await ctx.db.update(conversationThreads).set({ followUpAt: due }).where(eq(conversationThreads.id, id));
  const who = t.participantName ?? t.participantId ?? 'contact';
  const title = `Follow up with ${who} on ${t.source === 'INSTAGRAM' ? 'Instagram' : t.source}`;
  const existing = rowsOf<{ id: string }>(
    await ctx.db.execute(
      sql`update internal_actions set due_at = ${due.toISOString()}::timestamptz, updated_at = now() where org_id = ${ctx.orgId} and dedupe_key = ${dedupeKey} and state in ('OPEN','SNOOZED') returning id`,
    ),
  );
  if (!existing.length)
    await ctx.db
      .insert(internalActions)
      .values({
        orgId: ctx.orgId,
        sourceType: 'social_thread',
        sourceId: id,
        dedupeKey,
        title,
        reason: 'Follow-up you set in Socials',
        deepLink: deepLink(id),
        dueAt: due,
        ownerUserId: ctx.userId,
      })
      .onConflictDoNothing();
  await audit(ctx, 'social.thread.followup', { type: 'thread', id }, undefined, { due });
  return { followUpAt: due };
}

export async function createThreadTask(ctx: Ctx, id: string, input: { title?: string; dueAt?: Date | null }) {
  const t = await loadThread(ctx, id);
  const dedupeKey = `social-task:${id}`;
  const [open] = await ctx.db
    .select()
    .from(internalActions)
    .where(
      and(
        eq(internalActions.orgId, ctx.orgId),
        eq(internalActions.dedupeKey, dedupeKey),
        sql`${internalActions.state} in ('OPEN','SNOOZED')`,
      ),
    );
  if (open) return { ...open, alreadyExists: true };
  const [a] = await ctx.db
    .insert(internalActions)
    .values({
      orgId: ctx.orgId,
      sourceType: 'social_thread',
      sourceId: id,
      dedupeKey,
      title:
        input.title?.trim() ||
        `Handle ${t.participantName ?? t.participantId ?? 'conversation'} (${t.source})`,
      reason: 'Task created from Socials',
      deepLink: deepLink(id),
      dueAt: input.dueAt ?? null,
      ownerUserId: ctx.userId,
    })
    .returning();
  await audit(ctx, 'social.thread.task', { type: 'thread', id });
  return { ...a!, alreadyExists: false };
}

/** Confirms the conversation as a collaboration lead. Idempotent: the same conversation never creates a second record. */
export async function createThreadCollaboration(ctx: Ctx, id: string, input: { title?: string }) {
  await loadThread(ctx, id);
  const r = await triageThread(ctx, id, 'CONFIRMED', { title: input.title });
  const [opp] = await ctx.db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.sourceThreadId, id), eq(opportunities.orgId, ctx.orgId)));
  return {
    ...r,
    opportunityId: opp?.id ?? null,
    alreadyExisted: Boolean((r as { alreadyConfirmed?: boolean }).alreadyConfirmed),
  };
}

export interface OverviewQuery {
  connectionId?: string;
  days?: number;
}

/** Every number comes from synchronised rows. Unread counts are CreatorOS read state, not the platform's. */
export async function socialsOverview(ctx: Ctx, q: OverviewQuery = {}) {
  const days = Math.min(Math.max(q.days ?? 30, 1), 365);
  const conn = q.connectionId ? sql`and t.provider_connection_id = ${q.connectionId}::uuid` : sql``;
  const [r] = rowsOf<Record<string, number>>(
    await ctx.db.execute(sql`
      select
        count(*) filter (where t.kind = 'DM' and not t.archived_local)::int as "conversations",
        count(*) filter (where t.state = 'NEED_REPLY' and not t.archived_local and t.triage_state <> 'DISMISSED')::int as "needReply",
        count(*) filter (where t.kind = 'COMMENT' and t.state = 'NEED_REPLY' and not t.archived_local)::int as "commentsAwaiting",
        count(*) filter (where t.kind = 'COMMENT' and not t.archived_local)::int as "comments",
        count(*) filter (where t.opportunity_id is not null)::int as "leads",
        count(*) filter (where t.follow_up_at is not null and t.follow_up_at < now() and not t.archived_local)::int as "followUpsOverdue",
        count(*) filter (where t.follow_up_at is not null and t.follow_up_at >= now())::int as "followUpsPending",
        count(*) filter (where t.starred)::int as "starred",
        (select count(*)::int from messages m join conversation_threads t2 on t2.id = m.thread_id
          where t2.org_id = ${ctx.orgId} and t2.source in ('INSTAGRAM','FACEBOOK','TIKTOK') and m.direction = 'INBOUND' and not m.is_read
            ${q.connectionId ? sql`and t2.provider_connection_id = ${q.connectionId}::uuid` : sql``}) as "unreadMessages",
        (select count(*)::int from messages m join conversation_threads t3 on t3.id = m.thread_id
          where t3.org_id = ${ctx.orgId} and t3.source in ('INSTAGRAM','FACEBOOK','TIKTOK') and m.direction = 'INBOUND'
            and m.received_at > now() - make_interval(days => ${days})
            ${q.connectionId ? sql`and t3.provider_connection_id = ${q.connectionId}::uuid` : sql``}) as "received"
      from conversation_threads t
      where t.org_id = ${ctx.orgId} and t.merged_into_id is null and t.source in ('INSTAGRAM','FACEBOOK','TIKTOK') ${conn}`),
  );
  const accounts = rowsOf<{ state: string; n: number }>(
    await ctx.db.execute(
      sql`select state::text, count(*)::int n from provider_connections where org_id = ${ctx.orgId} and provider = 'instagram' group by state`,
    ),
  );
  const problems = rowsOf<any>(
    await ctx.db.execute(
      sql`select id, label, state::text as state, last_error as "lastError", config->>'username' as username from provider_connections where org_id = ${ctx.orgId} and provider = 'instagram' and state::text not in ('ACTIVE','PARTIAL_SYNC') order by updated_at desc limit 10`,
    ),
  );
  const needsReply = rowsOf<any>(
    await ctx.db.execute(sql`
      select t.id, t.participant_name as "participantName", t.kind, t.last_inbound_at as "lastInboundAt",
             c.config->>'username' as "accountUsername",
             (select m.body_preview from messages m where m.thread_id = t.id order by m.received_at desc limit 1) as preview
      from conversation_threads t left join provider_connections c on c.id = t.provider_connection_id
      where t.org_id = ${ctx.orgId} and t.state = 'NEED_REPLY' and not t.archived_local and t.merged_into_id is null
        and t.source in ('INSTAGRAM','FACEBOOK','TIKTOK') ${conn}
      order by t.last_inbound_at asc nulls last limit 8`),
  );
  const leads = rowsOf<any>(
    await ctx.db.execute(sql`
      select t.id, t.participant_name as "participantName", t.opportunity_id as "opportunityId", c.config->>'username' as "accountUsername", t.last_inbound_at as "lastInboundAt"
      from conversation_threads t left join provider_connections c on c.id = t.provider_connection_id
      where t.org_id = ${ctx.orgId} and t.opportunity_id is not null and t.source in ('INSTAGRAM','FACEBOOK','TIKTOK') ${conn}
      order by t.last_inbound_at desc nulls last limit 8`),
  );
  const scheduled = await scheduledContent(ctx, 5);
  return {
    ...r,
    days,
    accountsTotal: accounts.reduce((a, b) => a + b.n, 0),
    accountsByState: accounts,
    connectionProblems: problems,
    needsReplyList: needsReply,
    leadList: leads,
    scheduled,
    // Mentions are not collected by any built connector yet; report that instead of a zero.
    mentions: null,
    notes: {
      unread:
        'Unread is CreatorOS read state. Instagram does not tell us what you read in the Instagram app.',
      mentions: 'Mentions are not collected yet.',
    },
  };
}

/** Planned or scheduled publications from the existing Publishing module (not a second scheduler). */
export async function scheduledContent(ctx: Ctx, limit = 100) {
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select p.id, p.title, p.state::text as state, p.planned_at as "plannedAt", p.planned_timezone as "timezone",
             sa.platform::text as platform, sa.handle as "accountHandle"
      from publication_records p join social_accounts sa on sa.id = p.social_account_id
      where p.org_id = ${ctx.orgId} and p.state::text in ('PLANNED','READY','SCHEDULED') and p.planned_at is not null
      order by p.planned_at asc limit ${limit}`),
  );
}

type Status = 'AVAILABLE_WHEN_CONNECTED' | 'NOT_BUILT' | 'UNSUPPORTED_BY_API' | 'MANUAL_ONLY';
interface PlatformInfo {
  platform: string;
  name: string;
  status: Status;
  capabilities: Record<string, string>;
  nativeInbox: string | null;
  note: string;
}

/** Honest platform matrix. Nothing is reported as working unless code exists; none of it has been live-verified. */
const igNote = (live: Record<string, string>) => {
  const base =
    'Instagram API with Instagram Login. Needs a Meta app, test users or app review, and a public webhook URL.';
  if (!Object.keys(live).length) return `${base} Live checks have not been run yet.`;
  const word = (k: string) =>
    ({
      END_TO_END: 'verified end to end',
      IMPORTED: 'real data imported',
      REACHABLE_NO_DATA: 'API reachable, no data returned',
      FAILED: 'API call failed',
    })[live[k] ?? ''] ?? 'not tested';
  return `${base} Live status: posts ${word('media')}; comments ${word('comments')}; DMs ${word('conversations')}; webhook delivery ${live.webhookDelivery === 'VERIFIED_LIVE' ? 'received' : 'not received'}. HTTP 200 with zero records is not counted as imported.`;
};

export function platformCatalog(live: Record<string, string> = {}): PlatformInfo[] {
  const mark = (key: string, fallback: string) =>
    live[key] === 'END_TO_END'
      ? 'LIVE_VERIFIED_END_TO_END'
      : live[key] === 'IMPORTED'
        ? 'LIVE_IMPORTED'
        : live[key] === 'REACHABLE_NO_DATA'
          ? 'REACHABLE_NO_DATA'
          : fallback;
  return [
    {
      platform: 'instagram',
      name: 'Instagram',
      status: 'AVAILABLE_WHEN_CONNECTED',
      capabilities: {
        'Read DMs (API read + webhook)': mark('conversations', 'BUILT_NOT_VERIFIED'),
        'Reply to DMs': 'BUILT_MOCK_TESTED_ONLY',
        'Read comments (API read + webhook)': mark('comments', 'BUILT_NOT_VERIFIED'),
        'Reply to comments': 'BUILT_MOCK_TESTED_ONLY',
        'Read posts (media)': mark('media', 'BUILT_NOT_VERIFIED'),
        'Moderate comments': 'NOT_BUILT',
        Publishing: 'NOT_BUILT',
        Insights: 'NOT_BUILT',
      },
      nativeInbox: 'https://www.instagram.com/direct/inbox/',
      note: igNote(live),
    },
    {
      platform: 'facebook',
      name: 'Facebook Pages and Messenger',
      status: 'NOT_BUILT',
      capabilities: {
        'Page comments': 'NOT_BUILT',
        'Messenger conversations': 'NOT_BUILT',
        Insights: 'NOT_BUILT',
      },
      nativeInbox: 'https://business.facebook.com/latest/inbox',
      note: 'Needs Page access tokens and pages_messaging / pages_manage_engagement permissions (app review). Not implemented in CreatorOS yet.',
    },
    {
      platform: 'youtube',
      name: 'YouTube',
      status: 'NOT_BUILT',
      capabilities: {
        'Direct messages': 'UNSUPPORTED_BY_API',
        'Read comments': 'NOT_BUILT',
        'Reply to comments': 'NOT_BUILT',
        'Import uploads (Publishing module)': 'BUILT_UNVERIFIED',
      },
      nativeInbox: 'https://studio.youtube.com/channel/UC/comments',
      note: 'The YouTube Data API has no direct-message inbox. Comment reading and replying is not built in Socials yet; the Publishing module imports uploads.',
    },
    {
      platform: 'tiktok',
      name: 'TikTok',
      status: 'MANUAL_ONLY',
      capabilities: {
        'Direct messages': 'UNSUPPORTED_BY_API',
        Comments: 'NOT_BUILT',
        'Account and video info': 'NOT_BUILT',
      },
      nativeInbox: 'https://www.tiktok.com/messages',
      note: 'No general DM API is known to be available to ordinary developer apps. Use the native inbox; log leads and follow-ups in CreatorOS manually.',
    },
    {
      platform: 'threads',
      name: 'Threads',
      status: 'NOT_BUILT',
      capabilities: {
        'Read replies': 'NOT_BUILT',
        'Reply management': 'NOT_BUILT',
        'Direct messages': 'UNSUPPORTED_BY_API',
      },
      nativeInbox: 'https://www.threads.net/',
      note: 'The Threads API covers posts and replies, not DMs. Not implemented in CreatorOS yet.',
    },
  ];
}
